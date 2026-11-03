import uuid
from sqlalchemy import select
from app.models import DataRecord, TableWorkbook, User
from app.security import hash_password

def setup(auth):
    t=auth.post('/api/v1/tables',json={'name':'测试表','fields':[{'name':'名称','type':'short_text','required':True},{'name':'数量','type':'number'},{'name':'单价','type':'number'}]}).json()
    a,b,c=[f['key'] for f in t['fields']]
    rows=[auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{a:'甲',b:'2',c:'3.5'}}).json(),auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{a:'乙',b:'4',c:'1'}}).json()]
    return t,(a,b,c),rows

def tx(auth,t,edits,key=None):
    return auth.post(f"/api/v1/tables/{t['id']}/transactions",json={'schema_version':t['schema_version'],'request_id':key or uuid.uuid4().hex,'edits':edits})

def test_transaction_atomic_and_idempotent(auth):
    t,(a,b,c),rows=setup(auth);key=uuid.uuid4().hex
    edits=[{'id':r['id'],'version':r['version'],'changes':{b:'8'}} for r in rows]
    first=tx(auth,t,edits,key);assert first.status_code==200
    again=tx(auth,t,edits,key);assert again.status_code==200 and again.json()['replayed']
    assert auth.get('/api/v1/records/'+str(rows[0]['id'])).json()['version']==2
    edits[0]['changes'][b]='9';assert tx(auth,t,edits,key).status_code==409

def test_whole_batch_rejected_on_validation_or_version(auth):
    t,(a,b,c),rows=setup(auth)
    for change in [{'id':rows[1]['id'],'version':1,'changes':{b:'not number'}},{'id':rows[1]['id'],'version':9,'changes':{b:'5'}}]:
        response=tx(auth,t,[{'id':rows[0]['id'],'version':1,'changes':{b:'8'}},change]);assert response.status_code in {409,422}
        assert auth.get('/api/v1/records/'+str(rows[0]['id'])).json()['data'][b]=='2'

def test_cross_table_record_and_schema_protection(auth):
    t,keys,rows=setup(auth);other=auth.post('/api/v1/tables',json={'name':'另表','fields':[{'name':'字','type':'short_text'}]}).json()
    assert tx(auth,other,[{'id':rows[0]['id'],'version':1,'changes':{}}]).status_code==404
    auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'新增','type':'short_text'})
    assert tx(auth,t,[{'id':rows[0]['id'],'version':1,'changes':{}}]).status_code==409

