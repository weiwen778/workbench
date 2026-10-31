from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import (
    DataField,
    DataRecord,
    DataTable,
    FileObject,
    FileRef,
    Memo,
    Note,
    NoteFolder,
    NoteTag,
    NoteTagLink,
    TrashEntry,
    utcnow,
)
from ..services.fields import validate_record
from ..services.trash import active_entries, remaining_days
from ..utils import iso_z

router = APIRouter(tags=["trash"], dependencies=[Depends(get_current_user)])

KIND_LABEL = {"table": "表格", "record": "表格行", "note": "笔记", "memo": "便利贴"}


@router.get("/trash")
def list_trash(kind: str | None = Query(default=None), db: Session = Depends(get_db)):
    entries = active_entries(db)
    if kind:
        entries = [e for e in entries if e.kind == kind]
    items = []
    for e in entries:
        if e.kind == "table":
            name = e.name
        elif e.kind == "record":
            table = db.get(DataTable, e.parent_id) if e.parent_id else None
            name = e.name if table else e.name
        elif e.kind == "note":
            name = e.name or "未命名笔记"
        else:
            name = e.name
        items.append(
            {
                "id": e.id,
                "kind": e.kind,
                "kind_label": KIND_LABEL.get(e.kind, e.kind),
                "entity_id": e.entity_id,
                "name": name,
                "deleted_at": iso_z(e.deleted_at),
                "expires_at": iso_z(e.expires_at),
                "remaining_days": remaining_days(e),
            }
        )
    counts = {k: sum(1 for e in entries if e.kind == k) for k in KIND_LABEL}
    return {"items": items, "total": len(items), "counts": counts}


def _entry(db: Session, kind: str, entity_id: int) -> TrashEntry:
    entry = db.scalar(
        select(TrashEntry).where(
            TrashEntry.kind == kind,
            TrashEntry.entity_id == entity_id,
            TrashEntry.restored_at.is_(None),
            TrashEntry.purged_at.is_(None),
        )
    )
    if not entry:
        raise ApiError("NOT_FOUND", "回收站中没有这条记录", 404)
    if entry.expires_at <= utcnow():
        raise ApiError("TRASH_EXPIRED", "已超过 30 天保留期，无法恢复", 410)
    return entry


@router.post("/trash/{kind}/{entity_id}/restore")
def restore(kind: str, entity_id: int, db: Session = Depends(get_db)):
    if kind not in KIND_LABEL:
        raise ApiError("INVALID_KIND", "回收站类型不合法", 422)
    entry = _entry(db, kind, entity_id)
    detail: dict = {}

    if kind == "table":
        table = db.get(DataTable, entity_id)
        if not table:
            raise ApiError("NOT_FOUND", "表格已经不存在", 404)
        conflict = db.scalar(
            select(DataTable).where(
                DataTable.name == table.name, DataTable.deleted_at.is_(None), DataTable.id != table.id
            )
        )
        if conflict:
            raise ApiError("NAME_CONFLICT", "已经有同名表格，请先改名再恢复", 409, {"name": table.name})
        table.deleted_at = None

    elif kind == "record":
        record = db.get(DataRecord, entity_id)
        if not record:
            raise ApiError("NOT_FOUND", "数据已不存在", 404)
        table = db.get(DataTable, record.table_id)
        if not table or table.deleted_at is not None:
            raise ApiError("PARENT_TABLE_DELETED", "所属表格还没恢复，请先恢复表格", 409)
        fields = list(
            db.scalars(
                select(DataField).where(DataField.table_id == table.id).order_by(DataField.sort_order)
            ).all()
        )
        data = {k: v for k, v in (record.data or {}).items() if any(f.key == k for f in fields)}
        try:
            record.data = validate_record(db, fields, data, table_id=table.id)
        except ApiError as exc:
            raise ApiError(
                "RESTORE_VALIDATION_FAILED",
                "当前表结构已变化，需要补齐必填内容后才能恢复",
                409,
                exc.details,
            )
        record.deleted_at = None
        record.version += 1
        detail["message"] = "已按当前表结构恢复"

    elif kind == "note":
        note = db.get(Note, entity_id)
        if not note:
            raise ApiError("NOT_FOUND", "笔记已不存在", 404)
        snapshot_folder = (entry.snapshot or {}).get("folder_id")
        target_folder = note.folder_id or snapshot_folder
        if target_folder and not db.get(NoteFolder, target_folder):
            note.folder_id = None
            detail["message"] = "原文件夹已删除，已恢复到未分类"
        elif note.folder_id is None and snapshot_folder:
            note.folder_id = snapshot_folder
        snapshot_tags = (entry.snapshot or {}).get("tags") or []
        valid_ids = []
        for name in snapshot_tags:
            tag = db.scalar(select(NoteTag).where(NoteTag.name == name))
            if tag:
                valid_ids.append(tag.id)
        db.query(NoteTagLink).filter(NoteTagLink.note_id == note.id).delete(synchronize_session=False)
        for tag_id in valid_ids:
            db.add(NoteTagLink(note_id=note.id, tag_id=tag_id))
        note.deleted_at = None

    else:  # memo
        memo = db.get(Memo, entity_id)
        if not memo:
            raise ApiError("NOT_FOUND", "便利贴已不存在", 404)
        snapshot = entry.snapshot or {}
        if not memo.title and snapshot.get("title"):
            memo.title = snapshot["title"]
        if not memo.category and snapshot.get("category"):
            memo.category = snapshot["category"]
        if not memo.color and snapshot.get("color"):
            memo.color = snapshot["color"]
        memo.deleted_at = None

    entry.restored_at = utcnow()
    db.commit()
    return {"ok": True, **detail}


