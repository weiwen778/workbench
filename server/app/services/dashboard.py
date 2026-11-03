"""Aggregate live table data; never rely on the table UI's current page."""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from typing import Literal
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select, case, cast, Numeric

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
    value_fields: list[str] = Field(default_factory=list, max_length=8)
    group_field: str | None = Field(default=None, max_length=100)
    date_field: str | None = Field(default=None, max_length=100)
    date_bucket: Literal['day', 'week', 'month'] = 'day'
    sort: Literal['value_desc', 'label_asc'] = 'value_desc'
    limit: int = Field(default=10, ge=1, le=30)
    decimals: int = Field(default=2, ge=0, le=6)
    unit: str = Field(default='', max_length=12)
    wide: bool = False

    @model_validator(mode='after')
    def valid_series(self):
        if len(set(self.value_fields)) != len(self.value_fields):
            raise ValueError('同一个数字列不能重复选择')
        if self.value_fields:
            if self.kind not in {'bar', 'line'} or self.aggregation == 'count':
                raise ValueError('多指标对比请使用柱状图或折线图，并选择数字的计算方式')
            if any(not key or len(key) > 100 for key in self.value_fields):
                raise ValueError('请选择有效的数字列')
            self.value_field = self.value_fields[0]
        return self

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


def validate_source(db, widget: Widget, source_cache=None):
    if widget.kind == 'pie' and widget.aggregation not in {'count', 'sum'}:
        raise ApiError('DASHBOARD_AGGREGATION_INVALID', '饼图请选择记录数或求和，避免用平均值计算占比', 422)
    cached = source_cache.get(widget.table_id) if source_cache is not None else None
    if cached is None:
        table = db.get(DataTable, widget.table_id)
        if table is None or table.deleted_at is not None:
            raise ApiError('DASHBOARD_SOURCE_MISSING', '来源表格已删除或不存在，请重新选择表格', 422)
        fields = {f.key: f for f in db.scalars(select(DataField).where(DataField.table_id == table.id))}
        if source_cache is not None:
            source_cache[table.id] = (table, fields)
    else:
        table, fields = cached
    if widget.aggregation != 'count':
        for key in widget.value_fields or [widget.value_field]:
            field = fields.get(key)
            if field is None or field.type not in {'number','formula','rollup'}:
                raise ApiError('DASHBOARD_FIELD_INVALID', '统计列（要对比的数字）不存在或类型已改变，请重新选择', 422)
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


def _database_metrics(db,configs,dates):
    # Use exact PostgreSQL NUMERIC aggregates for plain metric cards. Date,
    # calculated and grouped charts retain the common validated scan path.
    if db.bind.dialect.name!='postgresql' or configs[0][1].kind!='physical' or any(w.kind!='metric' or (w.date_field and (dates.start_date or dates.end_date)) or (w.aggregation!='count' and fields[w.value_field].type!='number') for w,_,fields in configs):return None
    table=configs[0][1];expressions=[func.count(DataRecord.id)];positions={}
    for w,_,_ in configs:
        if w.aggregation=='count':continue
        text=func.trim(DataRecord.data[w.value_field].as_string())
        valid=text.op('~')(r'^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$')
        number=case((valid,cast(text,Numeric)),else_=None)
        positions[w.id]=len(expressions)
        expressions.extend([func.count(number),func.sum(number),func.min(number),func.max(number)])
    row=db.execute(select(*expressions).where(DataRecord.table_id==table.id,DataRecord.deleted_at.is_(None))).one()
    result={};count=row[0]
    for w,_,_ in configs:
        if count>MAX_ROWS:
            result[w.id]={'id':w.id,'status':'error','message':'来源表格超过 100,000 条记录，请拆分数据后再统计'};continue
        acc=Accumulator();acc.rows=count
        if w.aggregation=='count':acc.n=count
        else:
            offset=positions[w.id];acc.n=row[offset];acc.total=row[offset+1] or Decimal(0);acc.low=row[offset+2];acc.high=row[offset+3]
        with localcontext() as context:
            context.prec=50;value=acc.value(w.aggregation)
        result[w.id]={'id':w.id,'status':'ok','table_name':table.name,'value':str(value) if value is not None else None,
                      'matched_rows':count,'numeric_rows':acc.n,'ignored_rows':count-acc.n,'groups_total':0,'group_type':None,'points':[],
                      'date_filter_applied':False,'date_filter_unavailable':bool(not w.date_field and (dates.start_date or dates.end_date))}
    return result


