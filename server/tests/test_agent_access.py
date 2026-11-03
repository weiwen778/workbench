from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import AgentActivity, AgentToken, utcnow


def issue(auth, scopes=None, **extra):
    response = auth.post('/api/v1/agent-tokens', json={
        'name': '运营 Agent', 'scopes': scopes or ['todos:write', 'tables:write'], **extra,
    })
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def agent(auth):
    token = issue(auth)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + token['token']
        yield client


def merge_as_user(auth,response):
    """Compatibility checks explicitly review each write before inspecting business results."""
    if response.status_code!=202:
        return response
    change=response.json()
    merged=auth.post(f"/api/v1/agent-changes/{change['id']}/merge",json={'version':change['version']})
    assert merged.status_code==200,merged.text
    return httpx.Response(201 if response.request.method=='POST' else 200,json=merged.json()['results'][0])


def test_token_secret_only_once_and_stored_hashed(auth, db):
    token = issue(auth)
    stored = db.get(AgentToken, token['id'])
    assert stored.token_hash != token['token'] and len(stored.token_hash) == 64
    assert set(token['scopes']) == {'todos:read', 'todos:write', 'tables:read', 'tables:write'}
    listed = auth.get('/api/v1/agent-tokens').json()['items'][0]
    assert 'token' not in listed and 'token_hash' not in listed
    assert token['token'] not in str(listed)


def test_browser_cookie_does_not_authenticate_agent_endpoints(auth):
    assert auth.get('/api/v1/agent/todo-lists').status_code == 401
    auth.headers['Authorization'] = 'Bearer bad-token'
    assert auth.get('/api/v1/agent/todo-lists').status_code == 401


def test_agent_token_does_not_authenticate_browser_or_settings_routes(agent):
    for path in ('/api/v1/auth/me', '/api/v1/agent-tokens', '/api/v1/agent-activity', '/api/v1/tables'):
        assert agent.get(path).status_code == 401
    assert agent.post('/api/v1/agent-tokens', json={'name': 'escalate', 'scopes': ['tables:write']}).status_code == 401
    assert agent.post('/api/v1/auth/password', json={'old_password': 'x', 'new_password': 'newpass123'}).status_code == 401


def test_scoped_read_only_access(auth):
    token = issue(auth, ['todos:read'])
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + token['token']
        assert client.get('/api/v1/agent/todo-lists').status_code == 200
        assert client.get('/api/v1/agent/tables').status_code == 403
        assert client.post('/api/v1/agent/todo-lists', json={'name': '禁止创建'}).status_code == 403
        assert client.get('/api/v1/agent/me').json()['name'] == '运营 Agent'


def test_revocation_and_expiry_take_effect(auth, db):
    token = issue(auth)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + token['token']
        assert client.get('/api/v1/agent/me').status_code == 200
        auth.delete(f"/api/v1/agent-tokens/{token['id']}")
        assert client.get('/api/v1/agent/me').status_code == 401
    expired = issue(auth)
    db.get(AgentToken, expired['id']).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + expired['token']
        assert client.get('/api/v1/agent/me').status_code == 401


@pytest.mark.parametrize('patch', [
    {'name': '   '}, {'scopes': []}, {'scopes': ['admin']},
    {'expires_in_days': 0}, {'expires_in_days': 366},
])
def test_token_input_validation(auth, patch):
    response = auth.post('/api/v1/agent-tokens', json={'name': 'test', 'scopes': ['todos:read'], **patch})
    assert response.status_code == 422


def test_todo_writeback_completion_and_conflicts(agent, auth):
    lst = merge_as_user(auth,agent.post('/api/v1/agent/todo-lists', json={'name': 'Agent 执行'})).json()
    response = merge_as_user(auth,agent.post('/api/v1/agent/todos', json={'list_id': lst['id'], 'title': '生成日报'}))
    assert response.status_code == 201, response.text
    todo = response.json()
    path = f"/api/v1/agent/todos/{todo['id']}"
    assert agent.get(path).json()['title'] == '生成日报'
    patched = merge_as_user(auth,agent.patch(path, json={'version': todo['version'], 'note': '日报已生成，链接：https://example.com/report'}))
    assert patched.status_code == 200
    assert agent.patch(path, json={'version': todo['version'], 'note': '覆盖他人的改动'}).status_code == 409
    assert agent.patch(path, json={'note': '无版本'}).status_code == 422
    complete = merge_as_user(auth,agent.put(path + '/completion', json={'completed': True}))
    assert complete.json()['completed'] is True
    repeat = merge_as_user(auth,agent.put(path + '/completion', json={'completed': True}))
    assert repeat.json()['version'] == complete.json()['version']
    assert merge_as_user(auth,agent.put(path + '/completion', json={'completed': False})).json()['completed'] is False
    assert agent.get('/api/v1/agent/todos', params={'list_id': lst['id']}).status_code == 200
    browser_view = auth.get('/api/v1/todos', params={'list_id': lst['id']}).json()
    assert browser_view['pending'][0]['note'].startswith('日报已生成')
    activities = auth.get('/api/v1/agent-activity').json()['items']
    # Six submitted changes and six explicit user merges; failed proposals leave no successful activity.
    assert len(activities) == 12
    assert all(a['agent_name'] == '运营 Agent' for a in activities)


