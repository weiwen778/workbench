from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import DataField, DataRecord, DataTable, FileObject, FileRef, utcnow
from ..services.fields import FIELD_TYPES, validate_record
from ..services.virtual_tables import physical_only
from ..services.query import paginate, parse_filters
from ..services.trash import push
from ..utils import iso_z

router = APIRouter(tags=["tables"], dependencies=[Depends(get_current_user)])

from ..table_limits import MAX_FIELDS
MAX_OPTIONS = 100


class FieldIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    type: str
    required: bool = False
    default_value: Any = None
    options: list[dict] | None = None
    config: dict | None = None


class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=2000)
    fields: list[FieldIn] = []


class TablePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = Field(default=None, max_length=2000)
    sort_order: int | None = None


class FieldPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    type: str | None = None
    required: bool | None = None
    default_value: Any = None
    options: list[dict] | None = None
    config: dict | None = None
    sort_order: int | None = None


class RecordIn(BaseModel):
    data: dict = {}
    version: int | None = None


class BatchDeleteIn(BaseModel):
    ids: list[int]


def field_payload(f: DataField) -> dict:
    return {
        "id": f.id,
        "key": f.key,
        "name": f.name,
        "type": f.type,
        "required": f.required,
        "default_value": f.default_value,
        "options": f.options or [],
        "config": f.config or {},
        "sort_order": f.sort_order,
    }


def table_payload(t: DataTable, fields: list[DataField] | None = None, record_count: int | None = None) -> dict:
    out = {
        "id": t.id,
        "name": t.name,
        "note": t.note,
        "schema_version": t.schema_version,
        "kind": t.kind,
        "virtual_config": t.virtual_config if t.kind=="virtual" else None,
        "sort_order": t.sort_order,
        "created_at": iso_z(t.created_at),
        "updated_at": iso_z(t.updated_at),
    }
    if fields is not None:
        out["fields"] = [field_payload(f) for f in fields]
    if record_count is not None:
        out["record_count"] = record_count
    return out


def record_payload(r: DataRecord, db=None) -> dict:
    if db is not None:
        from ..services.table_calculated_query import project
        r=project(db,[r],{f.key:f for f in _fields(db,r.table_id)})[0]
    out = {
        "id": r.id,
        "data": r.data,
        "version": r.version,
        "created_at": iso_z(r.created_at),
        "updated_at": iso_z(r.updated_at),
    }

    if hasattr(r,"computed_errors"):out["computed_errors"]=r.computed_errors
    if hasattr(r,"origins"):out.update(origins=r.origins,origin_count=r.origin_count)
    return out


def _get_table(db: Session, table_id: int) -> DataTable:
    table = db.get(DataTable, table_id)
    if not table or table.deleted_at is not None:
        raise ApiError("TABLE_NOT_FOUND", "表格不存在或已删除", 404)
    return table


def _lock_table(db, table_id):
    table=_get_table(db,table_id)
    locked=db.execute(update(DataTable).where(DataTable.id==table_id,DataTable.schema_version==table.schema_version,DataTable.deleted_at.is_(None)).values(schema_version=table.schema_version,updated_at=table.updated_at))
    if locked.rowcount!=1:raise ApiError('SCHEMA_CONFLICT','表格结构已改变，请刷新后重试',409)
    return table


def _fields(db: Session, table_id: int) -> list[DataField]:
    return list(
        db.scalars(
            select(DataField).where(DataField.table_id == table_id).order_by(DataField.sort_order, DataField.id)
        ).all()
    )


def _check_field_payload(payload: FieldIn, existing_names: set[str]) -> None:
    if payload.type not in FIELD_TYPES:
        raise ApiError("INVALID_FIELD_TYPE", "列类型不合法", 422, {"field": payload.name})
    name = payload.name.strip()
    if not name: raise ApiError("INVALID_FIELD_NAME", "字段名称不能为空", 422)
    if name in existing_names:
        raise ApiError("FIELD_NAME_DUPLICATED", "同一张表格里列名不能重复", 409, {"field": name})
    if payload.type in {"select", "multiselect"}:
        options = payload.options or []
        if len(options) > MAX_OPTIONS:
            raise ApiError("TOO_MANY_OPTIONS", f"每个单选／多选列最多 {MAX_OPTIONS} 个选项", 422)
        ids = [o.get("id") for o in options]
        if any(not i for i in ids) or len(set(ids)) != len(ids):
            raise ApiError("INVALID_OPTIONS", "选项标识缺失或重复", 422)


