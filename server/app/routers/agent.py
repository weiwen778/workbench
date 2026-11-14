"""Full business API for Agents: reads are immediate, all mutations are reviewed drafts."""
import hashlib
import json
from pathlib import Path
import re
import uuid

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response, FileResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from ..agent_access import get_agent_token
from ..agent_policy import effective_policy, write_mode
from ..agent_runtime import AgentSession
from ..agent_guide import GUIDE
from ..config import settings
from ..db import get_db
from ..errors import ApiError
from ..models import AgentActivity, AgentChange, AgentRun, AgentToken, Todo, DataRecord
from ..services import agent_direct
from ..services import agent_staging as staging
from ..services.encryption import encrypt_config
from .agent_tokens import token_payload
from . import tables, todos

router=APIRouter(prefix='/agent',tags=['Agent'])

class Operation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    method: str
    path: str = Field(max_length=1000)
    body: object = None
    ref: str | None = Field(default=None,pattern=r'^[A-Za-z][A-Za-z0-9_]{0,40}$')

class ChangeIn(BaseModel):
    title: str = Field(default='Agent 批量变更',min_length=1,max_length=200)
    operations: list[Operation] = Field(min_length=1,max_length=100)
    request_key: str | None = Field(default=None,max_length=128)

@router.get('/me')
def me(token:AgentToken=Depends(get_agent_token)):
    mode=write_mode(token)
    return {**token_payload(token),'write_mode':mode,'requires_user_merge':mode=='review','undo_supported':True}

@router.get('/guide')
def guide(_token=Depends(get_agent_token)):
    return {'guide':GUIDE}

@router.get('/capabilities')
def capabilities(request:Request,token:AgentToken=Depends(get_agent_token)):
    routes=[]
    for candidate,methods in request.app.openapi()['paths'].items():
        if candidate.startswith('/api/v1/'):
            path=candidate[7:]
            if path.startswith('/{resource}/categories/'):
                for resource in ('memos','bookmarks'):
                    routes.append({'path':path.replace('{resource}',resource),'methods':sorted(method.upper() for method in methods if method in {'get','post','put','patch','delete'})})
            if path.strip('/').split('/')[0] in staging.ROOTS:
                routes.append({'path':path,'methods':sorted(method.upper() for method in methods if method in {'get','post','put','patch','delete'})})
    payload = token_payload(token)
    policy = payload['policy'] or effective_policy(token)
    return {'write_mode':payload['write_mode'],'review':'用户在设置 → Agent 操作记录中撤销' if payload['write_mode']=='direct' else '用户在设置 → Agent 暂存区合并','scopes':token.scopes,'routes':routes,
        'policy':policy,
        'reserved':['账号登录','令牌管理','暂存审批'],'batch_endpoint':'/agent/changes','max_operations_per_change':policy['max_operations'],
        'references':'同批操作可用 {{前一步ref.id}} 或 {{前一步ref.fields.0.key}} 引用创建结果。'}


def own(db,token,change_id):
    change=db.scalar(select(AgentChange).where(AgentChange.id==change_id,AgentChange.token_id==token.id,AgentChange.user_id==token.user_id))
    if change is None: raise ApiError('NOT_FOUND','暂存不存在',404)
    return change

@router.get('/changes')
def own_changes(token=Depends(get_agent_token),db=Depends(get_db)):
    rows=db.scalars(select(AgentChange).where(AgentChange.token_id==token.id).order_by(AgentChange.id.desc()).limit(100)).all()
    return {'items':[{k:v for k,v in staging.change_payload(row,token.name).items() if k not in {'preview','results'}} for row in rows]}

@router.get('/changes/{change_id}')
def own_change(change_id:int,token=Depends(get_agent_token),db=Depends(get_db)):
    return staging.change_payload(own(db,token,change_id),token.name)

@router.get('/changes/{change_id}/files/{index}')
def own_file(change_id:int,index:int,token=Depends(get_agent_token),db=Depends(get_db)):
    change=own(db,token,change_id)
    if change.status!='applied' or index<0 or index>=len(change.results or []): raise ApiError('NOT_FOUND','合并结果不存在',404)
    path=settings.storage_dir/'agent-results'/f'{change.id}-{index}.bin'
    if not path.is_file(): raise ApiError('NOT_FOUND','文件结果不存在',404)
    result=change.results[index]
    return FileResponse(path,media_type=result.get('content_type','application/octet-stream'),filename=result.get('filename','result.bin'))


