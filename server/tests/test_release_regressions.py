import io
from openpyxl import Workbook


def test_deepseek_saved_model_is_used_for_test_and_translation(auth, monkeypatch):
    from app.routers import translate
    response = auth.put('/api/v1/translation-connections/deepseek', json={'enabled': True, 'config': {'api_key': 'test-key'}, 'model': 'custom-deepseek-model'})
    assert response.status_code == 200
    seen = []
    def translated(provider, text, source, target, config):
        seen.append(config['model'])
        return 'Hello', config['model']
    monkeypatch.setattr(translate.prov, 'translate', translated)
    assert auth.post('/api/v1/translation-connections/deepseek/test').json()['ok']
    result = auth.post('/api/v1/translations', json={'provider': 'deepseek', 'source_text': '你好', 'source_lang': 'zh', 'target_lang': 'en'})
    assert result.status_code == 200
    assert result.json()['model'] == 'custom-deepseek-model'
    assert seen == ['custom-deepseek-model', 'custom-deepseek-model']


def test_export_attachment_has_filename_and_authenticated_absolute_link(auth):
    from openpyxl import load_workbook
    from app.config import settings
    table = auth.post('/api/v1/tables', json={'name': 'export-links', 'fields': [{'name': 'text', 'type': 'short_text'}, {'name': 'file', 'type': 'attachment'}]}).json()
    file = auth.post('/api/v1/files', files={'file': ('invoice.pdf', b'%PDF-1.4 sample', 'application/pdf')}).json()
    keys = [f['key'] for f in table['fields']]
    auth.post(f"/api/v1/tables/{table['id']}/records", json={'data': {keys[0]: '=1+1', keys[1]: file['id']}}).raise_for_status()
    job = auth.post(f"/api/v1/tables/{table['id']}/exports", json={'scope': 'all'}).json()
    response = auth.get(f"/api/v1/data-transfer-jobs/{job['id']}/download")
    sheet = load_workbook(io.BytesIO(response.content)).active
    assert sheet['A2'].value == '=1+1'
    assert sheet['A2'].data_type == 's'
    assert sheet['B2'].value == 'invoice.pdf'
    assert sheet['B2'].hyperlink.target == f"{settings.public_base_url.rstrip('/')}/api/v1/files/{file['id']}/download"


def test_cleanup_removes_expired_export_from_export_directory(auth, db):
    from datetime import timedelta
    from app.config import settings
    from app.maintenance import run_cleanup
    from app.models import DataTransferJob, FileObject, utcnow
    table = auth.post('/api/v1/tables', json={'name': 'expired-export', 'fields': [{'name': 'text', 'type': 'short_text'}]}).json()
    result = auth.post(f"/api/v1/tables/{table['id']}/exports", json={'scope': 'all'}).json()
    job = db.get(DataTransferJob, result['id'])
    obj = db.get(FileObject, job.file_id)
    path = settings.storage_dir / 'exports' / obj.storage_key
    assert path.exists()
    job.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    run_cleanup()
    assert not path.exists()


def test_spa_does_not_serve_files_outside_distribution(client):
    response = client.get('/..%2F..%2FREADME.md')
    assert response.status_code == 404


def test_health_failure_is_unhealthy_and_redacts_details(client, monkeypatch):
    from app.routers import health
    def unavailable():
        raise RuntimeError('PRIVATE_DATABASE_PASSWORD')
    monkeypatch.setattr(health, 'SessionLocal', unavailable)
    response = client.get('/api/v1/health')
    assert response.status_code == 503
    assert 'PRIVATE_DATABASE_PASSWORD' not in response.text


def test_excel_zero_padding_is_preserved_for_text():
    from app.routers.transfers import _read_sheets
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(['SKU', 'Quantity'])
    sheet.append([123, 123])
    sheet['A2'].number_format = '00000'
    output = io.BytesIO()
    workbook.save(output)
    sheets, selected = _read_sheets(output.getvalue())
    assert sheets[selected][1] == ['00123', 123]