def _new_option_id(index: int) -> str:
    return f"opt_{index}_{utcnow().strftime('%H%M%S%f')}"


# ---------------------------------------------------------------- 表


@router.get("/tables")
def list_tables(db: Session = Depends(get_db)):
    tables = db.scalars(
        select(DataTable)
        .where(DataTable.deleted_at.is_(None), DataTable.kind != "virtual")
        .order_by(DataTable.sort_order, DataTable.id)
    ).all()
    counts = dict(
        db.execute(
            select(DataRecord.table_id, func.count(DataRecord.id))
            .where(DataRecord.deleted_at.is_(None))
            .group_by(DataRecord.table_id)
        ).all()
    )
    field_counts = {}
    field_previews: dict[int, list[dict]] = {}
    for table_id, name, kind in db.execute(
        select(DataField.table_id, DataField.name, DataField.type)
        .order_by(DataField.table_id, DataField.sort_order, DataField.id)
    ).all():
        field_counts[table_id] = field_counts.get(table_id, 0) + 1
        preview = field_previews.setdefault(table_id, [])
        if len(preview) < 4:
            preview.append({"name": name, "type": kind})
    return [
        {
            "id": t.id,
            "name": t.name,
            "note": t.note,
            "kind": t.kind,
            "record_count": None if t.kind=="virtual" else counts.get(t.id, 0),
            "field_count": field_counts.get(t.id, 0),
            "fields_preview": field_previews.get(t.id, []),
            "schema_version": t.schema_version,
            "created_at": iso_z(t.created_at),
            "updated_at": iso_z(t.updated_at),
        }
        for t in tables
    ]


@router.post("/tables", status_code=201)
def create_table(payload: TableIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if db.scalar(select(DataTable).where(DataTable.name == name, DataTable.deleted_at.is_(None))):
        raise ApiError("NAME_DUPLICATED", "已有同名表格", 409, {"field": "name"})
    if len(payload.fields) > MAX_FIELDS:
        raise ApiError("TOO_MANY_FIELDS", f"每张表格最多 {MAX_FIELDS} 列", 422)
    names: set[str] = set()
    for f in payload.fields:
        _check_field_payload(f, names)
        names.add(f.name.strip())

    table = DataTable(
        name=name,
        note=payload.note,
        sort_order=(db.scalar(select(func.max(DataTable.sort_order))) or 0) + 1,
    )
    db.add(table)
    db.flush()
    for index, f in enumerate(payload.fields):
        options = f.options
        if f.type in {"select", "multiselect"}:
            options = [
                {"id": o.get("id") or _new_option_id(i), "name": o.get("name", "")}
                for i, o in enumerate(options or [])
            ]
        db.add(
            DataField(
                table_id=table.id,
                name=f.name.strip(),
                type=f.type,
                required=f.required,
                default_value=f.default_value,
                options=options,
                config=f.config,
                sort_order=index,
            )
        )
    db.flush()
    from ..services.table_expressions import configure
    for field in _fields(db, table.id): configure(db, field, _fields(db, table.id))
    db.commit()
    return table_payload(table, _fields(db, table.id), 0)


@router.get("/tables/{table_id}")
def get_table(table_id: int, db: Session = Depends(get_db)):
    table = _get_table(db, table_id)
    if table.kind == "virtual":
        raise ApiError("NOT_FOUND", "此表格功能已下线", 404)
    count = (
        db.scalar(
            select(func.count(DataRecord.id)).where(
                DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None)
            )
        )
        or 0
    )
    return table_payload(table, _fields(db, table_id), None if table.kind=="virtual" else count)


