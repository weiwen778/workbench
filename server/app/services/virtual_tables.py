"""Bounded live virtual datasets: append, hash joins and grouped alignment."""
from __future__ import annotations
import hashlib, json
from collections import defaultdict
from datetime import date
from decimal import Decimal, localcontext
from functools import cmp_to_key
from types import SimpleNamespace
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from ..errors import ApiError
from ..models import DataTable, DataField, DataRecord, FileObject, utcnow
from ..utils import iso_z
from .table_expressions import Resolver, expression_tree, evaluate, configure, COMPUTED

MAX_INPUT_ROWS=20000
MAX_OUTPUT_ROWS=10000
MAX_LINEAGE=100
BASIC={'short_text','long_text','number','date','checkbox','url'}
NUMERIC={'number','formula','rollup'}
KEY_PATTERN=r'^[A-Za-z][A-Za-z0-9_]{0,31}$'
class StrictModel(BaseModel):
    model_config=ConfigDict(extra='forbid')
class Source(StrictModel):
    alias:str=Field(pattern=KEY_PATTERN)
    table_id:int=Field(gt=0)
class Key(StrictModel):
    key:str=Field(pattern=KEY_PATTERN)
    name:str=Field(min_length=1,max_length=50)
    type:Literal['short_text','number','date','checkbox']='short_text'
    fields:dict[str,str]
class Column(StrictModel):
    key:str=Field(pattern=KEY_PATTERN)
    name:str=Field(min_length=1,max_length=50)
    type:Literal['short_text','long_text','number','date','checkbox','url','formula']='short_text'
    mapping:dict[str,str]=Field(default_factory=dict)
    source:str|None=None
    field:str|None=None
    aggregation:Literal['count','sum','avg','min','max']='sum'
    expression:str|None=Field(default=None,max_length=1000)
    bindings:dict[str,str]=Field(default_factory=dict)
class Predicate(StrictModel):
    field:str
    op:Literal['eq','ne','contains','gt','gte','lt','lte','empty','not_empty']
    value:str|bool|None=None
class Order(StrictModel):
    field:str
    order:Literal['asc','desc']='asc'
class Definition(StrictModel):
    mode:Literal['union','join','align']='union'
    sources:list[Source]=Field(min_length=2,max_length=8)
    keys:list[Key]=Field(default_factory=list,max_length=3)
    columns:list[Column]=Field(min_length=1,max_length=50)
    join_type:Literal['left','inner','full']='left'
    allow_many:bool=False
    filters:list[Predicate]=Field(default_factory=list,max_length=10)
    sorts:list[Order]=Field(default_factory=list,max_length=3)


def fail(message,code='INVALID_VIRTUAL_TABLE',details=None):
    raise ApiError(code,message,422,details or {})
def physical_only(table):
    if table.kind=='virtual':raise ApiError('VIRTUAL_TABLE_READ_ONLY','虚拟表结果只读，请通过编辑组合规则或原始表修改数据',409)
def data_fields(db,table_id):
    return list(db.scalars(select(DataField).where(DataField.table_id==table_id).order_by(DataField.sort_order,DataField.id)))
def metadata_fields(definition):
    keys=definition.keys if definition.mode!='union' else []
    return [DataField(key=c.key,name=c.name.strip(),type=c.type,required=False,config={'expression':c.expression,'bindings':c.bindings} if isinstance(c,Column) and c.type=='formula' else {},sort_order=i) for i,c in enumerate([*keys,*definition.columns])]
