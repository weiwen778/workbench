from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import Memo, utcnow
from ..services.trash import push
from ..utils import iso_z

router = APIRouter(tags=["memos"], dependencies=[Depends(get_current_user)])

COLORS = {"default", "yellow", "green", "blue", "pink", "purple"}


class MemoIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=2000)
    category: str | None = Field(default=None, max_length=80)
    color: str = "default"


class MemoPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=80)
    color: str | None = None
    version: int | None = None


def payload(m: Memo) -> dict:
    return {
        "id": m.id,
        "title": m.title or "",
        "display_title": m.title or "无标题便利贴",
        "content": m.content,
        "category": m.category or "",
        "display_category": m.category or "未分类",
        "color": m.color,
        "created_at": iso_z(m.created_at),
        "updated_at": iso_z(m.updated_at),
        "version": m.version,
    }


def _clean_category(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


@router.get("/memos")
def list_memos(
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = select(Memo).where(Memo.deleted_at.is_(None)).order_by(Memo.updated_at.desc())
    if category == "__uncategorized__":
        stmt = stmt.where((Memo.category.is_(None)) | (Memo.category == ""))
    elif category:
        stmt = stmt.where(Memo.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where((Memo.title.like(like)) | (Memo.content.like(like)))
    return [payload(m) for m in db.scalars(stmt).all()]


@router.get("/memos/categories")
def categories(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Memo.category)
        .where(Memo.deleted_at.is_(None), Memo.category.is_not(None), Memo.category != "")
        .distinct()
    ).all()
    return sorted({r for r in rows if r})


@router.post("/memos", status_code=201)
def create_memo(payload_in: MemoIn, db: Session = Depends(get_db)):
    content = payload_in.content.strip("\n")
    if not content.strip():
        raise ApiError("MEMO_CONTENT_REQUIRED", "便利贴正文不能为空", 422, {"fields": {"content": "正文不能为空"}})
    if payload_in.color not in COLORS:
        raise ApiError("INVALID_COLOR", "便利贴颜色不合法", 422)
    if len(content) > 2000:
        raise ApiError("MEMO_TOO_LONG", "正文最多 2000 个字符", 422)
    memo = Memo(
        title=(payload_in.title or "").strip(),
        content=content,
        category=_clean_category(payload_in.category),
        color=payload_in.color,
    )
    db.add(memo)
    db.commit()
    return payload(memo)


@router.patch("/memos/{memo_id}")
def update_memo(memo_id: int, payload_in: MemoPatch, db: Session = Depends(get_db)):
    memo = db.get(Memo, memo_id)
    if not memo or memo.deleted_at is not None:
        raise ApiError("NOT_FOUND", "便利贴不存在", 404)
    if payload_in.version is not None and payload_in.version != memo.version:
        raise ApiError("VERSION_CONFLICT", "这张便利贴已在其他位置修改，请刷新后重试", 409,
                       {"current_version": memo.version})
    if payload_in.content is not None:
        content = payload_in.content.strip("\n")
        if not content.strip():
            raise ApiError("MEMO_CONTENT_REQUIRED", "便利贴正文不能为空", 422)
        if len(content) > 2000:
            raise ApiError("MEMO_TOO_LONG", "正文最多 2000 个字符", 422)
        memo.content = content
    if payload_in.title is not None:
        memo.title = payload_in.title.strip()
    if payload_in.category is not None:
        memo.category = _clean_category(payload_in.category)
    if payload_in.color is not None:
        if payload_in.color not in COLORS:
            raise ApiError("INVALID_COLOR", "便利贴颜色不合法", 422)
        memo.color = payload_in.color
    memo.version += 1
    memo.updated_at = utcnow()
    db.commit()
    return payload(memo)


@router.delete("/memos/{memo_id}")
def delete_memo(memo_id: int, db: Session = Depends(get_db)):
    memo = db.get(Memo, memo_id)
    if not memo or memo.deleted_at is not None:
        raise ApiError("NOT_FOUND", "便利贴不存在", 404)
    memo.deleted_at = utcnow()
    push(
        db,
        "memo",
        memo.id,
        memo.title or memo.content[:40],
        {
            "title": memo.title,
            "content": memo.content,
            "category": memo.category,
            "color": memo.color,
        },
    )
    db.commit()
    return {"ok": True}