async def submit(request,token,db,title,operations,key=None):
    agent_direct.enforce_limits(token,db,len(operations))
    if len(json.dumps(operations,ensure_ascii=False).encode())>staging.MAX_BYTES: raise ApiError('CHANGE_TOO_LARGE','单份暂存内容最多 20 MB',413)
    refs=set()
    for op in operations:
        if op['method'].upper() not in {'POST','PUT','PATCH','DELETE'}: raise ApiError('INVALID_CHANGE_METHOD','暂存只接受新增、修改、删除操作',422)
        op['path']=staging.canonical(op['path']);staging.authorize(token,op['path'],True,op['method'].upper(),db)
        if op.get('ref'):
            if op['ref'] in refs: raise ApiError('DUPLICATE_REFERENCE','同批操作的 ref 不能重复',422)
            refs.add(op['ref'])
    logical_operations=[{**op, 'upload':{k:v for k,v in op['upload'].items() if k!='path'}} if op.get('upload') else op for op in operations]
    digest=hashlib.sha256(json.dumps(logical_operations,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    if key:
        if len(key)>128: raise ApiError('INVALID_REQUEST_KEY','幂等键最多 128 个字符',422)
        previous=db.scalar(select(AgentChange).where(AgentChange.token_id==token.id,AgentChange.request_key==key))
        if previous:
            if previous.payload_hash!=digest: raise ApiError('REQUEST_KEY_REUSED','该幂等键已用于另一份内容',409)
            return staging.change_payload(previous,token.name)
    pending=db.scalar(select(func.count()).select_from(AgentChange).where(AgentChange.user_id==token.user_id,AgentChange.status=='pending')) or 0
    if pending>=2000: raise ApiError('PENDING_LIMIT','待审核暂存已达 2000 份，请先处理',409)
    # Release the request connection before the isolated preview needs one.
    db.expunge(token);db.rollback()
    fingerprints,previews=await staging.preview(request.app,token.user_id,'Agent 预览: '+token.name,operations,db.get_bind())
    change=AgentChange(user_id=token.user_id,token_id=token.id,request_key=key,title=title,
        operations_cipher=encrypt_config({'operations':operations}),payload_hash=digest,
        fingerprints=fingerprints,preview=previews,status='pending')
    db.add(change)
    try:
        db.flush()
        db.add(AgentActivity(token_id=token.id,method='POST',path=f'/api/v1/agent/changes/{change.id}'))
        db.commit()
    except IntegrityError:
        db.rollback()
        previous=db.scalar(select(AgentChange).where(AgentChange.token_id==token.id,AgentChange.request_key==key)) if key else None
        if previous and previous.payload_hash==digest:return staging.change_payload(previous,token.name)
        raise ApiError('CHANGE_CONFLICT','暂存提交冲突，请用同一幂等键查询后重试',409)
    return staging.change_payload(change,token.name)

@router.post('/changes',status_code=202)
async def create_change(payload:ChangeIn,request:Request,token=Depends(get_agent_token),db=Depends(get_db)):
    operations=[op.model_dump(exclude_none=True) for op in payload.operations]
    key=payload.request_key or request.headers.get('Idempotency-Key')
    if write_mode(token)=='direct':
        result=await agent_direct.execute(request,token,db,payload.title,operations,key)
        return JSONResponse(result,status_code=200)
    return await submit(request,token,db,payload.title,operations,key)

# These two convenient read endpoints existed before staging; retain their contracts.
@router.get('/todos/{todo_id}')
def one_todo(todo_id:int,token=Depends(get_agent_token),db=Depends(get_db)):
    staging.authorize(token,'/todos')
    todo=db.get(Todo,todo_id)
    if todo is None:raise ApiError('NOT_FOUND','待办不存在',404)
    children=db.scalars(select(Todo).where(Todo.parent_id==todo.id).order_by(Todo.sort_index,Todo.id)).all()
    return todos.serialize(todo,list(children))

@router.get('/records/{record_id}')
def one_record(record_id:int,token=Depends(get_agent_token),db=Depends(get_db)):
    staging.authorize(token,'/records')
    record=db.get(DataRecord,record_id)
    if record is None or record.deleted_at is not None:raise ApiError('NOT_FOUND','表格记录不存在',404)
    tables._get_table(db,record.table_id)
    return tables.record_payload(record,db)


def own_run(db,token,run_id):
    run=db.scalar(select(AgentRun).where(AgentRun.id==run_id,AgentRun.token_id==token.id,AgentRun.user_id==token.user_id))
    if run is None: raise ApiError('NOT_FOUND','操作记录不存在',404)
    return run

@router.get('/runs')
def own_runs(token=Depends(get_agent_token),db=Depends(get_db)):
    rows=db.scalars(select(AgentRun).where(AgentRun.token_id==token.id,AgentRun.user_id==token.user_id).order_by(AgentRun.id.desc()).limit(100)).all()
    return {'items':[{k:v for k,v in agent_direct.run_payload(row,token.name).items() if k not in {'preview','results'}} for row in rows]}

@router.get('/runs/{run_id}')
def own_run_detail(run_id:int,token=Depends(get_agent_token),db=Depends(get_db)):
    return agent_direct.run_payload(own_run(db,token,run_id),token.name)


@router.api_route('/{path:path}',methods=['GET','POST','PUT','PATCH','DELETE'],include_in_schema=False)
async def business(path:str,request:Request,token=Depends(get_agent_token),db=Depends(get_db)):
    target=staging.canonical('/'+path+('?'+request.url.query if request.url.query else ''))
    readonly=request.method=='GET' or (request.method=='POST' and path=='dashboards/preview')
    staging.authorize(token,target,not readonly,request.method,db)
    body=None;upload=None;form=None
    content_type=request.headers.get('content-type','')
    if request.method!='GET':
        if content_type.startswith('multipart/form-data'):
            data=await request.form()
            file=data.get('file')
            if file is None or not hasattr(file,'read'):raise ApiError('FILE_REQUIRED','请选择文件',422)
            raw=await file.read(settings.max_upload_bytes+1)
            if not raw or len(raw)>settings.max_upload_bytes:raise ApiError('FILE_TOO_LARGE','文件为空或超过上传限制',413)
            directory=settings.storage_dir/'agent-staging';directory.mkdir(parents=True,exist_ok=True)
            destination=directory/(uuid.uuid4().hex+'.bin');destination.write_bytes(raw);destination.chmod(0o600)
            upload={'path':str(destination.resolve()),'name':Path(file.filename or 'file').name,'content_type':file.content_type or 'application/octet-stream','size':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            form={k:str(v) for k,v in data.items() if k!='file'}
        else:
            raw=bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw)>staging.MAX_BYTES:raise ApiError('CHANGE_TOO_LARGE','请求内容最多 20 MB',413)
            if raw:
                try:body=json.loads(raw)
                except ValueError:raise ApiError('INVALID_JSON','请求不是有效 JSON',422)
    operation={'method':request.method,'path':target,'body':body}
    if upload:operation.update(upload=upload,form=form)
    if readonly:
        staging.route_for(request.app,request.method,target)
        with AgentSession(bind=db.get_bind(),autoflush=False,expire_on_commit=False) as sandbox:
            try:response=await staging.dispatch(request.app,sandbox,token.user_id,'Agent: '+token.name,operation)
            finally:sandbox.rollback()
        headers={k:v for k,v in response.headers.items() if k.lower() in {'content-type','content-disposition'}}
        return Response(response.content,status_code=response.status_code,headers=headers)
    if write_mode(token)=='direct':
        try:
            result=await agent_direct.execute(request,token,db,'',[operation],request.headers.get('Idempotency-Key'))
        except BaseException:
            if upload:Path(upload['path']).unlink(missing_ok=True)
            raise
        if upload:staging.cleanup_uploads([operation])
        headers={'X-Agent-Run-Id':str(result['run_id']),'X-Agent-Write-Mode':'direct','X-Agent-Undo-Status':result['undo_status']}
        return JSONResponse(result['results'][0],status_code=result['result_status'],headers=headers)
    try:
        result=await submit(request,token,db,request.method+' '+url_path(target),[operation],request.headers.get('Idempotency-Key'))
        if upload:
            stored=staging.decode_operations(db.get(AgentChange,result['id']))
            if stored[0].get('upload',{}).get('path')!=upload['path']: staging.cleanup_uploads([operation])
        return JSONResponse(result,status_code=202)
    except BaseException:
        if upload:Path(upload['path']).unlink(missing_ok=True)
        raise


def url_path(path):
    return path.split('?')[0][:180]