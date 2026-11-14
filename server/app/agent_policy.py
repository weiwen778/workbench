"""Granular Agent permissions layered on top of the existing token scopes."""
from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from sqlalchemy.orm import Session

from .errors import ApiError

DEFAULT_POLICY = {
    'modules': [],
    'tables': [],
    'operations': ['create', 'update', 'delete'],
    'allow_schema': False,
    'allow_files': False,
    'allow_external': False,
    'allow_irreversible': False,
    'max_operations': 100,
    'daily_runs': 1000,
}

MODULE_KEYS = {
    'tables', 'todos', 'notes', 'memos', 'bookmarks', 'dashboards',
    'checkins', 'files', 'preferences', 'trash', 'translation',
}
OPERATION_KEYS = {'create', 'update', 'delete'}
WRITE_MODES = {'review', 'direct'}


def effective_policy(token) -> dict:
    raw = getattr(token, 'policy', None) or {}
    if not isinstance(raw, dict):
        raw = {}
    policy = {**DEFAULT_POLICY, **raw}
    policy['modules'] = [str(item) for item in (raw.get('modules') or []) if str(item) in MODULE_KEYS]
    policy['tables'] = [int(item) for item in (raw.get('tables') or []) if isinstance(item, (int, str)) and str(item).isdigit()]
    policy['operations'] = [str(item) for item in (raw.get('operations') or DEFAULT_POLICY['operations']) if str(item) in OPERATION_KEYS]
    if not policy['operations']:
        policy['operations'] = list(DEFAULT_POLICY['operations'])
    policy['max_operations'] = min(max(int(raw.get('max_operations') or 100), 1), 100)
    policy['daily_runs'] = min(max(int(raw.get('daily_runs') or 1000), 1), 100_000)
    for key in ('allow_schema', 'allow_files', 'allow_external', 'allow_irreversible'):
        policy[key] = bool(raw.get(key, False))
    return policy


def write_mode(token) -> str:
    mode = getattr(token, 'write_mode', None) or 'review'
    return mode if mode in WRITE_MODES else 'review'


def operation_kind(method: str, path: str) -> str:
    method = method.upper()
    clean = urlsplit(path).path
    if method == 'DELETE' or clean.endswith('/batch-delete') or clean.startswith('/trash/') and method == 'DELETE':
        return 'delete'
    if method in {'PUT', 'PATCH'}:
        return 'update'
    if method == 'POST':
        action = clean.rstrip('/').split('/')[-1]
        if action in {
            'complete', 'cancel', 'move', 'reorder', 'undo', 'restore', 'refresh',
            'merge', 'reject', 'confirm', 'preview', 'suggest', 'metadata',
            'purge-expired', 'rotate',
        }:
            return 'update'
    return 'create'


def is_schema(path: str, method: str) -> bool:
    if method.upper() == 'GET':
        return False
    clean = urlsplit(path).path
    root = clean.strip('/').split('/')[0]
    if root == 'fields':
        return True
    if root == 'table-views':
        return True
    if root == 'tables':
        parts = clean.strip('/').split('/')
        # /tables/{id}/records is data; /tables/{id}/fields is schema.
        if len(parts) <= 2:
            return True
        return parts[2] == 'fields'
    return False


def is_files(path: str) -> bool:
    clean = urlsplit(path).path
    parts = clean.strip('/').split('/')
    root = parts[0] if parts else ''
    return (
        root in {'files', 'imports', 'data-transfer-jobs'}
        or clean.endswith('/export-tasks')
        or clean.endswith('/confirm-tasks')
        or any(part in {'export', 'exports', 'import'} for part in parts)
    )


def is_external(path: str) -> bool:
    clean = urlsplit(path).path
    root = clean.strip('/').split('/')[0]
    return root.startswith('translation') or clean.endswith('/metadata')


def table_id_for_path(db: Session | None, path: str) -> int | None:
    clean = urlsplit(path).path
    query = parse_qs(urlsplit(path).query)
    parts = clean.strip('/').split('/')
    if not parts:
        return None
    root = parts[0]
    if root == 'tables':
        return int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
    if root in {'records', 'fields', 'table-views', 'table-changes'} and len(parts) > 1 and parts[1].isdigit():
        if db is None:
            return None
        from .models import DataField, DataRecord, TableChange, TableView
        model = {'records': DataRecord, 'fields': DataField, 'table-views': TableView, 'table-changes': TableChange}[root]
        row = db.get(model, int(parts[1]))
        if row is not None:
            return getattr(row, 'table_id', None)
        return None
    if root == 'table-changes':
        value = (query.get('table_id') or [None])[0]
        return int(value) if value and str(value).isdigit() else None
    return None


def check_policy(token, path: str, write: bool, method: str, db: Session | None = None) -> None:
    """Raise when a token's granular policy does not grant this operation."""
    from .services.agent_staging import module

    policy = effective_policy(token)
    group = module(path)
    if getattr(token, 'policy', None) is None:
        # Tokens issued before granular policies keep their original scope contract.
        return
    if policy['modules'] and group not in policy['modules']:
        raise ApiError('AGENT_POLICY_MODULE', f'此 Agent 没有被授予「{group}」模块的权限', 403)

    if not write:
        return

    kind = operation_kind(method, path)
    if kind not in policy['operations']:
        label = {'create': '新增', 'update': '修改', 'delete': '删除'}[kind]
        raise ApiError('AGENT_POLICY_OPERATION', f'此 Agent 不允许{label}内容', 403)
    if is_schema(path, method) and not policy['allow_schema']:
        raise ApiError('AGENT_POLICY_SCHEMA', '此 Agent 不允许修改表格结构（建表、改列、改视图）', 403)
    if is_files(path) and not policy['allow_files']:
        raise ApiError('AGENT_POLICY_FILES', '此 Agent 不允许上传、导入或导出文件', 403)
    if is_external(path) and not policy['allow_external']:
        raise ApiError('AGENT_POLICY_EXTERNAL', '此 Agent 不允许调用外部服务或读取网址元数据', 403)

    allowed_tables = policy['tables']
    if allowed_tables and group == 'tables' and '{{' not in path:
        table_id = table_id_for_path(db, path)
        if table_id is None or table_id not in allowed_tables:
            raise ApiError('AGENT_POLICY_TABLE', '此 Agent 只能操作指定的表格', 403)
