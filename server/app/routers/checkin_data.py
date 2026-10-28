"""Password-confirmed reset of the entire check-in module."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import (ActivityInterval, CheckinGroup, CheckinInstance, CheckinRule,
                      CheckinRuleVersion, LoginAttempt, User, WorkTarget, utcnow)
from ..security import verify_password

router = APIRouter(tags=["checkin-data"], dependencies=[Depends(get_current_user)])

# Delete children before their parents; all changes commit in one transaction.
TABLES = {
    "instances": CheckinInstance,
    "rule_versions": CheckinRuleVersion,
    "rules": CheckinRule,
    "activity_intervals": ActivityInterval,
    "targets": WorkTarget,
    "groups": CheckinGroup,
}


class ClearCheckinIn(BaseModel):
    password: SecretStr = Field(min_length=1, max_length=200)
    confirmation: Literal["删除全部打卡内容"]


@router.get("/checkin-data/summary")
def summary(db: Session = Depends(get_db)):
    counts = {name: db.scalar(select(func.count()).select_from(model)) or 0
              for name, model in TABLES.items()}
    counts["shops"] = db.scalar(select(func.count()).select_from(WorkTarget).where(WorkTarget.kind == "shop")) or 0
    counts["social_accounts"] = db.scalar(select(func.count()).select_from(WorkTarget).where(WorkTarget.kind == "social")) or 0
    return counts


@router.post("/checkin-data/clear")
def clear_checkin_data(payload: ClearCheckinIn, request: Request,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # A separate attempt namespace avoids mixing reset verification with login attempts.
    identity = f"checkin-clear:{user.id}"
    since = utcnow() - timedelta(seconds=settings.login_lock_seconds)
    failures = db.scalar(select(func.count(LoginAttempt.id)).where(
        LoginAttempt.username == identity,
        LoginAttempt.success.is_(False), LoginAttempt.created_at >= since,
    )) or 0
    if failures >= settings.login_max_failures:
        raise ApiError("PASSWORD_RATE_LIMITED", f"密码错误次数过多，请 {settings.login_lock_seconds // 60} 分钟后再试", 429)
    valid = verify_password(payload.password.get_secret_value(), user.password_hash)
    db.add(LoginAttempt(username=identity, ip=request.client.host if request.client else None, success=valid))
    if not valid:
        db.commit()
        raise ApiError("PASSWORD_MISMATCH", "当前登录密码不正确，未删除任何打卡内容", 403)
    deleted = {}
    for name, model in TABLES.items():
        deleted[name] = db.execute(delete(model).execution_options(synchronize_session=False)).rowcount
    db.commit()
    return {"ok": True, "deleted": deleted}
