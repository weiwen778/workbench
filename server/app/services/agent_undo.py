"""Build and execute inverse operations for direct Agent runs."""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Any
from urllib.parse import urlsplit

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Base
from ..errors import ApiError
from ..models import AgentActivity, AgentRun, TrashEntry, utcnow
from ..agent_runtime import AgentSession

ROOT_MODEL = {
    'records': ('data_records', 'record'),
    'fields': ('data_fields', None),
    'table-views': ('table_views', None),
    'todos': ('todos', 'todo'),
    'todo-lists': ('todo_lists', 'todo_list'),
    'notes': ('notes', 'note'),
    'memos': ('memos', 'memo'),
    'bookmarks': ('bookmarks', 'bookmark'),
    'dashboards': ('dashboards', 'dashboard'),
    'tables': ('data_tables', 'table'),
}

TRASH_KINDS = {'record', 'todo', 'todo_list', 'note', 'memo', 'table'}
ACTION_SUFFIXES = {'complete', 'cancel', 'move', 'reorder'}

# Only these fields are mutable through the public API.  Restricting the
# inverse operation to fields the Agent actually changed keeps later user
# edits to unrelated fields intact.
UPDATE_FIELDS = {
    'todos': ('title', 'note', 'due_date', 'due_time'),
    'todo-lists': ('name', 'sort_mode'),
    'notes': ('title', 'content', 'folder_id', 'tags'),
    'memos': ('title', 'content', 'category', 'color'),
    'tables': ('name', 'note', 'sort_order'),
    'fields': ('name', 'type', 'required', 'default_value', 'options', 'config', 'sort_order'),
    'table-views': ('name', 'kind', 'config'),
    'bookmarks': ('url', 'title', 'category', 'icon_url', 'description'),
    'dashboards': ('name', 'widgets'),
}

CLEAR_UNSUPPORTED = {
    'todos': ('note',),
    'memos': ('title', 'category'),
    'tables': ('note',),
    'fields': ('default_value', 'options', 'config'),
}

FIELD_LABELS = {
    'title': '标题', 'note': '备注', 'content': '正文', 'name': '名称',
    'due_date': '截止日期', 'due_time': '截止时间', 'list_id': '所属清单',
    'folder_id': '文件夹', 'tags': '标签', 'category': '分类', 'color': '颜色',
    'sort_mode': '排序方式', 'sort_order': '排序', 'required': '必填',
    'default_value': '默认值', 'options': '选项', 'config': '配置',
    'kind': '类型', 'config': '配置', 'url': '网址', 'icon_url': '图标',
    'description': '描述', 'widgets': '组件', 'data': '内容',
}


class _Unsupported(Exception):
    """Raised when a changed value cannot be restored through the public API."""


def _iso(value: Any) -> Any:
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    return value


def _snapshot(db: Session, root: str, entity_id: int | None) -> dict | None:
    if entity_id is None or root not in ROOT_MODEL:
        return None
    table_name, _kind = ROOT_MODEL[root]
    table = Base.metadata.tables.get(table_name)
    if table is None:
        return None
    row = db.execute(select(table).where(table.c.id == entity_id)).first()
    if not row:
        return None
    value = jsonable_encoder(dict(row._mapping))
    if root == 'notes':
        from ..models import NoteTag, NoteTagLink
        value['tags'] = list(db.scalars(
            select(NoteTag.name).join(NoteTagLink, NoteTagLink.tag_id == NoteTag.id).where(NoteTagLink.note_id == entity_id)
        ).all())
    return value


def _version(row: dict | None) -> int | None:
    if not row:
        return None
    value = row.get('version')
    return int(value) if isinstance(value, int) else None


def _same_version(current: dict | None, after: dict | None) -> bool:
    if current is None or after is None:
        return False
    current_version, after_version = _version(current), _version(after)
    if current_version is not None and after_version is not None:
        return current_version == after_version
    current_updated, after_updated = current.get('updated_at'), after.get('updated_at')
    if current_updated is not None and after_updated is not None:
        return current_updated == after_updated
    return True


def _same_content(current: dict | None, after: dict | None) -> bool:
    """Compare business fields, ignoring bookkeeping versions/timestamps."""
    if current is None or after is None:
        return False
    ignored = {'id', 'version', 'created_at', 'updated_at', 'deleted_at'}
    keys = (set(current) | set(after)) - ignored
    for key in keys:
        if key in current or key in after:
            if current.get(key) != after.get(key):
                return False
    return True


