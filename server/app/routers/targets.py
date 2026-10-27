from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import (
    ActivityInterval,
    CheckinGroup,
    CheckinInstance,
    CheckinRule,
    CheckinRuleVersion,
    User,
    WorkTarget,
    utcnow,
)
from ..services.checkins import change_rule_period, effective_period, ensure_target_period
from ..services.periods import next_period_start, period_bounds
from ..utils import iso_z, now_local, today_local

router = APIRouter(tags=["checkin-config"], dependencies=[Depends(get_current_user)])

KINDS = {"shop", "social"}


class TargetIn(BaseModel):
    kind: str
    name: str = Field(min_length=1, max_length=100)
    platform: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=2000)


class TargetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    platform: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=2000)
    sort_order: int | None = None


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = 0


class RuleIn(BaseModel):
    group_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    period: str = "daily"
    sort_order: int = 0


class RulePatch(BaseModel):
    group_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    period: str | None = None
    active: bool | None = None
    sort_order: int | None = None


def target_payload(t: WorkTarget) -> dict:
    return {
        "id": t.id,
        "kind": t.kind,
        "name": t.name,
        "platform": t.platform,
        "note": t.note,
        "sort_order": t.sort_order,
        "status": t.status,
        "version": t.version,
        "archived_at": iso_z(t.archived_at),
        "generate_from": t.generate_from.isoformat() if t.generate_from else None,
    }


def rule_payload(r: CheckinRule, group_name: str | None = None) -> dict:
    return {
        "id": r.id,
        "target_id": r.target_id,
        "group_id": r.group_id,
        "group_name": group_name,
        "title": r.title,
        "description": r.description,
        "period": r.period,
        "effective_period": effective_period(r),
        "active": r.active,
        "sort_order": r.sort_order,
        "pending_period": r.pending_period,
        "pending_effective_from": r.pending_effective_from.isoformat() if r.pending_effective_from else None,
        "version": r.version,
    }


def _ensure_name_free(db: Session, kind: str, name: str, exclude_id: int | None = None) -> None:
    stmt = select(WorkTarget).where(
        WorkTarget.kind == kind, WorkTarget.name == name, WorkTarget.status == "active"
    )
    if exclude_id:
        stmt = stmt.where(WorkTarget.id != exclude_id)
    if db.scalar(stmt):
        raise ApiError("NAME_DUPLICATED", "同类型下已经有同名的了，换个名称", 409, {"field": "name"})


