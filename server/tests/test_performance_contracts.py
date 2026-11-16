"""Regression contracts for the bottlenecks found in the release load test."""
import asyncio
import contextlib
import threading
from pathlib import Path

import httpx
import pytest
from sqlalchemy import event


def test_admission_limit_releases_cancelled_requests_and_keeps_health_available():
    from app.request_limits import RequestConcurrencyLimit
    from starlette.responses import JSONResponse

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()

        async def downstream(scope, receive, send):
            if scope['path'] != '/api/v1/health':
                entered.set()
                await release.wait()
            await JSONResponse({'ok': True})(scope, receive, send)

        app = RequestConcurrencyLimit(downstream, limit=1, timeout=.05)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            held = asyncio.create_task(client.get('/api/v1/held'))
            await entered.wait()
            busy = await client.get('/api/v1/queued')
            assert busy.status_code == 503
            assert busy.json()['code'] == 'SERVER_BUSY'
            assert busy.headers['retry-after'] == '1'
            assert (await client.get('/api/v1/health')).status_code == 200
            held.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await held
            release.set()
            assert (await client.get('/api/v1/next')).status_code == 200
    asyncio.run(run())


@pytest.mark.parametrize('kind', ['upload', 'import'])
def test_blocking_file_work_does_not_block_event_loop(auth, monkeypatch, kind):
    from app.main import app
    from app.routers import transfers
    entered, release = threading.Event(), threading.Event()
    if kind == 'upload':
        original = Path.write_bytes
        def delayed(path, data):
            entered.set()
            assert release.wait(3), 'File work blocked the event loop instead of using a worker'
            return original(path, data)
        monkeypatch.setattr(Path, 'write_bytes', delayed)
        endpoint, name, content = '/files', 'test.txt', b'data'
    else:
        original = transfers._read_any
        def delayed(name, data):
            entered.set()
            assert release.wait(3), 'Import parsing blocked the event loop instead of using a worker'
            return original(name, data)
        monkeypatch.setattr(transfers, '_read_any', delayed)
        endpoint, name, content = '/imports/preview', 'test.csv', b'name,value\na,1\n'

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test',
                cookies=dict(auth.cookies), headers={'X-CSRF-Token': auth.cookies.get('wb_csrf')}) as client:
            pending = asyncio.create_task(client.post('/api/v1' + endpoint, files={'file': (name, content)}))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                assert not pending.done()
                assert (await asyncio.wait_for(client.get('/api/v1/health'), timeout=1)).status_code == 200
            finally:
                release.set()
            response = await pending
            assert response.status_code in (200, 201), response.text
    asyncio.run(run())


def test_navigation_queries_do_not_grow_per_item(db):
    from app.models import Note, NoteFolder, NoteTag, NoteTagLink, TodoList
    from app.routers import notes, todos
    for i in range(25):
        folder, tag, lst = NoteFolder(name=f'folder-{i}'), NoteTag(name=f'tag-{i}'), TodoList(name=f'list-{i}')
        db.add_all([folder, tag, lst]); db.flush()
        note = Note(title=f'note-{i}', content='body', folder_id=folder.id)
        db.add(note); db.flush(); db.add(NoteTagLink(note_id=note.id, tag_id=tag.id))
    db.commit()
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(statement)
    engine = db.get_bind()
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        for call, maximum in [(lambda: notes.list_folders(db), 2), (lambda: notes.list_tags(db), 1),
                              (lambda: notes.list_notes(db=db), 2), (lambda: todos._lists_payload(db), 2)]:
            statements.clear()
            result = call()
            assert result
            assert len(statements) <= maximum
    finally:
        event.remove(engine, 'before_cursor_execute', capture)


def test_note_summary_omits_full_body_without_breaking_search_or_legacy_api(auth):
    body = 'start ' + 'x' * 50_000 + ' UNIQUE-END'
    note = auth.post('/api/v1/notes', json={'title': 'long', 'content': body, 'tags': ['ops']}).json()
    summary = auth.get('/api/v1/notes?summary=true&q=UNIQUE-END').json()
    assert len(summary) == 1
    assert 'content' not in summary[0]
    assert summary[0]['excerpt'].startswith('start')
    assert summary[0]['tags'] == ['ops']
    assert auth.get('/api/v1/notes').json()[0]['content'] == body
    assert auth.get(f'/api/v1/notes/{note["id"]}').json()['content'] == body


