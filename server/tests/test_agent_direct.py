from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AgentRun, DataRecord, Todo, TodoList, TrashEntry


def direct(auth, policy=None, scopes=None):
    payload = {
        'name': '接管 Agent',
        'scopes': scopes or ['all:read', 'all:stage'],
        'write_mode': 'direct',
        'policy': policy if policy is not None else {
            'modules': [], 'tables': [], 'operations': ['create', 'update', 'delete'],
            'allow_schema': True, 'allow_files': True, 'allow_external': True,
            'allow_irreversible': True, 'max_operations': 100, 'daily_runs': 1000,
        },
    }
    response = auth.post('/api/v1/agent-tokens', json=payload)
    assert response.status_code == 201, response.text
    client = TestClient(app)
    client.headers['Authorization'] = 'Bearer ' + response.json()['token']
    return client, response.json()


def make_table(auth, name='Agent 写入'):
    response = auth.post('/api/v1/tables', json={'name': name, 'fields': [
        {'name': '任务', 'type': 'short_text'},
        {'name': '状态', 'type': 'short_text'},
    ]})
    assert response.status_code == 201, response.text
    table = response.json()
    return table, {field['name']: field['key'] for field in table['fields']}


def test_direct_mode_returns_business_result_and_writes_run_journal(auth, db):
    agent, token = direct(auth)

    response = agent.post('/api/v1/agent/todo-lists', json={'name': '直接创建'})
    assert response.status_code == 201, response.text
    run_id = int(response.headers['x-agent-run-id'])
    assert response.headers['x-agent-write-mode'] == 'direct'

    assert db.scalar(select(func.count()).select_from(TodoList)) == 1
    run = db.get(AgentRun, run_id)
    assert run is not None and run.status == 'applied'
    assert run.undo_status == 'available'
    assert run.preview[0]['summary'].startswith('新增')
    assert run.operation_count == 1

    me = agent.get('/api/v1/agent/me').json()
    assert me['write_mode'] == 'direct'
    assert me['requires_user_merge'] is False
    assert me['policy']['operations'] == ['create', 'update', 'delete']

    listed = auth.get('/api/v1/agent-runs').json()
    assert listed['total'] == 1
    assert listed['items'][0]['id'] == run_id
    assert listed['items'][0]['agent_name'] == token['name']


def test_direct_policy_blocks_delete_and_schema_changes(auth, db):
    agent, _ = direct(auth, policy={'operations': ['create', 'update'], 'allow_schema': False})

    created = agent.post('/api/v1/agent/todo-lists', json={'name': '可以创建'})
    assert created.status_code == 201, created.text
    todo_id = agent.post('/api/v1/agent/todos', json={'list_id': created.json()['id'], 'title': '任务'})
    assert todo_id.status_code == 201, todo_id.text

    assert agent.delete(f"/api/v1/agent/todos/{todo_id.json()['id']}").status_code == 403
    assert agent.post('/api/v1/agent/tables', json={'name': '结构变更', 'fields': []}).status_code == 403


def test_direct_record_create_can_be_undone(auth, db):
    table, keys = make_table(auth)
    agent, _ = direct(auth)

    response = agent.post(f"/api/v1/agent/tables/{table['id']}/records", json={
        'data': {keys['任务']: '自动补数据', keys['状态']: '待核对'},
    })
    assert response.status_code == 201, response.text
    record_id = response.json()['id']
    run_id = int(response.headers['x-agent-run-id'])
    assert db.get(DataRecord, record_id) is not None

    undone = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert undone.status_code == 200, undone.text
    assert undone.json()['status'] == 'undone'
    assert undone.json()['undo_status'] == 'undone'
    assert db.get(DataRecord, record_id).deleted_at is not None
    assert auth.get(f"/api/v1/tables/{table['id']}/records").json()['items'] == []
    assert db.scalar(select(func.count()).select_from(TrashEntry).where(
        TrashEntry.kind == 'record', TrashEntry.entity_id == record_id,
    )) == 1


