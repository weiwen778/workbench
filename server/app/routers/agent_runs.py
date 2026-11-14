"""Browser-facing view of direct Agent writes and their undo controls."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import AgentRun, AgentToken, User, utcnow
from ..services.agent_direct import decode_plan, run_payload
from ..services.agent_undo import execute_undo, preflight
from .agent_changes import review_user

router = APIRouter(prefix='/agent-runs', tags=['Agent runs'])


def _run(db: Session, user: User, run_id: int, lock: bool = False) -> tuple[AgentRun, str]:
    stmt = select(AgentRun).where(AgentRun.id == run_id, AgentRun.user_id == user.id)
    run = db.scalar(stmt.with_for_update() if lock else stmt)
    if run is None:
        raise ApiError('NOT_FOUND', '操作记录不存在', 404)
    token = db.get(AgentToken, run.token_id)
    return run, token.name if token else 'Agent'


@router.get('')
def listing(
    status: str = 'all',
    undo_status: str = 'all',
    q: str = Query('', max_length=100),
    page: int = Query(default=1, ge=1),
    user: User = Depends(review_user),
    db: Session = Depends(get_db),
):
    base = select(AgentRun, AgentToken.name).join(AgentToken).where(AgentRun.user_id == user.id)
    if q:
        base = base.where(AgentRun.title.contains(q, autoescape=True) | AgentToken.name.contains(q, autoescape=True))
    if status != 'all':
        if status not in {'applied', 'undone'}:
            raise ApiError('INVALID_STATUS', '状态不合法', 422)
        base = base.where(AgentRun.status == status)
    if undo_status != 'all':
        if undo_status not in {'available', 'undone', 'unsupported', 'failed'}:
            raise ApiError('INVALID_STATUS', '撤销状态不合法', 422)
        base = base.where(AgentRun.undo_status == undo_status)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(base.order_by(AgentRun.id.desc()).offset((page - 1) * 20).limit(20)).all()
    counts = dict(db.execute(
        select(AgentRun.status, func.count()).where(AgentRun.user_id == user.id).group_by(AgentRun.status)
    ).all())
    undo_counts = dict(db.execute(
        select(AgentRun.undo_status, func.count()).where(AgentRun.user_id == user.id).group_by(AgentRun.undo_status)
    ).all())
    return {
        'items': [{k: v for k, v in run_payload(run, name).items() if k not in {'preview', 'results'}} for run, name in rows],
        'total': total, 'page': page, 'counts': counts, 'undo_counts': undo_counts,
    }


@router.get('/{run_id}')
def detail(run_id: int, user: User = Depends(review_user), db: Session = Depends(get_db)):
    run, name = _run(db, user, run_id)
    return run_payload(run, name)


@router.post('/{run_id}/undo')
async def undo(run_id: int, request: Request, user: User = Depends(review_user), db: Session = Depends(get_db)):
    run, name = _run(db, user, run_id)
    if run.status == 'undone':
        return {**run_payload(run, name), 'replayed': True}
    if run.status != 'applied':
        raise ApiError('RUN_NOT_UNDOABLE', '这条操作记录不能撤销', 409)
    plan = decode_plan(run)
    conflicts, unsupported = preflight(db, plan)
    if unsupported:
        raise ApiError('UNDO_UNSUPPORTED', '这次操作包含无法自动撤销的步骤，请手动处理', 409, {'unsupported': unsupported})
    if conflicts:
        raise ApiError('UNDO_CONFLICT', '内容在 Agent 写入后又被修改过，撤销会覆盖新的修改；请先手动核对', 409, {'conflicts': conflicts})
    target_id = run.id
    db.rollback()
    try:
        await execute_undo(request.app, db, target_id, plan, user.id, f'用户撤销 {name}')
    except ApiError as exc:
        _mark_failed(db, target_id, exc.message)
        raise
    except BaseException:
        _mark_failed(db, target_id, '撤销执行失败')
        raise
    fresh = db.get(AgentRun, target_id)
    return run_payload(fresh, name)


def _mark_failed(db: Session, run_id: int, message: str) -> None:
    db.rollback()
    run = db.get(AgentRun, run_id)
    if run is not None:
        run.undo_status = 'failed'
        run.undo_error = message[:1000]
        db.commit()