def validate_definition(db,raw):
    d=raw if isinstance(raw,Definition) else Definition.model_validate(raw)
    if len(json.dumps(d.model_dump()).encode())>200000:fail('组合规则超过 200KB')
    aliases=[s.alias for s in d.sources]
    if len(set(aliases))!=len(aliases):fail('来源别名重复')
    if len({s.table_id for s in d.sources})!=len(d.sources):fail('同一张来源表只能选择一次')
    tables={};fields={}
    for source in d.sources:
        t=db.get(DataTable,source.table_id)
        if not t or t.deleted_at is not None:fail('来源表已删除或不存在','VIRTUAL_SOURCE_MISSING',{'table_id':source.table_id})
        if t.kind!='physical':fail('当前虚拟表的来源请选择原始表，不支持嵌套虚拟表')
        tables[source.alias]=t;fields[source.alias]={f.key:f for f in data_fields(db,t.id)}
    outputs=metadata_fields(d)
    if len(outputs)>50:fail('虚拟表最多 50 个输出字段（含匹配键）')
    if len({f.key for f in outputs})!=len(outputs):fail('输出字段标识重复')
    if len({f.name for f in outputs})!=len(outputs) or any(not f.name for f in outputs):fail('输出字段名称不能为空或重复')
    def source_field(alias,key):
        if alias not in fields or key not in fields[alias]:fail('映射的来源字段已删除或不存在','VIRTUAL_FIELD_MISSING',{'source':alias,'field':key})
        return fields[alias][key]
    if d.mode!='union':
        if not d.keys:fail('关联或汇总对齐需要至少一个匹配键')
        for key in d.keys:
            if set(key.fields)!=set(aliases):fail('每个匹配键都需要为所有来源表选择字段')
            for alias,field_key in key.fields.items():
                f=source_field(alias,field_key)
                if key.type=='number' and f.type not in NUMERIC:fail('数字匹配键需要数字或数值计算列')
                if key.type=='date' and f.type!='date':fail('日期匹配键需要日期列')
                if key.type=='checkbox' and f.type!='checkbox':fail('勾选匹配键需要勾选列')
                if key.type=='short_text' and f.type not in {'short_text','long_text','select','url'}:fail('文本匹配键需要文本或单选列')
    elif d.keys:fail('上下追加模式不需要匹配键')
    for c in d.columns:
        if c.type=='formula':
            if not c.expression:fail('计算列需要表达式')
            continue
        if d.mode=='union':
            if not c.mapping:fail('每个输出字段至少映射一张来源表')
            for alias,key in c.mapping.items():source_field(alias,key)
        else:
            if c.source not in fields:fail('请选择输出字段的来源表')
            if d.mode=='align' and c.type!='number':fail('汇总对齐的指标列请选择数字类型')
            if d.mode!='align' or c.aggregation!='count':
                f=source_field(c.source,c.field)
                if d.mode=='align' and f.type not in NUMERIC:fail('汇总指标需要数字列，或选择记录数')
    for f in outputs:
        if f.type=='formula':configure(db,f,outputs)
    output_map={f.key:f for f in outputs}
    for c in d.columns:
        if c.type=='formula':c.bindings=output_map[c.key].config['bindings']
    if any(p.field not in output_map for p in [*d.filters,*d.sorts]):fail('筛选或排序引用了不存在的输出字段')
    return d,tables,fields,outputs


def scalar(value,kind):
    if value is None or value=='':return None
    if kind=='number':
        try:n=Decimal(str(value))
        except Exception:fail('字段含有不能转换为数字的值','VIRTUAL_TYPE_MISMATCH')
        if isinstance(value,bool) or not n.is_finite() or abs(n)>Decimal('1e30'):fail('数字值无效或超过范围','VIRTUAL_TYPE_MISMATCH')
        return format(n,'f')
    if kind=='date':
        try:return date.fromisoformat(str(value)).isoformat()
        except Exception:fail('字段含有不能转换为日期的值','VIRTUAL_TYPE_MISMATCH')
    if kind=='checkbox':
        if not isinstance(value,bool):fail('勾选输出需要勾选列的布尔值','VIRTUAL_TYPE_MISMATCH')
        return value
    text=str(value)
    if len(text)>20000:fail('字段文本超过 20000 字符')
    return text

class VirtualResult:
    def __init__(self,fields,rows,sources,warnings):
        self.fields=fields;self.rows=rows;self.sources=sources;self.warnings=warnings;self.generated_at=utcnow()
    def payload(self):
        from ..routers.tables import field_payload
        stamp=iso_z(self.generated_at)
        return {'fields':[field_payload(f) for f in self.fields],'records':[{**r,'version':1,'created_at':stamp,'updated_at':stamp} for r in self.rows], 'total':len(self.rows),'sources':self.sources,'warnings':self.warnings,'generated_at':stamp,'limit':MAX_OUTPUT_ROWS}


def compute(db,raw):
    with localcontext() as context:
        context.prec=50
        return _compute(db,raw)

