import copy,io
from decimal import Decimal
from openpyxl import load_workbook
from app.models import DataRecord,DataTable
from sqlalchemy import select,func

def sources(auth):
    tables=[];rows=[]
    for name,values in [('甲表',[['a','2026-01-01','0.1'],['b','2026-01-02','2'],[None,'2026-01-03','3']]),('乙表',[['a','2026-01-01','0.2'],['c','2026-01-02','4'],[None,'2026-01-03','5']])]:
        t=auth.post('/api/v1/tables',json={'name':name,'fields':[{'name':'编号','type':'short_text'},{'name':'日期','type':'date'},{'name':'金额','type':'number'}]}).json();tables.append(t)
        rows.append([auth.post(f"/api/v1/tables/{t['id']}/records",json={'data':{f['key']:v for f,v in zip(t['fields'],line)}}).json() for line in values])
    d={'mode':'union','sources':[{'alias':a,'table_id':t['id']} for a,t in zip(['a','b'],tables)],'columns':[{'key':k,'name':n,'type':kind,'mapping':{a:t['fields'][i]['key'] for a,t in zip(['a','b'],tables)}} for i,(k,n,kind) in enumerate([('id_col','编号','short_text'),('day','日期','date'),('amount','金额','number')])]}
    return tables,rows,d

def create(auth,d,name='虚拟结果'):
    r=auth.post('/api/v1/virtual-tables',json={'name':name,'definition':d});assert r.status_code==201,r.text;return r.json()
def result(auth,t):
    r=auth.get(f"/api/v1/virtual-tables/{t['id']}/data");assert r.status_code==200,r.text;return r.json()
def joined(tables,d,kind='left'):
    d=copy.deepcopy(d);d.update(mode='join',join_type=kind,keys=[{'key':'match_key','name':'匹配编号','type':'short_text','fields':{a:t['fields'][0]['key'] for a,t in zip(['a','b'],tables)}}],columns=[{'key':'left_amount','name':'甲金额','type':'number','source':'a','field':tables[0]['fields'][2]['key']},{'key':'right_amount','name':'乙金额','type':'number','source':'b','field':tables[1]['fields'][2]['key']}]);return d

def test_union_live_result_and_stable_source_rename(auth,db):
    ts,rs,d=sources(auth);t=create(auth,d);out=result(auth,t);assert out['total']==6
    assert out['records'][0]['origins']==[{'table_id':ts[0]['id'],'record_id':rs[0][0]['id']}]
    assert db.scalar(select(func.count(DataRecord.id)).where(DataRecord.table_id==t['id']))==0
    auth.patch('/api/v1/fields/'+str(ts[0]['fields'][2]['id']),json={'name':'改名后的金额'})
    first=auth.get('/api/v1/records/'+str(rs[0][0]['id'])).json();first['data'][ts[0]['fields'][2]['key']]='9'
    assert auth.put('/api/v1/records/'+str(first['id']),json={'version':first['version'],'data':first['data']}).status_code==200
    assert result(auth,t)['records'][0]['data']['amount']=='9'
    assert auth.get('/api/v1/tables').json()[-1]['kind']=='virtual'

def test_union_formula_filters_sort_and_exact_chart(auth):
    ts,rs,d=sources(auth);d['columns'].append({'key':'double','name':'双倍','type':'formula','expression':'{金额}*2'})
    t=create(auth,d);out=result(auth,t);assert out['records'][0]['data']['double']=='0.2'
    p=auth.post('/api/v1/dashboards/preview',json={'widget':{'id':'v','title':'合计','table_id':t['id'],'kind':'metric','aggregation':'sum','value_field':'amount'}});assert p.status_code==200,p.text
    assert Decimal(p.json()['value'])==Decimal('14.3')
    d['filters']=[{'field':'amount','op':'gt','value':'1'}];d['sorts']=[{'field':'amount','order':'desc'}]
    r=auth.post('/api/v1/virtual-tables/preview',json={'definition':d});assert r.status_code==200,r.text
    assert [x['data']['amount'] for x in r.json()['records']]==['5','4','3','2']

def test_join_left_inner_full_and_null_keys(auth):
    ts,rs,d=sources(auth)
    for kind,count in [('left',3),('inner',1),('full',5)]:
        out=result(auth,create(auth,joined(ts,d,kind),kind));assert out['total']==count
        assert sum(r['data']['left_amount'] is not None and r['data']['right_amount'] is not None for r in out['records'])==1

