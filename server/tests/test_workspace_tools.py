import base64,importlib.util,io,json,sqlite3
from pathlib import Path
import pytest
from sqlalchemy import select,func
from openpyxl import load_workbook
from app.models import DataRecord,Todo,TodoList,Note,Memo,BackgroundJob,OperationLog
from app.config import settings
from app.services import jobs,backups
from app.errors import ApiError


def table(auth):
    response=auth.post('/api/v1/tables',json={'name':'后台测试表','fields':[{'name':'金额','type':'number'}]})
    assert response.status_code==201,response.text
    return response.json()


def test_paged_notes_memos_todo_trees_and_focus(auth,db):
    db.add_all([Note(title=f'笔记{i}',content='正文') for i in range(105)])
    db.add_all([Memo(title=f'便利贴{i}',content='正文',color='yellow') for i in range(105)])
    lst=TodoList(name='分页清单');db.add(lst);db.flush()
    parents=[Todo(list_id=lst.id,title=f'任务{i}',sort_index=i) for i in range(105)];db.add_all(parents);db.flush()
    child=Todo(list_id=lst.id,parent_id=parents[99].id,title='第100项子任务');db.add(child);db.commit()
    for resource in ('notes','memos'):
        first=auth.get('/api/v1/'+resource,params={'page':1,'page_size':50}).json()
        second=auth.get('/api/v1/'+resource,params={'page':2,'page_size':50}).json()
        assert first['total']==105 and len(first['items'])==50
        assert len(second['items'])==50 and not ({r['id'] for r in first['items']}&{r['id'] for r in second['items']})
    response=auth.get('/api/v1/todos',params={'list_id':lst.id,'page':1,'page_size':20,'focus':child.id})
    assert response.status_code==200,response.text
    out=response.json();assert out['page']==5 and len(out['pending'])==20
    assert out['counts']['nodes_total']==106
    assert any(c['id']==child.id for item in out['pending'] for c in item['children'])


def test_todo_tree_and_list_can_be_restored(auth):
    lst=auth.post('/api/v1/todo-lists',json={'name':'可恢复清单'}).json()
    parent=auth.post('/api/v1/todos',json={'list_id':lst['id'],'title':'父任务','note':'原说明'}).json()
    child=auth.post('/api/v1/todos',json={'list_id':lst['id'],'title':'子任务','parent_id':parent['id']}).json()
    assert auth.delete('/api/v1/todos/'+str(parent['id'])).json()['recoverable'] is True
    restored=auth.post(f"/api/v1/trash/todo/{parent['id']}/restore")
    assert restored.status_code==200,restored.text
    items=auth.get('/api/v1/todos',params={'list_id':lst['id']}).json()['pending']
    assert items[0]['title']=='父任务' and items[0]['note']=='原说明' and items[0]['children'][0]['title']=='子任务'
    assert auth.delete('/api/v1/todo-lists/'+str(lst['id'])).status_code==200
    restored=auth.post(f"/api/v1/trash/todo_list/{lst['id']}/restore")
    assert restored.status_code==200,restored.text
    assert restored.json()['restored_todos']==2
    assert len(auth.get('/api/v1/todos',params={'list_id':restored.json()['list_id']}).json()['pending'])==1


def test_background_export_10000_rows_idempotency_and_download(auth,db):
    t=table(auth);key=t['fields'][0]['key']
    db.add_all([DataRecord(table_id=t['id'],data={key:str(i)}) for i in range(10000)]);db.commit()
    path=f"/api/v1/tables/{t['id']}/export-tasks"
    queued=auth.post(path,json={'scope':'all'},headers={'Idempotency-Key':'export-10000'})
    assert queued.status_code==202,queued.text
    assert queued.json()['status']=='queued'
    assert auth.post(path,json={'scope':'all'},headers={'Idempotency-Key':'export-10000'}).json()['id']==queued.json()['id']
    assert jobs.run_next()
    result=auth.get('/api/v1/tasks/'+str(queued.json()['id'])).json()
    assert result['status']=='completed',result
    assert result['result']['rows']==10000 and result['progress']==100
    file=auth.get(result['result']['download_url'])
    book=load_workbook(io.BytesIO(file.content),read_only=True)
    assert sum(1 for _ in book.active.rows)==10001;book.close()


