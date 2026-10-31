from urllib.parse import urlsplit
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import Bookmark, BookmarkCategory, utcnow
from ..utils import iso_z

router = APIRouter(tags=["bookmarks"], dependencies=[Depends(get_current_user)])

class BookmarkInput(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: str = Field(default="", max_length=200)
    category: str = Field(default="", max_length=80)
    icon_url: str = Field(default="", max_length=2048)
    description: str = Field(default="", max_length=500)

def validate_url(url: str) -> str:
    url = url.strip()
    try:
        parts = urlsplit(url)
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError()
        _ = parts.port
        if any(ord(c) < 32 for c in url):
            raise ValueError()
    except ValueError:
        raise ApiError("INVALID_URL", "请输入有效的 HTTP 或 HTTPS 网址，不支持包含账号密码", 422)
    return url

def payload(row):
    return {"id": row.id, "url": row.url, "title": row.title, "category": row.category,
            "icon_url": row.icon_url, "description": row.description, "created_at": iso_z(row.created_at), "updated_at": iso_z(row.updated_at)}

def assign(row, data):
    row.url = validate_url(data.url)
    row.icon_url = validate_url(data.icon_url) if data.icon_url else ""
    row.title = data.title.strip() or urlsplit(row.url).hostname or row.url
    row.category = data.category.strip()
    row.description = data.description.strip()
    row.updated_at = utcnow()

@router.get("/bookmarks")
def listing(db: Session = Depends(get_db)):
    return [payload(row) for row in db.scalars(select(Bookmark).order_by(Bookmark.id.desc())).all()]

@router.post("/bookmarks", status_code=201)
def create(data: BookmarkInput, db: Session = Depends(get_db)):
    row = Bookmark(); assign(row, data); ensure_category(db,row.category); db.add(row); db.commit(); return payload(row)

@router.put("/bookmarks/{item_id}")
def update(item_id: int, data: BookmarkInput, db: Session = Depends(get_db)):
    row = db.get(Bookmark, item_id)
    if row is None: raise ApiError("NOT_FOUND", "网址不存在", 404)
    ensure_category(db,row.category)
    assign(row, data); ensure_category(db,row.category); db.commit(); return payload(row)

@router.delete("/bookmarks/{item_id}")
def delete(item_id: int, db: Session = Depends(get_db)):
    row = db.get(Bookmark, item_id)
    if row is None: raise ApiError("NOT_FOUND", "网址不存在", 404)
    ensure_category(db,row.category)
    db.delete(row); db.commit(); return {"ok": True}


class MetadataInput(BaseModel):
    url: str = Field(min_length=1, max_length=2048)

@router.post('/bookmarks/metadata')
def read_metadata(data: MetadataInput):
    from ..services.bookmark_metadata import metadata
    return metadata(validate_url(data.url))


def ensure_category(db, name):
    if name and db.scalar(select(BookmarkCategory).where(BookmarkCategory.name==name)) is None:
        db.add(BookmarkCategory(name=name))
        db.flush()

class CategoryInput(BaseModel):
    name: str = Field(min_length=1,max_length=80)

@router.get('/bookmarks/categories')
def categories(db: Session = Depends(get_db)):
    names=set(db.scalars(select(BookmarkCategory.name)).all())
    names.update(db.scalars(select(Bookmark.category).where(Bookmark.category!='')).all())
    return sorted(names)

@router.post('/bookmarks/categories')
def create_category(data: CategoryInput, db: Session = Depends(get_db)):
    name=data.name.strip()
    if not name or name in {'__all','__none'}:
        raise ApiError('INVALID_CATEGORY','请输入有效的分类名称',422)
    ensure_category(db,name);db.commit()
    return {'name':name}
