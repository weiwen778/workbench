"""打卡：周期实例生成、完成/取消、锁定与快照规则。"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import CheckinGroup, CheckinInstance, CheckinRule, CheckinRuleVersion, WorkTarget, utcnow
from ..utils import iso_z, local_midnight_utc, now_local, today_local, utc_to_local
from .periods import PERIODS, iter_periods, period_bounds

PERIOD_ACTIVATED = "周期生效"


def _period_start_on_or_after(period: str, day: date) -> date:
    start, end = period_bounds(period, day)
    return start if start == day else end


def pending_period_start(rule: CheckinRule) -> date | None:
    if rule.pending_period not in PERIODS or rule.pending_effective_from is None:
        return None
    return _period_start_on_or_after(rule.pending_period, rule.pending_effective_from)


def effective_period(rule: CheckinRule, today: date | None = None) -> str:
    """周期修改采用“下一个对应周期生效”。"""
    today = today or today_local()
    starts_on = pending_period_start(rule)
    if starts_on and today >= starts_on:
        assert rule.pending_period is not None
        return rule.pending_period
    return rule.period


def _schedule_starts(db: Session, rule_ids: list[int]) -> dict[int, date]:
    versions = db.execute(
        select(CheckinRuleVersion.rule_id, func.max(CheckinRuleVersion.effective_from))
        .where(CheckinRuleVersion.rule_id.in_(rule_ids), CheckinRuleVersion.change_summary == PERIOD_ACTIVATED)
        .group_by(CheckinRuleVersion.rule_id)
    )
    return {rule_id: utc_to_local(start).date() for rule_id, start in versions}


def collapse_pending(db: Session, rule: CheckinRule, target: WorkTarget, today: date | None = None) -> None:
    """到达生效日期后，把待生效周期转正并写一条修改记录。"""
    today = today or today_local()
    starts_on = pending_period_start(rule)
    if starts_on is None or today < starts_on:
        return
    db.refresh(rule, with_for_update=True)
    starts_on = pending_period_start(rule)
    new_period = rule.pending_period
    if starts_on is None or new_period is None or today < starts_on:
        return

    # Complete the previous schedule through its last day before switching.
    previous_start = _schedule_starts(db, [rule.id]).get(rule.id)
    ensure_rule_instances(
        db, rule, target, period_type=rule.period,
        today=starts_on - timedelta(days=1), schedule_start=previous_start,
    )
    rule.period = new_period
    rule.pending_period = None
    rule.pending_effective_from = None
    rule.version += 1
    group = db.get(CheckinGroup, rule.group_id)
    db.add(CheckinRuleVersion(
        rule_id=rule.id, title=rule.title, description=rule.description,
        group_id=rule.group_id, group_name=group.name if group else "未分类",
        period=new_period, change_summary=PERIOD_ACTIVATED, effective_from=local_midnight_utc(starts_on),
    ))
    db.flush()


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
    today: date | None = None,
    schedule_start: date | None = None,
) -> None:
    """幂等：同一事项同一周期只产生一个实例。

    - 当前周期：读取时即补齐
    - 停机遗漏的历史周期：以未完成、只读形式补齐
    """
    if not rule.active or target.status != "active":
        return
    today = today or today_local()
    period = period_type or effective_period(rule, today)
    group = group_cache.get(rule.group_id) if group_cache is not None else db.get(CheckinGroup, rule.group_id)
    if existing_starts is None:
        existing_starts = set(db.scalars(select(CheckinInstance.period_start).where(
            CheckinInstance.rule_id == rule.id, CheckinInstance.period_type == period)).all())
    pending = []
    earliest = max((start for start in (target.generate_from, schedule_start) if start is not None), default=None)

    def allowed(start: date) -> bool:
        return earliest is None or start >= earliest

    # 当前周期：读取即补齐
    start, end = period_bounds(period, today)
    if start not in existing_starts and allowed(start):
        pending.append(_instance_values(rule, target, group, period, start, end))
        existing_starts.add(start)

    # 停机遗漏的已结束周期：以未完成、只读形式补齐
    if backfill:
        created_local = utc_to_local(rule.created_at).date()
        anchor = schedule_start or min([*existing_starts, created_local])
        if not _history_complete(existing_starts, period, anchor, today, earliest):
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
        collapse_pending(db, rule, target)
    rules = [rule for rule in rules if effective_period(rule) == period_type]
    if not rules:
        db.flush()
        return
    starts = {rule.id: set() for rule in rules}
    schedule_starts = _schedule_starts(db, list(starts))
    for rule_id, start in db.execute(select(CheckinInstance.rule_id, CheckinInstance.period_start).where(
            CheckinInstance.rule_id.in_(starts), CheckinInstance.period_type == period_type)):
        starts[rule_id].add(start)
    groups = {group.id: group for group in db.scalars(select(CheckinGroup).where(
        CheckinGroup.id.in_({rule.group_id for rule in rules})))}
    for rule in rules:
        ensure_rule_instances(db, rule, target, period_type=period_type, backfill=True,
                              existing_starts=starts[rule.id], group_cache=groups,
                              schedule_start=schedule_starts.get(rule.id))
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


def period_change_start(current_period: str, new_period: str, today: date) -> date:
    return _period_start_on_or_after(new_period, period_bounds(current_period, today)[1])


def change_rule_period(rule: CheckinRule, new_period: str, today: date | None = None) -> dict:
    """修改周期是特殊变更：保留旧规则当前实例，新周期从下一个对应周期生效。"""
    today = today or today_local()
    if new_period == rule.period:
        rule.pending_period = None
        rule.pending_effective_from = None
        return {"pending": False, "effective_from": None}
    starts_on = period_change_start(rule.period, new_period, today)
    rule.pending_period = new_period
    rule.pending_effective_from = starts_on
    return {"pending": True, "effective_from": starts_on.isoformat()}