def test_cancel_failure_retry_and_readonly_token_boundary(auth,monkeypatch):
    from app.routers import transfers
    from fastapi.testclient import TestClient
    from app.main import app
    t=table(auth);path=f"/api/v1/tables/{t['id']}/export-tasks"
    first=auth.post(path,json={'scope':'all'}).json()
    assert auth.post(f"/api/v1/tasks/{first['id']}/cancel").json()['status']=='cancelled'
    second=auth.post(f"/api/v1/tasks/{first['id']}/retry").json();assert second['id']!=first['id']
    def fail(*args,**kwargs):raise ApiError('TEST','测试失败原因',422)
    monkeypatch.setattr(transfers,'export_table',fail);assert jobs.run_next()
    failed=auth.get(f"/api/v1/tasks/{second['id']}").json();assert failed['status']=='failed' and failed['error']=='测试失败原因'
    token=auth.post('/api/v1/agent-tokens',json={'name':'工具只读','scopes':['all:read']}).json()['token']
    with TestClient(app) as client:
        client.headers['Authorization']='Bearer '+token
        assert client.get('/api/v1/agent/tasks').status_code==200
        assert client.get('/api/v1/agent/backups').status_code==403
        assert client.post(path,json={'scope':'all'}).status_code==401


def test_encrypted_backup_verify_restore_and_no_overwrite(auth,db,tmp_path,monkeypatch):
    if not settings.is_sqlite:pytest.skip('SQLite restore exercise; PostgreSQL has a separate offline restore drill')
    monkeypatch.setattr(settings,'backup_dir',tmp_path/'backups')
    storage=settings.storage_dir;storage.mkdir(parents=True,exist_ok=True)
    (storage/'example.txt').write_text('需要恢复的附件')
    note=auth.post('/api/v1/notes',json={'title':'恢复演练','content':'恢复后的正文'}).json()
    queued=auth.post('/api/v1/backups');assert queued.status_code==202,queued.text
    assert jobs.run_next()
    result=auth.get('/api/v1/tasks/'+str(queued.json()['id'])).json();assert result['status']=='completed',result
    name=result['result']['id'];assert result['result']['verified'] is True
    archive=backups.archive_path(name);assert archive.read_bytes()[:4]==b'WBK1'
    assert backups.verify_backup(name)['verified'] is True
    spec=importlib.util.spec_from_file_location('restore_backup',Path(__file__).resolve().parents[2]/'scripts/restore_backup.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    url='sqlite:///'+str(tmp_path/'restored.db');target=tmp_path/'restored-storage';env=tmp_path/'recovered.env'
    restored=module.restore(archive,backups.key_file(),url,target,env)
    assert restored['restored'] and (target/'example.txt').read_text()=='需要恢复的附件'
    with sqlite3.connect(tmp_path/'restored.db') as conn:assert conn.execute('select content from notes where id=?',(note['id'],)).fetchone()[0]=='恢复后的正文'
    assert settings.encryption_key in env.read_text()
    with pytest.raises(RuntimeError):module.restore(archive,backups.key_file(),url,target,env)
    tampered=tmp_path/'tampered.wbbackup';raw=bytearray(archive.read_bytes());raw[-1]^=1;tampered.write_bytes(raw)
    from cryptography.exceptions import InvalidTag
    with pytest.raises(InvalidTag):backups.decrypt_archive(tampered,tmp_path/'bad.tar',base64.urlsafe_b64decode(backups.key_file().read_bytes()))


def test_backup_directory_failure_allows_retry(tmp_path, monkeypatch):
    from threading import Lock

    monkeypatch.setattr(backups, '_lock', Lock())
    monkeypatch.setattr(settings, 'storage_dir', tmp_path / 'storage')
    monkeypatch.setattr(settings, 'backup_dir', settings.storage_dir / 'backups')
    with pytest.raises(RuntimeError, match='备份目录必须放在附件目录之外'):
        backups.create_backup()

    monkeypatch.setattr(settings, 'backup_dir', tmp_path / 'backups')
    result = backups.create_backup()
    assert backups.verify_backup(result['id'])['verified']


def test_cancelled_backup_keeps_previous_verified_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'backup_dir', tmp_path / 'backups')
    monkeypatch.setattr(settings, 'backup_keep', 1)
    previous = backups.create_backup()

    def cancel_at_final_progress(done, total):
        if done == total:
            raise jobs.Cancelled()

    with pytest.raises(jobs.Cancelled):
        backups.create_backup(cancel_at_final_progress)

    assert [item['id'] for item in backups.list_backups()] == [previous['id']]
    assert backups.verify_backup(previous['id'])['verified']


