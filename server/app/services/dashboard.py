"""Aggregate live table data; never rely on the table UI's current page."""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from typing import Literal
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select

from ..errors import ApiError
from ..models import DataField, DataRecord, DataTable

MAX_ROWS = 100_000
MAX_GROUPS = 2000
DIMENSION_TYPES = {'short_text', 'select', 'checkbox', 'date'}


class Widget(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    title: str = Field(min_length=1, max_length=100)
    kind: Literal['metric', 'bar', 'line', 'pie'] = 'metric'
    table_id: int = Field(gt=0)
    aggregation: Literal['count', 'sum', 'avg', 'min', 'max'] = 'count'
    value_field: str | None = Field(default=None, max_length=100)
    group_field: str | None = Field(default=None, max_length=100)
    date_field: str | None = Field(default=None, max_length=100)
    date_bucket: Literal['day', 'week', 'month'] = 'day'
    sort: Literal['value_desc', 'label_asc'] = 'value_desc'
    limit: int = Field(default=10, ge=1, le=30)
    decimals: int = Field(default=2, ge=0, le=6)
    unit: str = Field(default='', max_length=12)
    wide: bool = False

    @field_validator('title')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('请填写图表标题')
        return value.strip()


class DateRange(BaseModel):
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode='after')
    def valid_range(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError('开始日期不能晚于结束日期')
        return self


def validate_source(db, widget: Widget):
    if widget.kind == 'pie' and widget.aggregation not in {'count', 'sum'}:
        raise ApiError('DASHBOARD_AGGREGATION_INVALID', '饼图请选择记录数或求和，避免用平均值计算占比', 422)
    table = db.get(DataTable, widget.table_id)
    if table is None or table.deleted_at is not None:
        raise ApiError('DASHBOARD_SOURCE_MISSING', '来源表格已删除或不存在，请重新选择表格', 422)
    fields = {f.key: f for f in db.scalars(select(DataField).where(DataField.table_id == table.id))}
    if widget.aggregation != 'count':
        field = fields.get(widget.value_field)
        if field is None or field.type != 'number':
            raise ApiError('DASHBOARD_FIELD_INVALID', '统计列不存在或不再是数字列，请重新配置', 422)
    if widget.kind != 'metric':
        field = fields.get(widget.group_field)
        if field is None or field.type not in DIMENSION_TYPES:
            raise ApiError('DASHBOARD_FIELD_INVALID', '请选择文本、单选、勾选或日期列作为分组列', 422)
    if widget.date_field:
        field = fields.get(widget.date_field)
        if field is None or field.type != 'date':
            raise ApiError('DASHBOARD_FIELD_INVALID', '时间筛选列不存在或不再是日期列，请重新配置', 422)
    return table, fields


def _decimal(raw):
    if raw is None or isinstance(raw, bool) or raw == '':
        return None
    try:
        value = Decimal(str(raw))
        return value if value.is_finite() else None
    except InvalidOperation:
        return None


def _date(raw):
    try:
        return date.fromisoformat(str(raw))
    except (ValueError, TypeError):
        return None


def _group(data, field, bucket):
    raw = data.get(field.key)
    if raw is None or raw == '':
        return '(未填写)'
    if field.type == 'select':
        return next((str(o.get('name') or o.get('label') or o['id']) for o in (field.options or []) if o.get('id') == raw), str(raw))
    if field.type == 'checkbox':
        return '是' if raw is True else '否'
    if field.type == 'date':
        value = _date(raw)
        if value is None:
            return '(无效日期)'
        if bucket == 'week':
            value -= timedelta(days=value.weekday())
        return value.strftime('%Y-%m') if bucket == 'month' else value.isoformat()
    return str(raw)


class Accumulator:
    def __init__(self):
        self.rows = 0
        self.n = 0
        self.total = Decimal(0)
        self.low = None
        self.high = None

    def add(self, value):
        self.rows += 1
        if value is not None:
            self.n += 1
            self.total += value
            self.low = value if self.low is None else min(self.low, value)
            self.high = value if self.high is None else max(self.high, value)

    def value(self, aggregation):
        if aggregation == 'count':
            return Decimal(self.rows)
        if aggregation == 'sum':
            return self.total
        if not self.n:
            return None
        return {'avg': lambda: self.total / self.n, 'min': lambda: self.low, 'max': lambda: self.high}[aggregation]()


def aggregate(db, widgets: list[Widget], dates: DateRange):
    results = {}
    sources = {}
    for widget in widgets:
        try:
            table, fields = validate_source(db, widget)
            sources.setdefault(table.id, []).append((widget, table, fields))
        except ApiError as exc:
            results[widget.id] = {'id': widget.id, 'status': 'error', 'message': exc.message}
    with localcontext() as context:
        context.prec = 50
        for table_id, configs in sources.items():
            totals = {w.id: Accumulator() for w, _, _ in configs}
            groups = {w.id: {} for w, _, _ in configs}
            failed = {}
            scanned = 0
            rows = db.scalars(select(DataRecord.data).where(
                DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None)
            ).execution_options(yield_per=1000))
            for data in rows:
                scanned += 1
                if scanned > MAX_ROWS:
                    failed = {w.id: '来源表格超过 100,000 条记录，请拆分数据后再统计' for w, _, _ in configs}
                    break
                for w, table, fields in configs:
                    if w.id in failed:
                        continue
                    if w.date_field and (dates.start_date or dates.end_date):
                        day = _date(data.get(w.date_field))
                        if day is None or (dates.start_date and day < dates.start_date) or (dates.end_date and day > dates.end_date):
                            continue
                    value = Decimal(1) if w.aggregation == 'count' else _decimal(data.get(w.value_field))
                    totals[w.id].add(value)
                    if w.kind != 'metric':
                        label = _group(data, fields[w.group_field], w.date_bucket)
                        if label not in groups[w.id]:
                            if len(groups[w.id]) >= MAX_GROUPS:
                                failed[w.id] = '分组超过 2,000 项，请选择更适合汇总的列'
                                continue
                            groups[w.id][label] = Accumulator()
                        groups[w.id][label].add(value)
            rows.close()
            for w, table, fields in configs:
                if w.id in failed:
                    results[w.id] = {'id': w.id, 'status': 'error', 'message': failed[w.id]}
                    continue
                total = totals[w.id]
                points = [(label, acc.value(w.aggregation), acc.rows) for label, acc in groups[w.id].items()]
                if w.sort == 'label_asc':
                    points.sort(key=lambda p: p[0])
                else:
                    points.sort(key=lambda p: (p[1] is None, -(p[1] or Decimal(0)), p[0]))
                # Preserve chronological order for a date trend after selecting its displayed range.
                if w.kind == 'line' and fields[w.group_field].type == 'date':
                    points.sort(key=lambda p: p[0])
                    shown = points[-w.limit:]
                else:
                    shown = points[:w.limit]
                if w.kind == 'pie' and len(points) > w.limit:
                    rest = points[w.limit:]
                    shown.append(('其他（剩余分组）', sum((v for _, v, _ in rest if v is not None), Decimal(0)), sum(n for _, _, n in rest)))
                value = total.value(w.aggregation)
                results[w.id] = {
                    'id': w.id, 'status': 'ok', 'table_name': table.name,
                    'value': str(value) if value is not None else None,
                    'matched_rows': total.rows, 'numeric_rows': total.n,
                    'ignored_rows': total.rows - total.n,
                    'groups_total': len(points),
                    'group_type': fields[w.group_field].type if w.kind != 'metric' else None,
                    'points': [{'label': label, 'value': str(v) if v is not None else None, 'rows': n} for label, v, n in shown],
                    'date_filter_applied': bool(w.date_field and (dates.start_date or dates.end_date)),
                    'date_filter_unavailable': bool(not w.date_field and (dates.start_date or dates.end_date)),
                }
    return [results[w.id] for w in widgets]