def test_undo_redo_and_concurrent_external_write(auth):
    t,(a,b,c),rows=setup(auth)
    op=tx(auth,t,[{'id':rows[0]['id'],'version':1,'changes':{b:'8'}}]).json()['operation']
    undo=auth.post(f"/api/v1/table-changes/{op['id']}/undo",json={'request_id':uuid.uuid4().hex});assert undo.status_code==200
    assert auth.get('/api/v1/records/'+str(rows[0]['id'])).json()['data'][b]=='2'
    redo=auth.post(f"/api/v1/table-changes/{undo.json()['operation']['id']}/undo",json={'request_id':uuid.uuid4().hex});assert redo.status_code==200
    latest=auth.get('/api/v1/records/'+str(rows[0]['id'])).json();latest['data'][b]='99'
    assert auth.put('/api/v1/records/'+str(rows[0]['id']),json={'version':latest['version'],'data':latest['data']}).status_code==200
    assert auth.post(f"/api/v1/table-changes/{redo.json()['operation']['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==409

def test_creation_deletion_undo_respects_trash(auth):
    t,(a,b,c),rows=setup(auth)
    op=tx(auth,t,[{'changes':{a:'新行'}}]).json()['operation']
    u=auth.post(f"/api/v1/table-changes/{op['id']}/undo",json={'request_id':uuid.uuid4().hex});assert u.status_code==200
    history=auth.get(f"/api/v1/tables/{t['id']}/changes").json();assert auth.get('/api/v1/table-changes/'+str(history[0]['id'])).json()['changes'][0]['after']['deleted']
    assert auth.post(f"/api/v1/table-changes/{u.json()['operation']['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==200
    d=tx(auth,t,[{'id':rows[0]['id'],'version':1,'delete':True}]);assert d.status_code==200
    assert auth.get('/api/v1/records/'+str(rows[0]['id'])).status_code==404
    assert auth.post(f"/api/v1/table-changes/{d.json()['operation']['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==200
    assert auth.get('/api/v1/records/'+str(rows[0]['id'])).status_code==200

def test_saved_views_versioned_and_private(auth,db,client):
    t,keys,rows=setup(auth)
    v=auth.post(f"/api/v1/tables/{t['id']}/views",json={'name':'我的视图','config':{'hidden':[keys[1]],'frozen':2}});assert v.status_code==201
    v=v.json();assert auth.put('/api/v1/table-views/'+str(v['id']),json={**v,'version':9}).status_code==409
    db.add(User(username='second',password_hash=hash_password('test12345'),theme='light'));db.commit()
    client.post('/api/v1/auth/logout');client.post('/api/v1/auth/login',json={'username':'second','password':'test12345'});client.headers['X-CSRF-Token']=client.cookies.get('wb_csrf')
    assert client.get(f"/api/v1/tables/{t['id']}/views").json()==[]
    assert client.delete('/api/v1/table-views/'+str(v['id'])).status_code==404

def test_formula_decimal_recalculation_and_rename(auth):
    t,(a,b,c),rows=setup(auth)
    f=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'总价','type':'formula','config':{'expression':'ROUND({数量} * {单价}, 2)'}});assert f.status_code==201,f.text
    f=f.json();key=f['key'];path=f"/api/v1/tables/{t['id']}/workspace"
    assert auth.get(path).json()['records'][0]['data'][key]=='7'
    auth.patch('/api/v1/fields/'+str(t['fields'][1]['id']),json={'name':'件数'})
    assert auth.get(path).json()['records'][0]['data'][key]=='7'
    current=auth.get('/api/v1/records/'+str(rows[0]['id'])).json();current['data'][b]='3'
    auth.put('/api/v1/records/'+str(current['id']),json={'version':current['version'],'data':current['data']})
    assert auth.get(path).json()['records'][0]['data'][key]=='10.5'

def test_formula_rejects_execution_and_cycles(auth):
    t,(a,b,c),rows=setup(auth)
    for expr in ["__import__('os').getcwd()",'2 ** 1000000','[1]*100000000',"F('missing')"]:
        assert auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'错误','type':'formula','config':{'expression':expr}}).status_code==422
    one=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'一','type':'formula','config':{'expression':'{数量}+1'}}).json()
    two=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'二','type':'formula','config':{'expression':'{一}+1'}}).json()
    assert auth.patch('/api/v1/fields/'+str(one['id']),json={'config':{'expression':'{二}+1'}}).status_code==422

def test_formula_failure_does_not_destroy_row(auth):
    t,(a,b,c),rows=setup(auth)
    f=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'除零','type':'formula','config':{'expression':'1/0'}}).json()
    row=auth.get(f"/api/v1/tables/{t['id']}/workspace").json()['records'][0]
    assert row['data'][f['key']] is None and f['key'] in row['computed_errors'] and row['data'][a]=='甲'
    assert auth.put('/api/v1/records/'+str(rows[0]['id']),json={'version':1,'data':{a:'甲',f['key']:'注入'}}).status_code==422

def test_reference_lookup_rollup_and_deleted_source(auth):
    t,(a,b,c),rows=setup(auth)
    other=auth.post('/api/v1/tables',json={'name':'关联目标','fields':[{'name':'关联','type':'reference','config':{'table_id':t['id'],'label_field':a,'multiple':True}}]}).json()
    ref=other['fields'][0]['key'];r=auth.post(f"/api/v1/tables/{other['id']}/records",json={'data':{ref:[r['id'] for r in rows]}});assert r.status_code==201,r.text
    lookup=auth.post(f"/api/v1/tables/{other['id']}/fields",json={'name':'名称集合','type':'lookup','config':{'reference_field':ref,'target_field':a}}).json()
    rollup=auth.post(f"/api/v1/tables/{other['id']}/fields",json={'name':'数量合计','type':'rollup','config':{'reference_field':ref,'target_field':b,'operation':'sum'}}).json()
    result=auth.get(f"/api/v1/tables/{other['id']}/workspace").json()['records'][0]
    assert result['data'][lookup['key']]==['甲','乙'] and result['data'][rollup['key']]=='6'
    assert auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{a:'丙'}}).status_code==201
    auth.delete('/api/v1/records/'+str(rows[0]['id']))
    result=auth.get(f"/api/v1/tables/{other['id']}/workspace").json()['records'][0];assert result['data'][rollup['key']]=='4'
    assert auth.post(f"/api/v1/tables/{other['id']}/records",json={'data':{ref:[True]}}).status_code==422

