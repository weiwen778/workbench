from __future__ import annotations

import io
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import DataField, DataRecord, DataTable, DataTransferJob, FileObject, utcnow
from ..services.fields import validate_record
from ..services.query import paginate, parse_filters
from ..utils import iso_z, stringify_decimal

router = APIRouter(tags=["transfer"], dependencies=[Depends(get_current_user)])

MAX_ROWS = 10_000
MAX_COLS = 50
TRUE_WORDS = {"true", "是", "1", "yes", "y", "对"}
FALSE_WORDS = {"false", "否", "0", "no", "n", "错"}
MULTI_SEP = re.compile(r"[,;、，；|]")


class MappingIn(BaseModel):
    sheet: str | None = None
    mapping: dict | None = None
    table_name: str | None = None
    fields: list[dict] | None = None


class ExportIn(BaseModel):
    scope: str = "all"
    filters: list[dict] = []
    sorts: list[dict] = []


def _job(db: Session, job_id: int) -> DataTransferJob:
    job = db.get(DataTransferJob, job_id)
    if not job:
        raise ApiError("NOT_FOUND", "任务不存在", 404)
    if job.expires_at is not None and job.expires_at <= utcnow():
        raise ApiError("TRANSFER_EXPIRED", "导入导出任务已过期，请重新提交", 410)
    return job


def job_payload(job: DataTransferJob) -> dict:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "table_id": job.table_id,
        "result": job.result,
        "errors": job.errors,
        "created_at": iso_z(job.created_at),
        "updated_at": iso_z(job.updated_at),
    }


def _read_sheets(raw: bytes) -> tuple[dict[str, list[list]], str]:
    wb = load_workbook(io.BytesIO(raw), data_only=True)
    sheets: dict[str, list[list]] = {}
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows():
            values = []
            for cell in row:
                value = cell.value
                if (isinstance(value, (int, float)) and not isinstance(value, bool)
                        and float(value).is_integer() and re.fullmatch(r"0+", cell.number_format or "")):
                    value = format(int(value), f"0{len(cell.number_format)}d")
                values.append(value)
            rows.append(values)
        sheets[ws.title] = rows
    wb.close()
    return sheets, wb.sheetnames[0] if wb.sheetnames else ""


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return stringify_decimal(int(value))
    return str(value).strip()


def _infer_type(values: list) -> str:
    texts = [_cell_text(v) for v in values if v not in (None, "")]
    if not texts:
        return "short_text"
    if all(t.lower() in TRUE_WORDS | FALSE_WORDS for t in texts):
        return "checkbox"
    is_date = True
    for t in texts:
        try:
            date.fromisoformat(t[:10])
        except ValueError:
            is_date = False
            break
    if is_date:
        return "date"
    is_number = True
    for t in texts:
        try:
            float(t.replace(",", ""))
        except ValueError:
            is_number = False
            break
    if is_number:
        return "number"
    return "short_text"


