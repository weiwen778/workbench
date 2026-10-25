from __future__ import annotations

import mimetypes
import re
import uuid
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import FileObject, FileRef, utcnow
from ..utils import iso_z

router = APIRouter(tags=["files"], dependencies=[Depends(get_current_user)])

ALLOWED_EXT = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".pdf", ".txt", ".md", ".csv", ".docx", ".xlsx", ".pptx", ".zip",
}
INLINE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"}


def _safe_name(name: str) -> str:
    name = Path(name or "file").name
    return re.sub(r"[^\w\u4e00-\u9fa5.\- ()（）]+", "_", name)[:200].strip() or "file"


def file_payload(f: FileObject) -> dict:
    return {
        "id": f.id,
        "name": f.original_name,
        "content_type": f.content_type,
        "size": f.size,
        "status": f.status,
        "created_at": iso_z(f.created_at),
        "url": f"/api/v1/files/{f.id}/content",
        "download_url": f"/api/v1/files/{f.id}/download",
        "is_image": f.content_type.startswith("image/"),
        "is_pdf": f.content_type == "application/pdf",
    }


@router.post("/files", status_code=201)
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw = await file.read()
    if len(raw) > settings.max_upload_bytes:
        raise ApiError(
            "FILE_TOO_LARGE",
            f"单个文件不能超过 {settings.max_upload_bytes // 1_000_000} MB",
            413,
            {"size": len(raw), "limit": settings.max_upload_bytes},
        )
    if not raw:
        raise ApiError("EMPTY_FILE", "上传的文件是空的", 422)

    original = _safe_name(file.filename or "file")
    suffix = Path(original).suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise ApiError("FILE_TYPE_NOT_ALLOWED", f"不支持 {suffix or '该'} 类型的文件", 415)

    content_type = file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream"
    storage_key = f"{uuid.uuid4().hex}{suffix}"
    target_dir = settings.storage_dir / "files"
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / storage_key).write_bytes(raw)

    obj = FileObject(
        storage_key=storage_key,
        original_name=original,
        content_type=content_type,
        size=len(raw),
        status="staged",
        expires_at=utcnow() + timedelta(hours=settings.staged_ttl_hours),
    )
    db.add(obj)
    db.commit()
    return file_payload(obj)


@router.get("/files/{file_id}")
def metadata(file_id: int, db: Session = Depends(get_db)):
    obj = db.get(FileObject, file_id)
    if not obj:
        raise ApiError("NOT_FOUND", "文件不存在", 404)
    return file_payload(obj)


def _resolve(file_id: int, db: Session) -> tuple[FileObject, Path]:
    obj = db.get(FileObject, file_id)
    if not obj:
        raise ApiError("NOT_FOUND", "文件不存在", 404)
    path = settings.storage_dir / "files" / obj.storage_key
    if not path.exists():
        raise ApiError("FILE_MISSING", "文件已不在存储中", 410)
    return obj, path


@router.get("/files/{file_id}/content")
def content(file_id: int, db: Session = Depends(get_db)):
    obj, path = _resolve(file_id, db)
    inline = obj.content_type in INLINE_TYPES or obj.content_type.startswith("image/")
    return FileResponse(
        path,
        media_type=obj.content_type,
        filename=obj.original_name,
        content_disposition_type="inline" if inline else "attachment",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/files/{file_id}/download")
def download(file_id: int, db: Session = Depends(get_db)):
    obj, path = _resolve(file_id, db)
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=obj.original_name,
        content_disposition_type="attachment",
    )


@router.delete("/files/{file_id}")
def delete_staged(file_id: int, db: Session = Depends(get_db)):
    obj = db.get(FileObject, file_id)
    if not obj:
        raise ApiError("NOT_FOUND", "文件不存在", 404)
    refs = db.scalar(select(FileRef).where(FileRef.file_id == file_id).limit(1))
    if refs or obj.status == "bound":
        raise ApiError("FILE_IN_USE", "文件已被使用，不能直接删除", 409)
    path = settings.storage_dir / "files" / obj.storage_key
    path.unlink(missing_ok=True)
    db.delete(obj)
    db.commit()
    return {"ok": True}