def _compute(db,raw):
    d,tables,fields,outputs=validate_definition(db,raw)
    class BoundedResolver(Resolver):
        loaded=0
        def table(self,table_id):
            fresh=table_id not in self.tables
            result=super().table(table_id)
            if fresh:
                self.loaded+=len(result[1])
                if self.loaded>40000:fail('含关联计算的来源加载超过 40000 行，请缩小来源','VIRTUAL_LIMIT')
            return result
    resolver=BoundedResolver(db);source_rows={};total_input=0;file_names={}
    stats=[];warnings=[]
    for source in d.sources:
        _,records=resolver.table(source.table_id)
        rows=list(records.values());total_input+=len(rows)
        if total_input>MAX_INPUT_ROWS:fail('来源合计超过 20000 行，请先缩小数据范围','VIRTUAL_LIMIT')
        source_rows[source.alias]=rows
        stats.append({'alias':source.alias,'table_id':source.table_id,'name':tables[source.alias].name,'rows':len(rows),'duplicate_keys':0})
    value_cache={}
    def value(alias,row,key):
        if row is None:return None
        ident=(alias,row.id,key)
        if ident in value_cache:return value_cache[ident]
        f=fields[alias][key]
        try:v=resolver.value(row,key)
        except Exception as exc:fail(f'来源表「{tables[alias].name}」的「{f.name}」计算失败：{getattr(exc,"message",str(exc))}','VIRTUAL_SOURCE_ERROR')
        if f.type in {'select','multiselect'}:
            names={o['id']:o.get('name',o['id']) for o in f.options or []}
            v='、'.join(str(names.get(x,x)) for x in v) if isinstance(v,list) else names.get(v,v)
        elif f.type=='reference' and v:
            ids=v if isinstance(v,list) else [v];cfg=f.config or {};_,linked=resolver.table(cfg.get('table_id'))
            v='、'.join(str(resolver.value(linked[i],cfg.get('label_field'))) if i in linked else '#'+str(i) for i in ids)
        elif f.type=='attachment' and v:
            if v not in file_names:
                obj=db.get(FileObject,v);file_names[v]=obj.original_name if obj else f'附件 #{v}'
            v=file_names[v]
        elif isinstance(v,list):v='、'.join(str(x) for x in v)
        value_cache[ident]=v;return v
    def key_value(alias,row,missing_unique=False):
        values=tuple(scalar(value(alias,row,k.fields[alias]),k.type) for k in d.keys)
        if any(v is None for v in values):return ('__unmatched__',alias,row.id) if missing_unique else None
        return tuple(Decimal(v) if k.type=='number' else v for k,v in zip(d.keys,values))
    def origin(alias,row):return {'table_id':tables[alias].id,'record_id':row.id}
    rows=[]
    def append(data,origins,count=None,identity=None):
        if len(rows)>=MAX_OUTPUT_ROWS:fail('组合结果超过 10000 行，请调整组合规则；本次没有截断数据','VIRTUAL_LIMIT')
        # Stable identity based on source records (or group key), never a writable record id.
        token=json.dumps(identity if identity is not None else origins,sort_keys=True,ensure_ascii=False,default=str)
        rid=-int(hashlib.sha256(token.encode()).hexdigest()[:12],16)-1
        rows.append({'id':rid,'data':data,'origins':origins[:MAX_LINEAGE],'origin_count':count if count is not None else len(origins),'computed_errors':{}})
    if d.mode=='union':
        for source in d.sources:
            for row in source_rows[source.alias]:
                data={c.key:scalar(value(source.alias,row,c.mapping[source.alias]),c.type) if source.alias in c.mapping else None for c in d.columns if c.type!='formula'}
                append(data,[origin(source.alias,row)])
    elif d.mode=='join':
        aliases=[s.alias for s in d.sources];combined=[{aliases[0]:r} for r in source_rows[aliases[0]]]
        for alias in aliases[1:]:
            lookup=defaultdict(list)
            for r in source_rows[alias]:
                k=key_value(alias,r)
                if k is not None:lookup[k].append(r)
            duplicates=sum(1 for v in lookup.values() if len(v)>1)
            next(s for s in stats if s['alias']==alias)['duplicate_keys']=duplicates
            if duplicates and not d.allow_many:fail(f'来源表「{tables[alias].name}」有 {duplicates} 个重复匹配键，可能重复累计。请先汇总，或明确允许重复匹配。','VIRTUAL_DUPLICATE_KEY',{'source':alias,'duplicate_keys':duplicates})
            if duplicates:warnings.append(f'「{tables[alias].name}」存在重复键，关联结果可能包含重复配对，请检查汇总口径。')
            matched=set();next_rows=[]
            for combo in combined:
                base=next(((a,r) for a,r in combo.items() if r is not None),None)
                k=key_value(*base) if base else None
                matches=lookup.get(k,[]) if k is not None else []
                if matches:
                    if len(next_rows)+len(matches)>MAX_OUTPUT_ROWS:fail('关联结果超过 10000 行，请先汇总或调整匹配键','VIRTUAL_LIMIT')
                    for r in matches:next_rows.append({**combo,alias:r});matched.add(r.id)
                elif d.join_type!='inner':next_rows.append({**combo,alias:None})
                if len(next_rows)>MAX_OUTPUT_ROWS:fail('关联结果超过 10000 行','VIRTUAL_LIMIT')
            if d.join_type=='full':
                for r in source_rows[alias]:
                    if r.id not in matched:next_rows.append({**{a:None for a in aliases[:aliases.index(alias)]},alias:r})
                    if len(next_rows)>MAX_OUTPUT_ROWS:fail('关联结果超过 10000 行','VIRTUAL_LIMIT')
            combined=next_rows
        for combo in combined:
            data={}
            for k in d.keys:
                data[k.key]=next((scalar(value(a,r,k.fields[a]),k.type) for a,r in combo.items() if r is not None),None)
            for c in d.columns:
                if c.type!='formula':data[c.key]=scalar(value(c.source,combo.get(c.source),c.field),c.type)
            append(data,[origin(a,r) for a,r in combo.items() if r is not None])
        used={s.alias:set() for s in d.sources}
        for combo in combined:
            for a,r in combo.items():
                if r is not None:used[a].add(r.id)
        for s in stats:s['unmatched_rows']=s['rows']-len(used[s['alias']])
    else:
        grouped=defaultdict(dict)
        for source in d.sources:
            for row in source_rows[source.alias]:
                k=key_value(source.alias,row,True)
                if k not in grouped and len(grouped)>=MAX_OUTPUT_ROWS:fail('汇总分组超过 10000 项','VIRTUAL_LIMIT')
                grouped[k].setdefault(source.alias,[]).append(row)
        for group_identity,group in grouped.items():
            first_alias=next(iter(group));first=group[first_alias][0]
            data={k.key:scalar(value(first_alias,first,k.fields[first_alias]),k.type) for k in d.keys};origins=[];count=0
            for a,rs in group.items():
                count+=len(rs)
                if len(origins)<MAX_LINEAGE:origins.extend(origin(a,r) for r in rs[:MAX_LINEAGE-len(origins)])
            for c in d.columns:
                if c.type=='formula':continue
                rs=group.get(c.source,[])
                if c.aggregation=='count':v=str(len(rs)) if rs else None
                else:
                    vals=[Decimal(scalar(value(c.source,r,c.field),'number')) for r in rs if value(c.source,r,c.field) is not None and value(c.source,r,c.field)!='']
                    v=(sum(vals,Decimal(0)) if c.aggregation=='sum' else sum(vals,Decimal(0))/len(vals) if c.aggregation=='avg' else min(vals) if c.aggregation=='min' else max(vals)) if vals else None
                data[c.key]=str(v) if v is not None else None
            append(data,origins,count,group_identity)
    formula_map={f.key:f for f in outputs if f.type=='formula'}
    trees={k:expression_tree(f.config['expression'],f.config['bindings']) for k,f in formula_map.items()}
    for row in rows:
        data=row['data'];done=set()
        def resolve(key):
            if key not in formula_map:return data.get(key)
            if key in done:
                if key in row['computed_errors']:raise ValueError('依赖列计算失败')
                return data.get(key)
            try:
                v=evaluate(trees[key],resolve)
                data[key]=format(v,'f') if isinstance(v,Decimal) else v
                if isinstance(data[key],str) and len(data[key])>20000:raise ValueError('计算结果过长')
            except Exception as exc:data[key]=None;row['computed_errors'][key]=getattr(exc,'message',str(exc))[:160]
            done.add(key)
            if key in row['computed_errors']:raise ValueError(row['computed_errors'][key])
            return data[key]
        for key in trees:
            try:resolve(key)
            except Exception:pass
    rows=select_rows(rows,{f.key:f for f in outputs},[f.model_dump() for f in d.filters],[o.model_dump() for o in d.sorts])
    return VirtualResult(outputs,rows,stats,list(dict.fromkeys(warnings)))


