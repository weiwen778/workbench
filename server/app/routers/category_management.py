"""Rename/remove memo and bookmark categories without deleting their content."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update, delete
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from ..db import get_db
from ..deps import get_current_user
from ..models import Memo, MemoCategory, Bookmark, BookmarkCategory, utcnow
from ..errors import ApiError

router = APIRouter(tags=["categories"], dependencies=[Depends(get_current_user)])

class RenameIn(BaseModel):
    original_name: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)


def models(resource):
    if resource == "memos": return Memo, MemoCategory
    if resource == "bookmarks": return Bookmark, BookmarkCategory
    raise ApiError("NOT_FOUND", "分类不存在", 404)


def exists(db, content, category, name):
    return db.scalar(select(category.id).where(category.name == name)) is not None or db.scalar(select(content.id).where(content.category == name)) is not None


@router.patch("/{resource}/categories/manage")
def rename(resource: str, data: RenameIn, db: Session = Depends(get_db)):
    content, category = models(resource)
    name = data.name.strip()
    if not name or name in {"未分类", "__all", "__none", "__uncategorized__"}:
        raise ApiError("INVALID_CATEGORY", "请输入有效的分类名称", 422)
    if not exists(db, content, category, data.original_name):
        raise ApiError("NOT_FOUND", "分类不存在", 404)
    if name != data.original_name and exists(db, content, category, name):
        raise ApiError("NAME_DUPLICATED", "已有同名分类，请换个名称", 409)
    values = {"category": name, "updated_at": utcnow()}
    if content is Memo:
        values["version"] = content.version + 1
    db.execute(update(content).where(content.category == data.original_name).values(**values))
    row = db.scalar(select(category).where(category.name == data.original_name))
    if row: row.name = name
    else: db.add(category(name=name))
    try: db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError("NAME_DUPLICATED", "已有同名分类，请刷新后重试", 409)
    return {"name": name}


@router.delete("/{resource}/categories/manage")
def remove(resource: str, name: str = Query(min_length=1, max_length=80), db: Session = Depends(get_db)):
    content, category = models(resource)
    if not exists(db, content, category, name):
        raise ApiError("NOT_FOUND", "分类不存在", 404)
    values = {"category": None if content is Memo else "", "updated_at": utcnow()}
    if content is Memo: values["version"] = content.version + 1
    db.execute(update(content).where(content.category == name).values(**values))
    db.execute(delete(category).where(category.name == name))
    db.commit()
    return {"ok": True}