def _id_from_path(path: str) -> int | None:
    parts = urlsplit(path).path.strip('/').split('/')
    if len(parts) > 1 and parts[1].isdigit():
        return int(parts[1])
    return None


def _nested_root(segment: str) -> str | None:
    return {'records': 'records', 'fields': 'fields', 'views': 'table-views'}.get(segment)


def resource_ref(operation: dict, after: dict | None) -> tuple[str | None, int | None, bool]:
    """Return (root, id, is_action) for the resource touched by an operation."""
    method = operation['method'].upper()
    parts = urlsplit(operation['path']).path.strip('/').split('/')
    root = parts[0] if parts else None
    is_action = len(parts) > 2 and parts[-1] in ACTION_SUFFIXES

    if method == 'POST' and not is_action:
        if len(parts) == 1:
            created_root = root
        elif len(parts) == 3 and parts[0] == 'tables':
            created_root = _nested_root(parts[2])
        else:
            created_root = None
        entity_id = (after or {}).get('id') if isinstance(after, dict) else None
        return created_root, int(entity_id) if isinstance(entity_id, int) else None, False

    # Nested resources can be addressed directly or under /tables/{id}/....
    if len(parts) >= 4 and parts[0] == 'tables' and _nested_root(parts[2]):
        return _nested_root(parts[2]), int(parts[3]), False

    entity_id = _id_from_path(operation['path'])
    if method == 'POST' and len(parts) == 3 and parts[2] in {'records', 'fields'}:
        root = parts[2]
    return root, entity_id, is_action


def _changed_fields(root: str, before: dict, after: dict) -> list[str]:
    if root == 'records':
        before_data = before.get('data') or {}
        after_data = after.get('data') or {}
        keys = set(before_data) | set(after_data)
        return sorted(key for key in keys if before_data.get(key) != after_data.get(key))
    return [field for field in UPDATE_FIELDS.get(root, ()) if before.get(field) != after.get(field)]


def _clear_blocker(root: str, before: dict, after: dict, changed: list[str]) -> str | None:
    for field in changed:
        if field not in CLEAR_UNSUPPORTED.get(root, ()):
            continue
        if before.get(field) is None and after.get(field) is not None:
            label = FIELD_LABELS.get(field, field)
            return f"{label}原本为空，接口无法把它恢复为空，暂不支持自动撤销"
    return None


def _changed_conflict(root: str, before: dict, after: dict, current: dict, changed: list[str]) -> str | None:
    if root == 'records':
        current_data = current.get('data') or {}
        after_data = after.get('data') or {}
        bad = [key for key in changed if current_data.get(key) != after_data.get(key)]
    else:
        bad = [field for field in changed if current.get(field) != after.get(field)]
    if bad:
        labels = [FIELD_LABELS.get(field, field) for field in bad]
        return '这些字段在 Agent 写入后又被修改过：' + '、'.join(labels)
    return None


def _build_update(root: str, entity_id: int, before: dict, after: dict, current: dict, changed: list[str]) -> dict:
    current_version = current.get('version')
    if root == 'records':
        target = dict(current.get('data') or {})
        before_data = before.get('data') or {}
        for key in changed:
            if key in before_data:
                target[key] = before_data[key]
            else:
                target.pop(key, None)
        return {
            'method': 'PATCH', 'path': f'/records/{entity_id}',
            'body': {'version': current_version, 'data': target},
        }
    if root == 'todos':
        body: dict[str, Any] = {'version': current_version}
        for field in changed:
            if field == 'due_date':
                if before.get('due_date') is None:
                    body['clear_due'] = True
                else:
                    body['due_date'] = before.get('due_date')
            elif field == 'due_time':
                body['due_time'] = before.get('due_time') or ''
            else:
                body[field] = before.get(field)
        return {'method': 'PATCH', 'path': f'/todos/{entity_id}', 'body': body}
    if root == 'todo-lists':
        return {
            'method': 'PATCH', 'path': f'/todo-lists/{entity_id}',
            'body': {field: before.get(field) for field in changed},
        }
    if root == 'notes':
        body = {'version': current_version, 'mode': 'manual'}
        for field in changed:
            body[field] = before.get(field)
        return {'method': 'PUT', 'path': f'/notes/{entity_id}', 'body': body}
    if root == 'memos':
        body = {'version': current_version}
        for field in changed:
            body[field] = before.get(field)
        return {'method': 'PATCH', 'path': f'/memos/{entity_id}', 'body': body}
    if root == 'tables':
        return {
            'method': 'PATCH', 'path': f'/tables/{entity_id}',
            'body': {field: before.get(field) for field in changed},
        }
    if root == 'fields':
        return {
            'method': 'PATCH', 'path': f'/fields/{entity_id}',
            'body': {field: before.get(field) for field in changed},
        }
    if root == 'table-views':
        body = {
            'name': current.get('name'), 'kind': current.get('kind'),
            'config': current.get('config') or {}, 'version': current_version,
        }
        for field in changed:
            body[field] = before.get(field) if field != 'config' else (before.get('config') or {})
        return {'method': 'PUT', 'path': f'/table-views/{entity_id}', 'body': body}
    if root == 'bookmarks':
        body = {
            'url': current.get('url'), 'title': current.get('title') or '',
            'category': current.get('category') or '', 'icon_url': current.get('icon_url') or '',
            'description': current.get('description') or '',
        }
        for field in changed:
            body[field] = before.get(field) or ''
        return {'method': 'PUT', 'path': f'/bookmarks/{entity_id}', 'body': body}
    if root == 'dashboards':
        body = {
            'name': current.get('name'), 'widgets': current.get('widgets') or [],
            'version': current_version,
        }
        for field in changed:
            body[field] = before.get(field) if field != 'widgets' else (before.get('widgets') or [])
        return {'method': 'PUT', 'path': f'/dashboards/{entity_id}', 'body': body}
    raise _Unsupported('该类型暂不支持自动撤销')