def test_backup_retention_failure_preserves_new_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'backup_dir', tmp_path / 'backups')
    monkeypatch.setattr(settings, 'backup_keep', 1)
    previous = backups.create_backup()
    old_archive = backups.archive_path(previous['id'])
    unlink = Path.unlink

    def fail_only_for_old_archive(path, *args, **kwargs):
        if path == old_archive:
            raise PermissionError('simulated backup retention failure')
        return unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'unlink', fail_only_for_old_archive)
    result = backups.create_backup()

    assert backups.verify_backup(result['id'])['verified']
    assert backups.verify_backup(previous['id'])['verified']


def test_backup_rejects_attachment_deleted_after_database_snapshot(auth, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'storage_dir', tmp_path / 'storage')
    monkeypatch.setattr(settings, 'backup_dir', tmp_path / 'backups')
    response = auth.post('/api/v1/files', files={'file': ('fixture.pdf', b'attachment', 'application/pdf')})
    assert response.status_code == 201
    file_id = response.json()['id']

    def delete_after_snapshot(done, total):
        if done == 10:
            assert auth.delete(f'/api/v1/files/{file_id}').status_code == 200

    with pytest.raises(ApiError, match='数据库快照中的附件') as failure:
        backups.create_backup(delete_after_snapshot)

    assert failure.value.code == 'BACKUP_ATTACHMENT_MISSING'
    assert backups.list_backups() == []


def test_backup_task_explains_missing_attachment(auth, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'storage_dir', tmp_path / 'storage')
    monkeypatch.setattr(settings, 'backup_dir', tmp_path / 'backups')
    upload = auth.post('/api/v1/files', files={'file': ('fixture.pdf', b'attachment', 'application/pdf')})
    assert upload.status_code == 201
    next((settings.storage_dir / 'files').iterdir()).unlink()

    queued = auth.post('/api/v1/backups')
    assert queued.status_code == 202
    assert jobs.run_next()
    task = auth.get(f"/api/v1/tasks/{queued.json()['id']}").json()
    assert task['status'] == 'failed'
    assert '数据库快照中的附件' in task['error']


def test_search_escapes_wildcards_excludes_deleted_and_logs_no_secrets(auth):
    note=auth.post('/api/v1/notes',json={'title':'查找专用100%','content':'唯一标记XYZ'}).json()
    gone=auth.post('/api/v1/notes',json={'title':'已删除XYZ','content':'删除内容'}).json()
    auth.delete('/api/v1/notes/'+str(gone['id']))
    result=auth.get('/api/v1/search',params={'q':'XYZ'}).json()
    assert any(r['id']==note['id'] and r['kind']=='notes' for r in result['items'])
    assert not any(r['id']==gone['id'] and r['kind']=='notes' for r in result['items'])
    assert auth.get('/api/v1/search',params={'q':'100%','kind':'notes'}).json()['total']==1
    token=auth.post('/api/v1/agent-tokens',json={'name':'日志测试','scopes':['all:read']}).json()['token']
    activity=auth.get('/api/v1/activity').json()
    assert activity['total']>=4 and token not in json.dumps(activity)


