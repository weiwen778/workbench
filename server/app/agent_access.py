"""Agent authentication is separate from browser session authentication."""
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .errors import ApiError
from .models import AgentActivity, AgentToken, User, utcnow
from .security import hash_token

SCOPES = {
    'all:read': '读取全部业务数据',
    'all:stage': '全部业务写入（直接生效或先暂存由写入模式决定）',
    'todos:read': '读取待办',
    'todos:write': '添加和修改待办',
    'tables:read': '读取表格',
    'tables:write': '添加和修改表格记录',
}
bearer = HTTPBearer(auto_error=False, scheme_name='AgentToken', description='设置 → Agent 接入中创建的令牌')


def get_agent_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> AgentToken:
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise ApiError('AGENT_UNAUTHENTICATED', '请提供 Authorization: Bearer <令牌>', 401)
    token = db.scalar(select(AgentToken).where(AgentToken.token_hash == hash_token(credentials.credentials)))
    if token is None or token.revoked_at is not None or token.expires_at <= utcnow():
        raise ApiError('AGENT_UNAUTHENTICATED', 'Agent 令牌无效、已撤销或已过期', 401)
    if db.get(User, token.user_id) is None:
        raise ApiError('AGENT_UNAUTHENTICATED', '令牌所属账号不存在', 401)
    request.state.audit_identity=(token.user_id,"Agent: "+token.name)
    token.last_used_at = utcnow()
    db.commit()
    db.info['table_actor_id']=token.user_id
    db.info['table_actor']='Agent: '+token.name
    return token


def require_scope(scope: str):
    def authorize(request: Request, token: AgentToken = Depends(get_agent_token), db: Session = Depends(get_db)):
        if scope not in token.scopes:
            raise ApiError('AGENT_FORBIDDEN', f'此令牌没有 {SCOPES[scope]} 权限', 403)
        # The business endpoint commits this row together with the change.
        # A validation failure or rollback leaves no successful activity entry.
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            db.add(AgentActivity(token_id=token.id, method=request.method, path=request.url.path))
        return token
    return authorize
