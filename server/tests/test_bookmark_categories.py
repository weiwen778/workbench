def test_empty_category_persists_and_duplicate_is_idempotent(auth):
    assert auth.post('/api/v1/bookmarks/categories',json={'name':'运营工具'}).status_code==200
    assert auth.post('/api/v1/bookmarks/categories',json={'name':'运营工具'}).status_code==200
    assert auth.get('/api/v1/bookmarks/categories').json()==['运营工具']
    assert auth.get('/api/v1/bookmarks').json()==[]
    assert auth.post('/api/v1/bookmarks/categories',json={'name':'   '}).status_code==422

def test_category_remains_after_last_bookmark_removed(auth):
    row=auth.post('/api/v1/bookmarks',json={'url':'https://example.com','category':'工具'}).json()
    assert '工具' in auth.get('/api/v1/bookmarks/categories').json()
    assert auth.delete('/api/v1/bookmarks/'+str(row['id'])).status_code==200
    assert '工具' in auth.get('/api/v1/bookmarks/categories').json()
