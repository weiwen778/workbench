import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import TodoList, Todo, DataRecord, AgentChange
from sqlalchemy import select,func


def agent(auth):
    token=auth.post('/api/v1/agent-tokens',json={'name':'全业务 Agent','scopes':['all:stage'],'policy':{
        'modules':[],'tables':[],'operations':['create','update','delete'],
        'allow_schema':True,'allow_files':True,'allow_external':True,'allow_irreversible':True,
        'max_operations':100,'daily_runs':1000,
    }})
    assert token.status_code==201,token.text
    client=TestClient(app)
    client.headers['Authorization']='Bearer '+token.json()['token']
    return client


def test_stage_create_merge_and_no_self_approval(auth,db):
    client=agent(auth)
    result=client.post('/api/v1/agent/todo-lists',json={'name':'待审核清单'})
    assert result.status_code==202,result.text
    change=result.json();assert change['status']=='pending' and not change['business_data_changed']
    assert db.scalar(select(func.count()).select_from(TodoList))==0
    assert client.post(f"/api/v1/agent-changes/{change['id']}/merge",json={'version':1}).status_code==401
    assert client.post('/api/v1/agent/agent-changes/1/merge',json={'version':1}).status_code==403
    merged=auth.post(f"/api/v1/agent-changes/{change['id']}/merge",json={'version':1})
    assert merged.status_code==200,merged.text
    assert merged.json()['status']=='applied'
    assert auth.get('/api/v1/todo-lists').json()[0]['name']=='待审核清单'
    assert auth.post(f"/api/v1/agent-changes/{change['id']}/merge",json={'version':1}).status_code==200
    assert len(auth.get('/api/v1/todo-lists').json())==1


def test_batch_references_and_atomic_commit(auth,db):
    client=agent(auth)
    change=client.post('/api/v1/agent/changes',json={'title':'创建表格并写记录','request_key':'create-once','operations':[
        {'ref':'table','method':'POST','path':'/tables','body':{'name':'Agent 表格','fields':[{'name':'金额','type':'number'}]}},
        {'ref':'record','method':'POST','path':'/tables/{{table.id}}/records','body':{'data':{'{{table.fields.0.key}}':'0.3'}}},
    ]})
    assert change.status_code==202,change.text
    assert db.scalar(select(func.count()).select_from(DataRecord))==0
    repeated=client.post('/api/v1/agent/changes',json={'title':'创建表格并写记录','request_key':'create-once','operations':[
        {'ref':'table','method':'POST','path':'/tables','body':{'name':'Agent 表格','fields':[{'name':'金额','type':'number'}]}},
        {'ref':'record','method':'POST','path':'/tables/{{table.id}}/records','body':{'data':{'{{table.fields.0.key}}':'0.3'}}},
    ]})
    assert repeated.json()['id']==change.json()['id']
    merged=auth.post(f"/api/v1/agent-changes/{change.json()['id']}/merge",json={'version':1})
    assert merged.status_code==200,merged.text
    assert merged.json()['results'][1]['data']=={merged.json()['results'][0]['fields'][0]['key']:'0.3'}


def test_conflict_reject_and_read_other_modules(auth,db):
    client=agent(auth)
    note=auth.post('/api/v1/notes',json={'title':'原文','content':'用户内容'}).json()
    response=client.put(f"/api/v1/agent/notes/{note['id']}",json={'title':'Agent 标题','version':note['version']})
    assert response.status_code==202,response.text
    assert auth.get(f"/api/v1/notes/{note['id']}").json()['title']=='原文'
    auth.put(f"/api/v1/notes/{note['id']}",json={'title':'后来手动改名','version':note['version']})
    merged=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/merge",json={'version':1})
    assert merged.status_code==409,merged.text
    assert auth.get(f"/api/v1/notes/{note['id']}").json()['title']=='后来手动改名'
    rejected=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/reject",json={'version':1})
    assert rejected.status_code==200 and rejected.json()['status']=='rejected'
    assert client.get('/api/v1/agent/memos').status_code==200
    assert client.get('/api/v1/agent/dashboards').status_code==200
    assert client.get('/api/v1/agent/capabilities').status_code==200


