import pytest
from app.models import DataRecord


def source(auth,db):
 t=auth.post('/api/v1/tables',json={'name':'多指标日报','fields':[{'name':'日期','type':'date'},{'name':'销售额','type':'number'},{'name':'成本','type':'number'}]}).json()
 k={f['name']:f['key'] for f in t['fields']}
 db.add_all([DataRecord(table_id=t['id'],data={k['日期']:f'2026-10-{i:02}',k['销售额']:str(i),k['成本']:str(100-i)}) for i in range(1,32)])
 db.commit()
 w={'id':'multi','title':'销售与成本','table_id':t['id'],'kind':'bar','aggregation':'sum','group_field':k['日期'],'value_fields':[k['销售额'],k['成本']],'limit':2}
 return t,k,w


def test_multiple_series_align_before_top_limit_and_persist(auth,db):
 t,k,w=source(auth,db)
 result=auth.post('/api/v1/dashboards/preview',json={'widget':w})
 assert result.status_code==200,result.text
 series=result.json()['series']
 assert [s['name'] for s in series]==['销售额','成本']
 assert [p['label'] for p in series[0]['points']]==['2026-10-30','2026-10-31']
 assert [p['label'] for p in series[1]['points']]==['2026-10-30','2026-10-31']
 assert [p['value'] for p in series[1]['points']]==['70','69']
 board=auth.post('/api/v1/dashboards',json={'name':'对比'}).json()
 saved=auth.put(f"/api/v1/dashboards/{board['id']}",json={'name':'对比','version':board['version'],'widgets':[w]})
 assert saved.status_code==200,saved.text
 assert saved.json()['widgets'][0]['value_fields']==w['value_fields']
 assert auth.get(f"/api/v1/dashboards/{board['id']}/data").json()['widgets'][0]['series']==series


def test_multiple_series_date_group_uses_recent_dates_not_top_values(auth,db):
 t,k,w=source(auth,db)
 db.add(DataRecord(table_id=t['id'],data={k['日期']:'2026-10-01',k['销售额']:'999'}));db.commit()
 w.update(limit=2)
 r=auth.post('/api/v1/dashboards/preview',json={'widget':w})
 assert r.status_code==200,r.text
 assert [p['label'] for p in r.json()['series'][0]['points']]==['2026-10-30','2026-10-31']
 assert [p['value'] for p in r.json()['series'][0]['points']]==['30','31']


def test_date_series_and_nulls_and_time_filter(auth,db):
 t,k,w=source(auth,db)
 db.add(DataRecord(table_id=t['id'],data={k['日期']:'2026-11-01',k['成本']:'-5'}));db.commit()
 w.update(kind='line',aggregation='avg',limit=3,date_field=k['日期'])
 r=auth.post('/api/v1/dashboards/preview',json={'widget':w,'start_date':'2026-10-30','end_date':'2026-11-01'}).json()
 assert r['status']=='ok'
 assert [p['label'] for p in r['series'][0]['points']]==['2026-10-30','2026-10-31','2026-11-01']
 assert [p['value'] for p in r['series'][0]['points']]==['30','31',None]
 assert [p['value'] for p in r['series'][1]['points']]==['70','69','-5']
 assert r['date_filter_applied']


@pytest.mark.parametrize('change',[{'kind':'metric'},{'kind':'pie'},{'aggregation':'count'},{'value_fields':['missing']},{'value_fields':['x']*9},{'value_fields':['x','x']}])
def test_invalid_series_configuration(auth,db,change):
 t,k,w=source(auth,db);w.update(change)
 assert auth.post('/api/v1/dashboards/preview',json={'widget':w}).status_code==422


def test_legacy_widget_without_series_still_works(auth,db):
 t,k,w=source(auth,db);w.pop('value_fields');w['value_field']=k['销售额']
 r=auth.post('/api/v1/dashboards/preview',json={'widget':w})
 assert r.status_code==200,r.text
 assert r.json()['status']=='ok' and 'series' not in r.json()

def test_sum_missing_value_is_gap_not_zero(auth,db):
 t,k,w=source(auth,db)
 db.add(DataRecord(table_id=t['id'],data={k['日期']:'2026-11-01',k['成本']:'-5'}));db.commit()
 w.update(kind='line',limit=1)
 r=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json()
 assert r['series'][0]['points'][0]['value'] is None
 assert r['series'][1]['points'][0]['value']=='-5'
