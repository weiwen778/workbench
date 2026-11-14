from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import User, Whiteboard, WhiteboardAsset, utcnow
from ..utils import iso_z

router = APIRouter(tags=["whiteboards"], dependencies=[Depends(get_current_user)])

MAX_SCENE_BYTES = 20_000_000
FILE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class BoardCreate(BaseModel):
    title: str = Field(default="未命名白板", min_length=1, max_length=120)


class BoardRename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class BoardSave(BaseModel):
    elements: list = Field(default_factory=list)
    app_state: dict = Field(default_factory=dict)
    version: int = Field(ge=1)


def _title(value: str) -> str:
    title = value.strip()
    if not title:
        raise ApiError("TITLE_REQUIRED", "请填写白板名称", 422)
    return title[:120]


def _board_payload(board: Whiteboard, detail: bool = False) -> dict:
    scene = board.scene or {}
    data = {
        "id": board.id,
        "title": board.title,
        "version": board.version,
        "element_count": sum(
            1 for element in scene.get("elements", [])
            if isinstance(element, dict) and not element.get("isDeleted")
        ),
        "created_at": iso_z(board.created_at),
        "updated_at": iso_z(board.updated_at),
    }
    if detail:
        data["scene"] = scene or {"elements": [], "appState": {}}
    return data


def _get_board(db: Session, user: User, board_id: int, lock: bool = False) -> Whiteboard:
    stmt = select(Whiteboard).where(Whiteboard.id == board_id, Whiteboard.user_id == user.id)
    board = db.scalar(stmt.with_for_update() if lock else stmt)
    if not board:
        raise ApiError("NOT_FOUND", "白板不存在", 404)
    return board


def _scene_asset_ids(elements: list) -> set[str]:
    ids: set[str] = set()
    for element in elements:
        if not isinstance(element, dict) or element.get("isDeleted"):
            continue
        if element.get("type") == "image" and element.get("fileId"):
            ids.add(str(element["fileId"]))
    return ids


