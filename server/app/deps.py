from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .errors import ApiError
from .models import User, UserSession, utcnow
from .security import hash_token


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    from .agent_runtime import execution
    context = execution.get()
    if context is not None:
        user = db.get(User, context.user_id)
        if user is None:
            raise ApiError("UNAUTHENTICATED", "账号不存在", 401)
        request.state.user = user
        db.info.update(table_actor_id=user.id, table_actor=context.actor)
        return user
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise ApiError("UNAUTHENTICATED", "请先登录", 401)
    sess = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
        )
    )
    if sess is None:
        raise ApiError("UNAUTHENTICATED", "登录已失效，请重新登录", 401)
    if sess.expires_at <= utcnow():
        raise ApiError("SESSION_EXPIRED", "登录已过期，请重新登录", 401)
    user = db.get(User, sess.user_id)
    if user is None:
        raise ApiError("UNAUTHENTICATED", "请先登录", 401)
    request.state.audit_identity=(user.id,user.username)
    request.state.session = sess
    request.state.user = user
    db.info["table_actor_id"]=user.id
    db.info["table_actor"]=user.username
    return user


def current_session(request: Request) -> UserSession:
    return request.state.session