def test_workbook_roundtrip_conflict_and_limits(auth):
    t,keys,rows=setup(auth);url=f"/api/v1/tables/{t['id']}/workbook"
    assert auth.get(url).json()['snapshot'] is None
    snapshot={'id':'wb','sheetOrder':['sheet'],'sheets':{'sheet':{'id':'sheet','name':'Sheet1','rowCount':100,'columnCount':26,'cellData':{'0':{'0':{'v':'0012'},'1':{'f':'=1+2'}}},'mergeData':[{'startRow':2,'endRow':2,'startColumn':0,'endColumn':1}]}}}
    assert auth.put(url,json={'version':0,'snapshot':snapshot}).json()['version']==1
    assert auth.get(url).json()['snapshot']==snapshot
    assert auth.put(url,json={'version':0,'snapshot':snapshot}).status_code==409
    snapshot['sheets']['sheet']['rowCount']=99999999
    assert auth.put(url,json={'version':1,'snapshot':snapshot}).status_code==422
    assert auth.get(url).json()['version']==1

def test_workspace_requires_auth(client):
    assert client.get('/api/v1/tables/1/workspace').status_code==401


def test_consecutive_undo_and_new_edit_invalidates_redo(auth):
    t,(a,b,c),rows=setup(auth);rid=rows[0]['id']
    first=tx(auth,t,[{'id':rid,'version':1,'changes':{b:'8'}}]).json()['operation']
    second=tx(auth,t,[{'id':rid,'version':2,'changes':{b:'9'}}]).json()['operation']
    u=auth.post(f"/api/v1/table-changes/{second['id']}/undo",json={'request_id':uuid.uuid4().hex});assert u.status_code==200
    assert auth.post(f"/api/v1/table-changes/{first['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==200
    assert auth.get('/api/v1/records/'+str(rid)).json()['data'][b]=='2'
    assert tx(auth,t,[{'id':rid,'version':5,'changes':{b:'10'}}]).status_code==200
    assert auth.post(f"/api/v1/table-changes/{u.json()['operation']['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==409


def test_computed_columns_in_classic_paging_sort_filter_and_export(auth):
    import json,io
    from openpyxl import load_workbook
    t,(a,b,c),rows=setup(auth)
    field=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'总价','type':'formula','config':{'expression':'{数量}*{单价}'}}).json();key=field['key']
    result=auth.get(f"/api/v1/tables/{t['id']}/records",params={'filters':json.dumps([{'field':key,'op':'gt','value':'5'}]),'sorts':json.dumps([{'field':key,'order':'desc'}])})
    assert result.status_code==200,result.text
    assert result.json()['total']==1 and result.json()['items'][0]['data'][key]=='7'
    direct=auth.get('/api/v1/records/'+str(rows[0]['id'])).json();assert direct['data'][key]=='7'
    direct['data'][b]='3';assert auth.put('/api/v1/records/'+str(rows[0]['id']),json={'data':direct['data'],'version':direct['version']}).status_code==200
    assert auth.get('/api/v1/records/'+str(rows[0]['id'])).json()['data'][key]=='10.5'
    exported=auth.post(f"/api/v1/tables/{t['id']}/exports",json={'scope':'all'});assert exported.status_code==201,exported.text


def test_visualization_uses_live_computed_values(auth,db):
    from decimal import Decimal
    from app.services.dashboard import aggregate,Widget,DateRange
    t,(a,b,c),rows=setup(auth)
    f=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'总价','type':'formula','config':{'expression':'{数量}*{单价}'}}).json()
    w=Widget(id='computed',title='公式合计',kind='metric',table_id=t['id'],aggregation='sum',value_field=f['key'])
    result=aggregate(db,[w],DateRange())[0]
    assert result['status']=='ok' and Decimal(result['value'])==Decimal('11')


