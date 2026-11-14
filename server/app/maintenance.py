"""Production retention cleanup; each pass uses its own database session."""
import asyncio
import logging
from datetime import timedelta
from sqlalchemy import delete, select
from .config import settings
from .db import SessionLocal
from .models import DataTransferJob, FileObject, FileRef, LoginAttempt, Whiteboard, WhiteboardAsset, utcnow

logger = logging.getLogger(__name__)

def run_cleanup():
    from .routers.trash import purge_expired
    with SessionLocal() as db:
        result = purge_expired(db=db)
        now = utcnow()
        jobs = db.scalars(select(DataTransferJob).where(DataTransferJob.expires_at <= now)).all()
        candidates = {job.file_id for job in jobs if job.file_id}
        exported_files = {job.file_id for job in jobs if job.kind == "export" and job.file_id}
        for job in jobs:
            db.delete(job)
        login_attempts = db.execute(
            delete(LoginAttempt).where(
                LoginAttempt.created_at < now - timedelta(days=settings.login_attempt_retention_days)
            )
        ).rowcount
        candidates.update(db.scalars(select(FileObject.id).where(FileObject.status == "staged", FileObject.expires_at <= now)).all())
        referenced_assets: set[str] = set()
        for board in db.scalars(select(Whiteboard)).all():
            for element in (board.scene or {}).get("elements", []):
                if isinstance(element, dict) and element.get("type") == "image" and element.get("fileId") and not element.get("isDeleted"):
                    referenced_assets.add(str(element["fileId"]))
        orphan_assets = db.scalars(
            select(WhiteboardAsset).where(
                WhiteboardAsset.created_at < now - timedelta(hours=settings.whiteboard_asset_grace_hours)
            )
        ).all()
        whiteboard_assets = 0
        storage = settings.storage_dir.resolve()
        for asset in orphan_assets:
            if asset.id in referenced_assets:
                continue
            path = (storage / asset.storage_key).resolve()
            if path.is_relative_to(storage):
                path.unlink(missing_ok=True)
            db.delete(asset)
            whiteboard_assets += 1
        removed = 0
        for file_id in candidates:
            if db.scalar(select(FileRef.id).where(FileRef.file_id == file_id).limit(1)):
                continue
            obj = db.get(FileObject, file_id)
            if obj:
                directory = (settings.storage_dir / ("exports" if file_id in exported_files else "files")).resolve()
                path = (directory / obj.storage_key).resolve()
                if not path.is_relative_to(directory):
                    continue
                path.unlink(missing_ok=True)
                db.delete(obj)
                removed += 1
        db.commit()
        return {"purged": result["purged"], "files": removed, "jobs": len(jobs), "login_attempts": login_attempts, "whiteboard_assets": whiteboard_assets}

async def maintenance_loop():
    while True:
        try:
            await asyncio.to_thread(run_cleanup)
        except Exception:
            logger.error("Retention cleanup failed; will retry on the next interval")
        await asyncio.sleep(max(60, settings.maintenance_interval_seconds))
