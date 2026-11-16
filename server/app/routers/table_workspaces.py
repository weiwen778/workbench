"""Versioned table views, atomic edits, reversible journal and independent workbooks."""
from __future__ import annotations
import copy, json, hashlib
from typing import Any
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import DataRecord, DataTable, TableView, TableChange, TableWorkbook, TrashEntry, User, utcnow
from ..services.fields import validate_record
from ..services.table_expressions import Resolver, COMPUTED, MAX_ROWS
from ..services.trash import push
from ..utils import iso_z
from .tables import _get_table, _fields, field_payload, _sync_file_refs, record_payload

router=APIRouter(tags=['Table workspace'],dependencies=[Depends(get_current_user)])

def bounded(value,limit=2_000_000):
    if len(json.dumps(value,ensure_ascii=False).encode())>limit:raise ApiError('PAYLOAD_TOO_LARGE','本次数据超过大小限制',413)

class ViewIn(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    kind:str='grid'
    config:dict=Field(default_factory=dict)
    version:int|None=None

class EditIn(BaseModel):
    id:int|None=Field(default=None,ge=1)
    version:int|None=Field(default=None,ge=1)
    changes:dict=Field(default_factory=dict)
    delete:bool=False

class TransactionIn(BaseModel):
    schema_version:int=Field(ge=1)
    request_id:str=Field(min_length=8,max_length=64,pattern=r'^[a-zA-Z0-9_-]+$')
    label:str=Field(default='编辑单元格',min_length=1,max_length=100)
    edits:list[EditIn]=Field(min_length=1,max_length=500)

class UndoIn(BaseModel):
    action:str|None=None
    request_id:str=Field(min_length=8,max_length=64,pattern=r'^[a-zA-Z0-9_-]+$')

class WorkbookIn(BaseModel):
    version:int=Field(ge=0)
    snapshot:dict

def view_payload(v):return {'id':v.id,'name':v.name,'kind':v.kind,'config':v.config,'version':v.version}

def check_view(payload):
    if not payload.name.strip():raise ApiError('INVALID_NAME','视图名称不能为空',422)
    if payload.kind not in {'grid','summary','pivot','workbook'}:raise ApiError('INVALID_VIEW','视图类型不合法',422)
    bounded(payload.config,100_000)
    c=payload.config
    for key in ['hidden','order','filters','sorts','conditions']:
        if key in c and (not isinstance(c[key],list) or len(c[key])>200):raise ApiError('INVALID_VIEW','视图列表设置不合法',422)
    for key in ['filters','sorts','conditions']:
        if any(not isinstance(v,dict) or not isinstance(v.get('field'),str) for v in c.get(key,[])):raise ApiError('INVALID_VIEW','视图条件设置不合法',422)
    for key in ['hidden','order']:
        if any(not isinstance(v,str) for v in c.get(key,[])):raise ApiError('INVALID_VIEW','视图列设置不合法',422)
    for key in ['widths','formats','summary','pivot']:
        if key in c and not isinstance(c[key],dict):raise ApiError('INVALID_VIEW','视图对象设置不合法',422)
    for key in ['search','group']:
        if key in c and not isinstance(c[key],str):raise ApiError('INVALID_VIEW','视图文字设置不合法',422)
    for key in ['frozen','rowHeight']:
        if key in c and (not isinstance(c[key],int) or not 0<=c[key]<=1000):raise ApiError('INVALID_VIEW','视图大小设置不合法',422)


@router.get('/tables/{table_id}/workspace')
def workspace(table_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    table=_get_table(db,table_id)
    from ..services.virtual_tables import physical_only
    physical_only(table)
    fields=_fields(db,table_id)
    count=db.scalar(select(func.count(DataRecord.id)).where(DataRecord.table_id==table_id,DataRecord.deleted_at.is_(None))) or 0
    if count>MAX_ROWS:raise ApiError('ANALYSIS_LIMIT',f'增强表格当前最多打开 {MAX_ROWS} 行，请使用经典视图分页查看',422)
    resolver=Resolver(db);_,records=resolver.table(table_id)
    views=db.scalars(select(TableView).where(TableView.table_id==table_id,TableView.user_id==user.id).order_by(TableView.id)).all()
    # Reference pickers expose only active rows and labels, not unrelated fields.
    references={}
    for f in fields:
        if f.type!='reference':continue
        config=f.config or {};tid=config.get('table_id')
        try:
            _,linked=resolver.table(tid)
            references[f.key]=[{'id':r.id,'label':str(label if label is not None and label!='' else f'#{r.id}')} for r in linked.values() for label in [resolver.value(r,config.get('label_field'))]]
        except ApiError:raise
        except Exception:references[f.key]=[]
    return {'table':{'id':table.id,'name':table.name,'note':table.note,'schema_version':table.schema_version},'fields':[field_payload(f) for f in fields],
            'records':[resolver.payload(r) for r in records.values()],'views':[view_payload(v) for v in views],'references':references,'limit':MAX_ROWS}

@router.get('/tables/{table_id}/views')
def views(table_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    _get_table(db,table_id)
    return [view_payload(v) for v in db.scalars(select(TableView).where(TableView.table_id==table_id,TableView.user_id==user.id).order_by(TableView.id))]

@router.post('/tables/{table_id}/views',status_code=201)
def create_view(table_id:int,payload:ViewIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    _get_table(db,table_id);check_view(payload)
    if db.scalar(select(func.count(TableView.id)).where(TableView.table_id==table_id,TableView.user_id==user.id))>=50:raise ApiError('VIEW_LIMIT','每张表最多 50 个视图',422)
    v=TableView(table_id=table_id,user_id=user.id,name=payload.name.strip(),kind=payload.kind,config=payload.config);db.add(v);db.commit();return view_payload(v)

@router.put('/table-views/{view_id}')
def save_view(view_id:int,payload:ViewIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    check_view(payload);v=db.scalar(select(TableView).where(TableView.id==view_id,TableView.user_id==user.id).with_for_update())
    if not v:raise ApiError('NOT_FOUND','视图不存在',404)
    _get_table(db,v.table_id)
    if payload.version!=v.version:raise ApiError('VERSION_CONFLICT','视图已在其他页面修改，请重新载入',409)
    changed=db.execute(update(TableView).where(TableView.id==v.id,TableView.version==payload.version).values(name=payload.name.strip(),kind=payload.kind,config=payload.config,version=v.version+1))
    if changed.rowcount!=1:raise ApiError('VERSION_CONFLICT','视图已发生变化',409)
    db.commit();db.refresh(v);return view_payload(v)

@router.delete('/table-views/{view_id}')
def delete_view(view_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    v=db.scalar(select(TableView).where(TableView.id==view_id,TableView.user_id==user.id))
    if not v:raise ApiError('NOT_FOUND','视图不存在',404)
    _get_table(db,v.table_id);db.delete(v);db.commit();return {'ok':True}

from ..services.table_history import snapshot,hold_files
def journal_payload(c,details=False):
    out={'id':c.id,'label':c.label,'created_at':iso_z(c.created_at),'record_count':len(c.changes),'reverts_id':c.reverts_id,'undone_by':c.undone_by,'source':c.source,'action':c.action,'schema_version':c.schema_version}
    if details:out['changes']=c.changes
    return out

def lock_table(db,table_id,version=None):
    table=_get_table(db,table_id)
    from ..services.virtual_tables import physical_only
    physical_only(table)
    if version is not None and table.schema_version!=version:raise ApiError('SCHEMA_CONFLICT','列设置已改变，请刷新表格',409)
    # A conditional no-op write also serializes SQLite writers; PostgreSQL obtains
    # the same table-row lock. Record CAS still protects writers outside this path.
    result=db.execute(update(DataTable).where(DataTable.id==table_id,DataTable.schema_version==table.schema_version).values(schema_version=table.schema_version,updated_at=table.updated_at))
    if result.rowcount!=1:raise ApiError('SCHEMA_CONFLICT','表格结构已改变',409)
    return table

def operation_records(db, changes):
    ids=[entry['id'] for entry in changes]
    rows=list(db.scalars(select(DataRecord).where(DataRecord.id.in_(ids))))
    fields=_fields(db,rows[0].table_id) if rows else []
    resolver=Resolver(db) if any(f.type in COMPUTED for f in fields) else None
    return [{**(resolver.payload(r) if resolver and r.deleted_at is None else record_payload(r)),'deleted':r.deleted_at is not None} for r in rows]

def replay(db,table_id,user_id,key,digest):
    prior=db.scalar(select(TableChange).where(TableChange.table_id==table_id,TableChange.user_id==user_id,TableChange.request_id==key))
    if prior:
        if prior.digest!=digest:raise ApiError('REQUEST_ID_REUSED','同一请求编号不能用于不同修改',409)
        return {'operation':journal_payload(prior),'replayed':True,'records':operation_records(db,prior.changes)}

@router.post('/tables/{table_id}/transactions')
def transact(table_id:int,payload:TransactionIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    bounded(payload.model_dump())
    if sum(len(e.changes) for e in payload.edits)>5000:raise ApiError('BATCH_TOO_LARGE','一批最多修改 5000 个单元格',422)
    table=lock_table(db,table_id,payload.schema_version)
    digest=hashlib.sha256(json.dumps(payload.model_dump(exclude={'request_id'}),sort_keys=True).encode()).hexdigest()
    prior=replay(db,table_id,user.id,payload.request_id,digest)
    if prior:return prior
    ids=[e.id for e in payload.edits if e.id is not None]
    if len(set(ids))!=len(ids):raise ApiError('DUPLICATE_RECORD','一批修改中每行只能出现一次',422)
    fields=_fields(db,table_id);records={r.id:r for r in db.scalars(select(DataRecord).where(DataRecord.id.in_(sorted(ids))).order_by(DataRecord.id).with_for_update())} if ids else {}
    planned=[]
    for e in payload.edits:
        row=records.get(e.id) if e.id else None
        if e.id and (not row or row.table_id!=table_id or row.deleted_at is not None):raise ApiError('NOT_FOUND','部分记录不存在或已删除，整批未修改',404)
        if row and e.version!=row.version:raise ApiError('VERSION_CONFLICT','部分记录已被修改，整批未修改',409,{'record_id':row.id,'current_version':row.version})
        if not row and (e.delete or e.version is not None):raise ApiError('INVALID_EDIT','新记录不能删除或指定版本',422)
        data=None if e.delete else validate_record(db,fields,{**(row.data if row else {}),**e.changes},table_id=table_id)
        planned.append((e,row,data))
    changes=[]
    for e,row,data in planned:
        before=snapshot(row) if row else None
        if row:
            values={'version':row.version+1,'updated_at':utcnow()}
            if e.delete:values.update(deleted_at=utcnow(),deleted_snapshot={'data':row.data,'version':row.version,'table_name':table.name})
            else:values['data']=data
            result=db.execute(update(DataRecord).where(DataRecord.id==row.id,DataRecord.version==e.version,DataRecord.deleted_at.is_(None)).values(**values))
            if result.rowcount!=1:raise ApiError('VERSION_CONFLICT','记录已变化，整批未修改',409)
            db.refresh(row)
        else:
            row=DataRecord(table_id=table_id,data=data);db.add(row);db.flush()
        if e.delete:push(db,'record',row.id,f'{table.name} #{row.id}',row.deleted_snapshot,parent_id=table_id)
        else:_sync_file_refs(db,'record',row.id,fields,data)
        changes.append({'id':row.id,'before':before,'after':snapshot(row)})
    bounded(changes,4_000_000)
    c=TableChange(table_id=table_id,user_id=user.id,request_id=payload.request_id,digest=digest,label=payload.label,schema_version=table.schema_version,changes=changes,source=db.info.get('table_actor','用户')[:100])
    db.add(c);hold_files(db,changes,fields)
    for redo in db.scalars(select(TableChange).where(TableChange.table_id==table_id,TableChange.user_id==user.id,TableChange.action=='undo',TableChange.undone_by.is_(None))):redo.undone_by=-1
    db.flush();result_records=operation_records(db,c.changes)
    db.commit()
    return {'operation':journal_payload(c),'replayed':False,'records':result_records}

@router.get('/tables/{table_id}/changes')
def changes(table_id:int,before:int|None=None,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    _get_table(db,table_id);stmt=select(TableChange).where(TableChange.table_id==table_id,TableChange.user_id==user.id)
    if before:stmt=stmt.where(TableChange.id<before)
    return [journal_payload(c) for c in db.scalars(stmt.order_by(TableChange.id.desc()).limit(50))]


@router.get('/table-changes/{change_id}')
def change_detail(change_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    c=db.scalar(select(TableChange).where(TableChange.id==change_id,TableChange.user_id==user.id))
    if not c:raise ApiError('NOT_FOUND','修改记录不存在',404)
    _get_table(db,c.table_id)
    return journal_payload(c,True)

@router.post('/table-changes/{change_id}/undo')
def undo(change_id:int,payload:UndoIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    c=db.scalar(select(TableChange).where(TableChange.id==change_id,TableChange.user_id==user.id))
    if not c:raise ApiError('NOT_FOUND','修改记录不存在',404)
    table=lock_table(db,c.table_id,c.schema_version)
    action=payload.action or ('redo' if c.action=='undo' else 'undo')
    if action not in {'undo','redo'} or action=='redo' and c.action!='undo' or action=='undo' and c.action=='undo':raise ApiError('INVALID_UNDO','撤销/重做方向不合法',422)
    digest=action+':'+str(c.id);prior=replay(db,c.table_id,user.id,payload.request_id,digest)
    if prior:return prior
    db.refresh(c)
    if c.undone_by:raise ApiError('ALREADY_UNDONE','这次修改已经撤销',409)
    fields=_fields(db,table.id);planned=[]
    for entry in sorted(c.changes,key=lambda e:e['id']):
        row=db.scalar(select(DataRecord).where(DataRecord.id==entry['id'],DataRecord.table_id==table.id).with_for_update())
        if not row or snapshot(row)!=entry['after']:raise ApiError('VERSION_CONFLICT','记录在此后已被修改，不能覆盖撤销',409,{'record_id':entry['id']})
        desired=entry['before'] or {**entry['after'],'deleted':True}
        if not desired['deleted']:validate_record(db,fields,desired['data'],table_id=table.id)
        planned.append((row,desired))
    reverse=[]
    for row,desired in planned:
        previous=snapshot(row)
        result=db.execute(update(DataRecord).where(DataRecord.id==row.id,DataRecord.version==row.version).values(data=desired['data'],deleted_at=utcnow() if desired['deleted'] else None,version=row.version+1,updated_at=utcnow()))
        if result.rowcount!=1:raise ApiError('VERSION_CONFLICT','记录已经改变，撤销未执行',409)
        db.refresh(row)
        if desired['deleted']:push(db,'record',row.id,f'{table.name} #{row.id}',{'data':row.data,'version':row.version,'table_name':table.name},parent_id=table.id)
        else:
            for t in db.scalars(select(TrashEntry).where(TrashEntry.kind=='record',TrashEntry.entity_id==row.id,TrashEntry.restored_at.is_(None),TrashEntry.purged_at.is_(None))):t.restored_at=utcnow()
            _sync_file_refs(db,'record',row.id,fields,row.data)
        reverse.append({'id':row.id,'before':previous,'after':snapshot(row)})
    u=TableChange(table_id=table.id,user_id=user.id,request_id=payload.request_id,digest=digest,label=('重做：' if action=='redo' else '撤销：')+c.label[:95],schema_version=table.schema_version,changes=reverse,reverts_id=c.id,source=db.info.get('table_actor','用户')[:100],action=action)
    db.add(u);hold_files(db,reverse,fields);db.flush();c.undone_by=u.id
    # An explicit undo restored known values. Rebase earlier active journal
    # versions for those exact values, allowing consecutive undo without ever
    # ignoring a version change made outside this undo transaction.
    restored={entry['id']:entry['after'] for entry in reverse}
    earlier=db.scalars(select(TableChange).where(TableChange.table_id==table.id,TableChange.user_id==user.id,TableChange.id<c.id,TableChange.undone_by.is_(None)).order_by(TableChange.id.desc()).limit(500)).all()
    for previous in earlier:
        entries=copy.deepcopy(previous.changes);updated=False
        for entry in entries:
            now=restored.get(entry['id']);old=entry['after']
            if now and old['data']==now['data'] and old['deleted']==now['deleted']:
                old['version']=now['version'];updated=True
        if updated:previous.changes=entries
    db.flush();result_records=operation_records(db,u.changes)
    db.commit();return {'operation':journal_payload(u),'replayed':False,'records':result_records}

def validate_workbook_snapshot(snapshot):
    import math
    bounded(snapshot,10_000_000)
    nodes=[(snapshot,0)];count=0
    while nodes:
        value,depth=nodes.pop();count+=1
        if depth>50 or count>1000000:raise ApiError('WORKBOOK_LIMIT','工作簿内容过于复杂',422)
        if isinstance(value,float) and not math.isfinite(value):raise ApiError('INVALID_WORKBOOK','工作簿包含非法数值',422)
        if isinstance(value,dict):
            if any(k in {'__proto__','constructor','prototype'} for k in value):raise ApiError('INVALID_WORKBOOK','工作簿包含非法对象键',422)
            nodes.extend((v,depth+1) for v in value.values())
        elif isinstance(value,list):nodes.extend((v,depth+1) for v in value)
    sheets=snapshot.get('sheets',{});order=snapshot.get('sheetOrder')
    if not isinstance(sheets,dict) or not 1<=len(sheets)<=30 or not isinstance(order,list) or any(not isinstance(i,str) for i in order) or len(order)!=len(set(order)) or set(order)!=set(sheets):raise ApiError('INVALID_WORKBOOK','工作簿需要 1–30 张工作表，且顺序与工作表一致',422)
    cells=0;merge_count=0
    for sheet in sheets.values():
        if not isinstance(sheet,dict) or not isinstance(sheet.get('cellData',{}),dict):raise ApiError('INVALID_WORKBOOK','工作表内容格式不合法',422)
        rows=sheet.get('rowCount',1000);cols=sheet.get('columnCount',26)
        if not isinstance(rows,int) or not 1<=rows<=100000 or not isinstance(cols,int) or not 1<=cols<=1000:raise ApiError('WORKBOOK_LIMIT','单张工作表最多 100000 行、1000 列',422)
        for r,row in sheet.get('cellData',{}).items():
            if not str(r).isdigit() or not 0<=int(r)<rows or not isinstance(row,dict):raise ApiError('INVALID_WORKBOOK','行坐标不合法',422)
            cells+=len(row)
            if cells>100000:raise ApiError('WORKBOOK_LIMIT','工作簿最多保存 100000 个非空单元格',422)
            for c,cell in row.items():
                if not str(c).isdigit() or not 0<=int(c)<cols or not isinstance(cell,dict):raise ApiError('INVALID_WORKBOOK','单元格坐标不合法',422)
                if not isinstance(cell.get('v'),(str,int,float,bool,type(None))) or ('f' in cell and (not isinstance(cell['f'],str) or len(cell['f'])>10000)):raise ApiError('INVALID_WORKBOOK','单元格值或公式不合法',422)
        for merged in sheet.get('mergeData',[]):
            if not isinstance(merged,dict):raise ApiError('INVALID_WORKBOOK','合并区域不合法',422)
            sr,er,sc,ec=[merged.get(k,0) for k in ['startRow','endRow','startColumn','endColumn']]
            if not all(isinstance(x,int) for x in [sr,er,sc,ec]) or not 0<=sr<=er<rows or not 0<=sc<=ec<cols:raise ApiError('INVALID_WORKBOOK','合并区域坐标不合法',422)
            area=(er-sr+1)*(ec-sc+1);merge_count+=area
            if area>10000 or merge_count>100000:raise ApiError('WORKBOOK_LIMIT','合并区域过大',422)

@router.post('/tables/{table_id}/workbook/validate')
def validate_workbook(table_id:int,payload:WorkbookIn,db:Session=Depends(get_db)):
    _get_table(db,table_id);validate_workbook_snapshot(payload.snapshot);return {'ok':True}

@router.get('/tables/{table_id}/workbook')
def workbook(table_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    _get_table(db,table_id);w=db.scalar(select(TableWorkbook).where(TableWorkbook.table_id==table_id,TableWorkbook.user_id==user.id))
    return {'version':w.version if w else 0,'snapshot':w.snapshot if w else None,'updated_at':iso_z(w.updated_at) if w else None}

@router.put('/tables/{table_id}/workbook')
def save_workbook(table_id:int,payload:WorkbookIn,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    lock_table(db,table_id);bounded(payload.snapshot,10_000_000)
    validate_workbook_snapshot(payload.snapshot)
    w=db.scalar(select(TableWorkbook).where(TableWorkbook.table_id==table_id,TableWorkbook.user_id==user.id).with_for_update())
    if payload.version!=(w.version if w else 0):raise ApiError('VERSION_CONFLICT','工作簿已在其他页面更新，当前内容仍保留，请导出备份后处理',409)
    if w:
        result=db.execute(update(TableWorkbook).where(TableWorkbook.id==w.id,TableWorkbook.version==payload.version).values(snapshot=payload.snapshot,version=w.version+1,updated_at=utcnow()))
        if result.rowcount!=1:raise ApiError('VERSION_CONFLICT','工作簿已改变',409)
        db.refresh(w)
    else:w=TableWorkbook(table_id=table_id,user_id=user.id,snapshot=payload.snapshot,version=1);db.add(w)
    db.commit();return {'version':w.version,'updated_at':iso_z(w.updated_at)}