def test_direct_record_update_undo_conflicts_with_later_user_edit(auth, db):
    table, keys = make_table(auth)
    record = auth.post(f"/api/v1/tables/{table['id']}/records", json={
        'data': {keys['任务']: '原始内容', keys['状态']: '待处理'},
    }).json()
    agent, _ = direct(auth)

    changed = agent.patch(f"/api/v1/agent/records/{record['id']}", json={
        'version': record['version'], 'data': {keys['状态']: 'Agent 已处理'},
    })
    assert changed.status_code == 200, changed.text
    run_id = int(changed.headers['x-agent-run-id'])

    # A later user edit must win; undo refuses to overwrite it.
    newer = changed.json()
    edited = auth.put(f"/api/v1/records/{record['id']}", json={
        'version': newer['version'], 'data': {keys['任务']: '原始内容', keys['状态']: '用户改过'},
    })
    assert edited.status_code == 200, edited.text
    refused = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert refused.status_code == 409, refused.text
    assert 'conflict' in refused.text.lower() or '冲突' in refused.text
    assert auth.get(f"/api/v1/records/{record['id']}").json()['data'][keys['状态']] == '用户改过'


def test_direct_update_undo_restores_before_values(auth, db):
    table, keys = make_table(auth, name='Agent 更新撤销')
    record = auth.post(f"/api/v1/tables/{table['id']}/records", json={
        'data': {keys['任务']: '原始内容', keys['状态']: '待处理'},
    }).json()
    agent, _ = direct(auth)

    changed = agent.patch(f"/api/v1/agent/records/{record['id']}", json={
        'version': record['version'], 'data': {keys['状态']: 'Agent 已处理'},
    })
    assert changed.status_code == 200, changed.text
    run_id = int(changed.headers['x-agent-run-id'])

    undone = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert undone.status_code == 200, undone.text
    restored = auth.get(f"/api/v1/records/{record['id']}").json()
    assert restored['data'] == {keys['任务']: '原始内容', keys['状态']: '待处理'}


def test_direct_delete_undo_restores_from_trash(auth, db):
    table, keys = make_table(auth, name='Agent 删除撤销')
    record = auth.post(f"/api/v1/tables/{table['id']}/records", json={
        'data': {keys['任务']: '不要删我', keys['状态']: '待处理'},
    }).json()
    agent, _ = direct(auth)

    deleted = agent.delete(f"/api/v1/agent/records/{record['id']}")
    assert deleted.status_code == 200, deleted.text
    run_id = int(deleted.headers['x-agent-run-id'])
    assert auth.get(f"/api/v1/records/{record['id']}").status_code == 404

    undone = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert undone.status_code == 200, undone.text
    assert auth.get(f"/api/v1/records/{record['id']}").json()['data'][keys['任务']] == '不要删我'