@router.delete("/trash/{kind}/{entity_id}")
def purge(kind: str, entity_id: int, db: Session = Depends(get_db)):
    if kind not in KIND_LABEL:
        raise ApiError("INVALID_KIND", "回收站类型不合法", 422)
    entry = _entry(db, kind, entity_id)
    _purge_entity(db, kind, entity_id)
    entry.purged_at = utcnow()
    db.commit()
    return {"ok": True}


@router.post("/trash/purge-expired")
def purge_expired(db: Session = Depends(get_db)):
    now = utcnow()
    expired = list(
        db.scalars(
            select(TrashEntry).where(
                TrashEntry.restored_at.is_(None),
                TrashEntry.purged_at.is_(None),
                TrashEntry.expires_at <= now,
            )
        ).all()
    )
    purged = 0
    for entry in expired:
        try:
            _purge_entity(db, entry.kind, entry.entity_id)
            entry.purged_at = now
            db.commit()
            purged += 1
        except Exception:  # 单条失败不影响其余
            db.rollback()
    db.commit()
    return {"ok": True, "purged": purged}


def _purge_entity(db: Session, kind: str, entity_id: int) -> None:
    if kind == "table":
        table = db.get(DataTable, entity_id)
        if table:
            for record in db.scalars(select(DataRecord).where(DataRecord.table_id == entity_id)).all():
                _release_record_files(db, record.id)
                db.delete(record)
            for field in db.scalars(select(DataField).where(DataField.table_id == entity_id)).all():
                db.delete(field)
            db.delete(table)
    elif kind == "record":
        record = db.get(DataRecord, entity_id)
        if record:
            _release_record_files(db, record.id)
            db.delete(record)
    elif kind == "note":
        note = db.get(Note, entity_id)
        if note:
            _release_owner_files(db, "note", note.id)
            db.query(NoteTagLink).filter(NoteTagLink.note_id == note.id).delete(synchronize_session=False)
            db.delete(note)
    elif kind == "memo":
        memo = db.get(Memo, entity_id)
        if memo:
            db.delete(memo)
    db.flush()


def _release_record_files(db: Session, record_id: int) -> None:
    _release_owner_files(db, "record", record_id)
    _release_owner_files(db, "table_change_record", record_id)


def _release_owner_files(db: Session, owner_type: str, owner_id: int) -> None:
    refs = db.scalars(
        select(FileRef).where(FileRef.owner_type == owner_type, FileRef.owner_id == owner_id)
    ).all()
    for ref in refs:
        db.delete(ref)
        db.flush()
        remaining = db.scalar(select(FileRef).where(FileRef.file_id == ref.file_id).limit(1))
        if remaining:
            continue
        file_obj = db.get(FileObject, ref.file_id)
        if not file_obj:
            continue
        path = settings.storage_dir / "files" / file_obj.storage_key
        path.unlink(missing_ok=True)
        db.delete(file_obj)
