"""Read-only progress aggregation with bounded scans and exact decimal ratios."""
import calendar,json
from datetime import date,timedelta,datetime
from decimal import Decimal,localcontext
from zoneinfo import ZoneInfo
from sqlalchemy import select
from ..models import DataRecord
from ..errors import ApiError
from .dashboard import _decimal as _parse_decimal,_date,_group,MAX_ROWS,MAX_GROUPS,DIMENSION_TYPES
NUMERIC={'number','formula','rollup'}

def _decimal(raw):
    value=_parse_decimal(raw)
    return value if value is not None and (value==0 or -30<=value.adjusted()<=30) else None

def validate_progress(w,fields):
    p=w.progress
    def field(key,types,message):
        f=fields.get(key)
        if f is None or f.type not in types:raise ApiError('DASHBOARD_FIELD_INVALID',message,422)
        return f
    if w.group_field:field(w.group_field,DIMENSION_TYPES,'分组列不存在或类型已改变')
    if w.date_field:field(w.date_field,{'date'},'时间筛选列不存在或类型已改变')
    if p.due_field:
        field(p.due_field,{'date'},'截止日期列不存在或类型已改变')
        if p.mode!='tasks':raise ApiError('DASHBOARD_FIELD_INVALID','截止日期仅用于按任务数量统计逾期项',422)
    if p.mode=='quantity':field(p.actual_field,NUMERIC,'请选择有效的完成数量列')
    if p.target_mode=='field':field(p.target_field,NUMERIC,'请选择有效的目标数量列')
    for c in [*p.filters,*([p.completed] if p.mode=='tasks' else [])]:
        f=field(c.field,{'short_text','long_text','number','formula','rollup','select','checkbox','date'},'筛选或完成条件字段不存在或类型已改变')
        if c.op in {'empty','not_empty'}:continue
        if c.value is None or isinstance(c.value,str) and (not c.value or len(c.value)>2000):raise ApiError('PROGRESS_CONDITION_INVALID','请填写筛选和完成条件的比较值',422)
        if f.type=='checkbox' and (c.op!='eq' or not isinstance(c.value,bool)):raise ApiError('PROGRESS_CONDITION_INVALID','勾选字段请选择等于是或否',422)
        if f.type=='select' and (c.op not in {'eq','ne'} or c.value not in {o['id'] for o in f.options or []}):raise ApiError('PROGRESS_CONDITION_INVALID','条件中的选项已删除，请重新选择',422)
        if f.type in NUMERIC and (c.op=='contains' or _decimal(c.value) is None):raise ApiError('PROGRESS_CONDITION_INVALID','数字条件需要有效数值',422)
        if f.type in NUMERIC:c.value=format(_decimal(c.value).normalize(),'f')
        if f.type=='date' and (c.op=='contains' or _date(c.value) is None):raise ApiError('PROGRESS_CONDITION_INVALID','日期条件需要 YYYY-MM-DD',422)
        if f.type in {'short_text','long_text'} and c.op not in {'eq','ne','contains'}:raise ApiError('PROGRESS_CONDITION_INVALID','文本条件请选择等于、不等于或包含',422)

def matches(data,c,fields):
    raw=data.get(c.field)
    if c.op=='empty':return raw is None or raw==''
    if c.op=='not_empty':return raw is not None and raw!=''
    if raw is None or raw=='':return False
    f=fields[c.field]
    if f.type=='checkbox':return raw is c.value
    a,b=(_decimal(raw),_decimal(c.value)) if f.type in NUMERIC else (str(raw),str(c.value))
    if a is None or b is None:return False
    if c.op=='contains':return b in a
    if c.op=='eq':return a==b
    if c.op=='ne':return a!=b
    if c.op=='gt':return a>b
    if c.op=='gte':return a>=b
    if c.op=='lt':return a<b
    return a<=b

def filters_for(w,dates):
    out=[c.model_dump() for c in w.progress.filters]
    if w.date_field:
        if dates.start_date:out.append({'field':w.date_field,'op':'gte','value':dates.start_date.isoformat()})
        if dates.end_date:out.append({'field':w.date_field,'op':'lte','value':dates.end_date.isoformat()})
    return out

def group_filter(w,f,raw):
    if raw is None or raw=='':return {'field':f.key,'op':'empty'}
    if f.type=='date':
        day=_date(raw)
        if day and w.date_bucket!='day':
            start=day-timedelta(days=day.weekday()) if w.date_bucket=='week' else day.replace(day=1)
            end=start+timedelta(days=6) if w.date_bucket=='week' else start.replace(day=calendar.monthrange(start.year,start.month)[1])
            return {'field':f.key,'op':'between','value':[start.isoformat(),end.isoformat()]}
    return {'field':f.key,'op':'eq','value':raw}

def accumulator():return {'actual':Decimal(0),'target':Decimal(0),'rows':0,'ignored':0,'completed_rows':0,'overdue_rows':0}
def add(acc,w,data,fields,today):
    p=w.progress;acc['rows']+=1
    if p.mode=='tasks':
        complete=matches(data,p.completed,fields)
        acc['actual']+=int(complete);acc['target']+=1;acc['completed_rows']+=int(complete)
        due=_date(data.get(p.due_field)) if p.due_field else None
        if not complete and due and due<today:acc['overdue_rows']+=1
    else:
        actual=_decimal(data.get(p.actual_field));target=_decimal(data.get(p.target_field)) if p.target_mode=='field' else Decimal(0)
        if actual is None or target is None or actual<0 or target<0:acc['ignored']+=1;return
        acc['actual']+=actual;acc['target']+=target