def test_cache_invalidates_on_record_edit_and_delete(auth):
    from test_dashboards import source,add,board,widget
    t,keys=source(auth);record=add(auth,t,keys,销售额='12')
    b=board(auth,[widget(t,keys)]);path=f"/api/v1/dashboards/{b['id']}/data"
    first=auth.get(path);assert first.status_code==200,first.text
    assert first.json()['cached'] is False
    assert auth.get(path).json()['cached'] is True
    auth.put('/api/v1/records/'+str(record['id']),json={'version':1,'data':{keys['销售额']:'13'}})
    fresh=auth.get(path).json();assert fresh['cached'] is False and fresh['widgets'][0]['value']=='13'
    auth.delete('/api/v1/records/'+str(record['id']))
    assert auth.get(path).json()['cached'] is False


def test_agent_record_scope_independent_changes_and_review_note(auth):
    from test_agent_staging import agent
    client=agent(auth);t=table(auth);key=t['fields'][0]['key']
    rows=[auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{key:str(i)}}).json() for i in range(2)]
    staged=client.patch('/api/v1/agent/records/'+str(rows[0]['id']),json={'version':1,'data':{key:'99'}})
    assert staged.status_code==202,staged.text
    assert staged.json()['preview'][0]['changes'][0]['label']=='金额'
    auth.put('/api/v1/records/'+str(rows[1]['id']),json={'version':1,'data':{key:'88'}})
    merged=auth.post(f"/api/v1/agent-changes/{staged.json()['id']}/merge",json={'version':1,'note':'已核对金额'})
    assert merged.status_code==200,merged.text
    detail=auth.get(f"/api/v1/agent-changes/{staged.json()['id']}").json()
    assert detail['review_note']=='已核对金额'


def test_split_independent_changes_and_reject_references(auth):
    from test_agent_staging import agent
    client=agent(auth)
    staged=client.post('/api/v1/agent/changes',json={'operations':[{'method':'POST','path':'/todo-lists','body':{'name':'清单A'}},{'method':'POST','path':'/memos','body':{'content':'独立便利贴'}}]})
    assert staged.status_code==202,staged.text
    split=auth.post(f"/api/v1/agent-changes/{staged.json()['id']}/split",json={'version':1,'indices':[1]})
    assert split.status_code==201,split.text
    assert split.json()['original']['status']=='split' and len(split.json()['original']['related_change_ids'])==2
    assert split.json()['remaining']['operation_count']==1 and split.json()['split']['operation_count']==1
    assert auth.post(f"/api/v1/agent-changes/{staged.json()['id']}/merge",json={'version':split.json()['original']['version']}).status_code==409
    for change in (split.json()['remaining'],split.json()['split']):
        merged=auth.post(f"/api/v1/agent-changes/{change['id']}/merge",json={'version':change['version']})
        assert merged.status_code==200,merged.text

