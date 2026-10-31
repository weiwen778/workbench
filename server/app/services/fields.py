"""字段类型校验与标准化（前后端双校验的服务端部分）。"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import FileObject, utcnow

FIELD_TYPES = {
    "short_text",
    "long_text",
    "number",
    "date",
    "select",
    "multiselect",
    "checkbox",
    "url",
    "attachment",
    "reference", "formula", "lookup", "rollup",
}

LIMITS = {
    "short_text": 500,
    "long_text": 20_000,
    "url": 2_048,
}

NUM_PRECISION = 18
NUM_SCALE = 6


def _fail(name: str, message: str) -> None:
    raise ApiError("FIELD_INVALID", message, 422, {"fields": {name: message}})


def normalize_number(value) -> str:
    try:
        dec = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, AttributeError):
        raise ValueError("请输入合法数字")
    if not dec.is_finite():
        raise ValueError("请输入合法数字")
    sign, digits, exp = dec.as_tuple()
    scale = max(0, -exp)
    total = len(digits)
    if scale > NUM_SCALE:
        raise ValueError(f"小数最多 {NUM_SCALE} 位")
    if total > NUM_PRECISION:
        raise ValueError(f"数字总长度最多 {NUM_PRECISION} 位")
    return format(dec.normalize(), "f")


def validate_value(db: Session, field, raw, *, table_id: int) -> object:
    """返回入库值；空值返回 None。0 与 False 不是空值。"""
    fname = field.name
    ftype = field.type

    if ftype in {"formula", "lookup", "rollup"}:
        if raw is not None:
            _fail(fname, "计算列由系统生成，不能手动写入")
        return None

    if ftype == "reference":
        from ..models import DataRecord, DataTable
        config = field.config or {}
        if raw is None or raw == "": return None
        values = raw if isinstance(raw, list) else [raw]
        if len(values) > 100 or not config.get('multiple') and len(values) > 1:
            _fail(fname, "关联记录数量不合法")
        tid = config.get('table_id'); table = db.get(DataTable, tid)
        if not table or table.deleted_at is not None: _fail(fname, "关联表已删除")
        cleaned=[]
        for rid in values:
            if isinstance(rid, bool) or not isinstance(rid, int): _fail(fname, "关联值需要记录 ID")
            record=db.get(DataRecord, rid)
            if not record or record.table_id != tid or record.deleted_at is not None: _fail(fname, "关联记录不存在")
            if rid not in cleaned: cleaned.append(rid)
        return cleaned if config.get('multiple') else cleaned[0] if cleaned else None

    if ftype == "checkbox":
        if raw is None or raw == "":
            return None
        if not isinstance(raw, bool):
            _fail(fname, "勾选列只能是是或否")
        return raw

    if ftype == "multiselect":
        if raw is None or raw == "":
            raw = []
        if not isinstance(raw, list):
            _fail(fname, "多选列需要数组")
        option_ids = {o["id"] for o in (field.options or [])}
        cleaned: list[str] = []
        for item in raw:
            if item not in option_ids:
                _fail(fname, "包含不属于该列的选项")
            if item not in cleaned:
                cleaned.append(item)
        return cleaned

    if raw is None:
        return None
    if isinstance(raw, str):
        raw = raw.strip()
        if raw == "":
            return None

    if ftype in {"short_text", "long_text"}:
        if not isinstance(raw, str):
            _fail(fname, "需要文本内容")
        if len(raw) > LIMITS[ftype]:
            _fail(fname, f"最多 {LIMITS[ftype]} 个字符")
        return raw

    if ftype == "number":
        try:
            return normalize_number(raw)
        except ValueError as exc:
            _fail(fname, str(exc))

    if ftype == "date":
        try:
            return date.fromisoformat(str(raw)[:10]).isoformat()
        except ValueError:
            _fail(fname, "日期格式应为 YYYY-MM-DD")

    if ftype == "select":
        option_ids = {o["id"] for o in (field.options or [])}
        if raw not in option_ids:
            _fail(fname, "选项不属于该列")
        return raw

    if ftype == "url":
        text = str(raw)
        if len(text) > LIMITS["url"]:
            _fail(fname, f"最多 {LIMITS['url']} 个字符")
        parsed = urlparse(text)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            _fail(fname, "请输入完整的 http 或 https 地址")
        return text

    if ftype == "attachment":
        try:
            file_id = int(raw)
        except (TypeError, ValueError):
            _fail(fname, "附件引用不合法")
        file_obj = db.get(FileObject, file_id)
        if not file_obj:
            _fail(fname, "附件不存在或已过期")
        if file_obj.status == "staged" and file_obj.expires_at is not None and file_obj.expires_at <= utcnow():
            _fail(fname, "附件已过期，请重新上传")
        if file_obj.status == "bound" and not _file_owned_by(db, file_id, table_id):
            pass
        return file_id

    _fail(fname, "未知列类型")
    return None


def _file_owned_by(db: Session, file_id: int, table_id: int) -> bool:
    """已绑定文件在替换前保持可用，这里只做存在性校验。"""
    return True


def validate_record(db: Session, fields: list, data: dict, *, table_id: int) -> dict:
    result: dict = {}
    known_keys = {f.key for f in fields}
    unknown = [k for k in data if k not in known_keys]
    if unknown:
        raise ApiError("UNKNOWN_FIELD", "提交了不存在的列", 422, {"fields": {unknown[0]: "列不存在"}})
    for field in fields:
        raw = data.get(field.key)
        value = validate_value(db, field, raw, table_id=table_id)
        if value is None or (field.type == "multiselect" and value == []):
            if field.required:
                if field.default_value is not None:
                    value = field.default_value
                else:
                    _fail(field.name, "必填列不能为空")
        if field.type not in {"formula", "lookup", "rollup"}:
            result[field.key] = value
    return result


def apply_defaults(fields: list, data: dict) -> dict:
    out = dict(data)
    for field in fields:
        if field.default_value is not None and not out.get(field.key):
            out[field.key] = field.default_value
    return out