@router.patch("/tables/{table_id}")
def update_table(table_id: int, payload: TablePatch, db: Session = Depends(get_db)):
    table = _lock_table(db, table_id)
    if payload.name is not None:
        name = payload.name.strip()
        dup = db.scalar(
            select(DataTable).where(
                DataTable.name == name, DataTable.id != table_id, DataTable.deleted_at.is_(None)
            )
        )
        if dup:
            raise ApiError("NAME_DUPLICATED", "已有同名表格", 409, {"field": "name"})
        table.name = name
    if payload.note is not None:
        table.note = payload.note
    if payload.sort_order is not None:
        table.sort_order = payload.sort_order
    db.commit()
    return table_payload(table, _fields(db, table_id))


@router.delete("/tables/{table_id}")
def delete_table(table_id: int, db: Session = Depends(get_db)):
    table = _lock_table(db, table_id)
    table.deleted_at = utcnow()
    push(
        db,
        "table",
        table.id,
        table.name,
        {
            "name": table.name,
            "note": table.note,
            "fields": [
                {
                    "id": f.id,
                    "key": f.key,
                    "name": f.name,
                    "type": f.type,
                    "required": f.required,
                    "default_value": f.default_value,
                    "options": f.options,
                    "sort_order": f.sort_order,
                }
                for f in _fields(db, table_id)
            ],
        },
    )
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 字段


@router.get("/tables/{table_id}/fields")
def list_fields(table_id: int, db: Session = Depends(get_db)):
    _get_table(db, table_id)
    return [field_payload(f) for f in _fields(db, table_id)]


@router.post("/tables/{table_id}/fields", status_code=201)
def add_field(table_id: int, payload: FieldIn, db: Session = Depends(get_db)):
    table = _lock_table(db, table_id)
    physical_only(table)
    fields = _fields(db, table_id)
    if len(fields) >= MAX_FIELDS:
        raise ApiError("TOO_MANY_FIELDS", f"每张表格最多 {MAX_FIELDS} 列", 422)
    _check_field_payload(payload, {f.name for f in fields})
    has_data = _has_any_data(db, table_id)
    if has_data and payload.required and payload.default_value is None:
        raise ApiError(
            "REQUIRED_NEEDS_DEFAULT",
            "表中已有数据，新增必填列需要提供默认值",
            409,
            {"field": payload.name},
        )
    options = payload.options
    if payload.type in {"select", "multiselect"}:
        options = [
            {"id": o.get("id") or _new_option_id(i), "name": o.get("name", "")}
            for i, o in enumerate(options or [])
        ]
    field = DataField(
        table_id=table_id,
        name=payload.name.strip(),
        type=payload.type,
        required=payload.required,
        default_value=payload.default_value,
        options=options,
        config=payload.config,
        sort_order=(max([f.sort_order for f in fields]) + 1) if fields else 0,
    )
    db.add(field)
    table.schema_version += 1
    db.flush()
    from ..services.table_expressions import configure
    configure(db, field, _fields(db, table_id))
    if field.required and field.default_value is not None:
        for record in db.scalars(
            select(DataRecord).where(DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None))
        ).all():
            data = dict(record.data or {})
            if data.get(field.key) in (None, "", []):
                data[field.key] = field.default_value
                record.data = data
                record.version += 1
    db.commit()
    return field_payload(field)