def _create_delete_spec(root: str, entity_id: int, after: dict) -> dict | None:
    if root == 'records':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/records/{entity_id}'}
    if root == 'todos':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/todos/{entity_id}'}
    if root == 'todo-lists':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/todo-lists/{entity_id}'}
    if root == 'notes':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/notes/{entity_id}'}
    if root == 'memos':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/memos/{entity_id}'}
    if root == 'bookmarks':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/bookmarks/{entity_id}'}
    if root == 'dashboards':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/dashboards/{entity_id}?version={after.get("version")}'}
    if root == 'tables':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/tables/{entity_id}'}
    if root == 'fields':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/fields/{entity_id}?confirm=true'}
    if root == 'table-views':
        return {'kind': 'call', 'method': 'DELETE', 'path': f'/table-views/{entity_id}'}
    return None


def _delete_restore_spec(root: str, entity_id: int, before: dict) -> dict | None:
    kind = ROOT_MODEL.get(root, (None, None))[1]
    if kind in TRASH_KINDS:
        return {'kind': 'trash_restore', 'trash_kind': kind, 'entity_id': entity_id}
    if root == 'bookmarks':
        return {'kind': 'call', 'method': 'POST', 'path': '/bookmarks', 'body': {
            'url': before.get('url'), 'title': before.get('title') or '',
            'category': before.get('category') or '', 'icon_url': before.get('icon_url') or '',
            'description': before.get('description') or '',
        }, 'recreate': True}
    if root == 'table-views':
        return {'kind': 'call', 'method': 'POST', 'path': f"/tables/{before.get('table_id')}/views", 'body': {
            'name': before.get('name'), 'kind': before.get('kind') or 'grid',
            'config': before.get('config') or {},
        }, 'recreate': True}
    if root == 'dashboards':
        return {'kind': 'dashboard_restore', 'name': before.get('name'), 'widgets': before.get('widgets') or []}
    return None


