"""回收站：30×24 小时，软删内容与快照。"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import TrashEntry, utcnow

KINDS = {"table", "record", "note", "memo", "todo", "todo_list"}


def push(
    db: Session,
    kind: str,
    entity_id: int,
    name: str,
    snapshot: dict | None = None,
    parent_id: int | None = None,
) -> TrashEntry:
    now = utcnow()
    existing = db.scalar(
        select(TrashEntry).where(
            TrashEntry.kind == kind,
            TrashEntry.entity_id == entity_id,
            TrashEntry.restored_at.is_(None),
            TrashEntry.purged_at.is_(None),
        )
    )
    if existing:
        existing.deleted_at = now
        existing.expires_at = now + timedelta(days=settings.trash_days)
        existing.snapshot = snapshot or existing.snapshot
        return existing
    entry = TrashEntry(
        kind=kind,
        entity_id=entity_id,
        name=name[:255],
        snapshot=snapshot,
        parent_id=parent_id,
        deleted_at=now,
        expires_at=now + timedelta(days=settings.trash_days),
    )
    db.add(entry)
    return entry


def remaining_days(entry: TrashEntry, now=None) -> int:
    now = now or utcnow()
    delta = entry.expires_at - now
    return max(0, (delta.days if delta.total_seconds() % 86400 == 0 else delta.days + 1))


def active_entries(db: Session) -> list[TrashEntry]:
    now = utcnow()
    return list(
        db.scalars(
            select(TrashEntry)
            .where(
                TrashEntry.restored_at.is_(None),
                TrashEntry.purged_at.is_(None),
                TrashEntry.expires_at > now,
            )
            .order_by(TrashEntry.deleted_at.desc())
        ).all()
    )