def finish(acc,w,target=None,**extra):
    denominator=acc['target'] if target is None else target
    percent=acc['actual']/denominator*100 if denominator>0 else None
    return {**extra,'actual':str(acc['actual']),'target':str(denominator),'percentage':str(percent) if percent is not None else None,
            'remaining':str(max(Decimal(0),denominator-acc['actual'])),'rows':acc['rows'],'ignored_rows':acc['ignored'],
            'completed_rows':acc['completed_rows'],'overdue_rows':acc['overdue_rows'],'state':'empty' if not acc['rows'] else 'no_target' if percent is None else 'complete' if percent>=100 else 'active'}

def aggregate_progress(db,widgets,dates):
    from .dashboard import validate_source
    from .table_expressions import COMPUTED,MAX_ROWS as COMPUTED_LIMIT
    results={};sources={};source_cache={}
    for w in widgets:
        try:
            table,fields=validate_source(db,w,source_cache);sources.setdefault(table.id,[]).append((w,table,fields))
        except ApiError as e:results[w.id]={'id':w.id,'status':'error','message':e.message}
    today=datetime.now(ZoneInfo('Asia/Shanghai')).date()
    with localcontext() as context:
        context.prec=50
        for tid,configs in sources.items():
            totals={w.id:accumulator() for w,_,_ in configs};groups={w.id:{} for w,_,_ in configs};failed={};stream=None
            fields=configs[0][2]
            used=set()
            for w,_,_ in configs:
                p=w.progress;used.update(k for k in [w.group_field,w.date_field,p.due_field,p.actual_field if p.mode=='quantity' else None,p.target_field if p.mode=='quantity' and p.target_mode=='field' else None,*[c.field for c in p.filters],p.completed.field if p.mode=='tasks' and p.completed else None] if k)
            try:
                if configs[0][1].kind=='virtual':
                    from .virtual_tables import resolve_table
                    rows=resolve_table(db,tid).rows
                    if any(used.intersection(row.get('computed_errors',{})) for row in rows):raise ApiError('PROGRESS_COMPUTED_ERROR','统计列存在计算错误，请先修复',422)
                    values=(row['data'] for row in rows)
                elif any(fields[k].type in COMPUTED for k in used):
                    from .table_calculated_query import project
                    raw=list(db.scalars(select(DataRecord).where(DataRecord.table_id==tid,DataRecord.deleted_at.is_(None)).order_by(DataRecord.id).limit(COMPUTED_LIMIT+1)))
                    if len(raw)>COMPUTED_LIMIT:raise ApiError('PROGRESS_LIMIT','计算列进度最多统计 10,000 行，请拆分数据',422)
                    projected=project(db,raw,fields)
                    if any(used.intersection(getattr(row,'computed_errors',{})) for row in projected):raise ApiError('PROGRESS_COMPUTED_ERROR','统计列存在计算错误，请先修复',422)
                    values=(row.data for row in projected)
                else:
                    stream=db.scalars(select(DataRecord.data).where(DataRecord.table_id==tid,DataRecord.deleted_at.is_(None)).limit(MAX_ROWS+1).execution_options(yield_per=1000));values=stream
                for scanned,data in enumerate(values,1):
                    if scanned>MAX_ROWS:raise ApiError('PROGRESS_LIMIT','来源表格超过 100,000 行，请拆分数据后统计',422)
                    for w,table,fields in configs:
                        if w.id in failed:continue
                        day=_date(data.get(w.date_field)) if w.date_field else None
                        if w.date_field and (dates.start_date or dates.end_date) and (day is None or dates.start_date and day<dates.start_date or dates.end_date and day>dates.end_date):continue
                        if not all(matches(data,c,fields) for c in w.progress.filters):continue
                        add(totals[w.id],w,data,fields,today)
                        if w.group_field:
                            f=fields[w.group_field];raw=data.get(w.group_field);label=_group(data,f,w.date_bucket)
                            key=label if f.type=='date' else json.dumps(raw,ensure_ascii=False,sort_keys=True)
                            if key not in groups[w.id]:
                                if len(groups[w.id])>=MAX_GROUPS:failed[w.id]='分组超过 2,000 项，请调整分组列';continue
                                groups[w.id][key]={'acc':accumulator(),'label':label,'filter':group_filter(w,f,raw)}
                            add(groups[w.id][key]['acc'],w,data,fields,today)
            except ApiError as e:failed={w.id:e.message for w,_,_ in configs}
            finally:
                if stream is not None:stream.close()
            for w,table,fields in configs:
                if w.id in failed:results[w.id]={'id':w.id,'status':'error','message':failed[w.id]};continue
                p=w.progress;fixed=Decimal(p.target_value) if p.target_mode=='fixed' else None
                points=[finish(g['acc'],w,fixed,label=g['label'],filter=g['filter']) for g in groups[w.id].values()]
                points.sort(key=(lambda g:g['label']) if w.sort=='label_asc' else (lambda g:(-(_decimal(g['percentage']) or Decimal(0)),g['label'])))
                total_fixed=fixed*(len(points) if w.group_field else 1) if fixed is not None else None
                results[w.id]={'id':w.id,'status':'ok','table_name':table.name,'matched_rows':totals[w.id]['rows'],'ignored_rows':totals[w.id]['ignored'],
                    'groups_total':len(points),'progress':finish(totals[w.id],w,total_fixed),'progress_groups':points[:w.limit],
                    'drilldown_filters':filters_for(w,dates),'date_filter_applied':bool(w.date_field and (dates.start_date or dates.end_date)),
                    'date_filter_unavailable':bool(not w.date_field and (dates.start_date or dates.end_date))}
    return [results[w.id] for w in widgets]