def _validate_scene(db: Session, user: User, elements: list, app_state: dict) -> None:
    if not isinstance(elements, list) or not isinstance(app_state, dict):
        raise ApiError("SCENE_INVALID", "场景数据格式不正确", 422)
    try:
        size = len(json.dumps({"elements": elements, "appState": app_state}, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        raise ApiError("SCENE_INVALID", "场景数据无法序列化", 422)
    if size > MAX_SCENE_BYTES:
        raise ApiError("SCENE_TOO_LARGE", f"白板内容不能超过 {MAX_SCENE_BYTES // 1_000_000} MB", 413)
    ids = _scene_asset_ids(elements)
    if not ids:
        return
    owned = set(db.scalars(select(WhiteboardAsset.id).where(
        WhiteboardAsset.user_id == user.id, WhiteboardAsset.id.in_(ids)).with_for_update()).all())
    missing = ids - owned
    if missing:
        raise ApiError("ASSET_MISSING", "白板引用的图片尚未保存，请重试", 422, {"missing": sorted(missing)[:10]})


def _refresh_asset_lifecycle(db: Session, user: User) -> None:
    """Mark assets orphaned when their last board reference disappears."""
    referenced: set[str] = set()
    for board in db.scalars(select(Whiteboard).where(Whiteboard.user_id == user.id)).all():
        for element in (board.scene or {}).get("elements", []):
            if isinstance(element, dict) and element.get("type") == "image" and element.get("fileId") and not element.get("isDeleted"):
                referenced.add(str(element["fileId"]))
    now = utcnow()
    for asset in db.scalars(select(WhiteboardAsset).where(WhiteboardAsset.user_id == user.id).with_for_update()).all():
        if asset.id in referenced:
            asset.orphaned_at = None
        elif asset.orphaned_at is None:
            asset.orphaned_at = now


@router.get("/whiteboards")
def list_boards(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    boards = db.scalars(select(Whiteboard).where(Whiteboard.user_id == user.id).order_by(
        Whiteboard.updated_at.desc(), Whiteboard.id.desc())).all()
    return [_board_payload(board) for board in boards]


@router.post("/whiteboards", status_code=201)
def create_board(data: BoardCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    board = Whiteboard(user_id=user.id, title=_title(data.title), scene={"elements": [], "appState": {}}, version=1)
    db.add(board)
    db.commit()
    db.refresh(board)
    return _board_payload(board, detail=True)


@router.post("/whiteboards/assets", status_code=201)
def upload_asset(
    file_id: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not FILE_ID.fullmatch(file_id):
        raise ApiError("ASSET_ID_INVALID", "图片资源标识不合法", 422)
    existing = db.get(WhiteboardAsset, (user.id, file_id))
    if existing:
        return {"id": existing.id, "size": existing.size, "content_type": existing.content_type}
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise ApiError("ASSET_TYPE_INVALID", "白板图片只支持图片格式", 415)
    raw = file.file.read(settings.max_upload_bytes + 1)
    if not raw:
        raise ApiError("EMPTY_FILE", "上传的图片是空的", 422)
    if len(raw) > settings.max_upload_bytes:
        raise ApiError("FILE_TOO_LARGE", f"单张图片不能超过 {settings.max_upload_bytes // 1_000_000} MB", 413)
    ext = Path(file.filename or "image.png").suffix.lower() or ".png"
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"}:
        ext = ".png"
    storage_key = f"whiteboards/{user.id}/{uuid.uuid4().hex}{ext}"
    target = settings.storage_dir / storage_key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    asset = WhiteboardAsset(
        id=file_id, user_id=user.id, storage_key=storage_key,
        content_type=content_type, size=len(raw), created_at=utcnow(), orphaned_at=utcnow(),
    )
    db.add(asset)
    try:
        db.commit()
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        existing = db.get(WhiteboardAsset, (user.id, file_id))
        if existing:
            return {"id": existing.id, "size": existing.size, "content_type": existing.content_type}
        raise
    return {"id": asset.id, "size": asset.size, "content_type": asset.content_type}


@router.get("/whiteboards/assets/{file_id}/content")
def asset_content(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    asset = db.get(WhiteboardAsset, (user.id, file_id))
    if not asset:
        raise ApiError("NOT_FOUND", "图片资源不存在", 404)
    path = settings.storage_dir / asset.storage_key
    if not path.exists():
        raise ApiError("NOT_FOUND", "图片资源文件不存在", 404)
    return FileResponse(path, media_type=asset.content_type, headers={
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        # User-provided SVGs must not run scripts if opened directly.
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    })


@router.get("/whiteboards/{board_id}")
def read_board(board_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _board_payload(_get_board(db, user, board_id), detail=True)


@router.put("/whiteboards/{board_id}")
def save_board(board_id: int, data: BoardSave, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    board = _get_board(db, user, board_id, lock=True)
    if data.version != board.version:
        raise ApiError("VERSION_CONFLICT", "白板已在其他标签页或设备上更新，请先处理冲突", 409,
                       {"current_version": board.version})
    _validate_scene(db, user, data.elements, data.app_state)
    board.scene = {"elements": data.elements, "appState": data.app_state}
    board.version += 1
    board.updated_at = utcnow()
    db.flush()
    _refresh_asset_lifecycle(db, user)
    db.commit()
    db.refresh(board)
    return _board_payload(board, detail=True)


@router.patch("/whiteboards/{board_id}")
def rename_board(board_id: int, data: BoardRename, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    board = _get_board(db, user, board_id)
    board.title = _title(data.title)
    board.updated_at = utcnow()
    db.commit()
    db.refresh(board)
    return _board_payload(board)


@router.post("/whiteboards/{board_id}/duplicate", status_code=201)
def duplicate_board(board_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    source = _get_board(db, user, board_id)
    copy = Whiteboard(
        user_id=user.id, title=f"{source.title} 副本"[:120], scene=source.scene, version=1,
    )
    db.add(copy)
    db.flush()
    _refresh_asset_lifecycle(db, user)
    db.commit()
    db.refresh(copy)
    return _board_payload(copy, detail=True)


@router.delete("/whiteboards/{board_id}")
def delete_board(board_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    board = _get_board(db, user, board_id)
    db.delete(board)
    db.flush()
    _refresh_asset_lifecycle(db, user)
    db.commit()
    return {"ok": True}
