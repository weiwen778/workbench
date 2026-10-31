def test_bookmark_requires_auth(client):
    assert client.get('/api/v1/bookmarks').status_code == 401

def test_bookmark_crud(auth):
    created = auth.post('/api/v1/bookmarks', json={'url': 'https://example.com/path', 'title': '', 'category': '工具', 'description': '备注'})
    assert created.status_code == 201, created.text
    item = created.json()
    assert item['title'] == 'example.com' and item['category'] == '工具'
    updated = auth.put(f"/api/v1/bookmarks/{item['id']}", json={'url':'http://localhost:8080', 'title':'本地', 'category':'', 'description':''})
    assert updated.status_code == 200 and updated.json()['title'] == '本地'
    assert len(auth.get('/api/v1/bookmarks').json()) == 1
    assert auth.delete(f"/api/v1/bookmarks/{item['id']}").status_code == 200
    assert auth.get('/api/v1/bookmarks').json() == []

def test_reject_unsafe_urls(auth):
    for url in ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com:999999']:
        assert auth.post('/api/v1/bookmarks', json={'url':url}).status_code == 422