def test_read_only_token_cannot_stage_and_paths_are_reserved(auth):
    token=auth.post('/api/v1/agent-tokens',json={'name':'只读','scopes':['all:read']}).json()['token']
    with TestClient(app) as client:
        client.headers['Authorization']='Bearer '+token
        assert client.get('/api/v1/agent/notes').status_code==200
        assert client.post('/api/v1/agent/memos',json={'content':'不应写入'}).status_code==403
        assert client.get('/api/v1/agent/agent-tokens').status_code==403
        assert client.post('/api/v1/agent/changes',json={'operations':[{'method':'POST','path':'/auth/login','body':{}}]}).status_code==403

def test_upload_is_staged_idempotent_and_reject_cleans_blob(auth,db):
    from app.config import settings
    from app.models import FileObject
    client=agent(auth)
    response=client.post('/api/v1/agent/files',files={'file':('report.txt',b'hello staged file','text/plain')},headers={'Idempotency-Key':'upload-once'})
    assert response.status_code==202,response.text
    assert response.json()['preview'][0]['deferred'] is True
    assert db.scalar(select(func.count()).select_from(FileObject))==0
    repeated=client.post('/api/v1/agent/files',files={'file':('report.txt',b'hello staged file','text/plain')},headers={'Idempotency-Key':'upload-once'})
    assert repeated.status_code==202 and repeated.json()['id']==response.json()['id']
    assert len(list((settings.storage_dir/'agent-staging').glob('*')))==1
    rejected=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/reject",json={'version':1})
    assert rejected.status_code==200,rejected.text
    assert not list((settings.storage_dir/'agent-staging').glob('*'))
    assert db.scalar(select(func.count()).select_from(FileObject))==0


def test_upload_merge_and_download(auth,db):
    from app.models import FileObject
    client=agent(auth)
    response=client.post('/api/v1/agent/files',files={'file':('report.txt',b'merged content','text/plain')})
    assert response.status_code==202,response.text
    merged=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/merge",json={'version':1})
    assert merged.status_code==200,merged.text
    assert db.scalar(select(func.count()).select_from(FileObject))==1
    id=merged.json()['results'][0]['id']
    assert client.get(f'/api/v1/agent/files/{id}/download').content==b'merged content'


def test_batch_validation_rolls_back_and_merge_failure_is_atomic(auth,db,monkeypatch):
    from app.services import agent_staging as staging
    from app.errors import ApiError
    client=agent(auth)
    bad=client.post('/api/v1/agent/changes',json={'operations':[
        {'method':'POST','path':'/todo-lists','body':{'name':'不应残留'}},
        {'method':'POST','path':'/todos','body':{'list_id':99999,'title':'目标不存在'}}]})
    assert bad.status_code==404,bad.text
    assert db.scalar(select(func.count()).select_from(TodoList))==0
    assert db.scalar(select(func.count()).select_from(AgentChange))==0
    response=client.post('/api/v1/agent/changes',json={'operations':[
        {'method':'POST','path':'/todo-lists','body':{'name':'第一步'}},
        {'method':'POST','path':'/todo-lists','body':{'name':'第二步'}}]})
    assert response.status_code==202,response.text
    original=staging.dispatch
    async def fail_second(*args,**kwargs):
        operation=args[-1]
        if operation.get('body',{}).get('name')=='第二步':raise ApiError('SIMULATED','模拟第二步失败',422)
        return await original(*args,**kwargs)
    monkeypatch.setattr(staging,'dispatch',fail_second)
    result=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/merge",json={'version':1})
    assert result.status_code==422,result.text
    assert db.scalar(select(func.count()).select_from(TodoList))==0
    detail=client.get(f"/api/v1/agent/changes/{response.json()['id']}").json()
    assert detail['status']=='pending' and detail['error']


