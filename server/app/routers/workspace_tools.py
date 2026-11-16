from fastapi import APIRouter,Depends,Query,Request
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field
from sqlalchemy import select,func,or_,cast,String,exists
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_admin_user, get_current_user
from ..models import BackgroundJob,OperationLog,User,Todo,TodoList,Note,Memo,Bookmark,DataTable,DataRecord,DataField,AgentChange
from ..errors import ApiError
from ..services import jobs,backups
from ..utils import iso_z
from .transfers import ExportIn
from ..config import settings
router=APIRouter(tags=['工作台工具'])


def own_job(db,user,id):
    job=db.scalar(select(BackgroundJob).where(BackgroundJob.id==id,BackgroundJob.user_id==user.id))
    if not job:raise ApiError('NOT_FOUND','任务不存在',404)
    return job

@router.get('/tasks')
def list_tasks(status:str|None=None,page:int=Query(1,ge=1),user=Depends(get_current_user),db:Session=Depends(get_db)):
    query=select(BackgroundJob).where(BackgroundJob.user_id==user.id)
    if status:query=query.where(BackgroundJob.status==status)
    total=db.scalar(select(func.count()).select_from(query.subquery()))
    counts=dict(db.execute(select(BackgroundJob.status,func.count()).where(BackgroundJob.user_id==user.id).group_by(BackgroundJob.status)).all())
    pending=db.scalar(select(func.count()).select_from(AgentChange).where(AgentChange.user_id==user.id,AgentChange.status=='pending')) or 0
    return {'items':[jobs.payload(j) for j in db.scalars(query.order_by(BackgroundJob.id.desc()).offset((page-1)*20).limit(20))],'total':total,'counts':counts,'agent_pending':pending}

@router.get('/tasks/summary')
def task_summary(user=Depends(get_current_user),db:Session=Depends(get_db)):
    from datetime import timedelta
    from ..models import utcnow
    counts=dict(db.execute(select(BackgroundJob.status,func.count()).where(BackgroundJob.user_id==user.id,BackgroundJob.updated_at>utcnow()-timedelta(days=7)).group_by(BackgroundJob.status)).all())
    pending=db.scalar(select(func.count()).select_from(AgentChange).where(AgentChange.user_id==user.id,AgentChange.status=='pending')) or 0
    return {'active':counts.get('queued',0)+counts.get('running',0),'failed':counts.get('failed',0),'agent_pending':pending}

@router.get('/tasks/{id}')
def task_detail(id:int,user=Depends(get_current_user),db:Session=Depends(get_db)):return jobs.payload(own_job(db,user,id))

@router.post('/tables/{table_id}/export-tasks',status_code=202)
def start_export(table_id:int,body:ExportIn,request:Request,user=Depends(get_current_user),db:Session=Depends(get_db)):
    table=db.get(DataTable,table_id)
    if not table or table.deleted_at:raise ApiError('NOT_FOUND','表格不存在',404)
    key=request.headers.get('Idempotency-Key')
    if key and len(key)>128:raise ApiError('INVALID_REQUEST_KEY','幂等键最多 128 字符',422)
    return jobs.payload(jobs.enqueue(db,user.id,'export','导出表格：'+table.name,{'table_id':table_id,'options':body.model_dump()},key))

@router.post('/tasks/{id}/cancel')
def cancel_task(id:int,user=Depends(get_current_user),db:Session=Depends(get_db)):
    job=own_job(db,user,id)
    if job.status not in {'queued','running'}:raise ApiError('JOB_FINISHED','任务已结束，不能取消',409)
    job.cancel_requested=True
    if job.status=='queued':job.status='cancelled'
    db.commit();return jobs.payload(job)

@router.post('/tasks/{id}/retry',status_code=202)
def retry_task(id:int,user=Depends(get_current_user),db:Session=Depends(get_db)):
    job=own_job(db,user,id)
    if job.status not in {'failed','cancelled'}:raise ApiError('JOB_NOT_RETRYABLE','只有失败或取消的任务才能重试',409)
    return jobs.payload(jobs.enqueue(db,user.id,job.kind,job.title,job.payload))

@router.get('/backups')
def backup_list(user=Depends(get_admin_user)):
    return {'items':backups.list_backups(),'enabled':settings.backup_enabled,'interval_hours':settings.backup_interval_hours,'keep':settings.backup_keep}

@router.post('/backups',status_code=202)
def backup_create(user=Depends(get_admin_user),db:Session=Depends(get_db)):
    return jobs.payload(jobs.enqueue(db,user.id,'backup','手动完整备份',{}))

@router.get('/backups/recovery-key')
def recovery_key(user=Depends(get_admin_user)):
    return FileResponse(backups.key_file(),media_type='application/octet-stream',filename='workbench-recovery.key',headers={'Cache-Control':'no-store'})

@router.get('/backups/{name}/download')
def backup_download(name:str,user=Depends(get_admin_user)):
    path=backups.archive_path(name)
    if not path.is_file():raise ApiError('NOT_FOUND','备份不存在',404)
    return FileResponse(path,media_type='application/octet-stream',filename=path.name,headers={'Cache-Control':'no-store'})

@router.post('/backups/{name}/verify',status_code=202)
def backup_verify(name:str,user=Depends(get_admin_user),db:Session=Depends(get_db)):
    if not backups.archive_path(name).is_file():raise ApiError('NOT_FOUND','备份不存在',404)
    return jobs.payload(jobs.enqueue(db,user.id,'backup_verify','校验备份',{'backup_id':name}))

