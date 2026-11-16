"""GitHub Issue 反馈配置与提交。"""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_admin_user
from ..errors import ApiError
from ..models import AppLog, FeedbackIntegration, FeedbackSubmission, utcnow
from ..services import feedback
from ..utils import iso_z
from .logs import _payload as log_payload

router = APIRouter(tags=["问题反馈"])
logger = logging.getLogger(__name__)


class ConfigIn(BaseModel):
    repo: str | None = Field(default=None, max_length=200)
    token: str | None = Field(default=None, max_length=500)
    labels: list[str] | None = None
    enabled: bool | None = None


class FeedbackIn(BaseModel):
    kind: str = Field(default="bug", pattern="^(bug|feature)$")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=8000)
    include_logs: bool = True
    log_ids: list[int] | None = None
    route: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=1000)
    user_agent: str | None = Field(default=None, max_length=500)
    viewport: str | None = Field(default=None, max_length=50)
    app_version: str | None = Field(default=None, max_length=50)
    request_id: str | None = Field(default=None, max_length=64)


def get_or_create(db: Session) -> FeedbackIntegration:
    config = db.scalar(select(FeedbackIntegration).order_by(FeedbackIntegration.id).limit(1))
    if config is None:
        config = FeedbackIntegration(id=1, labels=[])
        db.add(config)
        db.commit()
    return config


def _snapshot(db: Session, payload: FeedbackIn) -> str | None:
    if not payload.include_logs:
        return None
    query = select(AppLog)
    if payload.log_ids:
        ids = [int(value) for value in payload.log_ids[:50]]
        query = query.where(AppLog.id.in_(ids))
    else:
        query = query.where(
            AppLog.created_at >= utcnow() - timedelta(minutes=30),
            AppLog.level.in_(["ERROR", "CRITICAL"]),
        )
    rows = list(db.scalars(query.order_by(AppLog.id).limit(50)))
    if not rows:
        return None
    lines: list[str] = []
    for row in rows:
        method = f"{row.method or ''} {row.path or ''}".strip()
        head = f"{iso_z(row.created_at)} {row.level} [{row.source}] {method}".strip()
        if row.status:
            head += f" -> {row.status}"
        if row.duration_ms is not None:
            head += f" ({row.duration_ms}ms)"
        if row.request_id:
            head += f" req={row.request_id}"
        lines.append(head)
        lines.append(f"  {row.message}")
        if row.stack:
            lines.extend("  " + line for line in row.stack.strip().splitlines()[:20])
    return "\n".join(lines)[:12_000]


@router.get("/feedback/config")
def read_config(user=Depends(get_admin_user), db: Session = Depends(get_db)):
    return feedback.config_payload(get_or_create(db))


@router.put("/feedback/config")
def update_config(payload: ConfigIn, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    config = get_or_create(db)
    feedback.save_config(
        config, repo=payload.repo, token=payload.token,
        labels=payload.labels, enabled=payload.enabled,
    )
    db.commit()
    return feedback.config_payload(config)


@router.post("/feedback/config/test")
def test_config(user=Depends(get_admin_user), db: Session = Depends(get_db)):
    config = get_or_create(db)
    try:
        ok, message = feedback.test_connection(config)
    except feedback.FeedbackSendError as error:
        ok, message = False, str(error)
    config.last_test_ok = ok
    config.last_test_message = message[:500]
    config.last_tested_at = utcnow()
    db.commit()
    return {"ok": ok, "message": message, **feedback.config_payload(config)}


@router.post("/feedback", status_code=201)
def submit_feedback(payload: FeedbackIn, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    config = get_or_create(db)
    if not config.enabled or not config.repo:
        raise ApiError(
            "FEEDBACK_NOT_CONFIGURED",
            "还没有启用 GitHub 反馈通道，请先在设置中配置仓库和令牌",
            409,
            {"hint": "设置 → 服务与连接 → 问题反馈"},
        )
    environment = {
        key: value for key, value in {
            "submitted_at": iso_z(utcnow()),
            "route": payload.route,
            "url": payload.url,
            "user_agent": payload.user_agent,
            "viewport": payload.viewport,
            "app_version": payload.app_version,
            "request_id": payload.request_id,
        }.items() if value
    }
    submission = FeedbackSubmission(
        user_id=user.id,
        kind=payload.kind,
        title=payload.title.strip(),
        body=payload.body.strip(),
        environment=environment,
        log_snapshot=_snapshot(db, payload),
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    feedback.send_submission(db, submission, config)
    if submission.status == "failed":
        logger.warning("Feedback submission %s failed: %s", submission.id, submission.error)
    else:
        logger.info("Feedback submission %s created GitHub issue %s", submission.id, submission.issue_number)
    return feedback.submission_payload(submission)


@router.get("/feedback")
def list_feedback(
    page: int = Query(1, ge=1),
    user=Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    total = db.scalar(select(func.count()).select_from(FeedbackSubmission)) or 0
    rows = db.scalars(
        select(FeedbackSubmission).order_by(FeedbackSubmission.id.desc()).offset((page - 1) * 20).limit(20)
    )
    return {"items": [feedback.submission_payload(row) for row in rows], "total": total, "page": page}


@router.post("/feedback/{submission_id}/retry")
def retry_feedback(submission_id: int, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    submission = db.get(FeedbackSubmission, submission_id)
    if submission is None:
        raise ApiError("NOT_FOUND", "反馈记录不存在", 404)
    if submission.status == "sent":
        raise ApiError("ALREADY_SENT", "这条反馈已经提交成功", 409)
    config = get_or_create(db)
    feedback.send_submission(db, submission, config)
    return feedback.submission_payload(submission)
