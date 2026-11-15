from __future__ import annotations

from typing import Annotated

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, defer

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import FileObject, FileRef, Note, NoteFolder, NoteRevision, NoteTag, NoteTagLink, utcnow
from ..services.trash import push
from ..utils import iso_z

router = APIRouter(tags=["notes"], dependencies=[Depends(get_current_user)])

MAX_TITLE = 200
MAX_CONTENT = 1024 * 1024
REVISION_INTERVAL = timedelta(minutes=5)
MAX_REVISIONS = 100
FILE_PATTERN = re.compile(r"/api/v1/files/(\d+)/(?:content|download)")


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class NoteIn(BaseModel):
    title: str = Field(default="", max_length=MAX_TITLE)
    content: str = Field(default="")
    folder_id: int | None = None
    tags: list[str] = []


class NoteSave(BaseModel):
    title: str | None = Field(default=None, max_length=MAX_TITLE)
    content: str | None = None
    folder_id: int | None = None
    tags: list[str] | None = None
    version: int | None = None
    mode: str = "auto"


def _tags_of(db: Session, note_id: int) -> list[NoteTag]:
    return list(
        db.scalars(
            select(NoteTag).join(NoteTagLink, NoteTagLink.tag_id == NoteTag.id)
            .where(NoteTagLink.note_id == note_id).order_by(NoteTagLink.id)
        ).all()
    )


def note_payload(note: Note, tags: list[NoteTag], *, summary: bool = False, excerpt_content: str = '') -> dict:
    content = excerpt_content if summary else (note.content or '')
    excerpt = re.sub(r"\s+", " ", content.replace("\n", " "))[:120]
    data = {
        "id": note.id,
        "title": note.title or "未命名笔记",
        "raw_title": note.title,

        "excerpt": excerpt,
        "folder_id": note.folder_id,
        "tags": [t.name for t in tags],
        "created_at": iso_z(note.created_at),
        "updated_at": iso_z(note.updated_at),
        "version": note.version,
    }
    if not summary:
        data['content'] = note.content
    return data


def note_detail(db: Session, note: Note) -> dict:
    data = note_payload(note, _tags_of(db, note.id))
    data["revision_count"] = len(
        db.scalars(select(NoteRevision.id).where(NoteRevision.note_id == note.id)).all()
    )
    return data


# ---------------------------------------------------------------- 文件夹 / 标签


@router.get("/note-folders")
def list_folders(db: Session = Depends(get_db)):
    folders = db.scalars(select(NoteFolder).order_by(NoteFolder.sort_order, NoteFolder.id)).all()
    counts = dict(db.execute(select(Note.folder_id, func.count(Note.id)).where(
        Note.deleted_at.is_(None)).group_by(Note.folder_id)).all())
    return {'folders': [{'id': folder.id, 'name': folder.name, 'note_count': counts.get(folder.id, 0)} for folder in folders],
            'uncategorized': counts.get(None, 0)}


