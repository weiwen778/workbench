"""Direct (write-first) execution for trusted Agents, with an undo journal."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, time
from types import SimpleNamespace
from urllib.parse import urlsplit

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..agent_runtime import AgentSession
from ..errors import ApiError
from ..models import AgentActivity, AgentChange, AgentRun, AgentToken, utcnow
from ..utils import iso_z
from . import agent_staging as staging
from ..agent_policy import effective_policy, write_mode
from .agent_undo import build_entry, preflight, _snapshot, resource_ref
from .encryption import decrypt_config, encrypt_config


def _logical(operations):
    return [{**op, 'upload': {k: v for k, v in op['upload'].items() if k != 'path'}} if op.get('upload') else op for op in operations]


def _digest(operations):
    return hashlib.sha256(json.dumps(_logical(operations), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _daily_count(db: Session, token_id: int) -> int:
    start = datetime.combine(utcnow().date(), time.min)
    runs = db.scalar(select(func.count()).select_from(AgentRun).where(
        AgentRun.token_id == token_id, AgentRun.created_at >= start,
    )) or 0
    changes = db.scalar(select(func.count()).select_from(AgentChange).where(
        AgentChange.token_id == token_id, AgentChange.created_at >= start,
    )) or 0
    return runs + changes


def enforce_limits(token, db: Session, operation_count: int) -> None:
    policy = effective_policy(token)
    if operation_count > policy['max_operations']:
        raise ApiError('AGENT_TOO_MANY_OPERATIONS', f"此 Agent 单次最多 {policy['max_operations']} 个操作", 409)
    if _daily_count(db, token.id) >= policy['daily_runs']:
        raise ApiError('AGENT_DAILY_LIMIT', f"此 Agent 今天的操作次数已达上限（{policy['daily_runs']}）", 409)


def run_payload(run: AgentRun, name: str | None = None) -> dict:
    return {
        'id': run.id, 'agent_name': name, 'title': run.title, 'status': run.status,
        'undo_status': run.undo_status, 'preview': run.preview, 'results': run.results,
        'error': run.error, 'undo_error': run.undo_error,
        'created_at': iso_z(run.created_at), 'undone_at': iso_z(run.undone_at),
        'operation_count': run.operation_count,
        'message': '已直接写入并记录撤销方案' if run.status == 'applied' else '已撤销' if run.status == 'undone' else '执行失败',
    }


def decode_plan(run: AgentRun) -> list[dict]:
    return decrypt_config(run.plan_cipher)['operations']


def _token_proxy(token: AgentToken) -> SimpleNamespace:
    return SimpleNamespace(
        id=token.id, user_id=token.user_id, name=token.name,
        scopes=list(token.scopes or []), write_mode=token.write_mode,
        policy=dict(token.policy) if isinstance(token.policy, dict) else None,
    )


async def execute(request: Request, token: AgentToken, db: Session, title: str, operations: list[dict], key: str | None = None) -> dict:
    if len(json.dumps(operations, ensure_ascii=False).encode()) > staging.MAX_BYTES:
        raise ApiError('CHANGE_TOO_LARGE', '单次写入内容最多 20 MB', 413)
    if key and len(key) > 128:
        raise ApiError('INVALID_REQUEST_KEY', '幂等键最多 128 个字符', 422)
    proxy = _token_proxy(token)
    policy = effective_policy(proxy)
    enforce_limits(proxy, db, len(operations))

    refs = set()
    for op in operations:
        if op['method'].upper() not in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            raise ApiError('INVALID_CHANGE_METHOD', '只接受新增、修改、删除操作', 422)
        op['path'] = staging.canonical(op['path'])
        staging.authorize(proxy, op['path'], True, op['method'].upper(), db)
        if op.get('ref'):
            if op['ref'] in refs:
                raise ApiError('DUPLICATE_REFERENCE', '同批操作的 ref 不能重复', 422)
            refs.add(op['ref'])

    digest = _digest(operations)
    if key:
        previous = db.scalar(select(AgentRun).where(AgentRun.token_id == proxy.id, AgentRun.request_key == key))
        if previous:
            if previous.payload_hash != digest:
                raise ApiError('REQUEST_KEY_REUSED', '该幂等键已用于另一份内容', 409)
            return _execution_payload(previous, proxy.name, batch=len(operations) > 1)
        staged = db.scalar(select(AgentChange).where(AgentChange.token_id == proxy.id, AgentChange.request_key == key))
        if staged:
            raise ApiError('REQUEST_KEY_REUSED', '该幂等键已用于一份待审核暂存', 409)

    user_id, actor, token_id, name = proxy.user_id, 'Agent: ' + proxy.name, proxy.id, proxy.name
    # Release the request transaction before the direct execution session starts.
    db.expunge(token) if token in db else None
    db.rollback()

    work = AgentSession(bind=db.get_bind(), autoflush=False, expire_on_commit=False)
    try:
        previews: list[dict] = []
        results: dict[str, object] = {}
        plan: list[dict] = []
        result_status = 200

        for i, original in enumerate(operations):
            op = staging.normalize(staging.resolve(original, results))
            staging.authorize(proxy, op['path'], True, op['method'], work)
            if staging.deferred(op) and not policy['allow_irreversible']:
                raise ApiError(
                    'IRREVERSIBLE_OPERATION',
                    '该操作涉及文件、导入导出或外部服务，无法自动撤销；请改用审核模式，或在设置中允许不可撤销操作。',
                    409,
                )
            before_row = _snapshot(work, *resource_ref(op, None)[:2])
            before = staging.before_value(work, op)
            response = await staging.dispatch(request.app, work, user_id, actor, op)
            content_type = response.headers.get('content-type', '')
            if 'json' not in content_type:
                raise ApiError('IRREVERSIBLE_OPERATION', '二进制导出或文件结果不能直接写入，请改用审核模式', 409)
            try:
                after = response.json()
            except ValueError:
                after = {'ok': True, 'content_type': content_type}
            result_status = response.status_code
            results[op.get('ref') or f'op{i}'] = after
            after_row = _snapshot(work, *resource_ref(op, after)[:2])
            preview = {
                'method': op['method'], 'path': op['path'], 'before': before,
                'request': staging.redact(op.get('body')),
                'after': staging.redact(after), 'deferred': staging.deferred(op),
            }
            preview.update(staging.describe(work, op, before, after))
            entry = build_entry(op, before_row, after_row, preview)
            preview['undoable'] = entry['undoable']
            preview['undo_reason'] = entry['reason']
            previews.append(preview)
            plan.append(entry)

        undo_status = 'available' if all(item.get('undoable') and item.get('spec') for item in plan) else 'unsupported'
        display_title = title.strip() or (previews[0]['summary'] if previews else 'Agent 写入')
        run = AgentRun(
            user_id=user_id, token_id=token_id, request_key=key, title=display_title[:200],
            status='applied', undo_status=undo_status,
            operations_cipher=encrypt_config({'operations': operations}),
            plan_cipher=encrypt_config({'operations': plan}),
            payload_hash=digest, preview=previews, results=list(results.values()),
            operation_count=len(plan), result_status=result_status,
        )
        work.add(run)
        work.flush()
        path = urlsplit(operations[0]['path']).path if len(operations) == 1 else '/changes'
        work.add(AgentActivity(token_id=token_id, method=operations[0]['method'].upper(), path=('/api/v1/agent' + path)[:255]))
        Session.commit(work)
        return _execution_payload(run, name, batch=len(operations) > 1, results=list(results.values()), previews=previews)
    except IntegrityError:
        work.rollback()
        previous = db.scalar(select(AgentRun).where(AgentRun.token_id == token_id, AgentRun.request_key == key)) if key else None
        if previous and previous.payload_hash == digest:
            return _execution_payload(previous, name, batch=len(operations) > 1)
        raise ApiError('DIRECT_WRITE_CONFLICT', '直接写入提交冲突，请用同一幂等键查询后重试', 409)
    except BaseException:
        work.rollback()
        raise
    finally:
        work.close()


def _execution_payload(run: AgentRun, name: str, batch: bool, results=None, previews=None) -> dict:
    payload = run_payload(run, name)
    payload.update(
        run_id=run.id, status=run.status, batch=batch,
        results=results if results is not None else run.results,
        preview=previews if previews is not None else run.preview,
        result_status=run.result_status,
    )
    return payload