@router.patch("/fields/{field_id}")
def update_field(field_id: int, payload: FieldPatch, db: Session = Depends(get_db)):
    field = db.get(DataField, field_id)
    if not field:
        raise ApiError("NOT_FOUND", "列不存在", 404)
    table = _lock_table(db, field.table_id)
    physical_only(table)
    fields = _fields(db, table.id)

    if payload.name is not None:
        name = payload.name.strip()
        if any(f.id != field.id and f.name == name for f in fields):
            raise ApiError("FIELD_NAME_DUPLICATED", "同一张表格里列名不能重复", 409, {"field": name})
        field.name = name

    if payload.type is not None and payload.type != field.type:
        if payload.type not in FIELD_TYPES:
            raise ApiError("INVALID_FIELD_TYPE", "列类型不合法", 422)
        if _count_non_empty(db, table.id, field, include_deleted=True) > 0:
            raise ApiError(
                "TYPE_CHANGE_BLOCKED",
                "该列已有非空数据（含回收站数据），不能直接改类型；请新建列并迁移数据",
                409,
                {"field": field.name},
            )
        field.type = payload.type
        if field.type in {"select", "multiselect"}:
            field.options = [
                {"id": o.get("id") or _new_option_id(i), "name": o.get("name", "")}
                for i, o in enumerate(payload.options or [])
            ]
        else:
            field.options = None

    if payload.required is not None and payload.required and not field.required:
        empty_count = _count_empty(db, table.id, field)
        if empty_count:
            raise ApiError(
                "REQUIRED_CONFLICT",
                f"已有 {empty_count} 条数据的该列为空，请先补齐再设为必填",
                409,
                {"empty_count": empty_count},
            )
        field.required = True
    elif payload.required is not None and not payload.required:
        field.required = False

    if payload.default_value is not None:
        field.default_value = payload.default_value

    if payload.options is not None and field.type in {"select", "multiselect"}:
        old_ids = {o["id"] for o in (field.options or [])}
        new_ids = {o.get("id") for o in payload.options if o.get("id")}
        removed = old_ids - new_ids
        if removed:
            used = _count_option_refs(db, table.id, field, removed)
            if used:
                raise ApiError(
                    "OPTION_IN_USE",
                    f"有 {used} 条数据仍在使用要删除的选项，请先调整这些数据",
                    409,
                    {"used": used, "options": sorted(removed)},
                )
        field.options = [
            {"id": o.get("id") or _new_option_id(i), "name": o.get("name", "")}
            for i, o in enumerate(payload.options)
        ]

    if payload.sort_order is not None:
        field.sort_order = payload.sort_order

    if payload.config is not None: field.config = payload.config
    from ..services.table_expressions import configure
    configure(db, field, fields)
    table.schema_version += 1
    db.commit()
    return field_payload(field)



@router.delete("/fields/{field_id}")
def delete_field(field_id: int, confirm: bool = Query(default=False), db: Session = Depends(get_db)):
    field = db.get(DataField, field_id)
    if not field:
        raise ApiError("NOT_FOUND", "列不存在", 404)
    table = _lock_table(db, field.table_id)
    physical_only(table)
    active_count = _count_non_empty(db, table.id, field, include_deleted=False)
    trashed_count = _count_non_empty(db, table.id, field, include_deleted=True) - active_count
    if not confirm:
        raise ApiError(
            "DELETE_CONFIRM_REQUIRED",
            f"该列在 {active_count} 条活动数据和 {trashed_count} 条回收站数据中有值，确认后删除",
            409,
            {"active": active_count, "trashed": trashed_count},
        )
    remaining=[f for f in _fields(db,table.id) if f.id!=field.id]
    for record in db.scalars(select(DataRecord).where(DataRecord.table_id==table.id)):
        values=dict(record.data or {})
        if field.key in values:
            values.pop(field.key);record.data=values;record.version+=1
            _sync_file_refs(db,"record",record.id,remaining,values)
    db.delete(field)
    table.schema_version += 1
    db.commit()
    return {"ok": True, "removed_active_values": active_count, "removed_trashed_values": trashed_count}



def _has_any_data(db: Session, table_id: int) -> bool:
    return bool(
        db.scalar(
            select(func.count(DataRecord.id)).where(
                DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None)
            )
        )
    )


def _non_empty(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and value.strip() == "":
        return False
    if isinstance(value, list) and not value:
        return False
    return True


def _count_non_empty(db: Session, table_id: int, field: DataField, *, include_deleted: bool) -> int:
    stmt = select(DataRecord).where(DataRecord.table_id == table_id)
    if not include_deleted:
        stmt = stmt.where(DataRecord.deleted_at.is_(None))
    return sum(1 for r in db.scalars(stmt).all() if _non_empty((r.data or {}).get(field.key)))


def _count_empty(db: Session, table_id: int, field: DataField) -> int:
    records = db.scalars(
        select(DataRecord).where(DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None))
    ).all()
    return sum(1 for r in records if not _non_empty((r.data or {}).get(field.key)))


