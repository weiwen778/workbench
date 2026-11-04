from decimal import Decimal
from datetime import date,timedelta
import pytest
from app.models import DataRecord,DataField
from app.services.dashboard import Widget,DateRange,aggregate
from test_dashboards import source,add,board,data


def progress(table,keys,**changes):
    p={'mode':'tasks','display':'bar','completed':{'field':keys['状态'],'op':'eq','value':'done'},'target_mode':'rows','filters':[]}
    p.update(changes.pop('progress',{}))
    return {'id':'progress1','title':'任务进度','kind':'progress','table_id':table['id'],'aggregation':'count','progress':p,**changes}

def test_task_counts_grouped_dates_filters_and_drilldown(auth):
    t,k=source(auth)
    for shop,status,day in [('A','done','2026-11-01'),('A','pending','2026-11-02'),('B','done','2026-11-02'),('B','pending','2026-10-01'),('B',None,'2026-11-03')]:add(auth,t,k,店铺=shop,状态=status,日期=day)
    removed=add(auth,t,k,店铺='A',状态='done',日期='2026-11-02');auth.delete('/api/v1/records/'+str(removed['id']))
    b=board(auth,[progress(t,k,group_field=k['店铺'],date_field=k['日期'])])
    result=data(auth,b,start_date='2026-11-01',end_date='2026-11-02')[0]
    assert result['progress']['actual']=='2' and result['progress']['target']=='3'
    assert abs(Decimal(result['progress']['percentage'])-Decimal(200)/3)<Decimal('1e-24')
    assert [(p['label'],p['actual'],p['target']) for p in result['progress_groups']]==[('B','1','1'),('A','1','2')]
    import json
    for group in result['progress_groups']:
        filters=[*result['drilldown_filters'],group['filter']]
        page=auth.get(f'/api/v1/tables/{t["id"]}/records',params={'filters':json.dumps(filters)}).json()
        assert page['total']==group['rows']
    w=progress(t,k,progress={'filters':[{'field':k['店铺'],'op':'eq','value':'A'}]})
    response=auth.post('/api/v1/dashboards/preview',json={'widget':w});assert response.status_code==200,response.text
    assert response.json()['progress']['actual']=='1' and response.json()['progress']['target']=='2'

def test_quantity_exact_weighted_pair_validation_and_fixed_groups(auth,db):
    t,k=source(auth)
    goal=auth.post(f'/api/v1/tables/{t["id"]}/fields',json={'name':'目标','type':'number'}).json()['key'];k['目标']=goal
    for shop,actual,target in [('A','0.1','0.3'),('A','0.2','0.3'),('B','1','1'),('B',None,'2'),('B','-1','2'),('B','3',None)]:add(auth,t,k,店铺=shop,销售额=actual,目标=target)
    w=progress(t,k,group_field=k['店铺'],progress={'mode':'quantity','actual_field':k['销售额'],'target_mode':'field','target_field':goal})
    result=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json()
    assert result['status']=='ok',result
    assert result['progress']['actual']=='1.3' and result['progress']['target']=='1.6' and result['progress']['percentage']=='81.2500'
    assert result['ignored_rows']==3
    w['progress'].update(target_mode='fixed',target_value='0.5')
    result=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json()
    assert result['progress']['actual']=='4.3' and result['progress']['target']=='1.0' and Decimal(result['progress']['percentage'])==430
    assert result['progress']['remaining']=='0'

def test_checkbox_zero_goal_empty_and_overdue(auth,db):
    t,k=source(auth)
    w=progress(t,k,progress={'completed':{'field':k['已核对'],'op':'eq','value':True},'due_field':k['日期']})
    r=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json();assert r['progress']['state']=='empty' and r['progress']['percentage'] is None
    add(auth,t,k,已核对=True,日期='2020-01-01');add(auth,t,k,已核对=False,日期='2020-01-01');add(auth,t,k,日期='2020-01-01')
    r=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json();assert r['progress']['actual']=='1' and r['progress']['overdue_rows']==2
    # Quantity denominator 0 is explicitly not a 100% completion.
    w['progress']={'mode':'quantity','actual_field':k['销售额'],'target_mode':'field','target_field':k['销售额']}
    add(auth,t,k,销售额='0')
    r=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json();assert r['progress']['state']=='no_target' and r['progress']['percentage'] is None

@pytest.mark.parametrize('update',[{'completed':None},{'target_mode':'fixed','target_value':'0'},{'target_mode':'fixed','target_value':'NaN'},{'target_mode':'fixed','target_value':'sNaN'},{'target_mode':'fixed','target_value':'Infinity'},{'target_mode':'fixed','target_value':'1.5'},{'mode':'quantity','target_mode':'rows'},{'filters':[{'field':'x','value':'a'}]*8}])
def test_invalid_progress_configuration(auth,update):
    t,k=source(auth);w=progress(t,k,progress=update)
    assert auth.post('/api/v1/dashboards/preview',json={'widget':w}).status_code==422

def test_missing_changed_fields_errors_and_standard_widgets_unchanged(auth,db):
    t,k=source(auth);add(auth,t,k,状态='done',销售额='12')
    b=board(auth,[progress(t,k),{'id':'metric','title':'合计','kind':'metric','table_id':t['id'],'aggregation':'sum','value_field':k['销售额']}])
    assert data(auth,b)[1]['value']=='12'
    f=db.query(DataField).filter_by(key=k['状态']).one();f.options=[{'id':'pending','name':'待处理'}];db.commit()
    results=data(auth,b);assert results[0]['status']=='error' and results[1]['value']=='12'

def test_more_than_page_limit_and_cache_refresh(auth,db):
    t,k=source(auth)
    db.add_all([DataRecord(table_id=t['id'],data={k['状态']:'done' if i<91 else 'pending'}) for i in range(121)]);db.commit()
    b=board(auth,[progress(t,k)])
    assert data(auth,b)[0]['progress']['actual']=='91' and data(auth,b)[0]['progress']['target']=='121'
    add(auth,t,k,状态='done')
    r=data(auth,b)[0];assert r['progress']['actual']=='92' and r['progress']['target']=='122'

def test_source_row_bound_and_group_bound_are_errors_not_partial(auth,db,monkeypatch):
    from app.services import dashboard_progress
    t,k=source(auth)
    for i in range(4):add(auth,t,k,店铺=str(i),状态='done')
    monkeypatch.setattr(dashboard_progress,'MAX_ROWS',3)
    w=progress(t,k);r=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json();assert r['status']=='error'
    monkeypatch.setattr(dashboard_progress,'MAX_ROWS',100000);monkeypatch.setattr(dashboard_progress,'MAX_GROUPS',2)
    w['group_field']=k['店铺'];r=auth.post('/api/v1/dashboards/preview',json={'widget':w}).json();assert r['status']=='error'

def test_ten_thousand_rows(auth,db):
    t,k=source(auth)
    db.add_all([DataRecord(table_id=t['id'],data={k['状态']:'done' if i<6123 else 'pending',k['店铺']:str(i%5)}) for i in range(10000)])
    db.commit()
    w=Widget.model_validate(progress(t,k,group_field=k['店铺']))
    result=aggregate(db,[w],DateRange())[0]
    assert result['progress']['actual']=='6123' and result['progress']['target']=='10000'
    assert Decimal(result['progress']['percentage'])==Decimal('61.23')
    assert sum(int(g['actual']) for g in result['progress_groups'])==6123
