from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from .config import settings

try:
    LOCAL_TZ = ZoneInfo(settings.timezone)
except Exception:  # pragma: no cover - 无 tzdata 环境
    from datetime import timedelta

    LOCAL_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")


def now_local() -> datetime:
    return datetime.now(LOCAL_TZ)


def today_local() -> date:
    return now_local().date()


def iso_z(dt: datetime | None) -> str | None:
    """naive UTC → ISO8601 带 Z。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def utc_to_local(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LOCAL_TZ)


def local_midnight_utc(d: date) -> datetime:
    """本地自然日 00:00 对应的 UTC naive 时间。"""
    local = datetime.combine(d, time.min, tzinfo=LOCAL_TZ)
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def parse_date(value: str | date | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value)[:10])


def stringify_decimal(value) -> str:
    """数字统一按字符串保存，避免浮点近似。"""
    from decimal import Decimal, InvalidOperation

    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("不是合法数字")
    if not dec.is_finite():
        raise ValueError("不是合法数字")
    return format(dec.normalize(), "f")
