"""Generate isolated 10,000-row tables and verify real XLSX downloads.
Run: cd server && .venv/bin/python -m pytest -q -s tests/test_large_exports.py
No application data is used; conftest supplies a separate test database.
"""
import io
import time
from datetime import datetime

import pytest
from openpyxl import load_workbook
from sqlalchemy import insert

from app.models import DataRecord


def seed(db, table, count, width):
    keys = [f['key'] for f in table['fields'][:width]]
    for offset in range(0, count, 500):
        db.execute(insert(DataRecord), [
            {'table_id': table['id'], 'data': {key: (str(i) if j == 0 else f'R{i}C{j}') for j, key in enumerate(keys)}}
            for i in range(offset, min(count, offset + 500))
        ])
    db.execute(insert(DataRecord), [{'table_id': table['id'], 'data': {keys[0]: '999999'}, 'deleted_at': datetime.now()}])
    db.commit()


def download(auth, table_id, body):
    start = time.perf_counter()
    result = auth.post(f'/api/v1/tables/{table_id}/exports', json=body)
    assert result.status_code == 201, result.text
    job = result.json()
    file = auth.get(job['download_url'])
    assert file.status_code == 200
    elapsed = time.perf_counter() - start
    print(f"export scope={body['scope']} rows={job['rows']} bytes={len(file.content)} seconds={elapsed:.3f}")
    book = load_workbook(io.BytesIO(file.content), read_only=True)
    return job, book


def test_10000_rows_200_columns(auth, db):
    fields = [{'name': f'字段{j}', 'type': 'number' if j == 0 else 'short_text'} for j in range(200)]
    response = auth.post('/api/v1/tables', json={'name': '万行宽表压测', 'fields': fields})
    assert response.status_code == 201, response.text
    table = response.json()
    seed(db, table, 10_000, 200)
    job, book = download(auth, table['id'], {'scope': 'all'})
    try:
        assert job['rows'] == 10_000
        rows = book.active.iter_rows(values_only=True)
        assert next(rows) == tuple(f'字段{j}' for j in range(200))
        count = 0
        for i, row in enumerate(rows):
            assert row == tuple(str(i) if j == 0 else f'R{i}C{j}' for j in range(200)), i
            count += 1
        assert count == 10_000
    finally:
        book.close()
    key = table['fields'][0]['key']
    job, book = download(auth, table['id'], {'scope': 'filtered', 'filters': [{'field': key, 'op': 'gte', 'value': 9900}], 'sorts': [{'field': key, 'order': 'desc'}]})
    try:
        rows = list(book.active.values)
        assert job['rows'] == 100
        assert [int(row[0]) for row in rows[1:]] == list(range(9999, 9899, -1))
    finally:
        book.close()
    assert auth.post(f"/api/v1/tables/{table['id']}/fields", json={'name': '第201列', 'type': 'short_text'}).status_code == 422


def test_formula_export_over_10000_and_literal_text(auth, db):
    response = auth.post('/api/v1/tables', json={'name': '万行公式表', 'fields': [
        {'name': '数量', 'type': 'number'},
        {'name': '=SUM(A1:A2)', 'type': 'short_text'},
        {'name': '双倍', 'type': 'formula', 'config': {'expression': '{数量}*2'}},
    ]})
    assert response.status_code == 201, response.text
    table = response.json()
    seed(db, table, 10_001, 2)
    first = db.query(DataRecord).filter(DataRecord.table_id == table['id']).order_by(DataRecord.id).first()
    first.data = {**first.data, table['fields'][1]['key']: '=1+1'}
    db.commit()
    job, book = download(auth, table['id'], {'scope': 'all'})
    try:
        assert job['rows'] == 10_001
        rows = book.active.iter_rows()
        header = next(rows)
        assert header[1].value == '=SUM(A1:A2)' and header[1].data_type == 's'
        count = 0
        for i, row in enumerate(rows):
            assert row[0].value == str(i)
            assert row[2].value == str(i * 2)
            if i == 0:
                assert row[1].value == '=1+1' and row[1].data_type == 's'
            count += 1
        assert count == 10_001
    finally:
        book.close()


def test_200_column_import_and_overflow(auth):
    for width, expected in [(200, 200), (201, 422)]:
        content = (','.join(f'列{i}' for i in range(width)) + '\n' + ','.join('x' for _ in range(width))).encode()
        result = auth.post('/api/v1/imports/preview', files={'file': ('wide.csv', content, 'text/csv')})
        assert result.status_code == expected, result.text
        if width == 200:
            job = result.json()
            confirmed = auth.post(f"/api/v1/imports/{job['id']}/confirm")
            assert confirmed.status_code == 200, confirmed.text
            table_id = confirmed.json()['result']['table_id']
            assert len(auth.get(f'/api/v1/tables/{table_id}').json()['fields']) == 200
            overflow = auth.post('/api/v1/imports/preview', data={'table_id': table_id}, files={'file': ('extra.csv', b'extra\nx', 'text/csv')}).json()
            draft = auth.post(f"/api/v1/imports/{overflow['id']}/draft", json={'new_fields': [{'key': 'extra', 'name': '额外列', 'type': 'short_text', 'column': 0}]})
            assert draft.status_code == 422
            assert draft.json()['code'] == 'TOO_MANY_FIELDS'
