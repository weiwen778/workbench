def test_empty_category_survives_reload_and_duplicate_creation(auth):
    for name in ['  工作灵感  ', '工作灵感']:
        result = auth.post('/api/v1/memos/categories', json={'name': name})
        assert result.status_code == 200
        assert result.json()['name'] == '工作灵感'
    assert auth.get('/api/v1/memos/categories').json() == ['工作灵感']
    assert auth.get('/api/v1/memos', params={'category': '工作灵感'}).json() == []
    memo = auth.post('/api/v1/memos', json={'content': '分类内容', 'category': '工作灵感'}).json()
    assert auth.delete(f"/api/v1/memos/{memo['id']}").status_code == 200
    assert '工作灵感' in auth.get('/api/v1/memos/categories').json()


def test_category_validation_and_auth(auth, client):
    for name in ['  ', '未分类', '长' * 81]:
        assert auth.post('/api/v1/memos/categories', json={'name': name}).status_code == 422
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as anonymous:
        assert anonymous.post('/api/v1/memos/categories', json={'name': '分类'}).status_code == 401
