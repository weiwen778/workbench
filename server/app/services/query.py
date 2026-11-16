"""数据表服务端筛选与排序（参数化、字段白名单）。"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy import Numeric, and_, cast, column, func, or_, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import DataField, DataRecord, DataTable

MAX_FILTERS = 10
MAX_SORTS = 3
UNSORTABLE = {"long_text", "multiselect", "attachment"}


def _dialect(db: Session) -> str:
    bind = db.get_bind()
    return bind.dialect.name if bind is not None else "sqlite"


def _json_text(db: Session, key: str):
    if _dialect(db) == "postgresql":
        return DataRecord.data.op("->>")(key)
    return func.json_extract(DataRecord.data, f'$."{key}"')


def _json_num(db: Session, key: str):
    return cast(_json_text(db, key), Numeric(24, 6))


def _bool_literal(db: Session, value: bool):
    if _dialect(db) == "postgresql":
        return "true" if value else "false"
    return 1 if value else 0


def parse_filters(raw: list[dict] | None) -> list[dict]:
    raw = raw or []
    if len(raw) > MAX_FILTERS:
        raise ApiError("TOO_MANY_FILTERS", f"最多支持 {MAX_FILTERS} 个筛选条件", 422)
    return raw


def build_conditions(db: Session, fields: dict[str, DataField], filters: list[dict]) -> list:
    conditions = []
    for item in filters:
        key = item.get("field") or item.get("key")
        op = item.get("op") or item.get("operator")
        value = item.get("value")
        field = fields.get(key) if key else None
        if field is None:
            raise ApiError("UNKNOWN_FILTER_FIELD", "筛选列不存在", 422, {"field": key})
        expr = _json_text(db, field.key)
        if op == "empty":
            conditions.append(or_(expr.is_(None), expr == ""))
        elif op == "not_empty":
            conditions.append(and_(expr.is_not(None), expr != ""))
        elif field.type == "checkbox":
            target = _bool_literal(db, bool(value))
            conditions.append(expr == target)
        elif field.type == "multiselect":
            wanted = value if isinstance(value, list) else [value]
            likes = [expr.like(f'%"{w}"%') for w in wanted if w]
            if not likes:
                continue
            conditions.append(or_(*likes) if op == "has_any" else and_(*likes))
        elif op == "contains":
            conditions.append(expr.like(f"%{value}%"))
        elif op in {"eq", "equals"}:
            conditions.append(expr == str(value))
        elif op in {"ne", "not_equals"}:
            conditions.append(expr != str(value))
        elif op in {"gt", "lt", "gte", "lte"}:
            target = _json_num(db, field.key) if field.type == "number" else expr
            operand = value
            if field.type == "number":
                from decimal import Decimal

                operand = Decimal(str(value))
            conditions.append(
                {
                    "gt": target > operand,
                    "lt": target < operand,
                    "gte": target >= operand,
                    "lte": target <= operand,
                }[op]
            )
        elif op == "between":
            if not isinstance(value, list) or len(value) != 2:
                raise ApiError("INVALID_FILTER", "区间筛选需要两个值", 422)
            if field.type == "number":
                from decimal import Decimal

                low, high = Decimal(str(value[0])), Decimal(str(value[1]))
                conditions.append(_json_num(db, field.key).between(low, high))
            else:
                conditions.append(expr.between(str(value[0]), str(value[1])))
        else:
            raise ApiError("INVALID_FILTER_OP", "不支持的筛选方式", 422, {"op": op})
    return conditions


def build_order(db: Session, fields: dict[str, DataField], sorts: list[dict]) -> list:
    if len(sorts) > MAX_SORTS:
        raise ApiError("TOO_MANY_SORTS", f"最多支持 {MAX_SORTS} 个排序列", 422)
    clauses = []
    for item in sorts:
        key = item.get("field") or item.get("key")
        field = fields.get(key) if key else None
        if field is None:
            raise ApiError("UNKNOWN_SORT_FIELD", "排序列不存在", 422, {"field": key})
        if field.type in UNSORTABLE:
            raise ApiError("FIELD_NOT_SORTABLE", f"{field.name} 不支持排序", 422, {"field": key})
        direction = (item.get("order") or item.get("direction") or "asc").lower()
        expr = _json_num(db, field.key) if field.type == "number" else _json_text(db, field.key)
        clause = expr.asc() if direction != "desc" else expr.desc()
        clauses.append(clause.nullslast() if direction != "desc" else clause.nullsfirst())
    clauses.append(DataRecord.id.asc())
    return clauses


def paginate(db: Session, table_id: int, filters: list[dict], sorts: list[dict], page: int, page_size: int):
    table=db.get(DataTable,table_id)
    if table and table.kind=='virtual':
        from .virtual_tables import paginate_virtual
        return paginate_virtual(db,table_id,filters,sorts,page,page_size)
    fields = {
        f.key: f for f in db.scalars(select(DataField).where(DataField.table_id == table_id)).all()
    }
    from .table_expressions import COMPUTED
    if any(fields.get(item.get('field') or item.get('key')) is not None and fields[item.get('field') or item.get('key')].type in COMPUTED for item in [*filters,*sorts]):
        from .table_calculated_query import calculated_paginate
        return calculated_paginate(db,table_id,fields,filters,sorts,page,page_size)
    conditions = build_conditions(db, fields, filters)
    base = select(DataRecord).where(DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None))
    if conditions:
        base = base.where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    stmt = base.order_by(*build_order(db, fields, sorts)).offset((page - 1) * page_size).limit(page_size)
    rows = db.scalars(stmt).all()
    from .table_calculated_query import project
    return total, project(db, list(rows), fields), fields