def test_join_duplicate_guard_and_explicit_expansion(auth):
    ts,rs,d=sources(auth);auth.post(f"/api/v1/tables/{ts[1]['id']}/records",json={'data':{ts[1]['fields'][0]['key']:'a',ts[1]['fields'][2]['key']:'7'}});j=joined(ts,d)
    r=auth.post('/api/v1/virtual-tables/preview',json={'definition':j});assert r.status_code==422 and r.json()['code']=='VIRTUAL_DUPLICATE_KEY'
    j['allow_many']=True;out=result(auth,create(auth,j));assert out['total']==4 and out['warnings']

def test_alignment_groups_before_join_and_formula(auth):
    ts,rs,d=sources(auth);j=joined(ts,d);j['mode']='align'
    auth.post(f"/api/v1/tables/{ts[1]['id']}/records",json={'data':{ts[1]['fields'][0]['key']:'a',ts[1]['fields'][2]['key']:'0.3'}})
    j['columns'].append({'key':'combined','name':'合计','type':'formula','expression':'{甲金额}+{乙金额}'})
    out=result(auth,create(auth,j));a=next(r for r in out['records'] if r['data']['match_key']=='a');assert a['data']['right_amount']=='0.5' and a['data']['combined']=='0.6' and a['origin_count']==3
    assert len(a['origins'])==3

def test_virtual_readonly_for_legacy_agent_fields_transactions_and_import(auth):
    ts,rs,d=sources(auth);t=create(auth,d);base=f"/api/v1/tables/{t['id']}"
    assert auth.post(base+'/records',json={'data':{'amount':'4'}}).status_code==409
    assert auth.post(base+'/fields',json={'name':'偷偷添加','type':'number'}).status_code==409
    assert auth.patch('/api/v1/fields/'+str(t['fields'][0]['id']),json={'name':'偷偷改列'}).status_code==409
    assert auth.delete('/api/v1/fields/'+str(t['fields'][0]['id']),params={'confirm':True}).status_code==409
    assert auth.post(base+'/records/batch-delete',json={'ids':[1]}).status_code==409
    assert auth.post(base+'/transactions',json={'schema_version':1,'request_id':'readonly-check','edits':[{'changes':{'amount':'1'}}]}).status_code==409
    r=auth.post('/api/v1/imports/preview',data={'table_id':t['id']},files={'file':('x.csv',b'amount\n3','text/csv')});assert r.status_code==409,r.text
    token=auth.post('/api/v1/agent-tokens',json={'name':'验证','scopes':['tables:write']}).json()['token']
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as agent:
        agent.headers['Authorization']='Bearer '+token
        assert agent.post('/api/v1/agent/tables/'+str(t['id'])+'/records',json={'data':{'amount':'4'}}).status_code==409
        r=agent.get('/api/v1/agent/tables/'+str(t['id'])+'/records');assert r.status_code==200 and r.json()['total']==6

def test_missing_dependency_and_chart_error_isolated(auth):
    ts,rs,d=sources(auth);t=create(auth,d);auth.delete('/api/v1/fields/'+str(ts[0]['fields'][2]['id']),params={'confirm':True})
    assert auth.get(f"/api/v1/virtual-tables/{t['id']}/data").status_code==422
    assert auth.get('/api/v1/tables/'+str(t['id'])).status_code==200
    p=auth.post('/api/v1/dashboards/preview',json={'widget':{'id':'v','title':'坏来源','table_id':t['id'],'kind':'metric','aggregation':'count'}})
    assert p.status_code==200 and p.json()['status']=='error'

def test_config_version_conflict_field_identity_and_name_swap(auth):
    ts,rs,d=sources(auth);t=create(auth,d);ids={f['key']:f['id'] for f in t['fields']};d['columns'][0]['name']='日期';d['columns'][1]['name']='编号'
    payload={'name':'规则更新','definition':d,'version':1};r=auth.put('/api/v1/virtual-tables/'+str(t['id']),json=payload);assert r.status_code==200,r.text
    assert r.json()['schema_version']==2 and {f['key']:f['id'] for f in r.json()['fields']}==ids
    assert auth.put('/api/v1/virtual-tables/'+str(t['id']),json=payload).status_code==409