def _count_option_refs(db: Session, table_id: int, field: DataField, removed: set[str]) -> int:
    records = db.scalars(select(DataRecord).where(DataRecord.table_id == table_id)).all()
    count = 0
    for r in records:
        value = (r.data or {}).get(field.key)
        if isinstance(value, list):
            if any(v in removed for v in value):
                count += 1
        elif isinstance(value, str) and value in removed:
            count += 1
    return count


# ---------------------------------------------------------------- 记录


@router.get("/tables/{table_id}/records")
def list_records(
    table_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50),
    filters: str | None = None,
    sorts: str | None = None,
    db: Session = Depends(get_db),
):
    import json

    table = _get_table(db, table_id)
    if page_size not in (20, 50, 100):
        raise ApiError("INVALID_PAGE_SIZE", "每页只能是 20、50 或 100 条", 422)
    try:
        raw_filters = json.loads(filters) if filters else []
        parsed_sorts = json.loads(sorts) if sorts else []
    except (ValueError, TypeError):
        raise ApiError("INVALID_QUERY", "筛选和排序需要有效 JSON 数组", 422)
    if not isinstance(raw_filters,list) or not isinstance(parsed_sorts,list) or any(not isinstance(s,dict) for s in [*raw_filters,*parsed_sorts]):
        raise ApiError("INVALID_QUERY", "筛选和排序需要条件数组", 422)
    parsed_filters = parse_filters(raw_filters)
    total, rows, _fields_map = paginate(db, table_id, parsed_filters, parsed_sorts, page, page_size)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "schema_version": table.schema_version,
        "items": [record_payload(r) for r in rows],
    }


@router.post("/tables/{table_id}/records", status_code=201)
def create_record(table_id: int, payload: RecordIn, db: Session = Depends(get_db)):
    table = _lock_table(db, table_id)
    physical_only(table)
    fields = _fields(db, table_id)
    if not fields:
        raise ApiError("NO_FIELDS", "请先加至少一列，再添加内容", 409)
    data = validate_record(db, fields, payload.data, table_id=table_id)
    record = DataRecord(table_id=table_id, data=data)
    db.add(record)
    db.flush()
    _sync_file_refs(db, "record", record.id, fields, data)
    from ..services.table_history import append,snapshot
    append(db,table,"添加记录",[{"id":record.id,"before":None,"after":snapshot(record)}],fields)
    db.commit()
    return record_payload(record, db)



@router.get("/records/{record_id}")
def get_record(record_id: int, db: Session = Depends(get_db)):
    record = db.get(DataRecord, record_id)
    if not record or record.deleted_at is not None:
        raise ApiError("NOT_FOUND", "数据不存在", 404)
    return record_payload(record, db)


@router.put("/records/{record_id}")
def update_record(record_id: int, payload: RecordIn, db: Session = Depends(get_db)):
    record = db.get(DataRecord, record_id)
    if not record or record.deleted_at is not None:
        raise ApiError("NOT_FOUND", "数据不存在", 404)
    table = _lock_table(db, record.table_id)
    physical_only(table)
    db.refresh(record)
    if record.deleted_at is not None:raise ApiError("NOT_FOUND","数据不存在",404)
    if payload.version is not None and payload.version != record.version:
        raise ApiError("VERSION_CONFLICT", "这条数据已在其他位置被修改，请刷新后重试", 409,
                       {"current_version": record.version})
    fields = _fields(db, table.id)
    from ..services.table_expressions import COMPUTED
    incoming=dict(payload.data)
    computed=[f for f in fields if f.type in COMPUTED and f.key in incoming]
    if computed:
        current=record_payload(record,db)['data']
        for field in computed:
            if incoming[field.key]!=current.get(field.key):raise ApiError('READ_ONLY_FIELD','计算列不能手动修改',422)
            incoming.pop(field.key)
    data = validate_record(db, fields, incoming, table_id=table.id)
    from ..services.table_history import append,snapshot
    before=snapshot(record);expected=record.version
    changed=db.execute(update(DataRecord).where(DataRecord.id==record.id,DataRecord.version==expected,DataRecord.deleted_at.is_(None)).values(data=data,version=expected+1,updated_at=utcnow()))
    if changed.rowcount!=1:raise ApiError('VERSION_CONFLICT','数据已被修改，请重新读取',409)
    db.refresh(record)
    _sync_file_refs(db, "record", record.id, fields, data)
    append(db,table,"编辑记录",[{"id":record.id,"before":before,"after":snapshot(record)}],fields)
    db.commit()
    return record_payload(record, db)