def test_dashboard_shared_source_metadata_is_loaded_once(db):
    from app.models import DataRecord, DataTable
    from app.services.dashboard import DateRange, Widget, aggregate
    table = DataTable(name='source')
    db.add(table); db.flush()
    db.add_all([DataRecord(table_id=table.id, data={}), DataRecord(table_id=table.id, data={})]); db.commit()
    count = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            count.append(statement)
    event.listen(db.get_bind(), 'before_cursor_execute', capture)
    try:
        result = aggregate(db, [Widget(id=f'm{i}', title='count', table_id=table.id) for i in range(12)], DateRange())
        assert all(item['value'] == '2' and item['status'] == 'ok' for item in result)
        assert len(count) <= 3
    finally:
        event.remove(db.get_bind(), 'before_cursor_execute', capture)


def test_stale_checkin_discovery_does_not_duplicate_or_overwrite_completed_snapshot(db):
    from app.models import CheckinGroup, CheckinInstance, CheckinRule, WorkTarget, utcnow
    from app.services.checkins import ensure_rule_instances
    from sqlalchemy import select
    group, target = CheckinGroup(name='ops'), WorkTarget(kind='shop', name='shop')
    db.add_all([group, target]); db.flush()
    rule = CheckinRule(target_id=target.id, group_id=group.id, title='original', period='daily')
    db.add(rule); db.flush()
    ensure_rule_instances(db, rule, target, backfill=False, existing_starts=set())
    item = db.scalar(select(CheckinInstance))
    item.completed_at = utcnow()
    db.commit()
    rule.title = 'changed'
    # Simulates another request which discovered the same empty set before the
    # winning transaction committed. Existing snapshots/completion must survive.
    ensure_rule_instances(db, rule, target, backfill=False, existing_starts=set())
    db.commit(); db.expire_all()
    items = list(db.scalars(select(CheckinInstance)))
    assert len(items) == 1
    assert items[0].title == 'original'
    assert items[0].completed_at is not None


def test_period_fast_path_cannot_hide_gaps_with_future_or_misaligned_rows():
    from datetime import date
    from app.services.checkins import _history_complete
    assert _history_complete({date(2026, 10, 29), date(2026, 10, 30), date(2026, 10, 31)}, 'daily', date(2026, 10, 29), date(2026, 10, 31), None)
    assert not _history_complete({date(2026, 10, 29), date(2026, 10, 31), date(2026, 11, 1)}, 'daily', date(2026, 10, 29), date(2026, 10, 31), None)
    assert not _history_complete({date(2026, 10, 5), date(2026, 10, 13), date(2026, 10, 19)}, 'weekly', date(2026, 10, 5), date(2026, 10, 20), None)
    assert _history_complete({date(2026, 10, 19)}, 'weekly', date(2026, 10, 5), date(2026, 10, 20), date(2026, 10, 14))


def test_import_rejects_compressed_bomb_before_parsing(auth):
    import io, zipfile
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        with archive.open('xl/sharedStrings.xml', 'w') as entry:
            for _ in range(65):
                entry.write(b' ' * 1024 * 1024)
    assert len(raw.getvalue()) < 100_000
    response = auth.post('/api/v1/imports/preview', files={'file': ('oversized.xlsx', raw.getvalue())})
    assert response.status_code == 413
    assert response.json()['code'] == 'WORKBOOK_TOO_LARGE'


@pytest.mark.parametrize('name,content,code', [
    ('rows.csv', b'a,b\n1,2\n3,4\n5,6\n', 'TOO_MANY_ROWS'),
    ('cols.csv', b'a,b,c\n1,2,3\n', 'TOO_MANY_COLUMNS'),
    ('rows.json', b'[{"a":1},{"a":2},{"a":3}]', 'TOO_MANY_ROWS'),
])
def test_import_limits_are_reported_without_materializing_unbounded_rows(auth, monkeypatch, name, content, code):
    from app.routers import transfers
    monkeypatch.setattr(transfers, 'MAX_ROWS', 2)
    monkeypatch.setattr(transfers, 'MAX_COLS', 2)
    response = auth.post('/api/v1/imports/preview', files={'file': (name, content)})
    assert response.status_code == 422
    assert response.json()['code'] == code