def test_virtual_paging_sort_and_excel_export(auth):
    import json
    ts,rs,d=sources(auth);t=create(auth,d)
    r=auth.get(f"/api/v1/tables/{t['id']}/records",params={'sorts':json.dumps([{'field':'amount','order':'desc'}])});assert r.status_code==200,r.text
    assert r.json()['total']==6 and r.json()['items'][0]['data']['amount']=='5'
    r=auth.post(f"/api/v1/tables/{t['id']}/exports",json={'scope':'all'});assert r.status_code==201,r.text
    file=auth.get(r.json()['download_url']);assert file.status_code==200
    book=load_workbook(io.BytesIO(file.content));assert book.active.max_row==7 and book.active.cell(1,1).value=='编号'

def test_invalid_formula_cycles_and_nested_virtual_source(auth):
    ts,rs,d=sources(auth);t=create(auth,d)
    for expression in ["__import__('os')",'1e309','{不存在}+1']:
        bad=copy.deepcopy(d);bad['columns'].append({'key':'bad','name':'错误','type':'formula','expression':expression});assert auth.post('/api/v1/virtual-tables/preview',json={'definition':bad}).status_code==422
    bad=copy.deepcopy(d);bad['columns'] += [{'key':'x','name':'X','type':'formula','expression':'{Y}+1'},{'key':'y','name':'Y','type':'formula','expression':'{X}+1'}]
    assert auth.post('/api/v1/virtual-tables/preview',json={'definition':bad}).status_code==422
    bad=copy.deepcopy(d);bad['sources'][0]['table_id']=t['id'];assert auth.post('/api/v1/virtual-tables/preview',json={'definition':bad}).status_code==422

def test_formula_runtime_error_visible_and_chart_rejects_bad_measure(auth):
    ts,rs,d=sources(auth);d['columns'].append({'key':'bad','name':'除零','type':'formula','expression':'1/0'});t=create(auth,d);assert result(auth,t)['records'][0]['computed_errors']['bad']
    r=auth.post('/api/v1/dashboards/preview',json={'widget':{'id':'v','title':'错误公式','table_id':t['id'],'kind':'metric','aggregation':'sum','value_field':'bad'}});assert r.json()['status']=='error'
    exported=auth.post(f"/api/v1/tables/{t['id']}/exports",json={'scope':'all'});assert exported.status_code==201
    book=load_workbook(io.BytesIO(auth.get(exported.json()['download_url']).content))
    assert book.active.cell(2,len(t['fields'])).value.startswith('#ERROR')

def test_virtual_requires_auth_and_preview_does_not_persist(client,auth,db):
    ts,rs,d=sources(auth);before=db.scalar(select(func.count(DataTable.id)));assert auth.post('/api/v1/virtual-tables/preview',json={'definition':d}).status_code==200
    assert db.scalar(select(func.count(DataTable.id)))==before
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as anonymous:assert anonymous.post('/api/v1/virtual-tables/preview',json={'definition':d}).status_code==401


def test_three_sources_composite_join_and_alignment(auth):
    ts,rs,d=sources(auth)
    third=auth.post('/api/v1/tables',json={'name':'丙表','fields':[{'name':'编号','type':'short_text'},{'name':'日期','type':'date'},{'name':'金额','type':'number'}]}).json()
    auth.post(f"/api/v1/tables/{third['id']}/records",json={'data':{third['fields'][0]['key']:'a',third['fields'][1]['key']:'2026-01-01',third['fields'][2]['key']:'7'}})
    j=joined(ts,d,'inner');j['sources'].append({'alias':'c','table_id':third['id']});j['keys'][0]['fields']['c']=third['fields'][0]['key'];j['keys'].append({'key':'day_key','name':'日期键','type':'date','fields':{a:t['fields'][1]['key'] for a,t in zip(['a','b','c'],[*ts,third])}})
    j['columns'].append({'key':'third','name':'丙金额','type':'number','source':'c','field':third['fields'][2]['key']})
    out=result(auth,create(auth,j));assert out['total']==1 and out['records'][0]['data']['third']=='7' and out['records'][0]['origin_count']==3
    j['mode']='align';out=result(auth,create(auth,j,'三表汇总'));assert next(r for r in out['records'] if r['data']['match_key']=='a')['data']['third']=='7'

