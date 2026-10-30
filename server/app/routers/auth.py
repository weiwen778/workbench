from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import LoginAttempt, User, UserSession, utcnow
from ..security import (
    hash_password,
    new_session_token,
    session_expiry,
    verify_password,
)
from ..utils import iso_z

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class PasswordIn(BaseModel):
    old_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "theme": user.theme,
        "theme_color": user.theme_color,
        "password_changed_at": iso_z(user.password_changed_at),
    }


def _recent_failures(db: Session, username: str, ip: str | None) -> int:
    since = utcnow() - timedelta(seconds=settings.login_lock_seconds)
    return (
        db.scalar(
            select(func.count(LoginAttempt.id)).where(
                LoginAttempt.username == username,
                LoginAttempt.ip == ip,
                LoginAttempt.success.is_(False),
                LoginAttempt.created_at >= since,
            )
        )
        or 0
    )


@router.post("/auth/login")
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else None
    username = payload.username.strip()

    if _recent_failures(db, username, ip) >= settings.login_max_failures:
        raise ApiError(
            "LOGIN_RATE_LIMITED",
            f"连续登录失败次数过多，请 {settings.login_lock_seconds // 60} 分钟后再试",
            429,
        )

    user = db.scalar(select(User).where(User.username == username))
    ok = bool(user) and verify_password(payload.password, user.password_hash)
    db.add(LoginAttempt(username=username, ip=ip, success=ok))
    db.commit()

    if not ok or user is None:
        # 统一提示，不暴露账号是否存在
        raise ApiError("INVALID_CREDENTIALS", "用户名或密码不正确", 401)

    token, token_hash = new_session_token()
    now = utcnow()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=token_hash,
            created_at=now,
            expires_at=session_expiry(now),
            user_agent=(request.headers.get("user-agent") or "")[:255],
            ip=ip,
        )
    )
    db.commit()

    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return {"user": user_payload(user), "expires_at": iso_z(session_expiry(now))}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    sess = getattr(request.state, "session", None)
    if sess is not None:
        sess.revoked_at = utcnow()
        db.commit()
    response.delete_cookie(settings.cookie_name, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return {"user": user_payload(user)}


@router.post("/auth/password")
def change_password(
    payload: PasswordIn,
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.old_password, user.password_hash):
        raise ApiError("OLD_PASSWORD_MISMATCH", "原密码不正确", 400, {"fields": {"old_password": "原密码不正确"}})
    if payload.old_password == payload.new_password:
        raise ApiError("PASSWORD_UNCHANGED", "新密码不能与原密码相同", 400)

    user.password_hash = hash_password(payload.new_password)
    user.password_changed_at = utcnow()
    # 修改密码吊销其他会话，保留当前会话
    current = getattr(request.state, "session", None)
    stmt = update(UserSession).where(
        UserSession.user_id == user.id, UserSession.revoked_at.is_(None)
    )
    if current is not None:
        stmt = stmt.where(UserSession.id != current.id)
    else:
        stmt = stmt.where(UserSession.id == -1)
    db.execute(stmt.values(revoked_at=utcnow()))
    db.commit()
    return {"ok": True}