def test_agent_and_legacy_writes_are_journaled(auth):
    from fastapi.testclient import TestClient
    from app.main import app
    t,(a,b,c),rows=setup(auth)
    token=auth.post('/api/v1/agent-tokens',json={'name':'表格测试 Agent','scopes':['tables:write']}).json()['token']
    with TestClient(app) as agent:
        agent.headers['Authorization']='Bearer '+token
        draft=agent.patch('/api/v1/agent/records/'+str(rows[0]['id']),json={'version':1,'data':{b:'17'}})
        assert draft.status_code==202,draft.text
        assert auth.get('/api/v1/records/'+str(rows[0]['id'])).json()['data'][b]=='2'
        merged=auth.post(f"/api/v1/agent-changes/{draft.json()['id']}/merge",json={'version':1})
        assert merged.status_code==200,merged.text
    h=auth.get(f"/api/v1/tables/{t['id']}/changes").json()[0]
    assert h['source']=='Agent 合并: 表格测试 Agent；审核: admin'
    assert auth.post(f"/api/v1/table-changes/{h['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==200
    assert auth.get('/api/v1/records/'+str(rows[0]['id'])).json()['data'][b]=='2'

def test_deleted_field_values_do_not_break_future_edits(auth):
    t,(a,b,c),rows=setup(auth)
    assert auth.delete('/api/v1/fields/'+str(t['fields'][1]['id']),params={'confirm':True}).status_code==200
    r=auth.get('/api/v1/records/'+str(rows[0]['id'])).json();assert b not in r['data']
    updated=auth.get('/api/v1/tables/'+str(t['id'])).json()
    assert tx(auth,updated,[{'id':r['id'],'version':r['version'],'changes':{a:'仍可编辑'}}]).status_code==200

def test_attachment_versions_survive_replace_undo_and_release_on_purge(auth,db):
    from app.models import FileObject,FileRef
    t=auth.post('/api/v1/tables',json={'name':'附件表','fields':[{'name':'文件','type':'attachment'}]}).json();key=t['fields'][0]['key']
    files=[auth.post('/api/v1/files',files={'file':(f'{i}.pdf',b'%PDF-1.4\nfixture\n%%EOF','application/pdf')}).json()['id'] for i in range(2)]
    row=auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{key:files[0]}}).json()
    op=tx(auth,t,[{'id':row['id'],'version':1,'changes':{key:files[1]}}]).json()['operation']
    assert auth.get('/api/v1/files/'+str(files[0])).status_code==200
    assert auth.post(f"/api/v1/table-changes/{op['id']}/undo",json={'request_id':uuid.uuid4().hex}).status_code==200
    assert auth.get('/api/v1/records/'+str(row['id'])).json()['data'][key]==files[0]
    assert auth.delete('/api/v1/records/'+str(row['id'])).status_code==200
    result=auth.delete(f"/api/v1/trash/record/{row['id']}");assert result.status_code==200,result.text
    assert not list(db.scalars(select(FileRef).where(FileRef.owner_type=='table_change_record',FileRef.owner_id==row['id'])))

def test_purged_record_ids_not_reused(auth):
    t,(a,b,c),rows=setup(auth);old=rows[-1]['id']
    auth.delete('/api/v1/records/'+str(old));auth.delete('/api/v1/trash/record/'+str(old))
    new=auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{a:'新记录'}}).json()
    assert new['id']>old


def test_invalid_query_and_view_configuration_rejected(auth):
    import json
    t,(a,b,c),rows=setup(auth)
    f=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'计算','type':'formula','config':{'expression':'{数量}+1'}}).json()
    for q in ['oops','{}','[1]']:
        assert auth.get(f"/api/v1/tables/{t['id']}/records",params={'filters':q}).status_code==422
    assert auth.get(f"/api/v1/tables/{t['id']}/records",params={'filters':json.dumps([{'field':f['key'],'op':'gt','value':'NaN'}])}).status_code==422
    for config in [{'search':[]},{'filters':[1]},{'hidden':{}},{'pivot':[]}]:
        assert auth.post(f"/api/v1/tables/{t['id']}/views",json={'name':'错误','config':config}).status_code==422