def test_direct_batch_is_atomic_and_undo_reverses_order(auth, db):
    agent, _ = direct(auth)
    response = agent.post('/api/v1/agent/changes', json={
        'title': '创建清单和任务',
        'operations': [
            {'ref': 'list', 'method': 'POST', 'path': '/todo-lists', 'body': {'name': '批量直接写'}},
            {'ref': 'todo', 'method': 'POST', 'path': '/todos', 'body': {
                'list_id': '{{list.id}}', 'title': '批量任务',
            }},
        ],
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['status'] == 'applied' and body['batch'] is True
    run_id = body['run_id']
    assert db.scalar(select(func.count()).select_from(TodoList)) == 1
    assert db.scalar(select(func.count()).select_from(Todo)) == 1

    undone = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert undone.status_code == 200, undone.text
    assert db.scalar(select(func.count()).select_from(TodoList)) == 0
    assert db.scalar(select(func.count()).select_from(Todo)) == 0


def test_agent_can_read_own_runs_but_cannot_undo(auth):
    agent, _ = direct(auth)
    response = agent.post('/api/v1/agent/todo-lists', json={'name': '只读运行记录'})
    run_id = int(response.headers['x-agent-run-id'])

    own = agent.get('/api/v1/agent/runs')
    assert own.status_code == 200
    assert own.json()['items'][0]['id'] == run_id
    assert agent.get(f'/api/v1/agent/runs/{run_id}').status_code == 200
    assert agent.post(f'/api/v1/agent/runs/{run_id}/undo').status_code in {401, 403}


def test_token_policy_can_be_changed_after_issue(auth):
    agent, token = direct(auth)
    changed = auth.patch(f"/api/v1/agent-tokens/{token['id']}", json={
        'write_mode': 'review',
        'policy': {'operations': ['create'], 'allow_schema': False},
    })
    assert changed.status_code == 200, changed.text
    assert changed.json()['write_mode'] == 'review'
    assert agent.get('/api/v1/agent/me').json()['write_mode'] == 'review'
    # A review token keeps the existing staged contract.
    staged = agent.post('/api/v1/agent/todo-lists', json={'name': '仍需审核'})
    assert staged.status_code == 202, staged.text


def test_direct_policy_table_allowlist(auth):
    first, _ = make_table(auth, name='允许写入')
    second, _ = make_table(auth, name='禁止写入')
    agent, _ = direct(auth, policy={'tables': [first['id']]})

    allowed = agent.post(f"/api/v1/agent/tables/{first['id']}/records", json={'data': {}})
    assert allowed.status_code in {201, 422}, allowed.text
    denied = agent.post(f"/api/v1/agent/tables/{second['id']}/records", json={'data': {}})
    assert denied.status_code == 403, denied.text


def test_direct_todo_update_and_completion_undo(auth, db):
    agent, _ = direct(auth)
    lst = agent.post('/api/v1/agent/todo-lists', json={'name': '撤销待办'}).json()
    todo = agent.post('/api/v1/agent/todos', json={'list_id': lst['id'], 'title': '原始任务', 'note': '旧说明'}).json()

    changed = agent.patch(f"/api/v1/agent/todos/{todo['id']}", json={'version': todo['version'], 'note': '新说明'})
    assert changed.status_code == 200, changed.text
    run_id = int(changed.headers['x-agent-run-id'])
    assert agent.get(f"/api/v1/agent/todos/{todo['id']}").json()['note'] == '新说明'
    refused = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert refused.status_code == 200, refused.text
    assert agent.get(f"/api/v1/agent/todos/{todo['id']}").json()['note'] == '旧说明'

    current = agent.get(f"/api/v1/agent/todos/{todo['id']}").json()
    completed = agent.put(f"/api/v1/agent/todos/{todo['id']}/completion", json={'completed': True})
    assert completed.status_code == 200, completed.text
    complete_run = int(completed.headers['x-agent-run-id'])
    assert agent.get(f"/api/v1/agent/todos/{todo['id']}").json()['completed'] is True
    assert auth.post(f'/api/v1/agent-runs/{complete_run}/undo').status_code == 200
    assert agent.get(f"/api/v1/agent/todos/{todo['id']}").json()['completed'] is False


def test_direct_note_update_then_create_undo(auth, db):
    agent, _ = direct(auth)
    note = agent.post('/api/v1/agent/notes', json={'title': 'Agent 笔记', 'content': '第一版'})
    assert note.status_code == 201, note.text
    note_id = note.json()['id']
    create_run = int(note.headers['x-agent-run-id'])

    changed = agent.put(f'/api/v1/agent/notes/{note_id}', json={
        'title': 'Agent 笔记', 'content': '第二版', 'version': note.json()['version'],
    })
    assert changed.status_code == 200, changed.text
    update_run = int(changed.headers['x-agent-run-id'])

    assert auth.post(f'/api/v1/agent-runs/{update_run}/undo').status_code == 200
    assert auth.get(f'/api/v1/notes/{note_id}').json()['content'] == '第一版'
    assert auth.post(f'/api/v1/agent-runs/{create_run}/undo').status_code == 200
    assert auth.get(f'/api/v1/notes/{note_id}').status_code == 404


def test_direct_memo_and_bookmark_create_undo(auth):
    agent, _ = direct(auth)
    memo = agent.post('/api/v1/agent/memos', json={'content': 'Agent 便利贴'})
    assert memo.status_code == 201, memo.text
    assert auth.post(f"/api/v1/agent-runs/{int(memo.headers['x-agent-run-id'])}/undo").status_code == 200
    assert auth.get('/api/v1/memos').json() == []

    bookmark = agent.post('/api/v1/agent/bookmarks', json={'url': 'https://example.com/agent', 'title': 'Agent 书签'})
    assert bookmark.status_code == 201, bookmark.text
    assert auth.post(f"/api/v1/agent-runs/{int(bookmark.headers['x-agent-run-id'])}/undo").status_code == 200
    assert auth.get('/api/v1/bookmarks').json() == []


def test_direct_idempotency_key_returns_same_run(auth, db):
    agent, _ = direct(auth)
    headers = {'Idempotency-Key': 'direct-once'}
    first = agent.post('/api/v1/agent/todo-lists', json={'name': '只执行一次'}, headers=headers)
    assert first.status_code == 201, first.text
    second = agent.post('/api/v1/agent/todo-lists', json={'name': '只执行一次'}, headers=headers)
    assert second.status_code == 201, second.text
    assert first.headers['x-agent-run-id'] == second.headers['x-agent-run-id']
    assert db.scalar(select(func.count()).select_from(TodoList)) == 1

    conflict = agent.post('/api/v1/agent/todo-lists', json={'name': '换了内容'}, headers=headers)
    assert conflict.status_code == 409, conflict.text


def test_direct_module_policy_blocks_other_modules(auth):
    agent, _ = direct(auth, policy={'modules': ['tables']})
    assert agent.post('/api/v1/agent/todo-lists', json={'name': '不允许'}).status_code == 403
    table, keys = make_table(auth, name='模块策略')
    assert agent.post(f"/api/v1/agent/tables/{table['id']}/records", json={'data': {keys['任务']: '可以'}}).status_code == 201


def test_direct_file_policy_and_irreversible_flag(auth):
    blocked, _ = direct(auth, policy={'allow_files': False})
    response = blocked.post('/api/v1/agent/files', files={'file': ('a.txt', b'blocked', 'text/plain')})
    assert response.status_code == 403, response.text

    needs_confirmation, _ = direct(auth, policy={'allow_files': True, 'allow_irreversible': False})
    response = needs_confirmation.post('/api/v1/agent/files', files={'file': ('b.txt', b'confirm', 'text/plain')})
    assert response.status_code == 409, response.text

    allowed, _ = direct(auth, policy={'allow_files': True, 'allow_irreversible': True})
    response = allowed.post('/api/v1/agent/files', files={'file': ('c.txt', b'allowed', 'text/plain')})
    assert response.status_code == 201, response.text
    detail = auth.get(f"/api/v1/agent-runs/{int(response.headers['x-agent-run-id'])}").json()
    assert detail['undo_status'] == 'unsupported'


def test_record_update_undo_preserves_unrelated_user_edit(auth):
    table, keys = make_table(auth, name='字段级撤销')
    record = auth.post(f"/api/v1/tables/{table['id']}/records", json={
        'data': {keys['任务']: '原始内容', keys['状态']: '待处理'},
    }).json()
    agent, _ = direct(auth)

    changed = agent.patch(f"/api/v1/agent/records/{record['id']}", json={
        'version': record['version'], 'data': {keys['状态']: 'Agent 已处理'},
    })
    assert changed.status_code == 200, changed.text
    run_id = int(changed.headers['x-agent-run-id'])

    # The user edits a different field. Undo the Agent's field, keep the user's edit.
    edited = auth.put(f"/api/v1/records/{record['id']}", json={
        'version': changed.json()['version'],
        'data': {keys['任务']: '用户改过', keys['状态']: 'Agent 已处理'},
    })
    assert edited.status_code == 200, edited.text
    undone = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert undone.status_code == 200, undone.text
    data = auth.get(f"/api/v1/records/{record['id']}").json()['data']
    assert data[keys['任务']] == '用户改过'
    assert data[keys['状态']] == '待处理'


def test_field_create_and_update_undo(auth):
    table, _ = make_table(auth, name='列撤销')
    agent, _ = direct(auth)

    created = agent.post(f"/api/v1/agent/tables/{table['id']}/fields", json={
        'name': '备注', 'type': 'short_text',
    })
    assert created.status_code == 201, created.text
    field_id = created.json()['id']
    create_run = int(created.headers['x-agent-run-id'])
    assert auth.post(f'/api/v1/agent-runs/{create_run}/undo').status_code == 200
    assert all(f['id'] != field_id for f in auth.get(f"/api/v1/tables/{table['id']}/fields").json())

    field = auth.post(f"/api/v1/tables/{table['id']}/fields", json={
        'name': '用户列', 'type': 'short_text',
    }).json()
    changed = agent.patch(f"/api/v1/agent/fields/{field['id']}", json={'name': 'Agent 列名'})
    assert changed.status_code == 200, changed.text
    update_run = int(changed.headers['x-agent-run-id'])
    # Changing sort_order is unrelated to the Agent's rename and must survive undo.
    assert auth.patch(f"/api/v1/fields/{field['id']}", json={'sort_order': 99}).status_code == 200
    assert auth.post(f'/api/v1/agent-runs/{update_run}/undo').status_code == 200
    restored = next(f for f in auth.get(f"/api/v1/tables/{table['id']}/fields").json() if f['id'] == field['id'])
    assert restored['name'] == '用户列'
    assert restored['sort_order'] == 99


def test_view_create_update_and_delete_undo(auth):
    table, _ = make_table(auth, name='视图撤销')
    agent, _ = direct(auth)

    created = agent.post(f"/api/v1/agent/tables/{table['id']}/views", json={
        'name': 'Agent 视图', 'kind': 'grid', 'config': {},
    })
    assert created.status_code == 201, created.text
    view_id = created.json()['id']
    create_run = int(created.headers['x-agent-run-id'])
    assert auth.post(f'/api/v1/agent-runs/{create_run}/undo').status_code == 200
    assert all(v['id'] != view_id for v in auth.get(f"/api/v1/tables/{table['id']}/views").json())

    view = auth.post(f"/api/v1/tables/{table['id']}/views", json={
        'name': '用户视图', 'kind': 'grid', 'config': {},
    }).json()
    changed = agent.put(f"/api/v1/agent/table-views/{view['id']}", json={
        'name': '用户视图', 'kind': 'grid', 'config': {'search': 'agent'}, 'version': view['version'],
    })
    assert changed.status_code == 200, changed.text
    update_run = int(changed.headers['x-agent-run-id'])
    # The user renames the view; that unrelated change must survive undo.
    edited = auth.put(f"/api/v1/table-views/{view['id']}", json={
        'name': '用户改过的视图', 'kind': 'grid', 'config': {'search': 'agent'},
        'version': changed.json()['version'],
    })
    assert edited.status_code == 200, edited.text
    assert auth.post(f'/api/v1/agent-runs/{update_run}/undo').status_code == 200
    restored = next(v for v in auth.get(f"/api/v1/tables/{table['id']}/views").json() if v['id'] == view['id'])
    assert restored['name'] == '用户改过的视图'
    assert restored['config'] == {}

    doomed = auth.post(f"/api/v1/tables/{table['id']}/views", json={
        'name': '待删除视图', 'kind': 'grid', 'config': {'search': 'keep'},
    }).json()
    deleted = agent.delete(f"/api/v1/agent/table-views/{doomed['id']}")
    assert deleted.status_code == 200, deleted.text
    delete_run = int(deleted.headers['x-agent-run-id'])
    assert auth.post(f'/api/v1/agent-runs/{delete_run}/undo').status_code == 200
    recreated = [v for v in auth.get(f"/api/v1/tables/{table['id']}/views").json() if v['name'] == '待删除视图']
    assert len(recreated) == 1
    assert recreated[0]['config'] == {'search': 'keep'}


def test_dashboard_delete_undo_recreates(auth):
    board = auth.post('/api/v1/dashboards', json={'name': 'Agent 看板'}).json()
    agent, _ = direct(auth)
    deleted = agent.delete(f"/api/v1/agent/dashboards/{board['id']}?version={board['version']}")
    assert deleted.status_code == 200, deleted.text
    run_id = int(deleted.headers['x-agent-run-id'])
    assert auth.post(f'/api/v1/agent-runs/{run_id}/undo').status_code == 200
    assert any(b['name'] == 'Agent 看板' for b in auth.get('/api/v1/dashboards').json())


def test_unsupported_undo_reason_is_returned_in_preview(auth):
    table, _ = make_table(auth, name='列删除预览')
    field = auth.post(f"/api/v1/tables/{table['id']}/fields", json={
        'name': '待删列', 'type': 'short_text',
    }).json()
    agent, _ = direct(auth, policy={
        'operations': ['create', 'update', 'delete'],
        'allow_schema': True,
    })
    deleted = agent.delete(f"/api/v1/agent/fields/{field['id']}?confirm=true")
    assert deleted.status_code == 200, deleted.text
    run_id = int(deleted.headers['x-agent-run-id'])
    detail = auth.get(f'/api/v1/agent-runs/{run_id}').json()
    assert detail['undo_status'] == 'unsupported'
    assert detail['preview'][0]['undoable'] is False
    assert detail['preview'][0]['undo_reason']


def test_batch_delete_undo_restores_all_records(auth):
    table, keys = make_table(auth, name='批量删除撤销')
    agent, _ = direct(auth)
    ids = []
    for index in range(3):
        created = agent.post(f"/api/v1/agent/tables/{table['id']}/records", json={
            'data': {keys['任务']: f'记录 {index}', keys['状态']: '待处理'},
        })
        assert created.status_code == 201, created.text
        ids.append(created.json()['id'])

    deleted = agent.post(f"/api/v1/agent/tables/{table['id']}/records/batch-delete", json={'ids': ids})
    assert deleted.status_code == 200, deleted.text
    run_id = int(deleted.headers['x-agent-run-id'])
    assert all(auth.get(f'/api/v1/records/{record_id}').status_code == 404 for record_id in ids)

    undone = auth.post(f'/api/v1/agent-runs/{run_id}/undo')
    assert undone.status_code == 200, undone.text
    for record_id in ids:
        assert auth.get(f'/api/v1/records/{record_id}').status_code == 200