def test_refresh_requires_new_review_version_and_bearer_cookie_cannot_review(auth):
    client=agent(auth)
    response=client.post('/api/v1/agent/todo-lists',json={'name':'Agent 清单'}).json()
    auth.post('/api/v1/todo-lists',json={'name':'用户新建清单'})
    assert auth.post(f"/api/v1/agent-changes/{response['id']}/merge",json={'version':1}).status_code==409
    refreshed=auth.post(f"/api/v1/agent-changes/{response['id']}/refresh",json={'version':1})
    assert refreshed.status_code==200,refreshed.text
    assert refreshed.json()['version']==2
    assert auth.post(f"/api/v1/agent-changes/{response['id']}/merge",json={'version':1}).status_code==409
    assert auth.post(f"/api/v1/agent-changes/{response['id']}/merge",json={'version':2},headers={'Authorization':client.headers['Authorization']}).status_code==403
    assert auth.post(f"/api/v1/agent-changes/{response['id']}/merge",json={'version':2}).status_code==200


def test_delete_is_pending_until_merge_and_secrets_are_encrypted(auth,db):
    client=agent(auth)
    note=auth.post('/api/v1/notes',json={'title':'待删除','content':'用户内容'}).json()
    response=client.delete(f"/api/v1/agent/notes/{note['id']}")
    assert response.status_code==202,response.text
    assert auth.get(f"/api/v1/notes/{note['id']}").status_code==200
    merged=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/merge",json={'version':1})
    assert merged.status_code==200,merged.text
    assert auth.get(f"/api/v1/notes/{note['id']}").status_code==404
    response=client.put('/api/v1/agent/translation-connections/deepseek',json={'config':{'api_key':'highly-sensitive-test-secret'}})
    assert response.status_code in (403,404),response.text
    response=client.post('/api/v1/agent/notes',json={'title':'密钥测试','content':'highly-sensitive-test-secret'})
    assert response.status_code==202,response.text
    draft=db.get(AgentChange,response.json()['id'])
    assert 'highly-sensitive-test-secret' not in draft.operations_cipher


def test_other_tokens_cannot_read_proposal_and_key_cannot_change_content(auth):
    client=agent(auth);other=agent(auth)
    response=client.post('/api/v1/agent/todo-lists',json={'name':'私有暂存'},headers={'Idempotency-Key':'unique-key'})
    assert other.get(f"/api/v1/agent/changes/{response.json()['id']}").status_code==404
    assert client.post('/api/v1/agent/todo-lists',json={'name':'不同内容'},headers={'Idempotency-Key':'unique-key'}).status_code==409
    for path in ('/api/v1/auth/password','/notes/../auth/login','/notes/%252e%252e/auth/login','https://example.com/notes'):
        result=client.post('/api/v1/agent/changes',json={'operations':[{'method':'POST','path':path,'body':{}}]})
        assert result.status_code in (403,422),result.text
    assert client.get('/api/v1/agent/checkin-statistics').status_code==200
    capabilities=client.get('/api/v1/agent/capabilities').json()
    assert any(item['path']=='/table-views/{view_id}' for item in capabilities['routes'])
    assert any(item['path']=='/memos/categories/manage' for item in capabilities['routes'])

def test_binary_workbook_export_only_runs_on_merge(auth):
    import io
    from openpyxl import load_workbook
    client=agent(auth)
    table=auth.post('/api/v1/tables',json={'name':'导出测试','fields':[{'name':'名称','type':'short_text'}]}).json()
    response=client.post(f"/api/v1/agent/tables/{table['id']}/workbook/export",json={'snapshot':{'sheetOrder':['x'],'sheets':{'x':{'name':'数据','cellData':{'0':{'0':{'v':'00123'}}}}}}})
    assert response.status_code==202,response.text
    assert response.json()['preview'][0]['deferred'] is True
    assert client.get(f"/api/v1/agent/changes/{response.json()['id']}/files/0").status_code==404
    merged=auth.post(f"/api/v1/agent-changes/{response.json()['id']}/merge",json={'version':1})
    assert merged.status_code==200,merged.text
    output=client.get(merged.json()['results'][0]['agent_download_url'])
    assert output.status_code==200,output.text[:200]
    book=load_workbook(io.BytesIO(output.content))
    assert book.active['A1'].value=='00123'
    book.close()