@router.delete("/records/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    record = db.get(DataRecord, record_id)
    if not record or record.deleted_at is not None:
        raise ApiError("NOT_FOUND", "数据不存在", 404)
    table = _lock_table(db, record.table_id)
    physical_only(table)
    db.refresh(record)
    if record.deleted_at is not None:
        raise ApiError("NOT_FOUND", "数据已删除", 404)
    from ..services.table_history import append,snapshot
    before=snapshot(record)
    record.deleted_at = utcnow()
    record.deleted_snapshot = {
        "data": record.data,
        "version": record.version,
        "table_name": table.name if table else "",
    }
    push(
        db,
        "record",
        record.id,
        (table.name if table else "数据") + f" #{record.id}",
        record.deleted_snapshot,
        parent_id=record.table_id,
    )
    record.version+=1
    append(db,table,"删除记录",[{"id":record.id,"before":before,"after":snapshot(record)}],_fields(db,table.id))
    db.commit()
    return {"ok": True}



@router.post("/tables/{table_id}/records/batch-delete")
def batch_delete(table_id: int, payload: BatchDeleteIn, db: Session = Depends(get_db)):
    table = _lock_table(db, table_id)
    physical_only(table)
    if len(payload.ids) > 100:
        raise ApiError("BATCH_TOO_LARGE", "单批最多删除 100 条", 422)
    from ..services.table_history import append,snapshot
    entries=[]
    deleted = 0
    for record_id in payload.ids:
        record = db.get(DataRecord, record_id)
        if not record or record.table_id != table_id or record.deleted_at is not None:
            continue
        before=snapshot(record)
        record.deleted_at = utcnow()
        record.deleted_snapshot = {"data": record.data, "version": record.version, "table_name": table.name}
        push(db, "record", record.id, f"{table.name} #{record.id}", record.deleted_snapshot,
             parent_id=table.id)
        record.version+=1
        entries.append({"id":record.id,"before":before,"after":snapshot(record)})
        deleted += 1
    append(db,table,"批量删除",entries,_fields(db,table.id))
    db.commit()
    return {"ok": True, "deleted": deleted}



def _sync_file_refs(db: Session, owner_type: str, owner_id: int, fields: list[DataField], data: dict) -> None:
    existing = {
        ref.file_id
        for ref in db.scalars(
            select(FileRef).where(FileRef.owner_type == owner_type, FileRef.owner_id == owner_id)
        ).all()
    }
    current: set[int] = set()
    for field in fields:
        if field.type != "attachment":
            continue
        file_id = data.get(field.key)
        if isinstance(file_id, int):
            current.add(file_id)
            if file_id not in existing:
                db.add(FileRef(file_id=file_id, owner_type=owner_type, owner_id=owner_id))
            file_obj = db.get(FileObject, file_id)
            if file_obj:
                file_obj.status = "bound"
                file_obj.expires_at = None
    for file_id in existing - current:
        ref = db.scalar(
            select(FileRef).where(
                FileRef.file_id == file_id,
                FileRef.owner_type == owner_type,
                FileRef.owner_id == owner_id,
            )
        )
        if ref:
            db.delete(ref)
            db.flush()
            remaining = len(db.scalars(select(FileRef.id).where(FileRef.file_id == file_id)).all())
            if remaining == 0:
                file_obj = db.get(FileObject, file_id)
                # 解绑后回到暂存态，24 小时内可由清理任务回收，避免永久 bound 既不可删也 409
                if file_obj is not None and file_obj.status == "bound":
                    file_obj.status = "staged"
                    file_obj.expires_at = utcnow() + timedelta(hours=24)