def test_preview_rejects_expansion_without_persisting(auth,db,monkeypatch):
    from app.services import virtual_tables as service
    ts,rs,d=sources(auth);monkeypatch.setattr(service,'MAX_OUTPUT_ROWS',5)
    before=db.scalar(select(func.count(DataTable.id)))
    r=auth.post('/api/v1/virtual-tables',json={'name':'不应保存','definition':d});assert r.status_code==422 and r.json()['code']=='VIRTUAL_LIMIT'
    assert db.scalar(select(func.count(DataTable.id)))==before
    for t,records in zip(ts,rs):
        for r in records:
            entity=db.get(DataRecord,r['id']);entity.data={**entity.data,t['fields'][0]['key']:'a'}
    db.commit();j=joined(ts,d);j['allow_many']=True
    assert auth.post('/api/v1/virtual-tables/preview',json={'definition':j}).status_code==422

def test_formula_binding_survives_output_rename_and_expression_edit(auth):
    ts,rs,d=sources(auth);d['columns'].append({'key':'double','name':'双倍','type':'formula','expression':'{金额}*2'});t=create(auth,d)
    definition=t['virtual_config'];definition['columns'][2]['name']='数额'
    r=auth.put('/api/v1/virtual-tables/'+str(t['id']),json={'name':t['name'],'version':1,'definition':definition});assert r.status_code==200,r.text
    assert result(auth,t)['records'][0]['data']['double']=='0.2'
    definition=r.json()['virtual_config'];definition['columns'][3]['expression']='{数额}*3'
    assert auth.put('/api/v1/virtual-tables/'+str(t['id']),json={'name':t['name'],'version':2,'definition':definition}).status_code==200
    assert result(auth,t)['records'][0]['data']['double']=='0.3'

def test_aggregate_lineage_bounded_and_identity_stable(auth,db):
    ts,rs,d=sources(auth)
    for i in range(150):db.add(DataRecord(table_id=ts[0]['id'],data={ts[0]['fields'][0]['key']:'a',ts[0]['fields'][2]['key']:'1'}))
    db.commit();j=joined(ts,d);j['mode']='align';t=create(auth,j);a=next(r for r in result(auth,t)['records'] if r['data']['match_key']=='a')
    assert len(a['origins'])==100 and a['origin_count']==152
    record=db.get(DataRecord,rs[0][0]['id']);record.data={**record.data,ts[0]['fields'][2]['key']:'3'};db.commit()
    a2=next(r for r in result(auth,t)['records'] if r['data']['match_key']=='a');assert a2['id']==a['id'] and a2['data']['left_amount']!=a['data']['left_amount']

def test_type_error_and_deleted_source_are_explicit(auth):
    ts,rs,d=sources(auth);d['columns'][0]['type']='number'
    assert auth.post('/api/v1/virtual-tables/preview',json={'definition':d}).status_code==422
    d['columns'][0]['type']='short_text';t=create(auth,d);auth.delete('/api/v1/tables/'+str(ts[1]['id']))
    r=auth.get(f"/api/v1/virtual-tables/{t['id']}/data");assert r.status_code==422 and r.json()['code']=='VIRTUAL_SOURCE_MISSING'
    assert auth.get('/api/v1/tables/'+str(t['id'])).status_code==200

def test_boolean_output_filter_uses_display_values(auth):
    ts,rs,d=sources(auth)
    for t in ts:
        field=auth.post(f"/api/v1/tables/{t['id']}/fields",json={'name':'启用','type':'checkbox'}).json();r=auth.get('/api/v1/records/'+str(rs[ts.index(t)][0]['id'])).json();auth.put('/api/v1/records/'+str(r['id']),json={'version':r['version'],'data':{**r['data'],field['key']:True}})
        d.setdefault('checks',{})['a' if t==ts[0] else 'b']=field['key']
    mapping=d.pop('checks');d['columns'].append({'key':'enabled','name':'启用','type':'checkbox','mapping':mapping});d['filters']=[{'field':'enabled','op':'eq','value':'是'}]
    assert auth.post('/api/v1/virtual-tables/preview',json={'definition':d}).json()['total']==2
