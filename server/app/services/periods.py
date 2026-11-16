"""打卡周期计算：北京时间、左闭右开、自然月按日历。"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

from ..utils import now_local

PERIODS = ("daily", "weekly", "monthly")


def period_bounds(period: str, ref: date) -> tuple[date, date]:
    """返回 [start, end) 两个自然日。"""
    if period == "daily":
        return ref, ref + timedelta(days=1)
    if period == "weekly":
        start = ref - timedelta(days=ref.weekday())  # 周一
        return start, start + timedelta(days=7)
    if period == "monthly":
        start = ref.replace(day=1)
        last_day = calendar.monthrange(start.year, start.month)[1]
        return start, start + timedelta(days=last_day)
    raise ValueError(f"未知周期: {period}")


def current_period(period: str, now: datetime | None = None) -> tuple[date, date]:
    ref = (now or now_local()).date()
    return period_bounds(period, ref)


def next_period_start(period: str, after: date) -> date:
    """给定日期之后的下一个周期起点（用于周期修改生效时间）。"""
    start, end = period_bounds(period, after)
    if after < start:
        return start
    return end


def is_current(start: date, end: date, now: datetime | None = None) -> bool:
    """左闭右开：end 当天 00:00 起即视为结束。"""
    return start <= (now or now_local()).date() < end


def iter_periods(period: str, start_from: date, until: date):
    """从 start_from 所属周期开始，逐个产出 (start, end)，直到 start > until。"""
    start, end = period_bounds(period, start_from)
    guard = 0
    while start <= until and guard < 2000:
        yield start, end
        start, end = period_bounds(period, end)
        guard += 1
