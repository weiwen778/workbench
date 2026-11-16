"""运行日志查询、导出与浏览器日志上报。"""

from __future__ import annotations

import csv
import io
import json
import threading
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_admin_user, get_current_user
from ..errors import ApiError
from ..models import AppLog, utcnow
from ..services import log_store
from ..utils import iso_z

router = APIRouter(tags=["运行日志"])

_LEVELS = {"debug", "info", "warning", "error", "critical"}
_SOURCES = {"backend", "request", "job", "frontend"}
_rate_lock = threading.Lock()
_rate: dict[int, tuple[datetime, int]] = {}


class ClientLogIn(BaseModel):
    level: str = Field(default="error", max_length=20)
    message: str = Field(min_length=1, max_length=4000)
    stack: str | None = Field(default=None, max_length=12000)
    route: str | None = Field(default=None, max_length=500)
    context: dict | None = None


def _payload(row: AppLog) -> dict:
    return {
        "id": row.id,
        "created_at": iso_z(row.created_at),
        "level": row.level,
        "source": row.source,
        "logger": row.logger,
        "message": row.message,
        "stack": row.stack,
        "path": row.path,
        "method": row.method,
        "status": row.status,
        "duration_ms": row.duration_ms,
        "request_id": row.request_id,
        "user_id": row.user_id,
        "context": row.context,
    }


def _filtered(
    *, level: str | None, source: str | None, q: str | None, request_id: str | None,
    since: datetime | None, until: datetime | None, after_id: int | None,
):
    query = select(AppLog)
    if level:
        if level.lower() not in _LEVELS:
            raise ApiError("INVALID_LEVEL", "日志级别不合法", 422)
        query = query.where(AppLog.level == level.upper())
    if source:
        if source not in _SOURCES:
            raise ApiError("INVALID_SOURCE", "日志来源不合法", 422)
        query = query.where(AppLog.source == source)
    if request_id:
        query = query.where(AppLog.request_id == request_id[:64])
    if since:
        query = query.where(AppLog.created_at >= since.replace(tzinfo=None))
    if until:
        query = query.where(AppLog.created_at <= until.replace(tzinfo=None))
    if after_id:
        query = query.where(AppLog.id > after_id)
    keyword = (q or "").strip()
    if keyword:
        query = query.where(or_(
            AppLog.message.icontains(keyword, autoescape=True),
            AppLog.path.icontains(keyword, autoescape=True),
            AppLog.logger.icontains(keyword, autoescape=True),
        ))
    return query


@router.post("/logs/client", status_code=202)
def client_log(
    payload: ClientLogIn,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    level = payload.level.lower() if payload.level.lower() in _LEVELS else "error"
    now = utcnow()
    with _rate_lock:
        started, count = _rate.get(user.id, (now, 0))
        if now - started > timedelta(minutes=1):
            started, count = now, 0
        count += 1
        _rate[user.id] = (started, count)
    if count > settings.log_client_per_minute:
        return {"accepted": False, "reason": "rate_limited"}
    log_store.submit_client(
        level=level,
        message=payload.message,
        stack=payload.stack,
        route=payload.route,
        context=payload.context,
        user_id=user.id,
    )
    return {"accepted": True}


@router.get("/logs/summary")
def log_summary(user=Depends(get_admin_user), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(hours=24)
    counts = dict(db.execute(
        select(AppLog.level, func.count()).where(AppLog.created_at >= since).group_by(AppLog.level)
    ).all())
    return {
        "hours": 24,
        "counts": {key.lower(): value for key, value in counts.items()},
        "total": sum(counts.values()),
        "dropped": log_store.dropped_count(),
        "retention_days": settings.log_retention_days,
    }


@router.get("/logs/export")
def export_logs(
    format: str = Query("csv", pattern="^(csv|json)$"),
    level: str | None = None,
    source: str | None = None,
    q: str | None = Query(None, max_length=200),
    request_id: str | None = Query(None, max_length=64),
    since: datetime | None = Query(None, alias="from"),
    until: datetime | None = Query(None, alias="to"),
    user=Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    query = _filtered(level=level, source=source, q=q, request_id=request_id, since=since, until=until, after_id=None)
    rows = list(db.scalars(query.order_by(AppLog.id.desc()).limit(settings.log_export_limit)))
    items = [_payload(row) for row in rows]
    stamp = utcnow().strftime("%Y%m%d-%H%M%S")
    if format == "json":
        content = json.dumps(items, ensure_ascii=False, indent=1)
        return Response(
            content=content,
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="workbench-logs-{stamp}.json"'},
        )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["时间", "级别", "来源", "记录器", "请求", "状态码", "耗时ms", "请求ID", "消息", "堆栈"])
    for item in items:
        writer.writerow([
            item["created_at"], item["level"], item["source"], item["logger"],
            f"{item['method'] or ''} {item['path'] or ''}".strip(), item["status"] or "",
            item["duration_ms"] or "", item["request_id"] or "", item["message"] or "",
            item["stack"] or "",
        ])
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="workbench-logs-{stamp}.csv"'},
    )


@router.get("/logs")
def list_logs(
    level: str | None = None,
    source: str | None = None,
    q: str | None = Query(None, max_length=200),
    request_id: str | None = Query(None, max_length=64),
    since: datetime | None = Query(None, alias="from"),
    until: datetime | None = Query(None, alias="to"),
    after_id: int | None = Query(None, ge=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    user=Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    query = _filtered(level=level, source=source, q=q, request_id=request_id, since=since, until=until, after_id=after_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(AppLog.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {
        "items": [_payload(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "dropped": log_store.dropped_count(),
    }


@router.get("/logs/{log_id}")
def log_detail(log_id: int, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    row = db.get(AppLog, log_id)
    if row is None:
        raise ApiError("NOT_FOUND", "日志不存在", 404)
    return _payload(row)


@router.delete("/logs")
def clear_logs(
    before: datetime | None = None,
    user=Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    query = delete(AppLog)
    if before is not None:
        query = query.where(AppLog.created_at < before.replace(tzinfo=None))
    removed = db.execute(query).rowcount or 0
    db.commit()
    return {"removed": removed}
