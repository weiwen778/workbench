from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import User, Whiteboard
from app.security import hash_password


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII="
)


def test_whiteboard_crud_and_version(auth):
    created = auth.post('/api/v1/whiteboards', json={'title': '设计白板'}).json()
    assert created['version'] == 1
    assert created['element_count'] == 0
    board_id = created['id']

    listed = auth.get('/api/v1/whiteboards').json()
    assert [item['id'] for item in listed] == [board_id]

    saved = auth.put(f'/api/v1/whiteboards/{board_id}', json={
        'elements': [{'id': 'a', 'type': 'rectangle'}],
        'app_state': {'viewBackgroundColor': '#ffffff'},
        'version': 1,
    })
    assert saved.status_code == 200
    assert saved.json()['version'] == 2
    assert saved.json()['element_count'] == 1

    conflict = auth.put(f'/api/v1/whiteboards/{board_id}', json={
        'elements': [], 'app_state': {}, 'version': 1,
    })
    assert conflict.status_code == 409
    assert conflict.json()['details']['current_version'] == 2

    detail = auth.get(f'/api/v1/whiteboards/{board_id}').json()
    assert detail['scene']['elements'][0]['id'] == 'a'

    renamed = auth.patch(f'/api/v1/whiteboards/{board_id}', json={'title': '新名称'})
    assert renamed.json()['title'] == '新名称'
    assert renamed.json()['version'] == 2

    copy = auth.post(f'/api/v1/whiteboards/{board_id}/duplicate').json()
    assert copy['id'] != board_id
    assert copy['title'].endswith('副本')
    assert copy['version'] == 1
    assert copy['element_count'] == 1

    assert auth.delete(f'/api/v1/whiteboards/{board_id}').status_code == 200
    assert auth.get(f'/api/v1/whiteboards/{board_id}').status_code == 404
    assert auth.get(f"/api/v1/whiteboards/{copy['id']}").status_code == 200


def test_whiteboard_assets_are_owned_and_validated(auth):
    board = auth.post('/api/v1/whiteboards', json={'title': '图片板'}).json()
    missing = auth.put(f"/api/v1/whiteboards/{board['id']}", json={
        'elements': [{'id': 'img', 'type': 'image', 'fileId': 'missing'}],
        'app_state': {}, 'version': 1,
    })
    assert missing.status_code == 422

    uploaded = auth.post('/api/v1/whiteboards/assets', data={'file_id': 'asset-1'}, files={'file': ('shot.png', PNG, 'image/png')})
    assert uploaded.status_code == 201
    assert uploaded.json()['id'] == 'asset-1'
    again = auth.post('/api/v1/whiteboards/assets', data={'file_id': 'asset-1'}, files={'file': ('shot.png', PNG, 'image/png')})
    assert again.status_code == 201

    content = auth.get('/api/v1/whiteboards/assets/asset-1/content')
    assert content.status_code == 200
    assert content.content == PNG

    saved = auth.put(f"/api/v1/whiteboards/{board['id']}", json={
        'elements': [{'id': 'img', 'type': 'image', 'fileId': 'asset-1'}],
        'app_state': {}, 'version': 1,
    })
    assert saved.status_code == 200

    with SessionLocal() as db:
        db.add(User(username='other', password_hash='x'))
        db.commit()
        other = db.query(User).filter(User.username == 'other').one()
        db.add(Whiteboard(user_id=other.id, title='别人的白板', scene={'elements': [], 'appState': {}}, version=1))
        db.commit()
        other_board = db.query(Whiteboard).filter(Whiteboard.user_id == other.id).one().id
    assert auth.get(f'/api/v1/whiteboards/{other_board}').status_code == 404
    assert auth.get('/api/v1/whiteboards/assets/asset-1/content').status_code == 200


def test_same_file_id_is_scoped_per_user(auth):
    """Excalidraw fileIds are content hashes and may collide across accounts."""
    assert auth.post(
        '/api/v1/whiteboards/assets', data={'file_id': 'shared-hash'},
        files={'file': ('one.png', PNG, 'image/png')},
    ).status_code == 201
    with SessionLocal() as db:
        db.add(User(username='second', password_hash=hash_password('second12345')))
        db.commit()
    with TestClient(app) as other:
        other.get('/api/v1/health')
        login = other.post('/api/v1/auth/login', json={'username': 'second', 'password': 'second12345'})
        assert login.status_code == 200, login.text
        other.headers.update({'X-CSRF-Token': other.cookies.get('wb_csrf') or ''})
        uploaded = other.post(
            '/api/v1/whiteboards/assets', data={'file_id': 'shared-hash'},
            files={'file': ('two.png', PNG + b'other', 'image/png')},
        )
        assert uploaded.status_code == 201, uploaded.text
        assert other.get('/api/v1/whiteboards/assets/shared-hash/content').content == PNG + b'other'
    assert auth.get('/api/v1/whiteboards/assets/shared-hash/content').content == PNG


def test_whiteboard_orphan_assets_are_cleaned_after_grace(auth, db):
    from datetime import timedelta
    from sqlalchemy import select
    from app.config import settings
    from app.maintenance import run_cleanup
    from app.models import WhiteboardAsset, utcnow

    board = auth.post('/api/v1/whiteboards', json={'title': '清理白板'}).json()
    for file_id in ('keep-asset', 'orphan-asset'):
        response = auth.post(
            '/api/v1/whiteboards/assets', data={'file_id': file_id},
            files={'file': (file_id + '.png', PNG, 'image/png')},
        )
        assert response.status_code == 201, response.text
    saved = auth.put(f"/api/v1/whiteboards/{board['id']}", json={
        'elements': [{'id': 'img', 'type': 'image', 'fileId': 'keep-asset'}],
        'app_state': {}, 'version': 1,
    })
    assert saved.status_code == 200, saved.text
    with SessionLocal() as session:
        old = utcnow() - timedelta(hours=48)
        for asset in session.scalars(select(WhiteboardAsset)).all():
            asset.created_at = old
        session.commit()
        orphan = session.get(WhiteboardAsset, (1, 'orphan-asset'))
        keep = session.get(WhiteboardAsset, (1, 'keep-asset'))
        orphan_path = settings.storage_dir / orphan.storage_key
        keep_path = settings.storage_dir / keep.storage_key
        assert orphan_path.exists() and keep_path.exists()
    result = run_cleanup()
    assert result['whiteboard_assets'] == 1
    assert not orphan_path.exists() and keep_path.exists()
