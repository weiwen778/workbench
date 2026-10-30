"""打卡：周期实例生成、完成/取消、锁定与快照规则。"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import CheckinGroup, CheckinInstance, CheckinRule, WorkTarget, utcnow
from ..utils import iso_z, now_local, today_local, utc_to_local
from .periods import iter_periods, period_bounds


def effective_period(rule: CheckinRule, today: date | None = None) -> str:
    """周期修改采用“下一个对应周期生效”。"""
    today = today or today_local()
    if rule.pending_period and rule.pending_effective_from and today >= rule.pending_effective_from:
        return rule.pending_period
    return rule.period


def collapse_pending(db: Session, rule: CheckinRule, today: date | None = None) -> None:
    """到达生效日期后，把待生效周期转正并写一条修改记录。"""
    today = today or today_local()
    if rule.pending_period and rule.pending_effective_from and today >= rule.pending_effective_from:
        rule.period = rule.pending_period
        rule.pending_period = None
        rule.pending_effective_from = None
        rule.version += 1


def _instance_values(
    rule: CheckinRule,
    target: WorkTarget,
    group: CheckinGroup | None,
    period_type: str,
    start: date,
    end: date,
) -> dict:
    return dict(
        rule_id=rule.id,
        target_id=target.id,
        target_name=target.name,
        group_id=rule.group_id,
        group_name=group.name if group else "未分类",
        period_type=period_type,
        period_start=start,
        period_end=end,
        title=rule.title,
        description=rule.description,
        locked=end <= today_local(),
        lock_reason="周期已结束" if end <= today_local() else None,
    )


def _history_complete(starts: set[date], period: str, anchor: date, today: date, generate_from: date | None) -> bool:
    first, end = period_bounds(period, anchor)
    current, _ = period_bounds(period, today)
    if generate_from and first < generate_from:
        first, end = period_bounds(period, generate_from)
        if first < generate_from:
            first = end
    if first > current:
        return True
    if period == 'daily':
        expected = (current - first).days + 1
        valid = lambda value: True
    elif period == 'weekly':
        expected = (current - first).days // 7 + 1
        valid = lambda value: value.weekday() == first.weekday()
    else:
        expected = (current.year - first.year) * 12 + current.month - first.month + 1
        valid = lambda value: value.day == 1
    # Count only aligned starts inside the required range, so future/stray
    # records cannot hide an actual gap. No process-global freshness cache.
    return sum(1 for value in starts if first <= value <= current and valid(value)) == expected


def ensure_rule_instances(
    db: Session,
    rule: CheckinRule,
    target: WorkTarget,
    *,
    period_type: str | None = None,
    backfill: bool = True,
    existing_starts: set[date] | None = None,
    group_cache: dict[int, CheckinGroup] | None = None,
) -> None:
    """幂等：同一事项同一周期只产生一个实例。

    - 当前周期：读取时即补齐
    - 停机遗漏的历史周期：以未完成、只读形式补齐
    """
    if not rule.active or target.status != "active":
        return
    today = today_local()
    period = period_type or effective_period(rule, today)
    group = group_cache.get(rule.group_id) if group_cache is not None else db.get(CheckinGroup, rule.group_id)
    if existing_starts is None:
        existing_starts = set(db.scalars(select(CheckinInstance.period_start).where(
            CheckinInstance.rule_id == rule.id, CheckinInstance.period_type == period)).all())
    pending = []

    def allowed(start: date) -> bool:
        return target.generate_from is None or start >= target.generate_from

    # 当前周期：读取即补齐
    start, end = period_bounds(period, today)
    if start not in existing_starts and allowed(start):
        pending.append(_instance_values(rule, target, group, period, start, end))
        existing_starts.add(start)

    # 停机遗漏的已结束周期：以未完成、只读形式补齐
    if backfill:
        created_local = utc_to_local(rule.created_at).date()
        anchor = min([*existing_starts, created_local])
        if not _history_complete(existing_starts, period, anchor, today, target.generate_from):
            for p_start, p_end in iter_periods(period, anchor, today):
                if p_start not in existing_starts and allowed(p_start) and p_end <= today:
                    pending.append(_instance_values(rule, target, group, period, p_start, p_end))
    if pending:
        dialect = db.get_bind().dialect.name
        factory = pg_insert if dialect == 'postgresql' else sqlite_insert
        # Concurrent first-page reads can discover the same missing periods.
        # The unique constraint is the final authority; never fail a read or
        # overwrite an existing completion/snapshot when another request won.
        statement = factory(CheckinInstance).on_conflict_do_nothing(index_elements=['rule_id', 'period_start'])
        db.execute(statement, pending)
    db.flush()


def ensure_target_period(db: Session, target: WorkTarget, period_type: str) -> None:
    rules = db.scalars(
        select(CheckinRule).where(CheckinRule.target_id == target.id, CheckinRule.active.is_(True))
    ).all()
    for rule in rules:
        collapse_pending(db, rule)
    rules = [rule for rule in rules if effective_period(rule) == period_type]
    if not rules:
        db.flush()
        return
    starts = {rule.id: set() for rule in rules}
    for rule_id, start in db.execute(select(CheckinInstance.rule_id, CheckinInstance.period_start).where(
            CheckinInstance.rule_id.in_(starts), CheckinInstance.period_type == period_type)):
        starts[rule_id].add(start)
    groups = {group.id: group for group in db.scalars(select(CheckinGroup).where(
        CheckinGroup.id.in_({rule.group_id for rule in rules})))}
    for rule in rules:
        ensure_rule_instances(db, rule, target, period_type=period_type, backfill=True,
                              existing_starts=starts[rule.id], group_cache=groups)
    db.flush()


def refresh_locks(db: Session, instances: list[CheckinInstance]) -> None:
    today = today_local()
    for inst in instances:
        should_lock = inst.period_end <= today
        if should_lock and not inst.locked:
            inst.locked = True
            inst.lock_reason = inst.lock_reason or "周期已结束"
        elif not should_lock and inst.locked and inst.lock_reason == "周期已结束":
            inst.locked = False
            inst.lock_reason = None
    db.flush()


def sync_snapshot_from_rule(inst: CheckinInstance, rule: CheckinRule, group: CheckinGroup | None) -> None:
    """取消已完成实例时同步最新要求。"""
    inst.title = rule.title
    inst.description = rule.description
    inst.group_id = rule.group_id
    inst.group_name = group.name if group else inst.group_name
    inst.version += 1


def complete_instance(db: Session, inst: CheckinInstance, note: str | None) -> CheckinInstance:
    refresh_locks(db, [inst])
    if inst.locked:
        raise ApiError("PERIOD_LOCKED", "这一轮已经结束，不能补打卡", 409)
    if inst.completed_at:
        # 重复提交不刷新完成时间、不重复计数
        if note is not None and note != inst.note:
            inst.note = note
        return inst
    inst.completed_at = utcnow()
    if note is not None:
        inst.note = note
    inst.version += 1
    db.flush()
    return inst


def cancel_instance(db: Session, inst: CheckinInstance) -> CheckinInstance:
    refresh_locks(db, [inst])
    if inst.locked:
        raise ApiError("PERIOD_LOCKED", "这一轮已经结束，不能取消", 409)
    if inst.completed_at is None:
        return inst
    inst.completed_at = None
    rule = db.get(CheckinRule, inst.rule_id)
    if rule:
        group = db.get(CheckinGroup, rule.group_id)
        sync_snapshot_from_rule(inst, rule, group)
    else:
        inst.version += 1
    db.flush()
    return inst


def serialize_instance(inst: CheckinInstance) -> dict:
    return {
        "id": inst.id,
        "rule_id": inst.rule_id,
        "target_id": inst.target_id,
        "target_name": inst.target_name,
        "group_id": inst.group_id,
        "group_name": inst.group_name,
        "period_type": inst.period_type,
        "period_start": inst.period_start.isoformat(),
        "period_end": inst.period_end.isoformat(),
        "title": inst.title,
        "description": inst.description,
        "completed": inst.completed_at is not None,
        "completed_at": iso_z(inst.completed_at),
        "note": inst.note,
        "locked": inst.locked,
        "lock_reason": inst.lock_reason,
        "version": inst.version,
    }


def statistics(db: Session, period_type: str, target_ids: list[int] | None = None) -> dict:
    start, end = period_bounds(period_type, today_local())
    stmt = select(
        func.count(CheckinInstance.id), func.count(CheckinInstance.completed_at)
    ).where(
        CheckinInstance.period_type == period_type,
        CheckinInstance.period_start == start,
        CheckinInstance.lock_reason.is_(None) | (CheckinInstance.lock_reason != "已暂停"),
    )
    if target_ids is not None:
        stmt = stmt.where(CheckinInstance.target_id.in_(target_ids))
    total, completed = db.execute(stmt).one()
    total = total or 0
    completed = completed or 0
    return {
        "period_type": period_type,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total": total,
        "completed": completed,
        "rate": None if total == 0 else round(completed / total * 100),
    }


def change_rule_period(db: Session, rule: CheckinRule, new_period: str, today: date | None = None) -> dict:
    """修改周期是特殊变更：保留旧规则当前实例，新周期从下一个对应周期生效。"""
    today = today or today_local()
    if new_period == rule.period and not rule.pending_period:
        return {"pending": False, "effective_from": None}
    current_end = period_bounds(rule.period, today)[1]
    rule.pending_period = new_period
    rule.pending_effective_from = current_end
    rule.version += 1
    db.flush()
    return {"pending": True, "effective_from": current_end.isoformat()}
