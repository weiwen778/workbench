from datetime import timedelta
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter,Depends,UploadFile,File,Form
from pydantic import BaseModel,Field
from sqlalchemy import select,delete
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import AiConnection,AiExtraction,DataTable,DataRecord,User,utcnow
from ..services.encryption import encrypt_config,decrypt_config
from ..services import ai_tables as service
from ..services.fields import validate_record,validate_value
from .tables import _fields,_lock_table,field_payload


def browser_only(user:User=Depends(get_current_user)):
    from ..agent_runtime import execution
    if execution.get() is not None:raise ApiError('BROWSER_ONLY','AI 识别与确认请在浏览器中操作',403)
    return user
router=APIRouter(tags=['ai-tables'],dependencies=[Depends(browser_only)])

class ConfigIn(BaseModel):
    api_key:str|None=Field(default=None,max_length=512)
    default_model:str='glm-4v-flash'
    compare_models:bool=False

class ConfirmIn(BaseModel):
    records:list[dict]=Field(min_length=1,max_length=50)


def connection(db):return db.get(AiConnection,1)
def config_payload(c):return {'configured':bool(c and c.encrypted_config),'default_model':c.default_model if c else 'glm-4v-flash','compare_models':bool(decrypt_config(c.encrypted_config).get('compare_models',False)) if c and c.encrypted_config else False,'models':list(service.MODELS)}

@router.get('/ai/config')
def config(db:Session=Depends(get_db)):return config_payload(connection(db))

@router.put('/ai/config')
def save_config(payload:ConfigIn,db:Session=Depends(get_db)):
    if payload.default_model not in service.MODELS:raise ApiError('MODEL_INVALID','模型不支持',422)
    c=connection(db)
    if not c:c=AiConnection(id=1);db.add(c)
    config=decrypt_config(c.encrypted_config)
    if payload.api_key and payload.api_key.strip():config['api_key']=payload.api_key.strip()
    config['compare_models']=payload.compare_models
    if config.get('api_key'):c.encrypted_config=encrypt_config(config)
    c.default_model=payload.default_model;db.commit()
    return config_payload(c)

@router.delete('/ai/config')
def clear_config(db:Session=Depends(get_db)):
    c=connection(db)
    if c:c.encrypted_config=None;db.commit()
    return config_payload(c)

@router.post('/tables/{table_id}/ai/extract')
def extract(table_id:int,image:UploadFile=File(...),model:str=Form('glm-4v-flash'),compare:bool=Form(False),user:User=Depends(browser_only),db:Session=Depends(get_db)):
    if model not in service.MODELS:raise ApiError('MODEL_INVALID','模型不支持',422)
    raw=image.file.read(8*1024*1024+1);encoded=service.image_data(raw)
    table=db.get(DataTable,table_id)
    if not table or table.deleted_at is not None:raise ApiError('NOT_FOUND','表格不存在',404)
    if table.kind=='virtual':raise ApiError('TABLE_READ_ONLY','请使用原始表',422)
    fields=[field_payload(f) for f in _fields(db,table_id)]
    if not any(f['type'] in service.WRITABLE for f in fields):raise ApiError('NO_FIELDS','此表没有可识别填写的字段',422)
    c=connection(db);key=decrypt_config(c.encrypted_config if c else None).get('api_key')
    if not key:raise ApiError('AI_NOT_CONFIGURED','请先在设置 → AI 图片填表中配置 API Key',409)
    version=table.schema_version;uid=user.id
    # Release the DB connection while waiting for remote inference.
    db.commit()
    models=list(service.MODELS) if compare else [model]
    def one(m):
        try:return service.recognize(key,m,encoded,fields)
        except ApiError as e:return {'model':m,'error':e.message,'records':[],'warnings':[]}
    if compare:
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(one,models))
    else:results=[one(model)]
    from types import SimpleNamespace
    for result in results:
        if result.get('error'):continue
        for i,record in enumerate(result['records']):
            for k,value in list(record.items()):
                f=next(f for f in fields if f['key']==k)
                try:record[k]=validate_value(db,SimpleNamespace(**f),value,table_id=table_id)
                except ApiError as e:record.pop(k);result['warnings'].append(f'第 {i+1} 条「{f["name"]}」：{e.message}')
            for f in fields:
                if f['required'] and record.get(f['key']) in (None,'',[]):result['warnings'].append(f'第 {i+1} 条：必填项「{f["name"]}」需要补充')
        draft=AiExtraction(id=uuid4().hex,user_id=uid,table_id=table_id,schema_version=version,model=result['model'],encrypted_result=encrypt_config(result))
        db.add(draft);result['draft_id']=draft.id
    db.execute(delete(AiExtraction).where(AiExtraction.created_at<utcnow()-timedelta(days=1),AiExtraction.status=='pending'))
    db.commit()
    return {'table_id':table_id,'schema_version':version,'fields':fields,'results':results}

@router.post('/tables/{table_id}/ai/drafts/{draft_id}/confirm')
def confirm(table_id:int,draft_id:str,payload:ConfirmIn,user:User=Depends(browser_only),db:Session=Depends(get_db)):
    draft=db.scalar(select(AiExtraction).where(AiExtraction.id==draft_id,AiExtraction.user_id==user.id,AiExtraction.table_id==table_id).with_for_update())
    if not draft:raise ApiError('NOT_FOUND','识别草稿不存在',404)
    if draft.status=='applied':return {'record_ids':draft.record_ids,'already_applied':True}
    if draft.created_at<utcnow()-timedelta(days=1):raise ApiError('DRAFT_EXPIRED','草稿已过期，请重新识别',409)
    table=_lock_table(db,table_id)
    if table.schema_version!=draft.schema_version:raise ApiError('SCHEMA_CHANGED','字段配置已变化，请重新识别后再保存',409)
    fields=_fields(db,table_id);editable={f.key for f in fields if f.type in service.WRITABLE}
    if any(set(row)-editable for row in payload.records):raise ApiError('FIELD_INVALID','包含不可由 AI 填写的字段',422)
    cleaned=[validate_record(db,fields,row,table_id=table_id) for row in payload.records]
    from ..services.table_history import append,snapshot
    records=[DataRecord(table_id=table_id,data=row) for row in cleaned];db.add_all(records);db.flush()
    append(db,table,'AI 图片填表（人工确认）',[{'id':record.id,'before':None,'after':snapshot(record)} for record in records],fields)
    draft.status='applied';draft.record_ids=[record.id for record in records];draft.encrypted_result=None
    db.commit()
    return {'record_ids':draft.record_ids,'already_applied':False}