@router.get("/work-targets")
def list_targets(
    kind: str | None = Query(default=None),
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    stmt = select(WorkTarget).order_by(WorkTarget.sort_order, WorkTarget.id)
    if kind:
        if kind not in KINDS:
            raise ApiError("INVALID_KIND", "类型只能是 shop 或 social", 422)
        stmt = stmt.where(WorkTarget.kind == kind)
    if not include_archived:
        stmt = stmt.where(WorkTarget.status == "active")
    targets = db.scalars(stmt).all()
    counts = dict(
        db.execute(
            select(CheckinRule.target_id, func.count(CheckinRule.id))
            .where(CheckinRule.active.is_(True))
            .group_by(CheckinRule.target_id)
        ).all()
    )
    return [dict(target_payload(t), rule_count=counts.get(t.id, 0)) for t in targets]


@router.post("/work-targets", status_code=201)
def create_target(payload: TargetIn, db: Session = Depends(get_db)):
    if payload.kind not in KINDS:
        raise ApiError("INVALID_KIND", "类型只能是 shop 或 social", 422)
    name = payload.name.strip()
    _ensure_name_free(db, payload.kind, name)
    target = WorkTarget(
        kind=payload.kind,
        name=name,
        platform=payload.platform,
        note=payload.note,
        sort_order=(db.scalar(select(func.max(WorkTarget.sort_order))) or 0) + 1,
    )
    db.add(target)
    db.flush()
    db.add(ActivityInterval(target_id=target.id, start_at=utcnow(), reason="创建"))
    db.commit()
    return target_payload(target)


@router.get("/work-targets/{target_id}")
def get_target(target_id: int, db: Session = Depends(get_db)):
    target = db.get(WorkTarget, target_id)
    if not target:
        raise ApiError("NOT_FOUND", "店铺/账号不存在", 404)
    return target_payload(target)


@router.patch("/work-targets/{target_id}")
def update_target(target_id: int, payload: TargetPatch, db: Session = Depends(get_db)):
    target = db.get(WorkTarget, target_id)
    if not target:
        raise ApiError("NOT_FOUND", "店铺/账号不存在", 404)
    if payload.name is not None:
        name = payload.name.strip()
        _ensure_name_free(db, target.kind, name, exclude_id=target.id)
        target.name = name
        # 历史实例保留当时的名称，仅更新未完成且未锁定的实例
        db.query(CheckinInstance).filter(
            CheckinInstance.target_id == target.id,
            CheckinInstance.completed_at.is_(None),
            CheckinInstance.locked.is_(False),
        ).update({CheckinInstance.target_name: name}, synchronize_session=False)
    if payload.platform is not None:
        target.platform = payload.platform
    if payload.note is not None:
        target.note = payload.note
    if payload.sort_order is not None:
        target.sort_order = payload.sort_order
    target.version += 1
    db.commit()
    return target_payload(target)


@router.post("/work-targets/{target_id}/archive")
def archive_target(target_id: int, db: Session = Depends(get_db)):
    target = db.get(WorkTarget, target_id)
    if not target:
        raise ApiError("NOT_FOUND", "店铺/账号不存在", 404)
    if target.status == "archived":
        return target_payload(target)
    target.status = "archived"
    target.archived_at = utcnow()
    target.version += 1
    interval = db.scalar(
        select(ActivityInterval)
        .where(ActivityInterval.target_id == target.id, ActivityInterval.end_at.is_(None))
        .order_by(ActivityInterval.id.desc())
    )
    if interval:
        interval.end_at = utcnow()
    # 已有记录保留并锁定，不进入回收站
    db.query(CheckinInstance).filter(CheckinInstance.target_id == target.id).update(
        {CheckinInstance.locked: True, CheckinInstance.lock_reason: "已暂停"},
        synchronize_session=False,
    )
    db.commit()
    return target_payload(target)


@router.post("/work-targets/{target_id}/restore")
def restore_target(target_id: int, db: Session = Depends(get_db)):
    target = db.get(WorkTarget, target_id)
    if not target:
        raise ApiError("NOT_FOUND", "店铺/账号不存在", 404)
    if target.status == "active":
        return target_payload(target)
    _ensure_name_free(db, target.kind, target.name, exclude_id=target.id)
    target.status = "active"
    target.archived_at = None
    target.version += 1
    # 恢复后从下一个对应周期继续，归档期间不补工作
    upcoming: list = []
    rules = db.scalars(select(CheckinRule).where(CheckinRule.target_id == target.id)).all()
    today = today_local()
    for rule in rules:
        upcoming.append(next_period_start(rule.period, today))
    target.generate_from = min(upcoming) if upcoming else None
    db.add(ActivityInterval(target_id=target.id, start_at=utcnow(), reason="恢复"))
    db.commit()
    return target_payload(target)


# ---------------------------------------------------------------- 分组


@router.get("/checkin-groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.scalars(select(CheckinGroup).order_by(CheckinGroup.sort_order, CheckinGroup.id)).all()
    counts = dict(
        db.execute(
            select(CheckinRule.group_id, func.count(CheckinRule.id))
            .where(CheckinRule.active.is_(True))
            .group_by(CheckinRule.group_id)
        ).all()
    )
    return [
        {
            "id": g.id,
            "name": g.name,
            "sort_order": g.sort_order,
            "active": g.active,
            "rule_count": counts.get(g.id, 0),
        }
        for g in groups
    ]


@router.post("/checkin-groups", status_code=201)
def create_group(payload: GroupIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if db.scalar(select(CheckinGroup).where(CheckinGroup.name == name)):
        raise ApiError("NAME_DUPLICATED", "分类名称已存在", 409, {"field": "name"})
    group = CheckinGroup(name=name, sort_order=payload.sort_order)
    db.add(group)
    db.commit()
    return {"id": group.id, "name": group.name, "sort_order": group.sort_order, "active": group.active}


@router.patch("/checkin-groups/{group_id}")
def rename_group(group_id: int, payload: GroupIn, db: Session = Depends(get_db)):
    group = db.get(CheckinGroup, group_id)
    if not group:
        raise ApiError("NOT_FOUND", "分类不存在", 404)
    name = payload.name.strip()
    dup = db.scalar(select(CheckinGroup).where(CheckinGroup.name == name, CheckinGroup.id != group_id))
    if dup:
        raise ApiError("NAME_DUPLICATED", "分类名称已存在", 409, {"field": "name"})
    group.name = name
    group.sort_order = payload.sort_order
    # 历史快照保留当时名称，仅更新未锁定实例的分组名
    db.query(CheckinInstance).filter(
        CheckinInstance.group_id == group_id, CheckinInstance.locked.is_(False)
    ).update({CheckinInstance.group_name: name}, synchronize_session=False)
    db.commit()
    return {"id": group.id, "name": group.name, "sort_order": group.sort_order, "active": group.active}


@router.delete("/checkin-groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    group = db.get(CheckinGroup, group_id)
    if not group:
        raise ApiError("NOT_FOUND", "分类不存在", 404)
    active_rules = db.scalar(
        select(func.count(CheckinRule.id)).where(
            CheckinRule.group_id == group_id, CheckinRule.active.is_(True)
        )
    )
    pending = db.scalar(
        select(func.count(CheckinInstance.id)).where(
            CheckinInstance.group_id == group_id,
            CheckinInstance.completed_at.is_(None),
            CheckinInstance.locked.is_(False),
        )
    )
    if active_rules or pending:
        raise ApiError(
            "GROUP_IN_USE",
            "该分类仍有启用任务或未完成工作，请先调整归属再删除",
            409,
            {"active_rules": active_rules or 0, "pending_instances": pending or 0},
        )
    db.delete(group)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 打卡事项


@router.get("/work-targets/{target_id}/rules")
def list_rules(target_id: int, include_inactive: bool = Query(default=True), db: Session = Depends(get_db)):
    target = db.get(WorkTarget, target_id)
    if not target:
        raise ApiError("NOT_FOUND", "店铺/账号不存在", 404)
    ensure_target_period(db, target, "daily")
    db.commit()
    groups = {g.id: g.name for g in db.scalars(select(CheckinGroup)).all()}
    stmt = select(CheckinRule).where(CheckinRule.target_id == target_id)
    if not include_inactive:
        stmt = stmt.where(CheckinRule.active.is_(True))
    rules = db.scalars(stmt.order_by(CheckinRule.sort_order, CheckinRule.id)).all()
    return [rule_payload(r, groups.get(r.group_id)) for r in rules]


@router.post("/work-targets/{target_id}/rules", status_code=201)
def create_rule(target_id: int, payload: RuleIn, db: Session = Depends(get_db)):
    target = db.get(WorkTarget, target_id)
    if not target:
        raise ApiError("NOT_FOUND", "店铺/账号不存在", 404)
    if target.status != "active":
        raise ApiError("TARGET_ARCHIVED", "已经暂停了，请先恢复", 409)
    group = db.get(CheckinGroup, payload.group_id)
    if not group:
        raise ApiError("GROUP_NOT_FOUND", "分类不存在", 422, {"field": "group_id"})
    if payload.period not in {"daily", "weekly", "monthly"}:
        raise ApiError("INVALID_PERIOD", "时间范围只能是今日／本周／本月", 422)
    rule = CheckinRule(
        target_id=target_id,
        group_id=payload.group_id,
        title=payload.title.strip(),
        description=payload.description,
        period=payload.period,
        sort_order=payload.sort_order,
    )
    db.add(rule)
    db.flush()
    db.add(
        CheckinRuleVersion(
            rule_id=rule.id,
            title=rule.title,
            description=rule.description,
            group_id=rule.group_id,
            group_name=group.name,
            period=rule.period,
            change_summary="创建任务",
        )
    )
    # 新增立即进入当前对应周期
    ensure_target_period(db, target, payload.period)
    db.commit()
    return rule_payload(rule, group.name)


@router.patch("/checkin-rules/{rule_id}")
def update_rule(rule_id: int, payload: RulePatch, db: Session = Depends(get_db)):
    rule = db.get(CheckinRule, rule_id)
    if not rule:
        raise ApiError("NOT_FOUND", "任务不存在", 404)
    target = db.get(WorkTarget, rule.target_id)
    group = db.get(CheckinGroup, rule.group_id)
    changes: list[str] = []
    period_change: dict | None = None

    if payload.period and payload.period != rule.period:
        period_change = change_rule_period(db, rule, payload.period)
        changes.append("修改周期")

    if payload.group_id is not None and payload.group_id != rule.group_id:
        new_group = db.get(CheckinGroup, payload.group_id)
        if not new_group:
            raise ApiError("GROUP_NOT_FOUND", "分类不存在", 422, {"field": "group_id"})
        rule.group_id = new_group.id
        group = new_group
        changes.append("调整分类")
    if payload.title is not None and payload.title.strip() != rule.title:
        rule.title = payload.title.strip()
        changes.append("修改标题")
    if payload.description is not None and payload.description != rule.description:
        rule.description = payload.description
        changes.append("修改说明")
    if payload.active is not None and payload.active != rule.active:
        rule.active = payload.active
        changes.append("启用" if payload.active else "停用")
    if payload.sort_order is not None:
        rule.sort_order = payload.sort_order

    if changes:
        rule.version += 1
        db.add(
            CheckinRuleVersion(
                rule_id=rule.id,
                title=rule.title,
                description=rule.description,
                group_id=rule.group_id,
                group_name=group.name if group else "",
                period=rule.period,
                change_summary="、".join(changes),
            )
        )
        # 当前尚未完成且未锁定的事项立即更新；已完成/历史保留当时内容
        db.query(CheckinInstance).filter(
            CheckinInstance.rule_id == rule.id,
            CheckinInstance.completed_at.is_(None),
            CheckinInstance.locked.is_(False),
        ).update(
            {
                CheckinInstance.title: rule.title,
                CheckinInstance.description: rule.description,
                CheckinInstance.group_id: rule.group_id,
                CheckinInstance.group_name: group.name if group else "",
                CheckinInstance.version: CheckinInstance.version + 1,
            },
            synchronize_session=False,
        )
    if target:
        ensure_target_period(db, target, "daily")
    db.commit()
    payload_out = rule_payload(rule, group.name if group else None)
    payload_out["period_change"] = period_change
    return payload_out


@router.delete("/checkin-rules/{rule_id}")
def disable_rule(rule_id: int, db: Session = Depends(get_db)):
    """停用事项：停止后续生成，已有实例按原周期规则处理。"""
    rule = db.get(CheckinRule, rule_id)
    if not rule:
        raise ApiError("NOT_FOUND", "任务不存在", 404)
    rule.active = False
    rule.version += 1
    group = db.get(CheckinGroup, rule.group_id)
    db.add(
        CheckinRuleVersion(
            rule_id=rule.id,
            title=rule.title,
            description=rule.description,
            group_id=rule.group_id,
            group_name=group.name if group else "",
            period=rule.period,
            change_summary="停用任务",
        )
    )
    db.commit()
    return {"ok": True}


@router.get("/checkin-rules/{rule_id}/versions")
def rule_versions(rule_id: int, db: Session = Depends(get_db)):
    versions = db.scalars(
        select(CheckinRuleVersion)
        .where(CheckinRuleVersion.rule_id == rule_id)
        .order_by(CheckinRuleVersion.effective_from.desc(), CheckinRuleVersion.id.desc())
    ).all()
    return [
        {
            "id": v.id,
            "title": v.title,
            "description": v.description,
            "group_name": v.group_name,
            "period": v.period,
            "change_summary": v.change_summary,
            "created_at": iso_z(v.effective_from),
        }
        for v in versions
    ]
