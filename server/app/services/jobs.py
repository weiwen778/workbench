"""Durable, single-worker jobs. Expensive work never holds a request open."""
import asyncio,logging
from datetime import timedelta
from sqlalchemy import select,func
from ..db import SessionLocal
from ..models import BackgroundJob,User,DataRecord,utcnow
from ..config import settings
from ..errors import ApiError
from ..utils import iso_z

logger=logging.getLogger(__name__)
class Cancelled(Exception):pass


def payload(job):
    return {'id':job.id,'kind':job.kind,'title':job.title,'status':job.status,'progress':job.progress,'processed':job.processed,
            'cancel_requested':job.cancel_requested,'result':job.result,'error':job.error,'created_at':iso_z(job.created_at),'updated_at':iso_z(job.updated_at)}


def enqueue(db,user_id,kind,title,body,key=None):
    if key:
        previous=db.scalar(select(BackgroundJob).where(BackgroundJob.user_id==user_id,BackgroundJob.request_key==key))
        if previous:
            if previous.kind!=kind or previous.payload!=body:raise ApiError('REQUEST_KEY_REUSED','该幂等键已用于其他任务',409)
            return previous
    if (db.scalar(select(func.count()).select_from(BackgroundJob).where(BackgroundJob.status.in_(['queued','running']))) or 0)>=100:
        raise ApiError('JOB_LIMIT','待处理任务过多，请稍后再试',409)
    job=BackgroundJob(user_id=user_id,kind=kind,title=title,payload=body,request_key=key)
    db.add(job)
    try:db.commit()
    except Exception as error:
        from sqlalchemy.exc import IntegrityError
        db.rollback()
        if not isinstance(error,IntegrityError) or not key:raise
        previous=db.scalar(select(BackgroundJob).where(BackgroundJob.user_id==user_id,BackgroundJob.request_key==key))
        if previous and previous.kind==kind and previous.payload==body:return previous
        raise ApiError('REQUEST_KEY_REUSED','该幂等键已用于其他任务',409)
    return job


def update_progress(id,done,total):
    with SessionLocal() as db:
        job=db.get(BackgroundJob,id)
        if not job or job.cancel_requested:raise Cancelled()
        job.progress=min(99,int(done*100/max(1,total)));job.processed=done;db.commit()


def run_next():
    with SessionLocal() as db:
        job=db.scalar(select(BackgroundJob).where(BackgroundJob.status=='queued').order_by(BackgroundJob.id).with_for_update(skip_locked=True).limit(1))
        if not job:return False
        job.status='running';db.commit();id=job.id;kind=job.kind;body=job.payload;user_id=job.user_id
    try:
        update_progress(id,0,100)
        if kind=='export':
            from ..routers.transfers import export_table,ExportIn
            with SessionLocal() as work:
                total=work.scalar(select(func.count()).select_from(DataRecord).where(DataRecord.table_id==body['table_id'],DataRecord.deleted_at.is_(None))) or 0
                work.info['job_progress']=lambda done:update_progress(id,done,total)
                work.info['table_actor_id']=user_id;work.info['table_actor']='后台导出'
                result=export_table(body['table_id'],ExportIn.model_validate(body['options']),work)
        elif kind=='import':
            from ..routers.transfers import confirm_import
            from ..models import DataTransferJob
            with SessionLocal() as work:
                source=work.scalar(select(DataTransferJob).where(DataTransferJob.id==body['source_id']).with_for_update())
                if not source:raise ApiError('NOT_FOUND','导入预览不存在',404)
                if source.status!='success' and iso_z(source.updated_at)!=body['source_updated_at']:raise ApiError('IMPORT_CHANGED','导入映射已改变，请检查后重新提交',409)
                total=len((source.payload or {}).get('rows',[]))
                work.info['job_progress']=lambda done:update_progress(id,done,max(1,total*2))
                def check_cancel():
                    with SessionLocal() as check:
                        if check.get(BackgroundJob,id).cancel_requested:raise Cancelled()
                work.info['job_cancel_check']=check_cancel
                work.info['table_actor_id']=user_id;work.info['table_actor']='后台导入'
                result=confirm_import(source.id,work)
        elif kind=='backup':
            from .backups import create_backup
            result=create_backup(lambda done,total:update_progress(id,done,total))
            # create_backup verifies before retention can remove an older archive.
        elif kind=='backup_verify':
            from .backups import verify_backup
            result=verify_backup(body['backup_id'])
        else:raise RuntimeError('Unknown job kind')
        with SessionLocal() as db:
            job=db.get(BackgroundJob,id);job.status='completed';job.progress=100;job.result=result;db.commit()
    except Cancelled:
        with SessionLocal() as db:
            job=db.get(BackgroundJob,id);job.status='cancelled';job.error='任务已取消';db.commit()
    except Exception as error:
        logger.exception('Background job %s failed',id)
        with SessionLocal() as db:
            job=db.get(BackgroundJob,id);job.status='failed';job.error=str(getattr(error,'message','执行失败，请查看服务日志或重试'))[:1000];db.commit()
    return True


def schedule_backup():
    if not settings.backup_enabled or settings.env=='test':return
    with SessionLocal() as db:
        last=db.scalar(select(BackgroundJob).where(BackgroundJob.kind=='backup').order_by(BackgroundJob.id.desc()).limit(1))
        if last and (last.status in {'queued','running'} or last.created_at>utcnow()-timedelta(hours=settings.backup_interval_hours)):return
        owner=db.scalar(select(User).where(User.username==settings.admin_username))
        if owner:enqueue(db,owner.id,'backup','定时完整备份',{})


async def worker_loop():
    with SessionLocal() as db:
        # A crash must be visible; do not replay external/file side effects automatically.
        for job in db.scalars(select(BackgroundJob).where(BackgroundJob.status=='running')):
            job.status='failed';job.error='服务重启导致任务中断，请核对后手动重试'
        db.commit()
    ticks=0
    while True:
        try:
            if ticks%60==0:await asyncio.to_thread(schedule_backup)
            worked=await asyncio.to_thread(run_next)
            ticks+=1
            await asyncio.sleep(.2 if worked else 1)
        except asyncio.CancelledError:raise
        except Exception:
            logger.exception('Job worker failed; retrying later');await asyncio.sleep(5)