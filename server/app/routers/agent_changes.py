"""Browser-session-only approval. Agent bearer tokens cannot invoke these routes."""
import asyncio
import json
from pathlib import Path
from fastapi import APIRouter,Depends,Query,Request
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field
from sqlalchemy import func,select
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_current_user
from ..models import AgentChange,AgentToken,AgentActivity,User,utcnow,AgentReviewNote
from ..agent_runtime import AgentSession
from ..services import agent_staging as staging
from ..errors import ApiError
from ..config import settings

def review_user(request:Request,user:User=Depends(get_current_user)):
    if request.headers.get('authorization'):
        raise ApiError('AGENT_REVIEW_RESERVED','审批只接受用户网页登录，不接受 Agent 令牌',403)
    return user

router=APIRouter(prefix='/agent-changes',tags=['Agent review'])
class ReviewIn(BaseModel):
    version:int=Field(ge=1)
    note:str=Field(default="",max_length=1000)


def get_change(db,user,id,lock=False):
    stmt=select(AgentChange).where(AgentChange.id==id,AgentChange.user_id==user.id)
    row=db.scalar(stmt.with_for_update() if lock else stmt)
    if row is None:raise ApiError('NOT_FOUND','暂存不存在',404)
    comment=db.get(AgentReviewNote,row.id)
    row.review_note=comment.note if comment else None
    return row


def check_pending(row,version):
    if row.status!='pending':raise ApiError('CHANGE_REVIEWED','此暂存已处理',409)
    if row.version!=version:raise ApiError('VERSION_CONFLICT','暂存已重新预览，请刷新后核对',409)

@router.get('')
def listing(status:str='pending',q:str=Query('',max_length=100),page:int=Query(default=1,ge=1),user:User=Depends(review_user),db:Session=Depends(get_db)):
    base=select(AgentChange,AgentToken.name).join(AgentToken).where(AgentChange.user_id==user.id)
    if q:base=base.where(AgentChange.title.contains(q,autoescape=True) | AgentToken.name.contains(q,autoescape=True))
    if status!='all':
        if status not in {'pending','applied','rejected','split'}:raise ApiError('INVALID_STATUS','状态不合法',422)
        base=base.where(AgentChange.status==status)
    total=db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows=db.execute(base.order_by(AgentChange.id.desc()).offset((page-1)*20).limit(20)).all()
    counts=dict(db.execute(select(AgentChange.status,func.count()).where(AgentChange.user_id==user.id).group_by(AgentChange.status)).all())
    return {'items':[{k:v for k,v in staging.change_payload(row,name).items() if k not in {'preview','results'}} for row,name in rows], 'total':total,'counts':counts}

@router.get('/{change_id}')
def detail(change_id:int,user:User=Depends(review_user),db:Session=Depends(get_db)):
    row=get_change(db,user,change_id)
    return staging.change_payload(row,db.get(AgentToken,row.token_id).name)

@router.get('/{change_id}/files/{index}')
def file_result(change_id:int,index:int,user:User=Depends(review_user),db:Session=Depends(get_db)):
    row=get_change(db,user,change_id)
    if row.status!='applied' or index<0 or index>=len(row.results or []):raise ApiError('NOT_FOUND','文件结果不存在',404)
    path=settings.storage_dir/'agent-results'/f'{row.id}-{index}.bin'
    if not path.is_file():raise ApiError('NOT_FOUND','文件结果不存在',404)
    return FileResponse(path,media_type=row.results[index].get('content_type','application/octet-stream'),filename=row.results[index].get('filename','result.bin'))

@router.post('/{change_id}/reject')
def reject(change_id:int,payload:ReviewIn,user:User=Depends(review_user),db:Session=Depends(get_db)):
    row=get_change(db,user,change_id,True)
    if row.status=='rejected':return staging.change_payload(row)
    check_pending(row,payload.version)
    operations=staging.decode_operations(row)
    row.status='rejected';row.reviewed_at=utcnow();row.reviewed_by=user.id;row.version+=1;row.error=None
    if payload.note.strip():db.add(AgentReviewNote(change_id=row.id,user_id=user.id,note=payload.note.strip()));row.review_note=payload.note.strip()
    db.commit();staging.cleanup_uploads(operations)
    return staging.change_payload(row)

@router.post('/{change_id}/refresh')
async def refresh(change_id:int,payload:ReviewIn,request:Request,user:User=Depends(review_user),db:Session=Depends(get_db)):
    row=get_change(db,user,change_id,True);check_pending(row,payload.version)
    user_id=user.id;token_name=db.get(AgentToken,row.token_id).name
    operations=staging.decode_operations(row);bind=db.get_bind()
    db.rollback()
    fingerprints,previews=await staging.preview(request.app,user_id,'Agent 重新预览: '+token_name,operations,bind)
    from types import SimpleNamespace
    row=get_change(db,SimpleNamespace(id=user_id),change_id,True);check_pending(row,payload.version)
    row.fingerprints=fingerprints;row.preview=previews;row.version+=1;row.error=None;db.commit()
    return staging.change_payload(row,token_name)