def test_async_import_and_stale_mapping_rejected(auth,db):
    from test_files_transfers import make_xlsx
    raw=make_xlsx([[f'A{i}',i] for i in range(1100)],['名称','金额'])
    source=auth.post('/api/v1/imports/preview',files={'file':('queued.xlsx',raw,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()
    draft=auth.post(f"/api/v1/imports/{source['id']}/draft",json={});assert draft.status_code==200,draft.text
    queued=auth.post(f"/api/v1/imports/{source['id']}/confirm-tasks");assert queued.status_code==202,queued.text
    assert db.scalar(select(func.count()).select_from(DataRecord))==0
    assert jobs.run_next()
    result=auth.get('/api/v1/tasks/'+str(queued.json()['id'])).json();assert result['status']=='completed',result
    assert result['result']['result']['imported']==1100
    assert db.scalar(select(func.count()).select_from(DataRecord))==1100
    second=auth.post('/api/v1/imports/preview',files={'file':('stale.xlsx',raw,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()
    auth.post(f"/api/v1/imports/{second['id']}/draft",json={})
    queued=auth.post(f"/api/v1/imports/{second['id']}/confirm-tasks").json()
    auth.post(f"/api/v1/imports/{second['id']}/draft",json={'table_name':'用户后来修改名称'})
    assert jobs.run_next()
    result=auth.get('/api/v1/tasks/'+str(queued['id'])).json();assert result['status']=='failed' and '映射已改变' in result['error']
    assert db.scalar(select(func.count()).select_from(DataRecord))==1100


def test_staging_merge_and_refresh_work_with_single_connection(auth):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import QueuePool
    from app.db import engine,get_db
    from app.main import app
    from test_agent_staging import agent
    from app.config import settings
    small=create_engine(settings.database_url,poolclass=QueuePool,pool_size=1,max_overflow=0,pool_timeout=.3,connect_args={'check_same_thread':False} if settings.is_sqlite else {})
    def limited_db():
        from app.agent_runtime import execution
        context=execution.get()
        if context is not None:
            yield context.db;return
        with Session(small,autoflush=False,expire_on_commit=False) as session:yield session
    app.dependency_overrides[get_db]=limited_db
    try:
        client=agent(auth)
        result=client.post('/api/v1/agent/todo-lists',json={'name':'单连接预览'})
        assert result.status_code==202,result.text
        id=result.json()['id']
        refreshed=auth.post(f'/api/v1/agent-changes/{id}/refresh',json={'version':1})
        assert refreshed.status_code==200,refreshed.text
        merged=auth.post(f'/api/v1/agent-changes/{id}/merge',json={'version':2})
        assert merged.status_code==200,merged.text
    finally:app.dependency_overrides.pop(get_db,None);small.dispose()

def test_precompressed_asset_negotiation_and_cache(tmp_path):
    import gzip
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.static_assets import PrecompressedAssets
    raw=b'const value = 123;\n'*1000
    (tmp_path/'example-abc123.js').write_bytes(raw)
    (tmp_path/'example-abc123.js.gz').write_bytes(gzip.compress(raw))
    test=FastAPI();test.mount('/assets',PrecompressedAssets(directory=tmp_path))
    with TestClient(test) as client:
        response=client.get('/assets/example-abc123.js',headers={'Accept-Encoding':'gzip'})
        assert response.content==raw and response.headers['Content-Encoding']=='gzip'
        assert 'immutable' in response.headers['Cache-Control']
        assert response.headers['Vary']=='Accept-Encoding'
        assert client.get('/assets/example-abc123.js',headers={'Accept-Encoding':'gzip','If-None-Match':response.headers['ETag']}).status_code==304
        uncompressed=client.get('/assets/example-abc123.js',headers={'Accept-Encoding':'br;q=0,gzip;q=0'})
        assert 'Content-Encoding' not in uncompressed.headers and uncompressed.content==raw

def test_global_search_does_not_count_every_record_before_first_results(auth,db):
    from sqlalchemy import event
    db.add_all([Note(title='快速搜索'+str(i),content='正文') for i in range(60)]);db.commit()
    statements=[]
    def capture(connection,cursor,statement,parameters,context,many):statements.append(statement)
    event.listen(db.get_bind(),'before_cursor_execute',capture)
    try:
        result=auth.get('/api/v1/search',params={'q':'快速搜索'}).json()
        assert len(result['items'])==20 and result['has_more'] and not result['total_is_exact']
        assert not any('COUNT(' in sql.upper() for sql in statements)
    finally:event.remove(db.get_bind(),'before_cursor_execute',capture)
    selected=auth.get('/api/v1/search',params={'q':'快速搜索','kind':'notes'}).json()
    assert selected['total']==60 and selected['total_is_exact']

def test_record_search_matches_values_not_internal_field_keys(auth):
    t=table(auth);key=t['fields'][0]['key']
    auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{key:'987654321'}})
    assert auth.get('/api/v1/search',params={'q':key,'kind':'records'}).json()['total']==0
    found=auth.get('/api/v1/search',params={'q':'987654321','kind':'records'}).json()
    assert found['total']==1 and '金额：987654321' in found['items'][0]['excerpt']
    assert key not in found['items'][0]['excerpt']


def test_backups_are_admin_only(auth, db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import User
    from app.security import hash_password
    db.add(User(username='backup-viewer', password_hash=hash_password('viewer12345')))
    db.commit()
    with TestClient(app) as other:
        other.get('/api/v1/health')
        login = other.post('/api/v1/auth/login', json={'username': 'backup-viewer', 'password': 'viewer12345'})
        assert login.status_code == 200, login.text
        assert other.get('/api/v1/backups').status_code == 403
        assert other.get('/api/v1/backups/recovery-key').status_code == 403