def build_entry(operation: dict, before: dict | None, after: dict | None, preview: dict) -> dict:
    root, entity_id, is_action = resource_ref(operation, after)
    entry = {
        'method': operation['method'],
        'path': operation['path'],
        'summary': preview.get('summary'),
        'before': before,
        'after': after,
        'undoable': False,
        'reason': None,
        'spec': None,
    }

    # Batch deletion is one HTTP call but several restore-able trash entries.
    path = urlsplit(operation['path']).path.rstrip('/')
    if operation['method'] == 'POST' and path.endswith('/records/batch-delete'):
        ids = (operation.get('body') or {}).get('ids') or []
        if ids:
            entry.update(undoable=True, spec={
                'kind': 'trash_batch',
                'items': [{'trash_kind': 'record', 'entity_id': int(item)} for item in ids],
            })
        else:
            entry['reason'] = '没有可恢复的删除记录'
        return entry

    if root not in ROOT_MODEL:
        entry['reason'] = '该类型暂不支持自动撤销'
        return entry
    if is_action:
        if root == 'todos' and entity_id and operation['path'].rstrip('/').endswith(('/complete', '/cancel')):
            before_completed = bool((before or {}).get('completed_at'))
            if operation['path'].rstrip('/').endswith('/complete'):
                entry['spec'] = {'kind': 'noop'} if before_completed else {'kind': 'call', 'method': 'POST', 'path': f'/todos/{entity_id}/cancel'}
            else:
                entry['spec'] = {'kind': 'noop'} if not before_completed else {'kind': 'call', 'method': 'POST', 'path': f'/todos/{entity_id}/complete'}
            entry['undoable'] = True
            return entry
        if root == 'todos' and entity_id and operation['path'].rstrip('/').endswith('/move'):
            if before and before.get('list_id') is not None:
                entry['spec'] = {'kind': 'call', 'method': 'POST', 'path': f'/todos/{entity_id}/move', 'body': {'list_id': before['list_id']}}
                entry['undoable'] = True
                return entry
        entry['reason'] = '该操作暂不支持自动撤销'
        return entry
    if operation['method'] == 'POST':
        spec = _create_delete_spec(root, entity_id, after or {}) if entity_id else None
        if spec:
            entry.update(undoable=True, spec=spec)
        else:
            entry['reason'] = '无法确定新建内容的标识，暂不支持自动撤销'
        return entry
    if operation['method'] in {'PUT', 'PATCH'}:
        changed = _changed_fields(root, before or {}, after or {})
        if not changed:
            entry.update(undoable=True, spec={'kind': 'noop'})
            return entry
        reason = _clear_blocker(root, before or {}, after or {}, changed)
        if reason:
            entry['reason'] = reason
            return entry
        if not entity_id:
            entry['reason'] = '无法确定修改内容的标识，暂不支持自动撤销'
            return entry
        entry.update(undoable=True, spec={
            'kind': 'update', 'root': root, 'entity_id': entity_id, 'fields': changed,
        })
        return entry
    if operation['method'] == 'DELETE':
        spec = _delete_restore_spec(root, entity_id, before or {}) if entity_id and before else None
        if spec:
            entry.update(undoable=True, spec=spec)
        else:
            entry['reason'] = '该删除无法从回收站恢复，暂不支持自动撤销'
        return entry
    entry['reason'] = '该操作暂不支持自动撤销'
    return entry


def _prepare_update(db: Session, entry: dict) -> str | None:
    spec = entry['spec']
    root, entity_id = spec['root'], spec['entity_id']
    before, after = entry.get('before') or {}, entry.get('after') or {}
    current = _snapshot(db, root, entity_id)
    if current is None or current.get('deleted_at') is not None:
        return '内容已被删除，无法恢复到修改前'
    changed = spec['fields']
    conflict = _changed_conflict(root, before, after, current, changed)
    if conflict:
        return conflict
    call = _build_update(root, entity_id, before, after, current, changed)
    entry['spec'] = {'kind': 'call', **call}
    return None