@router.post('/{change_id}/merge')
async def merge(change_id:int,payload:ReviewIn,request:Request,user:User=Depends(review_user),db:Session=Depends(get_db)):
    operations=[];artifacts=[]
    from types import SimpleNamespace
    user=SimpleNamespace(id=user.id,username=user.username)
    db.rollback()  # The merge session is the sole owner of a DB connection.
    with AgentSession(bind=db.get_bind(),autoflush=False,expire_on_commit=False) as work:
        row=get_change(work,user,change_id,True)
        if row.status=='applied':return staging.change_payload(row)
        check_pending(row,payload.version)
        token=work.get(AgentToken,row.token_id)
        operations=staging.decode_operations(row)
        try:
            current=await asyncio.to_thread(staging.fingerprint,work,row.fingerprints,True)
            if current!=row.fingerprints:
                raise ApiError('CHANGE_CONFLICT','相关数据已变化。本次未合并，请重新预览并核对差异；若操作携带旧版本号，应让 Agent 重新提交。',409)
            refs={};results=[]
            for index,original in enumerate(operations):
                op=staging.normalize(staging.resolve(original,refs))
                response=await staging.dispatch(request.app,work,user.id,f'Agent 合并: {token.name}；审核: {user.username}',op)
                try:result=response.json()
                except ValueError:
                    directory=settings.storage_dir/'agent-results';directory.mkdir(parents=True,exist_ok=True)
                    path=directory/f'{row.id}-{index}.bin';path.write_bytes(response.content);artifacts.append(path)
                    result={'download_url':f'/api/v1/agent-changes/{row.id}/files/{index}',
                        'agent_download_url':f'/api/v1/agent/changes/{row.id}/files/{index}',
                        'content_type':response.headers.get('content-type','application/octet-stream'),'filename':'result.xlsx' if 'spreadsheetml' in response.headers.get('content-type','') else 'result.bin'}
                refs[op.get('ref') or f'op{index}']=result
                results.append(staging.redact(result))
            row.status='applied';row.results=results;row.reviewed_at=utcnow();row.reviewed_by=user.id;row.version+=1;row.error=None
            work.add(AgentActivity(token_id=row.token_id,method='MERGE',path=f'/api/v1/agent-changes/{row.id}'))
            if payload.note.strip():work.add(AgentReviewNote(change_id=row.id,user_id=user.id,note=payload.note.strip()));row.review_note=payload.note.strip()
            Session.commit(work)
            answer=staging.change_payload(row,token.name)
        except Exception as error:
            work.rollback()
            for path in artifacts:path.unlink(missing_ok=True)
            failed=get_change(db,user,change_id,True)
            if failed.status=='pending':failed.error=str(getattr(error,'message','合并失败，正式数据未提交'))[:1000];db.commit()
            raise
    staging.cleanup_uploads(operations)
    return answer
class SplitIn(BaseModel):
    version:int=Field(ge=1)
    indices:list[int]=Field(min_length=1,max_length=99)

@router.post('/{change_id}/split',status_code=201)
async def split_change(change_id:int,payload:SplitIn,request:Request,user=Depends(review_user),db:Session=Depends(get_db)):
    from ..services.encryption import encrypt_config
    import hashlib
    row=get_change(db,user,change_id,True);check_pending(row,payload.version)
    operations=staging.decode_operations(row);chosen=set(payload.indices)
    if any(i<0 or i>=len(operations) for i in chosen) or len(chosen)>=len(operations):raise ApiError('INVALID_SELECTION','请选择部分操作，至少保留一项',422)
    if '{{' in json.dumps(operations) or any(staging.deferred(op) for op in operations):raise ApiError('DEPENDENT_CHANGE','包含结果引用或文件/外部操作的批次不能拆分，请让 Agent 分开提交',422)
    selected=[op for i,op in enumerate(operations) if i in chosen];remaining=[op for i,op in enumerate(operations) if i not in chosen]
    uid=user.id;token_id=row.token_id;name=db.get(AgentToken,token_id).name;title=row.title;bind=db.get_bind();db.rollback()
    a,b=await staging.preview(request.app,uid,'拆分预览: '+name,selected,bind)
    c,d=await staging.preview(request.app,uid,'拆分预览: '+name,remaining,bind)
    from types import SimpleNamespace
    row=get_change(db,SimpleNamespace(id=uid),change_id,True);check_pending(row,payload.version)
    children=[]
    for index,(ops,fingerprints,previews) in enumerate([(remaining,c,d),(selected,a,b)]):
        child=AgentChange(user_id=uid,token_id=token_id,title=title[:180]+('（拆分：其余）' if index==0 else '（拆分：所选）'),
            operations_cipher=encrypt_config({'operations':ops}),payload_hash=hashlib.sha256(json.dumps(ops,sort_keys=True).encode()).hexdigest(),
            fingerprints=fingerprints,preview=previews,status='pending')
        db.add(child);db.flush();children.append(child)
    # Keep the original request intact. It can never be mistaken for an applied
    # complete batch after only one subset was approved.
    row.status='split';row.version+=1;row.reviewed_at=utcnow();row.reviewed_by=uid
    row.results=[{'change_id':child.id,'operation_count':len(child.preview)} for child in children]
    db.commit()
    return {'original':staging.change_payload(row,name),'remaining':staging.change_payload(children[0],name),'split':staging.change_payload(children[1],name)}