def test_parent_completion_rules_are_preserved(agent,auth):
    lst = merge_as_user(auth,agent.post('/api/v1/agent/todo-lists', json={'name': '子任务'})).json()
    parent = merge_as_user(auth,agent.post('/api/v1/agent/todos', json={'list_id': lst['id'], 'title': '父任务'})).json()
    child = merge_as_user(auth,agent.post('/api/v1/agent/todos', json={'list_id': lst['id'], 'parent_id': parent['id'], 'title': '子任务'})).json()
    assert agent.put(f"/api/v1/agent/todos/{parent['id']}/completion", json={'completed': True}).status_code == 409
    merge_as_user(auth,agent.put(f"/api/v1/agent/todos/{child['id']}/completion", json={'completed': True}))
    assert agent.get(f"/api/v1/agent/todos/{parent['id']}").json()['completed'] is True


def test_record_patch_keeps_other_fields_and_checks_version(agent, auth):
    table = auth.post('/api/v1/tables', json={'name': '执行结果', 'fields': [
        {'name': '任务', 'type': 'short_text', 'required': True},
        {'name': '状态', 'type': 'select', 'options': [{'id': 'pending', 'label': '待执行'}, {'id': 'done', 'label': '完成'}]},
    ]}).json()
    task, status = [f['key'] for f in table['fields']]
    table_path = f"/api/v1/agent/tables/{table['id']}"
    assert agent.get('/api/v1/agent/tables').status_code == 200
    assert agent.get(table_path).json()['fields'][0]['key'] == task
    response = merge_as_user(auth,agent.post(table_path + '/records', json={'data': {task: '整理报表', status: 'pending'}}))
    assert response.status_code == 201, response.text
    record = response.json()
    path = f"/api/v1/agent/records/{record['id']}"
    changed = merge_as_user(auth,agent.patch(path, json={'version': record['version'], 'data': {status: 'done'}}))
    assert changed.status_code == 200, changed.text
    assert changed.json()['data'] == {task: '整理报表', status: 'done'}
    assert agent.get(path).json()['version'] == record['version'] + 1
    assert agent.patch(path, json={'version': record['version'], 'data': {status: 'pending'}}).status_code == 409
    assert agent.patch(path, json={'data': {status: 'pending'}}).status_code == 422
    assert agent.patch(path, json={'version': changed.json()['version'], 'data': {status: '无效选项'}}).status_code == 422
    assert agent.get(table_path + '/records').json()['items'][0]['data'][status] == 'done'
    assert agent.get(table_path + '/records?page_size=999').status_code == 422


def test_no_delete_schema_or_other_module_access(agent, auth, db):
    assert agent.delete('/api/v1/agent/todos/1').status_code == 403
    assert agent.delete('/api/v1/agent/records/1').status_code == 403
    assert agent.post('/api/v1/agent/tables', json={'name': '不允许'}).status_code == 403
    assert agent.get('/api/v1/translation-connections').status_code == 401
    assert db.scalar(select(func.count()).select_from(AgentActivity)) == 0
    assert 'Bearer' in auth.get('/api/v1/agent-guide').json()['guide']
    assert agent.get('/api/v1/agent/guide').status_code == 200


def test_bearer_with_cookie_still_requires_valid_agent_token_and_keeps_browser_csrf(auth):
    token = issue(auth)
    auth.headers['Authorization'] = 'Bearer ' + token['token']
    auth.headers.pop('X-CSRF-Token')
    assert auth.post('/api/v1/agent/todo-lists', json={'name': 'Bearer无需CSRF'}).status_code == 202
    assert auth.post('/api/v1/todo-lists', json={'name': '仍然需要CSRF'}).status_code == 403