@router.get('/activity')
def activity(page:int=Query(1,ge=1),q:str=Query('',max_length=100),user=Depends(get_current_user),db:Session=Depends(get_db)):
    query=select(OperationLog).where(OperationLog.user_id==user.id)
    if q:query=query.where(or_(OperationLog.actor.contains(q,autoescape=True),OperationLog.path.contains(q,autoescape=True)))
    total=db.scalar(select(func.count()).select_from(query.subquery()))
    return {'items':[{'id':r.id,'actor':r.actor,'method':r.method,'path':r.path,'status':r.status,'created_at':iso_z(r.created_at)} for r in db.scalars(query.order_by(OperationLog.id.desc()).offset((page-1)*30).limit(30))],'total':total}

@router.get('/search')
def search(q:str=Query(min_length=1,max_length=100),kind:str='all',page:int=Query(1,ge=1),user=Depends(get_current_user),db:Session=Depends(get_db)):
    keyword=q.strip()
    if not keyword:return {'items':[],'total':0}
    models={'todos':Todo,'notes':Note,'memos':Memo,'bookmarks':Bookmark,'tables':DataTable,'records':DataRecord}
    if kind!='all' and kind not in models:raise ApiError('INVALID_KIND','搜索类型不合法',422)
    results=[];total=0;has_more=False
    for resource,model in models.items():
        if kind!='all' and resource!=kind:continue
        cols=[getattr(model,k) for k in ('title','name','note','content','url','description') if hasattr(model,k)]
        if model is DataRecord:
            function=func.json_each if db.bind.dialect.name=='sqlite' else func.json_each_text
            values=function(DataRecord.data).table_valued('key','value').alias('record_values')
            condition=exists(select(1).select_from(values).where(cast(values.c.value,String).icontains(keyword,autoescape=True)).correlate(DataRecord))
        else:condition=or_(*[col.icontains(keyword,autoescape=True) for col in cols])
        query=select(model).where(condition)
        if hasattr(model,'deleted_at'):query=query.where(model.deleted_at.is_(None))
        if model is DataRecord:query=query.join(DataTable,DataTable.id==DataRecord.table_id).where(DataTable.deleted_at.is_(None))
        if kind!='all':total+=db.scalar(select(func.count()).select_from(query.subquery())) or 0
        # Each module contributes a bounded subset; a selected module supports full paging.
        offset=(page-1)*20 if kind!='all' else 0
        rows=list(db.scalars(query.order_by(model.id.desc()).offset(offset).limit(21 if kind=='all' else 20)))
        if kind=='all':has_more=has_more or len(rows)>20;total+=min(20,len(rows))
        field_map={};table_names={}
        if model is DataRecord and rows:
            table_ids={r.table_id for r in rows}
            table_names=dict(db.execute(select(DataTable.id,DataTable.name).where(DataTable.id.in_(table_ids))).all())
            for field in db.scalars(select(DataField).where(DataField.table_id.in_(table_ids)).order_by(DataField.sort_order)):field_map.setdefault(field.table_id,{})[field.key]=field
        for row in rows[:20]:
            title=getattr(row,'title',None) or getattr(row,'name',None) or ('表格记录 #'+str(row.id))
            link={'todos':f'/todos/{getattr(row,"list_id",0)}?focus={row.id}','notes':f'/notes?note={row.id}',
                  'memos':f'/memos?focus={row.id}','bookmarks':f'/bookmarks?focus={row.id}',
                  'tables':f'/data/{row.id}','records':f'/data/{getattr(row,"table_id",0)}?record={row.id}'}[resource]
            raw=str(getattr(row,'content','') or getattr(row,'note','') or getattr(row,'data','') or getattr(row,'url',''))
            if model is DataRecord:
                title=table_names.get(row.table_id,'表格')+' · 记录 #'+str(row.id)
                labels=[]
                for key,value in (row.data or {}).items():
                    field=field_map.get(row.table_id,{}).get(key)
                    if field is None:continue
                    options={o['id']:o.get('name',o['id']) for o in (field.options or [])}
                    if isinstance(value,list):value='、'.join(str(options.get(v,v)) for v in value)
                    elif isinstance(value,str):value=options.get(value,value)
                    elif isinstance(value,bool):value='是' if value else '否'
                    labels.append(field.name+'：'+str(value if value is not None else ''))
                raw='；'.join(labels)
            at=max(0,raw.lower().find(keyword.lower())-40)
            results.append({'kind':resource,'id':row.id,'title':title,'excerpt':raw[at:at+180],'url':link})
    return {'items':results,'total':total,'page':page,'module_limit':20 if kind=='all' else None,'total_is_exact':kind!='all','has_more':has_more}
@router.post('/imports/{source_id}/confirm-tasks',status_code=202)
def start_import(source_id:int,request:Request,user=Depends(get_current_user),db:Session=Depends(get_db)):
    from ..models import DataTransferJob
    source=db.get(DataTransferJob,source_id)
    if not source or source.kind!='import':raise ApiError('NOT_FOUND','导入预览不存在',404)
    if source.status not in {'ready','success'}:raise ApiError('IMPORT_NOT_READY','请先检查并修正导入数据',409)
    key=request.headers.get('Idempotency-Key')
    if key and len(key)>128:raise ApiError('INVALID_REQUEST_KEY','幂等键最多 128 字符',422)
    return jobs.payload(jobs.enqueue(db,user.id,'import','导入表格：'+str((source.payload or {}).get('table_name') or source_id),{'source_id':source_id,'source_updated_at':iso_z(source.updated_at)},key))