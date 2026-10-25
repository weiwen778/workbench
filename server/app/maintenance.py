"""Production retention cleanup; each pass uses its own database session."""
import asyncio
import logging
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .models import DataTransferJob, FileObject, FileRef, utcnow

logger = logging.getLogger(__name__)

def run_cleanup():
    from .routers.trash import purge_expired
    with SessionLocal() as db:
        result = purge_expired(db=db)
        now = utcnow()
        jobs = db.scalars(select(DataTransferJob).where(DataTransferJob.expires_at <= now)).all()
        candidates = {job.file_id for job in jobs if job.file_id}
        for job in jobs:
            db.delete(job)
        candidates.update(db.scalars(select(FileObject.id).where(FileObject.status == "staged", FileObject.expires_at <= now)).all())
        removed = 0
        for file_id in candidates:
            if db.scalar(select(FileRef.id).where(FileRef.file_id == file_id).limit(1)):
                continue
            obj = db.get(FileObject, file_id)
            if obj:
                path = (settings.storage_dir / "files" / obj.storage_key).resolve()
                if not path.is_relative_to((settings.storage_dir / "files").resolve()):
                    continue
                path.unlink(missing_ok=True)
                db.delete(obj)
                removed += 1
        db.commit()
        return {"purged": result["purged"], "files": removed, "jobs": len(jobs)}

async def maintenance_loop():
    while True:
        try:
            await asyncio.to_thread(run_cleanup)
        except Exception:
            logger.error("Retention cleanup failed; will retry on the next interval")
        await asyncio.sleep(max(60, settings.maintenance_interval_seconds))