def _current_conflict(db: Session, entry: dict) -> str | None:
    spec = entry.get('spec') or {}
    kind = spec.get('kind')
    if kind == 'noop':
        return None
    if kind == 'update':
        return _prepare_update(db, entry)
    if kind == 'dashboard_restore':
        return None
    if kind == 'trash_batch':
        for item in spec.get('items', []):
            row = db.scalar(select(TrashEntry).where(
                TrashEntry.kind == item['trash_kind'],
                TrashEntry.entity_id == item['entity_id'],
                TrashEntry.restored_at.is_(None),
                TrashEntry.purged_at.is_(None),
            ).order_by(TrashEntry.id.desc()))
            if row is None:
                return f"回收站中找不到记录 #{item['entity_id']}，无法恢复"
        return None

    root, entity_id, _ = resource_ref(entry, entry.get('after'))
    if root not in ROOT_MODEL:
        return '该类型暂不支持自动撤销'
    current = _snapshot(db, root, entity_id)
    after = entry.get('after')
    method = entry['method']

    if method == 'POST':
        if current is None or current.get('deleted_at') is not None:
            entry['spec'] = {'kind': 'noop'}
            return None  # Already deleted by the user; nothing left to undo.
        if not _same_content(current, after):
            return 'Agent 新建的内容之后又被修改过，不能直接撤销'
        return None
    if method in {'PUT', 'PATCH'}:
        if current is None:
            return '内容已被删除，无法恢复到修改前'
        if not _same_version(current, after):
            return '内容在 Agent 修改后又被改过，撤销会覆盖新的修改'
        return None
    if method == 'DELETE':
        if spec.get('kind') == 'trash_restore':
            if current is not None and current.get('deleted_at') is None:
                entry['spec'] = {'kind': 'noop'}
                return None  # Already restored.
            row = db.scalar(select(TrashEntry).where(
                TrashEntry.kind == spec['trash_kind'],
                TrashEntry.entity_id == spec['entity_id'],
                TrashEntry.restored_at.is_(None),
                TrashEntry.purged_at.is_(None),
            ).order_by(TrashEntry.id.desc()))
            if row is None:
                return '回收站记录已不存在或已过期，无法恢复'
            return None
        if root == 'table-views' and current is not None:
            entry['spec'] = {'kind': 'noop'}
            return None  # Recreated already.
        if root == 'bookmarks':
            return None
        return None
    # Action endpoints: compare the state that the action changed.
    if root == 'todos' and entity_id:
        if entry['path'].rstrip('/').endswith(('/complete', '/cancel')):
            if current is None:
                return '待办已不存在'
            if bool(current.get('completed_at')) != bool((after or {}).get('completed_at')):
                return '待办完成状态之后又被改过，不能覆盖'
        if entry['path'].rstrip('/').endswith('/move'):
            if current is None:
                return '待办已不存在'
            if current.get('list_id') != (after or {}).get('list_id'):
                return '待办之后又被移动过，不能覆盖'
    return None


def preflight(db: Session, plan: list[dict]) -> tuple[list[dict], list[str]]:
    conflicts: list[str] = []
    unsupported: list[str] = []
    for entry in plan:
        if not entry.get('undoable') or not entry.get('spec'):
            unsupported.append(entry.get('reason') or '该操作暂不支持自动撤销')
            continue
        try:
            conflict = _current_conflict(db, entry)
        except _Unsupported as exc:
            unsupported.append(str(exc))
            continue
        if conflict:
            conflicts.append(f"{entry.get('summary') or entry.get('path')}: {conflict}")
    return conflicts, unsupported


async def execute_undo(app, db: Session, run_id: int, plan: list[dict], user_id: int, actor: str) -> None:
    from . import agent_staging as staging

    with AgentSession(bind=db.get_bind(), autoflush=False, expire_on_commit=False) as work:
        try:
            for entry in reversed(plan):
                spec = entry.get('spec') or {}
                kind = spec.get('kind')
                if kind == 'noop':
                    continue
                if kind == 'trash_restore':
                    await staging.dispatch(app, work, user_id, actor, {
                        'method': 'POST',
                        'path': f"/trash/{spec['trash_kind']}/{spec['entity_id']}/restore",
                        'body': None,
                    })
                    continue
                if kind == 'trash_batch':
                    for item in spec.get('items', []):
                        await staging.dispatch(app, work, user_id, actor, {
                            'method': 'POST',
                            'path': f"/trash/{item['trash_kind']}/{item['entity_id']}/restore",
                            'body': None,
                        })
                    continue
                if kind == 'dashboard_restore':
                    created = await staging.dispatch(app, work, user_id, actor, {
                        'method': 'POST', 'path': '/dashboards', 'body': {'name': spec.get('name')},
                    })
                    new_id = created.json().get('id')
                    await staging.dispatch(app, work, user_id, actor, {
                        'method': 'PUT', 'path': f'/dashboards/{new_id}',
                        'body': {'name': spec.get('name'), 'widgets': spec.get('widgets') or [], 'version': 1},
                    })
                    continue
                if kind == 'call':
                    await staging.dispatch(app, work, user_id, actor, {
                        'method': spec['method'], 'path': spec['path'], 'body': spec.get('body'),
                    })
                    continue
                raise ApiError('UNDO_UNSUPPORTED', entry.get('reason') or '该操作暂不支持自动撤销', 409)
            row = work.scalar(select(AgentRun).where(AgentRun.id == run_id).with_for_update())
            if row is None:
                raise ApiError('NOT_FOUND', '操作记录不存在', 404)
            row.status = 'undone'
            row.undo_status = 'undone'
            row.undo_error = None
            row.undone_at = utcnow()
            row.undone_by = user_id
            work.add(AgentActivity(token_id=row.token_id, method='UNDO', path=f'/api/v1/agent-runs/{row.id}/undo'))
            Session.commit(work)
        except BaseException:
            work.rollback()
            raise
