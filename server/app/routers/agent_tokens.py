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


class PolicyIn(BaseModel):
    modules: list[Literal['tables', 'todos', 'notes', 'memos', 'bookmarks', 'dashboards', 'checkins', 'files', 'preferences', 'trash', 'translation']] = Field(default_factory=list, max_length=11)
    tables: list[int] = Field(default_factory=list, max_length=100)
    operations: list[Literal['create', 'update', 'delete']] = Field(default_factory=lambda: ['create', 'update', 'delete'], min_length=1, max_length=3)
    allow_schema: bool = False
    allow_files: bool = False
    allow_external: bool = False
    allow_irreversible: bool = False
    max_operations: int = Field(default=100, ge=1, le=100)
    daily_runs: int = Field(default=1000, ge=1, le=100000)


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[Literal['all:read', 'all:stage', 'todos:read', 'todos:write', 'tables:read', 'tables:write']] = Field(min_length=1, max_length=6)
    expires_in_days: int = Field(default=90, ge=1, le=365)
    write_mode: Literal['review', 'direct'] = 'review'
    policy: PolicyIn | None = None

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('请填写 Agent 名称')
        return value.strip()


class TokenPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    write_mode: Literal['review', 'direct'] | None = None
    policy: PolicyIn | None = None

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError('请填写 Agent 名称')
        return value.strip() if value is not None else value


def token_payload(token):
    now = utcnow()
    from ..agent_policy import effective_policy
    show_policy = token.policy is not None or (token.write_mode or 'review') == 'direct'
    return {
        'id': token.id, 'name': token.name, 'prefix': token.prefix,
        'scopes': token.scopes, 'created_at': iso_z(token.created_at),
        'expires_at': iso_z(token.expires_at), 'last_used_at': iso_z(token.last_used_at),
        'revoked_at': iso_z(token.revoked_at),
        'write_mode': token.write_mode or 'review',
        'policy': effective_policy(token) if show_policy else None,
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
                       write_mode=payload.write_mode,
                       policy=payload.policy.model_dump() if payload.policy else None,
                       expires_at=utcnow() + timedelta(days=payload.expires_in_days))
    db.add(token)
    db.commit()
    return {**token_payload(token), 'token': plaintext}


@router.patch('/agent-tokens/{token_id}')
def update_token(token_id: int, payload: TokenPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    token = db.get(AgentToken, token_id)
    if token is None or token.user_id != user.id:
        raise ApiError('NOT_FOUND', '令牌不存在', 404)
    if token.revoked_at is not None:
        raise ApiError('TOKEN_REVOKED', '已撤销的令牌不能修改', 409)
    if payload.name is not None:
        token.name = payload.name
    if payload.write_mode is not None:
        token.write_mode = payload.write_mode
    if payload.policy is not None:
        token.policy = payload.policy.model_dump()
    db.commit()
    return token_payload(token)



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
