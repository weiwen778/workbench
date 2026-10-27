from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import CheckinGroup, CheckinInstance, WorkTarget
from ..services.checkins import (
    cancel_instance,
    complete_instance,
    ensure_target_period,
    refresh_locks,
    serialize_instance,
    statistics,
)
from ..services.periods import period_bounds
from ..utils import parse_date, today_local

router = APIRouter(tags=["checkin"], dependencies=[Depends(get_current_user)])

PERIODS = {"daily", "weekly", "monthly"}


class CompleteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class NoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


def _load_instances(
    db: Session,
    *,
    kind: str,
    period: str,
    target_id: int | None,
    status: str,
    period_start: date | None = None,
) -> list[CheckinInstance]:
    start, _end = period_bounds(period, period_start or today_local())
    targets = db.scalars(
        select(WorkTarget).where(WorkTarget.kind == kind, WorkTarget.status == "active")
    ).all()
    if target_id:
        targets = [t for t in targets if t.id == target_id]
    for target in targets:
        ensure_target_period(db, target, period)
    db.flush()

    stmt = (
        select(CheckinInstance)
        .join(WorkTarget, WorkTarget.id == CheckinInstance.target_id)
        .where(
            WorkTarget.kind == kind,
            CheckinInstance.period_type == period,
            CheckinInstance.period_start == start,
            # 归档前遗留的当前周期记录不在“今天要做”的清单里重复出现
            CheckinInstance.lock_reason.is_(None) | (CheckinInstance.lock_reason != "已暂停"),
        )
    )
    if target_id:
        stmt = stmt.where(CheckinInstance.target_id == target_id)
    if status == "pending":
        stmt = stmt.where(CheckinInstance.completed_at.is_(None))
    elif status == "done":
        stmt = stmt.where(CheckinInstance.completed_at.is_not(None))
    instances = list(db.scalars(stmt).all())
    refresh_locks(db, instances)
    return instances


@router.get("/checkin-instances")
def list_instances(
    kind: str = Query(default="shop"),
    period: str = Query(default="daily"),
    target_id: int | None = None,
    status: str = Query(default="all"),
    period_start: str | None = None,
    db: Session = Depends(get_db),
):
    if kind not in {"shop", "social"}:
        raise ApiError("INVALID_KIND", "类型只能是 shop 或 social", 422)
    if period not in PERIODS:
        raise ApiError("INVALID_PERIOD", "周期不合法", 422)
    if status not in {"all", "pending", "done"}:
        raise ApiError("INVALID_STATUS", "状态筛选不合法", 422)

    ref = parse_date(period_start)
    instances = _load_instances(
        db, kind=kind, period=period, target_id=target_id, status=status, period_start=ref
    )
    db.commit()

    groups = {g.id: g for g in db.scalars(select(CheckinGroup)).all()}
    targets = db.scalars(
        select(WorkTarget).where(WorkTarget.kind == kind, WorkTarget.status == "active")
    ).all()

    grouped: dict[int, dict] = {}
    for inst in instances:
        gid = inst.group_id
        node = grouped.setdefault(
            gid,
            {
                "group_id": gid,
                "group_name": groups[gid].name if gid in groups else inst.group_name,
                "sort_order": groups[gid].sort_order if gid in groups else 999,
                "items": [],
            },
        )
        node["items"].append(serialize_instance(inst))

    ordered = sorted(grouped.values(), key=lambda x: (x["sort_order"], x["group_id"]))
    for node in ordered:
        node["items"].sort(key=lambda i: (i["target_id"], i["id"]))
        node["completed"] = sum(1 for i in node["items"] if i["completed"])
        node["total"] = len(node["items"])

    start, end = period_bounds(period, ref or today_local())
    stats = statistics(db, period, [t.id for t in targets])
    return {
        "kind": kind,
        "period_type": period,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "is_current": start <= today_local() < end,
        "statistics": {**stats, "rate": stats["rate"]},
        "groups": ordered,
        "targets": [{"id": t.id, "name": t.name, "platform": t.platform} for t in targets],
    }


@router.get("/checkin-instances/history")
def history(
    kind: str = Query(default="shop"),
    period: str = Query(default="daily"),
    target_id: int | None = None,
    status: str = Query(default="all"),
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    if period not in PERIODS:
        raise ApiError("INVALID_PERIOD", "周期不合法", 422)
    stmt = (
        select(CheckinInstance)
        .join(WorkTarget, WorkTarget.id == CheckinInstance.target_id)
        .where(WorkTarget.kind == kind)
        .order_by(CheckinInstance.period_start.desc(), CheckinInstance.id)
    )
    if target_id:
        stmt = stmt.where(CheckinInstance.target_id == target_id)
    if status == "pending":
        stmt = stmt.where(CheckinInstance.completed_at.is_(None))
    elif status == "done":
        stmt = stmt.where(CheckinInstance.completed_at.is_not(None))
    start = parse_date(date_from)
    end = parse_date(date_to)
    if start:
        stmt = stmt.where(CheckinInstance.period_start >= start)
    if end:
        stmt = stmt.where(CheckinInstance.period_start <= end)
    total = len(list(db.scalars(stmt).all()))
    rows = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all())
    refresh_locks(db, rows)
    db.commit()
    return {"total": total, "page": page, "page_size": page_size, "items": [serialize_instance(r) for r in rows]}


@router.post("/checkin-instances/{instance_id}/complete")
def complete(instance_id: int, payload: CompleteIn | None = None, db: Session = Depends(get_db)):
    inst = db.get(CheckinInstance, instance_id)
    if not inst:
        raise ApiError("NOT_FOUND", "任务不存在", 404)
    note = payload.note if payload else None
    complete_instance(db, inst, note)
    db.commit()
    return serialize_instance(inst)


@router.post("/checkin-instances/{instance_id}/cancel")
def cancel(instance_id: int, db: Session = Depends(get_db)):
    inst = db.get(CheckinInstance, instance_id)
    if not inst:
        raise ApiError("NOT_FOUND", "任务不存在", 404)
    cancel_instance(db, inst)
    db.commit()
    return serialize_instance(inst)


@router.patch("/checkin-instances/{instance_id}")
def update_note(instance_id: int, payload: NoteIn, db: Session = Depends(get_db)):
    inst = db.get(CheckinInstance, instance_id)
    if not inst:
        raise ApiError("NOT_FOUND", "任务不存在", 404)
    refresh_locks(db, [inst])
    if inst.locked:
        raise ApiError("PERIOD_LOCKED", "本周期已结束，不能修改备注", 409)
    inst.note = payload.note
    inst.version += 1
    db.commit()
    return serialize_instance(inst)


@router.get("/checkin-statistics")
def stats(
    period: str = Query(default="daily"),
    kind: str = Query(default="shop"),
    db: Session = Depends(get_db),
):
    if period not in PERIODS:
        raise ApiError("INVALID_PERIOD", "周期不合法", 422)
    targets = db.scalars(
        select(WorkTarget.id).where(WorkTarget.kind == kind, WorkTarget.status == "active")
    ).all()
    for tid in targets:
        target = db.get(WorkTarget, tid)
        if target:
            ensure_target_period(db, target, period)
    db.commit()
    return statistics(db, period, list(targets))