@router.post("/note-folders", status_code=201)
def create_folder(payload: FolderIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if db.scalar(select(NoteFolder).where(NoteFolder.name == name)):
        raise ApiError("NAME_DUPLICATED", "文件夹名称已存在", 409, {"field": "name"})
    folder = NoteFolder(name=name)
    db.add(folder)
    db.commit()
    return {"id": folder.id, "name": folder.name}


@router.patch("/note-folders/{folder_id}")
def rename_folder(folder_id: int, payload: FolderIn, db: Session = Depends(get_db)):
    folder = db.get(NoteFolder, folder_id)
    if not folder:
        raise ApiError("NOT_FOUND", "文件夹不存在", 404)
    name = payload.name.strip()
    if db.scalar(select(NoteFolder).where(NoteFolder.name == name, NoteFolder.id != folder_id)):
        raise ApiError("NAME_DUPLICATED", "文件夹名称已存在", 409)
    folder.name = name
    db.commit()
    return {"id": folder.id, "name": folder.name}


@router.delete("/note-folders/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = db.get(NoteFolder, folder_id)
    if not folder:
        raise ApiError("NOT_FOUND", "文件夹不存在", 404)
    # 只调整活动笔记；回收站中的笔记保留原文件夹信息，恢复时再判断是否已删除
    db.query(Note).filter(Note.folder_id == folder_id, Note.deleted_at.is_(None)).update(
        {Note.folder_id: None}, synchronize_session=False
    )
    db.delete(folder)
    db.commit()
    return {"ok": True, "moved_to_uncategorized": True}


@router.get("/note-tags")
def list_tags(db: Session = Depends(get_db)):
    counts = (select(NoteTagLink.tag_id.label('tag_id'), func.count(NoteTagLink.note_id).label('total'))
              .join(Note, Note.id == NoteTagLink.note_id).where(Note.deleted_at.is_(None))
              .group_by(NoteTagLink.tag_id).subquery())
    rows = db.execute(select(NoteTag, func.coalesce(counts.c.total, 0)).outerjoin(
        counts, counts.c.tag_id == NoteTag.id).order_by(NoteTag.name)).all()
    return [{'id': tag.id, 'name': tag.name, 'note_count': count} for tag, count in rows]


@router.post("/note-tags", status_code=201)
def create_tag(payload: TagIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    tag = db.scalar(select(NoteTag).where(NoteTag.name == name))
    if tag:
        return {"id": tag.id, "name": tag.name}
    tag = NoteTag(name=name)
    db.add(tag)
    db.commit()
    return {"id": tag.id, "name": tag.name}


@router.delete("/note-tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(NoteTag, tag_id)
    if not tag:
        raise ApiError("NOT_FOUND", "标签不存在", 404)
    db.query(NoteTagLink).filter(NoteTagLink.tag_id == tag_id).delete(synchronize_session=False)
    db.delete(tag)
    db.commit()
    return {"ok": True}


def _clean_tags(names: list[str]) -> list[str]:
    return list(dict.fromkeys(name.strip()[:50] for name in names if name.strip()))


def _bind_tags(db: Session, note_id: int, names: list[str]) -> None:
    db.query(NoteTagLink).filter(NoteTagLink.note_id == note_id).delete(synchronize_session=False)
    for name in names:
        tag = db.scalar(select(NoteTag).where(NoteTag.name == name))
        if not tag:
            tag = NoteTag(name=name)
            db.add(tag)
            db.flush()
        db.add(NoteTagLink(note_id=note_id, tag_id=tag.id))


# ---------------------------------------------------------------- 笔记


@router.get("/notes")
def list_notes(
    folder_id: int | None = None,
    uncategorized: bool = False,
    tag_id: int | None = None,
    q: str | None = None,
    summary: bool = False,
    page: Annotated[int | None,Query(ge=1)] = None,
    page_size: Annotated[int,Query(ge=1,le=100)] = 50,
    db: Session = Depends(get_db),
):
    stmt = select(Note).where(Note.deleted_at.is_(None)).order_by(Note.updated_at.desc(),Note.id.desc())
    if uncategorized:
        stmt = stmt.where(Note.folder_id.is_(None))
    elif folder_id is not None:
        stmt = stmt.where(Note.folder_id == folder_id)
    if tag_id is not None:
        stmt = stmt.join(NoteTagLink, NoteTagLink.note_id == Note.id).where(NoteTagLink.tag_id == tag_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Note.title.like(like) | Note.content.like(like))
    total=db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) if page is not None else None
    if page is not None:
        page=min(page,max(1,(total+page_size-1)//page_size))
        stmt=stmt.offset((page-1)*page_size).limit(page_size)
    if summary:
        rows = db.execute(stmt.options(defer(Note.content)).add_columns(func.substr(Note.content, 1, 2048))).all()
        notes = [note for note, _ in rows]
        excerpts = {note.id: excerpt or '' for note, excerpt in rows}
    else:
        notes = db.scalars(stmt).all()
        excerpts = {}
    tags = {}
    if notes:
        for note_id, tag in db.execute(select(NoteTagLink.note_id, NoteTag).join(
                NoteTag, NoteTag.id == NoteTagLink.tag_id).where(NoteTagLink.note_id.in_([n.id for n in notes])).order_by(NoteTagLink.id)):
            tags.setdefault(note_id, []).append(tag)
    items=[note_payload(n, tags.get(n.id, []), summary=summary, excerpt_content=excerpts.get(n.id, '')) for n in notes]
    return {'items':items,'total':total,'page':page,'page_size':page_size} if page is not None else items


@router.post("/notes", status_code=201)
def create_note(payload: NoteIn, db: Session = Depends(get_db)):
    if len(payload.content.encode("utf-8")) > MAX_CONTENT:
        raise ApiError("NOTE_TOO_LARGE", "笔记正文不能超过 1 MiB", 413)
    if payload.folder_id is not None and not db.get(NoteFolder, payload.folder_id):
        raise ApiError("FOLDER_NOT_FOUND", "文件夹不存在", 422)
    note = Note(title=payload.title.strip(), content=payload.content, folder_id=payload.folder_id)
    db.add(note)
    db.flush()
    _bind_tags(db, note.id, _clean_tags(payload.tags))
    db.add(NoteRevision(note_id=note.id, title=note.title, content=note.content, reason="auto"))
    _sync_note_files(db, note, payload.content)
    db.commit()
    return note_detail(db, note)


@router.get("/notes/{note_id}")
def get_note(note_id: int, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if not note or note.deleted_at is not None:
        raise ApiError("NOT_FOUND", "笔记不存在", 404)
    return note_detail(db, note)


@router.put("/notes/{note_id}")
def save_note(note_id: int, payload: NoteSave, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if not note or note.deleted_at is not None:
        raise ApiError("NOT_FOUND", "笔记不存在", 404)
    if payload.version is not None and payload.version != note.version:
        raise ApiError(
            "VERSION_CONFLICT",
            "这篇笔记已在其他设备修改，已保留你的输入，请确认后再保存",
            409,
            {"current_version": note.version, "server_content": note.content, "server_title": note.title},
        )

    new_title = payload.title if payload.title is not None else note.title
    new_content = payload.content if payload.content is not None else note.content
    if len(new_content.encode("utf-8")) > MAX_CONTENT:
        raise ApiError("NOTE_TOO_LARGE", "笔记正文不能超过 1 MiB", 413)
    folder_changed = 'folder_id' in payload.model_fields_set and payload.folder_id != note.folder_id
    if folder_changed:
        if payload.folder_id is not None and not db.get(NoteFolder, payload.folder_id):
            raise ApiError("FOLDER_NOT_FOUND", "文件夹不存在", 422)
        note.folder_id = payload.folder_id
    tags_changed = False
    if payload.tags is not None:
        tags = _clean_tags(payload.tags)
        tags_changed = tags != [tag.name for tag in _tags_of(db, note.id)]
        if tags_changed:
            _bind_tags(db, note.id, tags)

    content_changed = new_title != note.title or new_content != note.content
    if content_changed:
        last = db.scalar(
            select(NoteRevision)
            .where(NoteRevision.note_id == note.id)
            .order_by(NoteRevision.created_at.desc(), NoteRevision.id.desc())
        )
        should_snapshot = payload.mode == "manual" or last is None or (utcnow() - last.created_at) >= REVISION_INTERVAL
        if should_snapshot:
            db.add(
                NoteRevision(
                    note_id=note.id,
                    title=note.title,
                    content=note.content,
                    reason="manual" if payload.mode == "manual" else "interval",
                )
            )
            _trim_revisions(db, note.id)
        note.title = new_title
        note.content = new_content
        _sync_note_files(db, note, new_content)
    if content_changed or folder_changed or tags_changed:
        note.version += 1
        note.updated_at = utcnow()
    db.commit()
    return note_detail(db, note)


@router.get("/notes/{note_id}/revisions")
def revisions(note_id: int, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if not note:
        raise ApiError("NOT_FOUND", "笔记不存在", 404)
    rows = db.scalars(
        select(NoteRevision)
        .where(NoteRevision.note_id == note_id)
        .order_by(NoteRevision.created_at.desc(), NoteRevision.id.desc())
    ).all()
    return [
        {
            "id": r.id,
            "title": r.title or "未命名笔记",
            "excerpt": re.sub(r"\s+", " ", r.content)[:120],
            "reason": r.reason,
            "created_at": iso_z(r.created_at),
        }
        for r in rows
    ]


@router.get("/notes/{note_id}/revisions/{revision_id}")
def revision_detail(note_id: int, revision_id: int, db: Session = Depends(get_db)):
    rev = db.get(NoteRevision, revision_id)
    if not rev or rev.note_id != note_id:
        raise ApiError("NOT_FOUND", "历史版本不存在", 404)
    return {
        "id": rev.id,
        "title": rev.title,
        "content": rev.content,
        "created_at": iso_z(rev.created_at),
        "reason": rev.reason,
    }


@router.post("/notes/{note_id}/revisions/{revision_id}/restore")
def restore_revision(note_id: int, revision_id: int, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    rev = db.get(NoteRevision, revision_id)
    if not note or note.deleted_at is not None:
        raise ApiError("NOT_FOUND", "笔记不存在", 404)
    if not rev or rev.note_id != note_id:
        raise ApiError("NOT_FOUND", "历史版本不存在", 404)
    # 恢复前先保留当前内容
    db.add(
        NoteRevision(note_id=note.id, title=note.title, content=note.content, reason="restore")
    )
    note.title = rev.title
    note.content = rev.content
    note.version += 1
    note.updated_at = utcnow()
    _sync_note_files(db, note, note.content)
    _trim_revisions(db, note.id)
    db.commit()
    return note_detail(db, note)


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)
    if not note or note.deleted_at is not None:
        raise ApiError("NOT_FOUND", "笔记不存在", 404)
    note.deleted_at = utcnow()
    push(
        db,
        "note",
        note.id,
        note.title or (note.content[:40] or "未命名笔记"),
        {
            "title": note.title,
            "content": note.content,
            "folder_id": note.folder_id,
            "tags": [t.name for t in _tags_of(db, note.id)],
        },
    )
    db.commit()
    return {"ok": True}


def _trim_revisions(db: Session, note_id: int) -> None:
    db.flush()
    rows = db.scalars(
        select(NoteRevision)
        .where(NoteRevision.note_id == note_id)
        .order_by(NoteRevision.created_at.desc(), NoteRevision.id.desc())
    ).all()
    for extra in rows[MAX_REVISIONS:]:
        db.delete(extra)


def _sync_note_files(db: Session, note: Note, content: str) -> None:
    """正文引用的图片建立引用关系。

    引用只增不减：历史版本可能仍引用旧图片，清理统一在彻底删除笔记时处理。
    """
    ids = {int(m) for m in FILE_PATTERN.findall(content or "")}
    existing = {
        ref.file_id
        for ref in db.scalars(
            select(FileRef).where(FileRef.owner_type == "note", FileRef.owner_id == note.id)
        ).all()
    }
    for file_id in ids - existing:
        file_obj = db.get(FileObject, file_id)
        if file_obj:
            db.add(FileRef(file_id=file_id, owner_type="note", owner_id=note.id))
            file_obj.status = "bound"
            file_obj.expires_at = None