def select_rows(rows,fields,filters,sorts):
    if not isinstance(filters,list) or len(filters)>10 or not isinstance(sorts,list) or len(sorts)>3:fail('筛选或排序条件过多')
    for spec in filters:
        if not isinstance(spec,dict):fail('筛选条件格式不正确')
        key=spec.get('field') or spec.get('key');f=fields.get(key);op=spec.get('op') or spec.get('operator');wanted=spec.get('value')
        if not f:fail('筛选字段已删除或不存在')
        if op not in {'eq','equals','ne','not_equals','contains','gt','gte','lt','lte','empty','not_empty','between'}:fail('不支持的虚拟表筛选方式')
        def match(r):
            if key in r.get('computed_errors',{}):fail('筛选列存在计算错误，请先修复公式','VIRTUAL_FORMULA_ERROR')
            raw=r['data'].get(key);empty=raw is None or raw==''
            if op=='empty':return empty
            if op=='not_empty':return not empty
            if empty:return False
            if isinstance(raw,bool):
                if op=='contains':return str(wanted or '') in ('是' if raw else '否')
                if isinstance(wanted,bool):target=wanted
                elif str(wanted).strip().lower() in {'true','1','是'}:target=True
                elif str(wanted).strip().lower() in {'false','0','否'}:target=False
                else:fail('勾选筛选值请选择是/否或 true/false')
                if op in {'eq','equals'}:return raw==target
                if op in {'ne','not_equals'}:return raw!=target
                fail('勾选列仅支持等于、不等于或空值筛选')
            if op=='contains':return str(wanted or '').casefold() in str(raw).casefold()
            if f.type in NUMERIC:
                try:
                    a=Decimal(str(raw));b=[Decimal(str(v)) for v in wanted] if op=='between' and isinstance(wanted,list) else Decimal(str(wanted))
                    if not a.is_finite() or any(not n.is_finite() for n in (b if isinstance(b,list) else [b])):raise ValueError()
                except Exception:fail('数值筛选需要有效的有限数字')
            else:a,b=str(raw),str(wanted)
            if op in {'eq','equals'}:return a==b
            if op in {'ne','not_equals'}:return a!=b
            if op=='between':
                if not isinstance(wanted,list) or len(wanted)!=2:fail('区间需要两个值')
                return (wanted[0]<=a<=wanted[1]) if isinstance(a,str) else b[0]<=a<=b[1]
            return a>b if op=='gt' else a>=b if op=='gte' else a<b if op=='lt' else a<=b
        rows=[r for r in rows if match(r)]
    for spec in sorts:
        if not isinstance(spec,dict) or (spec.get('field') or spec.get('key')) not in fields:fail('排序字段已删除或不存在')
    def compare(l,r):
        for s in sorts:
            k=s.get('field') or s.get('key');a,b=l['data'].get(k),r['data'].get(k)
            if a is None:n=0 if b is None else 1
            elif b is None:n=-1
            else:
                try:
                    if fields[k].type in NUMERIC:a,b=Decimal(str(a)),Decimal(str(b))
                    else:a,b=str(a),str(b)
                    n=(a>b)-(a<b)
                except Exception:n=(str(a)>str(b))-(str(a)<str(b))
            if n:return n*(-1 if (s.get('order') or s.get('direction'))=='desc' else 1)
        return 0
    return sorted(rows,key=cmp_to_key(compare)) if sorts else rows

def resolve_table(db,table_id,cache=None):
    if cache is not None and table_id in cache:return cache[table_id]
    t=db.get(DataTable,table_id)
    if not t or t.deleted_at is not None:fail('虚拟表已删除或不存在','VIRTUAL_SOURCE_MISSING')
    if t.kind!='virtual':fail('此表不是虚拟表')
    with localcontext() as context:
        context.prec=50
        result=compute(db,t.virtual_config or {})
    # Metadata fields retain stable DB ids; formula bindings come from canonical definition.
    result.fields=data_fields(db,table_id)
    if cache is not None:cache[table_id]=result
    return result

def paginate_virtual(db,table_id,filters,sorts,page,page_size):
    result=resolve_table(db,table_id);fields={f.key:f for f in result.fields}
    rows=select_rows(result.rows,fields,filters,sorts);stamp=result.generated_at
    return len(rows),[SimpleNamespace(id=r['id'],table_id=table_id,data=r['data'],version=1,created_at=stamp,updated_at=stamp,computed_errors=r['computed_errors'],origins=r['origins'],origin_count=r['origin_count']) for r in rows[(page-1)*page_size:page*page_size]],fields