def test_untrusted_mime_cannot_serve_svg_on_application_origin(auth):
    result = auth.post('/api/v1/files', files={'file': ('image.png', b'<svg onload="alert(1)"/>', 'image/svg+xml')})
    assert result.status_code == 201
    response = auth.get(result.json()['url'])
    assert response.headers['content-type'].startswith('image/png')
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_trashed_attachment_cannot_be_downloaded_until_restored(auth):
    table = auth.post('/api/v1/tables', json={'name': 'file-security', 'fields': [{'name': 'file', 'type': 'attachment'}]}).json()
    file = auth.post('/api/v1/files', files={'file': ('sample.pdf', b'%PDF-1.4 test', 'application/pdf')}).json()
    key = table['fields'][0]['key']
    record = auth.post(f"/api/v1/tables/{table['id']}/records", json={'data': {key: file['id']}}).json()
    assert auth.get(file['url']).status_code == 200
    assert auth.delete(f"/api/v1/records/{record['id']}").status_code == 200
    assert auth.get(file['url']).status_code == 410
    assert auth.post(f"/api/v1/trash/record/{record['id']}/restore").status_code == 200
    assert auth.get(file['url']).status_code == 200


def test_retention_removes_expired_orphans_but_preserves_referenced_files(auth, db, tmp_path, monkeypatch):
    from datetime import timedelta
    from app import maintenance
    from app.config import settings
    from app.models import FileObject, FileRef, utcnow
    monkeypatch.setattr(settings, 'storage_dir', tmp_path)
    (tmp_path / 'files').mkdir()
    expired = FileObject(storage_key='expired.txt', original_name='a.txt', content_type='text/plain', size=1, status='staged', expires_at=utcnow()-timedelta(hours=1))
    protected = FileObject(storage_key='protected.txt', original_name='b.txt', content_type='text/plain', size=1, status='staged', expires_at=utcnow()-timedelta(hours=1))
    db.add_all([expired, protected])
    db.flush()
    expired_id, protected_id = expired.id, protected.id
    db.add(FileRef(file_id=protected_id, owner_type='note', owner_id=999))
    db.commit()
    for name in ['expired.txt', 'protected.txt']:
        (tmp_path / 'files' / name).write_text('x')
    assert maintenance.run_cleanup()['files'] == 1
    db.expire_all()
    assert db.get(FileObject, expired_id) is None
    assert db.get(FileObject, protected_id) is not None
    assert not (tmp_path / 'files' / 'expired.txt').exists()
    assert (tmp_path / 'files' / 'protected.txt').exists()


def test_export_task_expires_after_retention(auth, db):
    from datetime import timedelta
    from app.models import DataTransferJob, utcnow
    table = auth.post('/api/v1/tables', json={'name': 'expiry', 'fields': [{'name': 'text', 'type': 'short_text'}]}).json()
    response = auth.post(f"/api/v1/tables/{table['id']}/exports", json={'scope': 'all'})
    assert response.status_code == 201
    job = db.get(DataTransferJob, response.json()['id'])
    assert job.expires_at is not None
    job.expires_at = utcnow()-timedelta(seconds=1)
    db.commit()
    assert auth.get(response.json()['download_url']).status_code == 410


def test_expired_staged_file_cannot_be_bound(auth, db):
    from datetime import timedelta
    from app.models import FileObject, utcnow
    table = auth.post('/api/v1/tables', json={'name': 'expired-file', 'fields': [{'name': 'file', 'type': 'attachment'}]}).json()
    file = auth.post('/api/v1/files', files={'file': ('old.txt', b'old', 'text/plain')}).json()
    obj = db.get(FileObject, file['id'])
    obj.expires_at = utcnow()-timedelta(seconds=1)
    db.commit()
    response = auth.post(f"/api/v1/tables/{table['id']}/records", json={'data': {table['fields'][0]['key']: file['id']}})
    assert response.status_code == 422
