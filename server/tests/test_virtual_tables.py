"""Retirement contract: no dedicated virtual-table API, no data deletion."""
from app.models import DataTable


def test_virtual_api_removed(auth):
    for method, path in [
        ('post', '/api/v1/virtual-tables'),
        ('post', '/api/v1/virtual-tables/preview'),
        ('put', '/api/v1/virtual-tables/1'),
        ('get', '/api/v1/virtual-tables/1/data'),
    ]:
        assert getattr(auth, method)(path).status_code in {404, 405}
    schema = auth.get('/api/openapi.json').json()
    assert not any('/virtual-tables' in path for path in schema['paths'])


def test_existing_virtual_hidden_and_preserved(auth, db):
    old = DataTable(name='历史组合表', kind='virtual', virtual_config={'mode': 'union'})
    db.add(old)
    db.commit()
    old_id = old.id
    normal = auth.post('/api/v1/tables', json={'name': '正常表格', 'fields': []})
    assert normal.status_code == 201
    tables = auth.get('/api/v1/tables').json()
    assert [t['id'] for t in tables] == [normal.json()['id']]
    assert auth.get(f'/api/v1/tables/{old_id}').status_code in {404, 405}
    assert auth.get(f"/api/v1/tables/{normal.json()['id']}").status_code == 200
    db.expire_all()
    assert db.get(DataTable, old_id).virtual_config == {'mode': 'union'}