@router.post("/imports/preview")
async def preview_import(
    file: UploadFile = File(...),
    table_id: int | None = Form(default=None),
    sheet: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    if len(raw) > settings.max_upload_bytes:
        raise ApiError("FILE_TOO_LARGE", "文件不能超过 20 MB", 413)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise ApiError("UNSUPPORTED_FILE", "当前只支持 .xlsx 文件", 415)

    try:
        sheets, first_sheet = _read_sheets(raw)
    except Exception:
        raise ApiError("INVALID_WORKBOOK", "无法解析这个 Excel 文件，请确认是有效的 .xlsx", 422)

    sheet_name = sheet or first_sheet
    if sheet_name not in sheets:
        raise ApiError("SHEET_NOT_FOUND", "选择的工作表不存在", 422)
    rows = sheets[sheet_name]
    while rows and all(v in (None, "") for v in rows[-1]):
        rows.pop()
    if not rows:
        raise ApiError("EMPTY_SHEET", "这个工作表没有内容", 422)

    headers = [_cell_text(v) for v in rows[0]]
    if len(headers) > MAX_COLS:
        raise ApiError("TOO_MANY_COLUMNS", f"最多支持 {MAX_COLS} 个字段", 422)
    if any(not h for h in headers):
        raise ApiError("EMPTY_HEADER", "表头中有空列名，请先补全再导入", 422)
    if len(set(headers)) != len(headers):
        raise ApiError("DUPLICATE_HEADER", "表头有重复列名，请先修正", 422)

    data_rows: list[tuple[int, list]] = []
    for index, row in enumerate(rows[1:], start=2):
        if all(v in (None, "") for v in row):
            continue  # 全空行跳过，但保留原行号
        data_rows.append((index, list(row) + [None] * (len(headers) - len(row))))
    if len(data_rows) > MAX_ROWS:
        raise ApiError("TOO_MANY_ROWS", f"单批最多 {MAX_ROWS} 条数据", 422)
    if not data_rows:
        raise ApiError("NO_DATA_ROWS", "工作表里没有数据行", 422)

    fields: list[DataField] = []
    mode = "existing"
    table = None
    if table_id:
        table = db.get(DataTable, table_id)
        if not table or table.deleted_at is not None:
            raise ApiError("TABLE_NOT_FOUND", "数据表不存在", 404)
        fields = list(
            db.scalars(
                select(DataField).where(DataField.table_id == table_id).order_by(DataField.sort_order)
            ).all()
        )
        mapping = {}
        for col, header in enumerate(headers):
            match = next((f for f in fields if f.name == header), None)
            mapping[str(col)] = match.key if match else None
    else:
        mode = "new_table"
        drafts = []
        for col, header in enumerate(headers):
            column_values = [row[col] for _, row in data_rows[:200]]
            ftype = _infer_type(column_values)
            options = []
            if ftype == "short_text":
                uniq = {_cell_text(v) for v in column_values if v not in (None, "")}
                if 1 < len(uniq) <= 12 and all(len(u) <= 40 for u in uniq):
                    ftype = "select"
                    options = [{"id": f"opt_{i}", "name": name} for i, name in enumerate(sorted(uniq))]
            drafts.append(
                {
                    "key": f"col_{col}",
                    "name": header,
                    "type": ftype,
                    "required": False,
                    "options": options,
                }
            )
        mapping = {str(col): f"col_{col}" for col in range(len(headers))}

    job = DataTransferJob(
        kind="import",
        table_id=table_id,
        status="preview",
        payload={
            "mode": mode,
            "sheet": sheet_name,
            "headers": headers,
            "rows": [[_cell_text(v) for v in row] for _, row in data_rows],
            "row_numbers": [n for n, _ in data_rows],
            "mapping": mapping,
            "fields": drafts if mode == "new_table" else None,
            "table_name": table.name if table else (Path(file.filename or "导入数据").stem[:100]),
            "file_name": file.filename,
        },
        errors=[],
        expires_at=utcnow() + timedelta(hours=settings.staged_ttl_hours),
    )
    db.add(job)
    db.commit()

    return {
        **job_payload(job),
        "sheets": list(sheets.keys()),
        "sheet": sheet_name,
        "mode": mode,
        "headers": headers,
        "row_count": len(data_rows),
        "sample": [[_cell_text(v) for v in row] for _, row in data_rows[:10]],
        "sample_row_numbers": [n for n, _ in data_rows[:10]],
        "mapping": job.payload["mapping"],
        "fields": job.payload["fields"],
        "table_name": job.payload["table_name"],
    }


def _to_field_value(field: dict, text: str) -> tuple[bool, object, str | None]:
    """返回 (ok, value, error_message)。"""
    if text == "":
        if field.get("required"):
            return False, None, "必填字段为空"
        return True, None, None
    ftype = field["type"]
    if ftype == "number":
        try:
            return True, stringify_decimal(text.replace(",", "")), None
        except ValueError:
            return False, None, "不是合法数字"
    if ftype == "date":
        try:
            return True, date.fromisoformat(text[:10]).isoformat(), None
        except ValueError:
            return False, None, "不是合法日期"
    if ftype == "checkbox":
        low = text.lower()
        if low in TRUE_WORDS:
            return True, True, None
        if low in FALSE_WORDS:
            return True, False, None
        return False, None, "勾选值需要是 true/false、是/否 或 1/0"
    if ftype == "select":
        opts = {o["name"]: o["id"] for o in field.get("options") or []}
        if text in opts:
            return True, opts[text], None
        return False, None, "不在该字段的选项中"
    if ftype == "multiselect":
        opts = {o["name"]: o["id"] for o in field.get("options") or []}
        parts = [p.strip() for p in MULTI_SEP.split(text) if p.strip()]
        ids = []
        for part in parts:
            if part not in opts:
                return False, None, f"选项「{part}」不在该字段中"
            if opts[part] not in ids:
                ids.append(opts[part])
        return True, ids, None
    if ftype == "attachment":
        return False, None, "附件不能在导入中迁移，请导入后单独上传"
    if ftype == "url":
        if not text.startswith(("http://", "https://")):
            return False, None, "需要完整的 http/https 地址"
        return True, text[:2048], None
    limit = 500 if ftype == "short_text" else 20_000
    if len(text) > limit:
        return False, None, f"超过 {limit} 个字符"
    return True, text, None


def _validate_rows(job: DataTransferJob, fields: list[dict]) -> list[dict]:
    payload = job.payload or {}
    mapping = payload.get("mapping") or {}
    headers = payload.get("headers") or []
    rows = payload.get("rows") or []
    row_numbers = payload.get("row_numbers") or []
    by_key = {f["key"]: f for f in fields}
    errors: list[dict] = []
    for idx, row in enumerate(rows):
        excel_row = row_numbers[idx] if idx < len(row_numbers) else idx + 2
        for col_str, field_key in mapping.items():
            if not field_key:
                continue
            col = int(col_str)
            field = by_key.get(field_key)
            if not field:
                errors.append({"row": excel_row, "column": headers[col], "message": "字段不存在"})
                continue
            text = row[col] if col < len(row) else ""
            ok, _value, message = _to_field_value(field, text or "")
            if not ok:
                errors.append({"row": excel_row, "column": headers[col], "message": message})
        if len(errors) > 500:
            errors.append({"row": excel_row, "column": "-", "message": "错误过多，已停止检查"})
            break
    return errors


@router.post("/imports/{job_id}/draft")
def update_draft(job_id: int, payload: MappingIn, db: Session = Depends(get_db)):
    job = _job(db, job_id)
    if job.kind != "import":
        raise ApiError("INVALID_JOB", "任务类型不匹配", 422)
    data = dict(job.payload or {})
    if payload.sheet and payload.sheet != data.get("sheet"):
        raise ApiError("SHEET_CHANGED", "切换工作表需要重新上传预览", 409)
    if payload.mapping is not None:
        data["mapping"] = payload.mapping
    if payload.fields is not None:
        data["fields"] = payload.fields
    if payload.table_name:
        data["table_name"] = payload.table_name
    job.payload = data

    if data.get("mode") == "new_table":
        fields = data.get("fields") or []
    else:
        fields = [
            {
                "key": f.key,
                "name": f.name,
                "type": f.type,
                "required": f.required,
                "options": f.options or [],
            }
            for f in db.scalars(select(DataField).where(DataField.table_id == job.table_id)).all()
        ]
    job.errors = _validate_rows(job, fields)
    job.status = "ready" if not job.errors else "needs_fix"
    job.updated_at = utcnow()
    db.commit()
    return job_payload(job)


@router.post("/imports/{job_id}/confirm")
def confirm_import(job_id: int, db: Session = Depends(get_db)):
    job = _job(db, job_id)
    if job.kind != "import":
        raise ApiError("INVALID_JOB", "任务类型不匹配", 422)
    if job.status == "success":
        return job_payload(job)  # 幂等：重复确认不重复追加
    data = dict(job.payload or {})

    if data.get("mode") == "new_table":
        fields_def = data.get("fields") or []
        if not fields_def:
            raise ApiError("NO_FIELDS", "请先确认字段配置", 422)
        name = (data.get("table_name") or "导入数据").strip()[:100]
        if db.scalar(select(DataTable).where(DataTable.name == name, DataTable.deleted_at.is_(None))):
            raise ApiError("NAME_DUPLICATED", "已有同名数据表，请换个表名", 409)
    else:
        table = db.get(DataTable, job.table_id) if job.table_id else None
        if not table or table.deleted_at is not None:
            raise ApiError("TABLE_NOT_FOUND", "数据表不存在", 404)
        fields_def = [
            {"key": f.key, "name": f.name, "type": f.type, "required": f.required, "options": f.options or []}
            for f in db.scalars(select(DataField).where(DataField.table_id == table.id)).all()
        ]

    errors = _validate_rows(job, fields_def)
    if errors:
        job.errors = errors
        job.status = "needs_fix"
        db.commit()
        raise ApiError("IMPORT_VALIDATION_FAILED", "这批数据有错误，本次不会导入任何一行", 422,
                       {"errors": errors[:200], "error_count": len(errors)})

    mapping = data.get("mapping") or {}
    headers = data.get("headers") or []
    rows = data.get("rows") or []

    prepared: list[dict] = []
    for row in rows:
        record: dict = {}
        for col_str, field_key in mapping.items():
            if not field_key:
                continue
            col = int(col_str)
            field = next((f for f in fields_def if f["key"] == field_key), None)
            if not field:
                continue
            ok, value, _msg = _to_field_value(field, row[col] if col < len(row) else "")
            record[field_key] = value
        prepared.append(record)

    try:
        if data.get("mode") == "new_table":
            table = DataTable(name=(data.get("table_name") or "导入数据")[:100])
            db.add(table)
            db.flush()
            key_map: dict[str, str] = {}
            for index, fd in enumerate(fields_def):
                field = DataField(
                    table_id=table.id,
                    name=fd["name"][:50],
                    type=fd["type"],
                    required=bool(fd.get("required")),
                    options=fd.get("options") or None,
                    sort_order=index,
                )
                db.add(field)
                db.flush()
                key_map[fd["key"]] = field.key
            for record in prepared:
                db.add(DataRecord(table_id=table.id, data={key_map[k]: v for k, v in record.items()}))
            job.table_id = table.id
        else:
            table = db.get(DataTable, job.table_id)
            for record in prepared:
                db.add(DataRecord(table_id=table.id, data=record))
            table.schema_version += 0
        db.flush()
        job.status = "success"
        job.errors = []
        job.result = {"imported": len(prepared), "table_id": table.id, "table_name": table.name}
        job.updated_at = utcnow()
        db.commit()
    except Exception:
        db.rollback()
        job = _job(db, job_id)
        job.status = "failed"
        job.errors = [{"row": 0, "column": "-", "message": "写入失败，本批次未导入任何数据"}]
        db.commit()
        raise ApiError("IMPORT_FAILED", "导入失败，本批次未写入任何数据", 500)

    return job_payload(job)


@router.get("/data-transfer-jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    return job_payload(_job(db, job_id))


@router.get("/data-transfer-jobs/{job_id}/download")
def download_job(job_id: int, db: Session = Depends(get_db)):
    job = _job(db, job_id)
    if not job.file_id:
        raise ApiError("NO_FILE", "该任务没有可下载的文件", 404)
    obj = db.get(FileObject, job.file_id)
    if not obj:
        raise ApiError("NOT_FOUND", "导出文件已过期", 404)
    path = settings.storage_dir / "exports" / obj.storage_key
    if not path.exists():
        raise ApiError("FILE_MISSING", "导出文件已不在存储中", 410)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=obj.original_name,
        content_disposition_type="attachment",
    )


@router.post("/tables/{table_id}/exports", status_code=201)
def export_table(table_id: int, payload: ExportIn, db: Session = Depends(get_db)):
    table = db.get(DataTable, table_id)
    if not table or table.deleted_at is not None:
        raise ApiError("TABLE_NOT_FOUND", "数据表不存在", 404)
    fields = list(
        db.scalars(
            select(DataField).where(DataField.table_id == table_id).order_by(DataField.sort_order)
        ).all()
    )
    if payload.scope not in {"all", "filtered"}:
        raise ApiError("INVALID_SCOPE", "导出范围不合法", 422)

    if payload.scope == "filtered":
        total, rows, _ = paginate(db, table_id, parse_filters(payload.filters), payload.sorts, 1, 100)
        # 导出全部匹配数据，不只当前页
        from ..services.query import build_conditions, build_order

        fields_map = {f.key: f for f in fields}
        stmt = select(DataRecord).where(
            DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None)
        )
        conditions = build_conditions(db, fields_map, payload.filters)
        if conditions:
            stmt = stmt.where(*conditions)
        all_rows = list(db.scalars(stmt.order_by(*build_order(db, fields_map, payload.sorts))).all())
    else:
        all_rows = list(
            db.scalars(
                select(DataRecord)
                .where(DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None))
                .order_by(DataRecord.id)
            ).all()
        )

    wb = Workbook()
    ws = wb.active
    ws.title = re.sub(r"[\[\]\*\?:/\\]", "_", table.name)[:31] or "数据"
    ws.append([f.name for f in fields])
    for cell in ws[1]:
        cell.data_type = "s"
    option_names = {
        f.key: {o["id"]: o["name"] for o in (f.options or [])} for f in fields if f.type in {"select", "multiselect"}
    }
    for record in all_rows:
        row = []
        for field in fields:
            value = (record.data or {}).get(field.key)
            if field.type == "checkbox":
                row.append("是" if value else "否")
            elif field.type in {"select", "multiselect"}:
                names = option_names.get(field.key, {})
                if isinstance(value, list):
                    row.append("、".join(names.get(v, v) for v in value))
                else:
                    row.append(names.get(value, value) if value else "")
            elif field.type == "attachment" and value:
                attached = db.get(FileObject, value)
                row.append(attached.original_name if attached else "附件已不可用")
            elif isinstance(value, (int, float)):
                row.append(value)
            else:
                row.append("" if value is None else str(value))
        ws.append(row)
        for index, field in enumerate(fields, start=1):
            cell = ws.cell(row=ws.max_row, column=index)
            # User text must remain text, including strings starting with '='.
            if isinstance(cell.value, str):
                cell.data_type = "s"
            file_id = (record.data or {}).get(field.key)
            if field.type == "attachment" and file_id:
                cell.hyperlink = f"{settings.public_base_url.rstrip('/')}/api/v1/files/{file_id}/download"
                cell.style = "Hyperlink"

    export_dir = settings.storage_dir / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    storage_key = f"export_{table_id}_{utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}.xlsx"
    buffer = io.BytesIO()
    wb.save(buffer)
    (export_dir / storage_key).write_bytes(buffer.getvalue())

    file_obj = FileObject(
        storage_key=storage_key,
        original_name=f"{table.name}.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size=len(buffer.getvalue()),
        status="bound",
    )
    db.add(file_obj)
    db.flush()
    job = DataTransferJob(
        kind="export",
        table_id=table_id,
        status="success",
        payload={"scope": payload.scope, "rows": len(all_rows)},
        result={"rows": len(all_rows), "file_id": file_obj.id},
        file_id=file_obj.id,
        expires_at=utcnow() + timedelta(hours=settings.staged_ttl_hours),
    )
    db.add(job)
    db.commit()
    return {
        **job_payload(job),
        "download_url": f"/api/v1/data-transfer-jobs/{job.id}/download",
        "rows": len(all_rows),
    }


@router.get("/tables/{table_id}/exports")
def list_exports(table_id: int, db: Session = Depends(get_db)):
    jobs = db.scalars(
        select(DataTransferJob)
        .where(DataTransferJob.kind == "export", DataTransferJob.table_id == table_id)
        .order_by(DataTransferJob.created_at.desc())
        .limit(20)
    ).all()
    return [job_payload(j) for j in jobs]
