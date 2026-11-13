from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import DocumentProject, FileObject, FileRef, User
from app.security import hash_password

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII="
)


def _upload(auth):
    response = auth.post('/api/v1/files', files={'file': ('preview.png', PNG, 'image/png')})
    assert response.status_code == 201, response.text
    return response.json()['id']


def test_document_project_crud_version_and_attachments(auth):
    file_id = _upload(auth)
    created = auth.post('/api/v1/document-projects', json={
        'kind': 'pdf',
        'title': '合同整理',
        'state': {'pages': [{'id': 'p1', 'rotation': 90}], 'annotations': {}},
        'attachment_ids': [file_id],
    })
    assert created.status_code == 201, created.text
    project = created.json()
    assert project['version'] == 1
    assert project['attachment_ids'] == [file_id]
    assert project['attachments'][0]['name'] == 'preview.png'
    assert auth.get(f"/api/v1/files/{file_id}/content").status_code == 200

    detail = auth.get(f"/api/v1/document-projects/{project['id']}").json()
    assert detail['state']['pages'][0]['rotation'] == 90

    updated = auth.put(f"/api/v1/document-projects/{project['id']}", json={
        'kind': 'pdf', 'title': '合同整理（已编辑）', 'state': {'pages': []},
        'attachment_ids': [file_id], 'version': 1,
    })
    assert updated.status_code == 200
    assert updated.json()['version'] == 2

    conflict = auth.put(f"/api/v1/document-projects/{project['id']}", json={
        'kind': 'pdf', 'title': '过期保存', 'state': {}, 'attachment_ids': [file_id], 'version': 1,
    })
    assert conflict.status_code == 409
    assert conflict.json()['details']['current_version'] == 2

    listed = auth.get('/api/v1/document-projects?kind=pdf').json()['items']
    assert [item['id'] for item in listed] == [project['id']]
    assert 'state' not in listed[0]

    assert auth.delete(f"/api/v1/document-projects/{project['id']}").status_code == 200
    assert auth.get(f"/api/v1/document-projects/{project['id']}").status_code == 404


def test_document_project_is_user_scoped(auth, db):
    file_id = _upload(auth)
    project = auth.post('/api/v1/document-projects', json={
        'kind': 'document', 'title': '私有文档', 'state': {'markdown': 'secret'},
        'attachment_ids': [file_id],
    }).json()
    db.add(User(username='project-other', password_hash=hash_password('other12345')))
    db.commit()
    with TestClient(app) as other:
        other.get('/api/v1/health')
        login = other.post('/api/v1/auth/login', json={'username': 'project-other', 'password': 'other12345'})
        assert login.status_code == 200, login.text
        other.headers.update({'X-CSRF-Token': other.cookies.get('wb_csrf') or ''})
        assert other.get('/api/v1/document-projects').json()['items'] == []
        assert other.get(f"/api/v1/document-projects/{project['id']}").status_code == 404
        assert other.put(f"/api/v1/document-projects/{project['id']}", json={
            'kind': 'document', 'title': '篡改', 'state': {}, 'attachment_ids': [],
        }).status_code == 404


def test_document_project_rejects_bad_kind_and_large_state(auth):
    assert auth.post('/api/v1/document-projects', json={
        'kind': 'video', 'title': 'bad', 'state': {}, 'attachment_ids': [],
    }).status_code == 422
    assert auth.post('/api/v1/document-projects', json={
        'kind': 'sheet', 'title': 'large', 'state': {'blob': 'x' * 5_100_000}, 'attachment_ids': [],
    }).status_code == 413


def test_document_project_attachment_refs_are_synced(auth, db):
    first = _upload(auth)
    second = _upload(auth)
    project = auth.post('/api/v1/document-projects', json={
        'kind': 'sheet', 'title': '工作簿', 'state': {}, 'attachment_ids': [first],
    }).json()
    auth.put(f"/api/v1/document-projects/{project['id']}", json={
        'kind': 'sheet', 'title': '工作簿', 'state': {}, 'attachment_ids': [second], 'version': 1,
    })
    refs = db.query(FileRef).filter(FileRef.owner_type == 'document_project', FileRef.owner_id == project['id']).all()
    assert [ref.file_id for ref in refs] == [second]
    with SessionLocal() as session:
        assert session.get(FileObject, first).status == 'staged'
        assert session.get(FileObject, second).status == 'bound'


def test_document_project_can_share_attachment_with_same_user_copy(auth, db):
    file_id = _upload(auth)
    first = auth.post('/api/v1/document-projects', json={
        'kind': 'pdf', 'title': '原项目', 'state': {}, 'attachment_ids': [file_id],
    }).json()
    copy = auth.post('/api/v1/document-projects', json={
        'kind': 'pdf', 'title': '原项目 副本', 'state': {}, 'attachment_ids': [file_id],
    })
    assert copy.status_code == 201, copy.text
    copy_id = copy.json()['id']
    assert auth.delete(f"/api/v1/document-projects/{first['id']}").status_code == 200
    with SessionLocal() as session:
        file_obj = session.get(FileObject, file_id)
        assert file_obj.status == 'bound'
    assert auth.delete(f"/api/v1/document-projects/{copy_id}").status_code == 200
    with SessionLocal() as session:
        file_obj = session.get(FileObject, file_id)
        assert file_obj.status == 'staged'

def test_document_project_cannot_attach_another_users_file(auth, db):
    file_id = _upload(auth)
    project = auth.post('/api/v1/document-projects', json={
        'kind': 'pdf', 'title': '私有 PDF', 'state': {}, 'attachment_ids': [file_id],
    }).json()
    with SessionLocal() as session:
        file_obj = session.get(FileObject, file_id)
        assert file_obj.status == 'bound'
        assert file_obj.expires_at is None
        session.add(User(username='attachment-other', password_hash=hash_password('other12345')))
        session.commit()

    with TestClient(app) as other:
        other.get('/api/v1/health')
        login = other.post('/api/v1/auth/login', json={'username': 'attachment-other', 'password': 'other12345'})
        assert login.status_code == 200, login.text
        other.headers.update({'X-CSRF-Token': other.cookies.get('wb_csrf') or ''})
        stolen = other.post('/api/v1/document-projects', json={
            'kind': 'pdf', 'title': '越权复用', 'state': {}, 'attachment_ids': [file_id],
        })
        assert stolen.status_code == 422, stolen.text
        assert other.get(f'/api/v1/files/{file_id}/content').status_code == 410

    assert auth.delete(f"/api/v1/document-projects/{project['id']}").status_code == 200
    with SessionLocal() as session:
        file_obj = session.get(FileObject, file_id)
        assert file_obj.status == 'staged'
        assert file_obj.expires_at is not None