def _aggregate_single(db, widgets: list[Widget], dates: DateRange, all_groups=frozenset()):
    results = {}
    sources = {}
    source_cache = {}
    for widget in widgets:
        try:
            table, fields = validate_source(db, widget, source_cache)
            sources.setdefault(table.id, []).append((widget, table, fields))
        except ApiError as exc:
            results[widget.id] = {'id': widget.id, 'status': 'error', 'message': exc.message}
    with localcontext() as context:
        context.prec = 50
        for table_id, configs in sources.items():
            sql_result=_database_metrics(db,configs,dates)
            if sql_result is not None:results.update(sql_result);continue
            totals = {w.id: Accumulator() for w, _, _ in configs}
            groups = {w.id: {} for w, _, _ in configs}
            failed = {}
            scanned = 0
            keys = sorted({key for w, _, _ in configs for key in (
                w.value_field if w.aggregation != 'count' else None,
                w.group_field if w.kind != 'metric' else None,
                w.date_field if dates.start_date or dates.end_date else None,
            ) if key})
            source_filter = (DataRecord.table_id == table_id, DataRecord.deleted_at.is_(None))
            from .table_expressions import COMPUTED, MAX_ROWS as COMPUTED_LIMIT
            all_fields=configs[0][2]
            if configs[0][1].kind=='virtual':
                from .virtual_tables import resolve_table
                try:
                    virtual=resolve_table(db,table_id)
                    values=[r['data'] for r in virtual.rows]
                    for w,_,_ in configs:
                        used={w.value_field,w.group_field,w.date_field}-{None}
                        if any(used.intersection(r['computed_errors']) for r in virtual.rows):failed[w.id]='虚拟表统计字段存在公式错误，请先修复规则'
                except ApiError as exc:
                    values=[];failed={w.id:exc.message for w,_,_ in configs}
                rows=None
            elif keys and any(all_fields[k].type in COMPUTED for k in keys):
                from .table_calculated_query import project
                raw_records=list(db.scalars(select(DataRecord).where(*source_filter).order_by(DataRecord.id).limit(COMPUTED_LIMIT+1)))
                if len(raw_records)>COMPUTED_LIMIT:
                    failed={w.id:'计算列统计最多 10000 行，请拆分数据后再统计' for w,_,_ in configs}
                    rows,values=None,[]
                else:
                    rows=None;values=[r.data for r in project(db,raw_records,all_fields)]
            elif keys:
                # JSON columns are decoded once per row. Extracting each key
                # separately made PostgreSQL repeatedly parse textual JSON and
                # was slower on the representative multi-card dashboard.
                rows = db.scalars(select(DataRecord.data).where(*source_filter).execution_options(yield_per=1000))
                values = rows
            else:
                # A set of plain record-count cards needs no JSON transfer.
                count = db.scalar(select(func.count()).select_from(DataRecord).where(*source_filter)) or 0
                if count > MAX_ROWS:
                    failed = {w.id: '来源表格超过 100,000 条记录，请拆分数据后再统计' for w, _, _ in configs}
                else:
                    for total in totals.values():
                        total.rows = total.n = count
                rows, values = None, []
            for data in values:
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
            if rows is not None:
                rows.close()
            for w, table, fields in configs:
                if w.id in failed:
                    results[w.id] = {'id': w.id, 'status': 'error', 'message': failed[w.id]}
                    continue
                total = totals[w.id]
                points = [(label, None if w.id in all_groups and w.aggregation != 'count' and not acc.n else acc.value(w.aggregation), acc.rows) for label, acc in groups[w.id].items()]
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
                if w.id in all_groups:
                    shown = points
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


def aggregate(db, widgets: list[Widget], dates: DateRange):
    """Compute all series in one source scan, then align them on one shared X axis."""
    expanded, plans, all_groups = [], {}, set()
    for widget in widgets:
        if not widget.value_fields:
            expanded.append(widget)
            continue
        # Validate the complete selection before returning a partial chart.
        try:
            _, fields = validate_source(db, widget)
        except ApiError as exc:
            plans[widget.id] = {'error': exc.message}
            continue
        children = []
        for key in widget.value_fields:
            child = widget.model_copy(update={'id': uuid.uuid4().hex, 'value_fields': [], 'value_field': key})
            expanded.append(child)
            all_groups.add(child.id)
            children.append((child.id, key, fields[key].name))
        plans[widget.id] = {'children': children}
    calculated = {result['id']: result for result in _aggregate_single(db, expanded, dates, all_groups)}
    output = []
    for widget in widgets:
        if widget.id not in plans:
            output.append(calculated[widget.id])
            continue
        plan = plans[widget.id]
        if 'error' in plan:
            output.append({'id': widget.id, 'status': 'error', 'message': plan['error']})
            continue
        children = plan['children']
        failed = next((calculated[id] for id, _, _ in children if calculated[id]['status'] == 'error'), None)
        if failed:
            output.append({**failed, 'id': widget.id})
            continue
        first = calculated[children[0][0]]
        points = first['points']
        shown = points[-widget.limit:] if widget.kind == 'line' and first['group_type'] == 'date' else points[:widget.limit]
        labels = [point['label'] for point in shown]
        series = []
        for id, key, name in children:
            index = {point['label']: point for point in calculated[id]['points']}
            series.append({'field': key, 'name': name, 'points': [index[label] for label in labels],
                'ignored_rows': calculated[id]['ignored_rows']})
        output.append({**first, 'id': widget.id, 'points': series[0]['points'], 'series': series})
    return output
