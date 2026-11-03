from datetime import timedelta
import secrets
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agent_access import SCOPES
from ..agent_guide import GUIDE
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import AgentActivity, AgentToken, User, utcnow
from ..security import hash_token
from ..utils import iso_z

router = APIRouter(tags=['agent-settings'])


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[Literal['all:read', 'all:stage', 'todos:read', 'todos:write', 'tables:read', 'tables:write']] = Field(min_length=1, max_length=6)
    expires_in_days: int = Field(default=90, ge=1, le=365)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('请填写 Agent 名称')
        return value.strip()


def token_payload(token):
    now = utcnow()
    return {
        'id': token.id, 'name': token.name, 'prefix': token.prefix,
        'scopes': token.scopes, 'created_at': iso_z(token.created_at),
        'expires_at': iso_z(token.expires_at), 'last_used_at': iso_z(token.last_used_at),
        'revoked_at': iso_z(token.revoked_at),
        'status': 'revoked' if token.revoked_at else 'expired' if token.expires_at <= now else 'active',
    }


@router.get('/agent-tokens')
def list_tokens(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tokens = db.scalars(select(AgentToken).where(AgentToken.user_id == user.id).order_by(AgentToken.id.desc())).all()
    return {'items': [token_payload(t) for t in tokens], 'scopes': SCOPES}


@router.post('/agent-tokens', status_code=201)
def create_token(payload: TokenIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = db.scalar(select(func.count()).select_from(AgentToken).where(
        AgentToken.user_id == user.id, AgentToken.revoked_at.is_(None), AgentToken.expires_at > utcnow()))
    if active >= 100:
        raise ApiError('TOO_MANY_TOKENS', '最多保留 100 个有效令牌，请先撤销不用的令牌', 409)
    scopes = set(payload.scopes)
    if 'all:stage' in scopes:
        scopes.add('all:read')
    for module in ('todos', 'tables'):
        if f'{module}:write' in scopes:
            scopes.add(f'{module}:read')
    plaintext = 'wb_agent_' + secrets.token_urlsafe(32)
    token = AgentToken(user_id=user.id, name=payload.name, token_hash=hash_token(plaintext),
                       prefix=plaintext[:16], scopes=sorted(scopes),
                       expires_at=utcnow() + timedelta(days=payload.expires_in_days))
    db.add(token)
    db.commit()
    return {**token_payload(token), 'token': plaintext}


@router.delete('/agent-tokens/{token_id}')
def revoke_token(token_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    token = db.get(AgentToken, token_id)
    if token is None or token.user_id != user.id:
        raise ApiError('NOT_FOUND', '令牌不存在', 404)
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        db.commit()
    return {'ok': True}


@router.get('/agent-activity')
def list_activity(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(AgentActivity, AgentToken.name).join(AgentToken).where(
        AgentToken.user_id == user.id).order_by(AgentActivity.id.desc()).limit(100)).all()
    return {'items': [{'id': a.id, 'agent_name': name, 'method': a.method,
                       'path': a.path, 'created_at': iso_z(a.created_at)} for a, name in rows]}


@router.get('/agent-guide')
def settings_guide(_user: User = Depends(get_current_user)):
    return {'guide': GUIDE}
