"""应用运行日志的采集、批量落库与清理。

写日志绝不能阻塞业务，也不能因为写库失败而递归写日志：队列满就丢弃，
写库异常直接写 stderr。检索逻辑在 routers/logs.py。
"""

from __future__ import annotations

import atexit
import json
import logging
import queue
import re
import sys
import threading
import traceback
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, insert

from ..config import settings
from ..db import SessionLocal
from ..models import AppLog, utcnow

request_id_var: ContextVar[str | None] = ContextVar("wb_log_request_id", default=None)
user_id_var: ContextVar[int | None] = ContextVar("wb_log_user_id", default=None)

_LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
_SECRET_RE = re.compile(
    r"(?i)\b(password|passwd|token|secret|authorization|cookie|api[_-]?key)\b(\s*[:=]\s*)([^\s,;&\"'}]+)"
)
_BEARER_RE = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}")
_MESSAGE_LIMIT = 4000
_STACK_LIMIT = 12_000
_CONTEXT_LIMIT = 8_000

_queue: queue.Queue[dict] = queue.Queue(maxsize=settings.log_queue_size)
_stop = threading.Event()
_wake = threading.Event()
_lock = threading.Lock()
_dropped = 0
_thread: threading.Thread | None = None
_installed = False


def scrub(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    value = _BEARER_RE.sub(r"\1 ***", str(text))
    value = _SECRET_RE.sub(r"\1\2***", value)
    return value[:limit]


def _cap_context(context: dict | None) -> dict | None:
    if not context:
        return None
    clean: dict = {}
    for key, value in list(context.items())[:30]:
        if isinstance(value, (str, int, float, bool)) or value is None:
            clean[str(key)[:80]] = scrub(str(value), 500) if isinstance(value, str) else value
        else:
            try:
                clean[str(key)[:80]] = scrub(json.dumps(value, ensure_ascii=False), 500)
            except Exception:
                clean[str(key)[:80]] = "<无法序列化>"
    if len(json.dumps(clean, ensure_ascii=False)) > _CONTEXT_LIMIT:
        return {"note": "context 已截断"}
    return clean


def _entry(
    *, level: str, source: str, logger: str, message: str, stack: str | None = None,
    path: str | None = None, method: str | None = None, status: int | None = None,
    duration_ms: int | None = None, request_id: str | None = None,
    user_id: int | None = None, context: dict | None = None,
    created_at: datetime | None = None,
) -> dict:
    return {
        "created_at": created_at or utcnow(),
        "level": (level or "INFO")[:10],
        "source": (source or "backend")[:16],
        "logger": (logger or "")[:120],
        "message": scrub(message, _MESSAGE_LIMIT) or "",
        "stack": scrub(stack, _STACK_LIMIT),
        "path": (path or None) and scrub(str(path), 500),
        "method": (method or None) and str(method)[:10],
        "status": status,
        "duration_ms": duration_ms,
        "request_id": (request_id or request_id_var.get() or None),
        "user_id": user_id if user_id is not None else user_id_var.get(),
        "context": _cap_context(context),
    }


def submit(entry: dict) -> None:
    """把一条已经整理好的日志放入队列。满了就丢弃并记数。"""
    global _dropped
    try:
        _queue.put_nowait(entry)
        _wake.set()
    except queue.Full:
        with _lock:
            _dropped += 1


def submit_client(
    *, level: str, message: str, stack: str | None, route: str | None,
    context: dict | None, user_id: int | None,
) -> None:
    submit(_entry(
        level=level.upper(), source="frontend", logger="browser", message=message,
        stack=stack, path=route, request_id=request_id_var.get(), user_id=user_id,
        context=context,
    ))


def record(
    *, level: str, source: str, logger: str, message: str, stack: str | None = None,
    path: str | None = None, method: str | None = None, status: int | None = None,
    duration_ms: int | None = None, user_id: int | None = None, context: dict | None = None,
) -> None:
    """业务代码直接记录一条结构化日志（不经过 logging）。"""
    submit(_entry(
        level=level, source=source, logger=logger, message=message, stack=stack,
        path=path, method=method, status=status, duration_ms=duration_ms,
        user_id=user_id, context=context,
    ))


class DatabaseLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:  # noqa: D102
        if record.name.startswith("app.services.log_store"):
            return
        try:
            stack = None
            if record.exc_info:
                stack = "".join(traceback.format_exception(*record.exc_info))
            submit(_entry(
                level=record.levelname,
                source=getattr(record, "log_source", "backend"),
                logger=record.name,
                message=record.getMessage(),
                stack=stack,
                path=getattr(record, "path", None),
                method=getattr(record, "method", None),
                status=getattr(record, "status", None),
                duration_ms=getattr(record, "duration_ms", None),
                request_id=getattr(record, "request_id", None) or request_id_var.get(),
                user_id=getattr(record, "user_id", None) if getattr(record, "user_id", None) is not None else user_id_var.get(),
                context=getattr(record, "context", None),
                created_at=datetime.fromtimestamp(record.created, tz=timezone.utc).replace(tzinfo=None),
            ))
        except Exception:
            # 记日志失败不能再走 logging，否则可能递归。
            try:
                sys.stderr.write("workbench log handler failed\n")
            except Exception:
                pass


def _drain(limit: int) -> list[dict]:
    batch: list[dict] = []
    while len(batch) < limit:
        try:
            batch.append(_queue.get_nowait())
        except queue.Empty:
            break
    return batch


def _write(batch: list[dict]) -> None:
    if not batch:
        return
    try:
        with SessionLocal() as db:
            db.execute(insert(AppLog), batch)
            db.commit()
    except Exception as error:  # 数据库故障时保底到 stderr
        try:
            sys.stderr.write(f"workbench log flush failed: {error}\n")
            for entry in batch:
                sys.stderr.write(f"{entry['level']} {entry['logger']}: {entry['message']}\n")
        except Exception:
            pass


def _worker() -> None:
    while not _stop.is_set() or not _queue.empty():
        _wake.wait(0.5)
        _wake.clear()
        batch = _drain(200)
        while batch:
            _write(batch)
            batch = _drain(200)


def flush_now() -> None:
    """同步写完当前队列，供测试和进程退出使用。"""
    batch = _drain(1000)
    while batch:
        _write(batch)
        batch = _drain(1000)


def install() -> None:
    global _thread, _installed
    if _installed:
        return
    _installed = True
    level = _LEVELS.get(settings.log_level.upper(), logging.INFO)
    handler = DatabaseLogHandler(level)
    handler.set_name("workbench-db")
    root = logging.getLogger()
    if root.level > level or root.level == logging.NOTSET:
        root.setLevel(level)
    root.addHandler(handler)
    # uvicorn.error 默认 propagate=False，单独挂一份才能收到启动和异常日志。
    uvicorn_logger = logging.getLogger("uvicorn.error")
    uvicorn_logger.addHandler(handler)
    if uvicorn_logger.level > level or uvicorn_logger.level == logging.NOTSET:
        uvicorn_logger.setLevel(level)
    _thread = threading.Thread(target=_worker, name="workbench-log-writer", daemon=True)
    _thread.start()


def shutdown() -> None:
    _stop.set()
    _wake.set()
    if _thread is not None and _thread.is_alive():
        _thread.join(timeout=3)
    flush_now()


def dropped_count() -> int:
    with _lock:
        return _dropped


def cleanup(db, days: int | None = None) -> int:
    cutoff = utcnow() - timedelta(days=days or settings.log_retention_days)
    return db.execute(delete(AppLog).where(AppLog.created_at < cutoff)).rowcount or 0


atexit.register(shutdown)
