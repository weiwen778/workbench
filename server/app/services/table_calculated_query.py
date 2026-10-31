"""Read-only computed record projection shared by classic paging and exports."""
from types import SimpleNamespace
from functools import cmp_to_key
from decimal import Decimal,InvalidOperation
from sqlalchemy import select
from ..models import DataRecord,DataField
from ..errors import ApiError
from .table_expressions import Resolver,COMPUTED,MAX_ROWS

def project(db,rows,fields):
    rows=list(rows)
    if not rows or not any(f.type in COMPUTED for f in fields.values()):return rows
    resolver=Resolver(db);resolver.tables[rows[0].table_id]=(fields,{r.id:r for r in rows})
    result=[]
    for row in rows:
        payload=resolver.payload(row)
        result.append(SimpleNamespace(id=row.id,table_id=row.table_id,data=payload['data'],version=row.version,created_at=row.created_at,updated_at=row.updated_at,computed_errors=payload['computed_errors']))
    return result

def calculated_paginate(db,table_id,fields,filters,sorts,page,page_size):
    from .query import MAX_FILTERS,MAX_SORTS,UNSORTABLE
    if len(filters)>MAX_FILTERS or len(sorts)>MAX_SORTS:raise ApiError('INVALID_QUERY','筛选或排序条件过多',422)
    rows=list(db.scalars(select(DataRecord).where(DataRecord.table_id==table_id,DataRecord.deleted_at.is_(None)).order_by(DataRecord.id).limit(MAX_ROWS+1)))
    if len(rows)>MAX_ROWS:raise ApiError('ANALYSIS_LIMIT',f'计算列筛选和排序最多支持 {MAX_ROWS} 行',422)
    rows=project(db,rows,fields)
    for spec in filters:
        key=spec.get('field') or spec.get('key');op=spec.get('op') or spec.get('operator');field=fields.get(key)
        if not field:raise ApiError('UNKNOWN_FILTER_FIELD','筛选列不存在',422)
        if op not in {'empty','not_empty','eq','equals','ne','not_equals','contains','gt','gte','lt','lte','between','has_any','has_all'}:raise ApiError('INVALID_FILTER_OP','不支持的筛选方式',422)
        value=spec.get('value')
        def match(row):
            raw=row.data.get(key)
            if op=='empty':return raw is None or raw=='' or raw==[]
            if op=='not_empty':return not (raw is None or raw=='' or raw==[])
            if raw is None:return False
            if field.type=='multiselect':
                wanted=value if isinstance(value,list) else [value]
                return any(v in raw for v in wanted) if op=='has_any' else all(v in raw for v in wanted)
            if field.type=='checkbox':return raw==bool(value)
            if op=='contains':return str(value).casefold() in str(raw).casefold()
            a,b=str(raw),str(value)
            if op in {'gt','gte','lt','lte','between'} and field.type in {'number','formula','rollup'}:
                try:a=Decimal(str(raw));b=[Decimal(str(v)) for v in value] if op=='between' else Decimal(str(value))
                except Exception:raise ApiError('INVALID_FILTER','数值筛选需要有效数字',422)
                if not a.is_finite() or any(not n.is_finite() for n in (b if isinstance(b,list) else [b])):raise ApiError('INVALID_FILTER','数值筛选需要有限数字',422)
            if op in {'eq','equals'}:return a==b
            if op in {'ne','not_equals'}:return a!=b
            if op=='between':
                if not isinstance(value,list) or len(value)!=2:raise ApiError('INVALID_FILTER','区间需要两个值',422)
                b=value if isinstance(a,str) else b
                return b[0]<=a<=b[1]
            return a>b if op=='gt' else a>=b if op=='gte' else a<b if op=='lt' else a<=b
        rows=[r for r in rows if match(r)]
    for spec in sorts:
        key=spec.get('field') or spec.get('key');f=fields.get(key)
        if not f:raise ApiError('UNKNOWN_SORT_FIELD','排序列不存在',422)
        if f.type in UNSORTABLE:raise ApiError('FIELD_NOT_SORTABLE','该列不支持排序',422)
    def compare(left,right):
        for spec in sorts:
            key=spec.get('field') or spec.get('key');f=fields[key];a,b=left.data.get(key),right.data.get(key);direction=-1 if (spec.get('order') or spec.get('direction'))=='desc' else 1
            if a is None:n=0 if b is None else 1
            elif b is None:n=-1
            else:
                try:
                    if f.type in {'number','formula','rollup'}:a,b=Decimal(str(a)),Decimal(str(b))
                    else:a,b=str(a),str(b)
                except Exception:a,b=str(a),str(b)
                n=(a>b)-(a<b)
            if n:return n*direction
        return left.id-right.id
    if sorts:rows.sort(key=cmp_to_key(compare))
    return len(rows),rows[(page-1)*page_size:page*page_size],fields
