import pytest
from sqlalchemy import select
from app.models import WorkTarget,CheckinRule,CheckinInstance

@pytest.mark.parametrize('kind',['shop','social'])
def test_target_edit_delete_preserves_history(auth,db,kind):
 t=auth.post('/api/v1/work-targets',json={'kind':kind,'name':'输错的名字','platform':'旧平台'}).json()
 g=auth.post('/api/v1/checkin-groups',json={'name':'任务分类'}).json()
 rule=auth.post(f"/api/v1/work-targets/{t['id']}/rules",json={'title':'任务','group_id':g['id']}).json()
 assert auth.patch(f"/api/v1/work-targets/{t['id']}",json={'name':'修正名称','platform':''}).status_code==200
 assert auth.get(f"/api/v1/work-targets/{t['id']}").json()['platform']==''
 assert auth.delete(f"/api/v1/work-targets/{t['id']}").status_code==200
 assert t['id'] not in [row['id'] for row in auth.get('/api/v1/work-targets?include_archived=true').json()]
 assert auth.get(f"/api/v1/work-targets/{t['id']}").status_code==404
 assert not any(g['items'] for g in auth.get('/api/v1/checkin-instances',params={'kind':kind}).json()['groups'])
 assert auth.post(f"/api/v1/work-targets/{t['id']}/restore").status_code==404
 db.expire_all()
 assert db.get(WorkTarget,t['id']).status=='deleted'
 assert db.get(CheckinRule,rule['id']) is not None
 assert all(i.locked for i in db.scalars(select(CheckinInstance).where(CheckinInstance.target_id==t['id'])))


def test_group_rename_transfer_delete_keeps_tasks(auth,db):
 t=auth.post('/api/v1/work-targets',json={'kind':'shop','name':'店铺'}).json()
 a=auth.post('/api/v1/checkin-groups',json={'name':'错别字','sort_order':8}).json()
 b=auth.post('/api/v1/checkin-groups',json={'name':'接收分类'}).json()
 rule=auth.post(f"/api/v1/work-targets/{t['id']}/rules",json={'title':'保留任务','group_id':a['id']}).json()
 assert auth.patch(f"/api/v1/checkin-groups/{a['id']}",json={'name':'正确名称','sort_order':8}).status_code==200
 assert auth.delete(f"/api/v1/checkin-groups/{a['id']}").status_code==409
 result=auth.delete(f"/api/v1/checkin-groups/{a['id']}?move_to={b['id']}")
 assert result.status_code==200,result.text
 db.expire_all();assert db.get(CheckinRule,rule['id']).group_id==b['id']
 assert a['id'] not in [g['id'] for g in auth.get('/api/v1/checkin-groups').json()]
 assert db.scalar(select(CheckinInstance).where(CheckinInstance.rule_id==rule['id'])).group_id==b['id']


@pytest.mark.parametrize('resource',['memos','bookmarks'])
def test_category_rename_and_delete_preserves_content(auth,resource):
 assert auth.post(f'/api/v1/{resource}/categories',json={'name':'输入错了'}).status_code==200
 body={'content':'要保留的正文','category':'输入错了'} if resource=='memos' else {'url':'https://example.com','title':'保留网址','category':'输入错了'}
 item=auth.post(f'/api/v1/{resource}',json=body).json()
 renamed=auth.patch(f'/api/v1/{resource}/categories/manage',json={'original_name':'输入错了','name':'正确分类'})
 assert renamed.status_code==200,renamed.text
 assert '输入错了' not in auth.get(f'/api/v1/{resource}/categories').json()
 assert auth.get(f'/api/v1/{resource}').json()[0]['category']=='正确分类'
 auth.post(f'/api/v1/{resource}/categories',json={'name':'重复名称'})
 assert auth.patch(f'/api/v1/{resource}/categories/manage',json={'original_name':'正确分类','name':'重复名称'}).status_code==409
 assert auth.delete(f'/api/v1/{resource}/categories/manage',params={'name':'正确分类'}).status_code==200
 rows=auth.get(f'/api/v1/{resource}').json()
 assert rows[0]['id']==item['id'] and not rows[0]['category']
 assert '正确分类' not in auth.get(f'/api/v1/{resource}/categories').json()