import base64,io
from unittest.mock import patch
import pytest
from PIL import Image
from sqlalchemy import select,func
from app.models import DataRecord,AiExtraction
from app.services import ai_tables as ai


def png():
    stream=io.BytesIO();Image.new('RGB',(10,10),'white').save(stream,'PNG');return stream.getvalue()

def table(auth):
    r=auth.post('/api/v1/tables',json={'name':'图片测试','fields':[{'name':'姓名','type':'short_text','required':True},{'name':'年龄','type':'number'},{'name':'性别','type':'select','options':[{'id':'m','name':'男'}]},{'name':'日期','type':'date'},{'name':'手机号','type':'short_text'}]});assert r.status_code in (200,201),r.text
    return r.json()

def setup(auth):
    r=auth.put('/api/v1/ai/config',json={'api_key':'private-test-key','default_model':'glm-ocr'});assert r.status_code==200
    assert 'private-test-key' not in r.text

def fake(key,model,image,fields):
    rows,warnings=ai.normalize([{'姓名':'张三','年龄':'76','性别':'男','日期':'2034/1/3','手机号':'001120023331'}],fields)
    return {'model':model,'records':rows,'warnings':warnings,'duration_ms':10,'raw_text':'模拟原文','usage':{}}

def extract(auth,t,**kwargs):
    with patch('app.services.ai_tables.recognize',side_effect=fake):
        response=auth.post(f'/api/v1/tables/{t["id"]}/ai/extract',files={'image':('x.png',png(),'image/png')},data=kwargs)
    assert response.status_code in (200,201),response.text
    return response.json()

def test_preview_confirm_idempotent(auth,db):
    setup(auth);t=table(auth);data=extract(auth,t,compare='true');assert len(data['results'])==2
    assert db.scalar(select(func.count()).select_from(DataRecord))==0
    result=data['results'][0];row=result['records'][0];fields={f['name']:f['key'] for f in t['fields']}
    assert row[fields['手机号']]=='001120023331' and row[fields['日期']]=='2034-01-03' and row[fields['性别']]=='m'
    draft=db.get(AiExtraction,result['draft_id']);assert '张三' not in draft.encrypted_result
    url=f'/api/v1/tables/{t["id"]}/ai/drafts/{result["draft_id"]}/confirm'
    response=auth.post(url,json={'records':[row]});assert response.status_code in (200,201),response.text
    again=auth.post(url,json={'records':[row]});assert again.status_code==200;assert again.json()['already_applied']
    assert response.json()['record_ids']==again.json()['record_ids'];db.expire_all();assert db.scalar(select(func.count()).select_from(DataRecord))==1

def test_schema_change_and_invalid_rows_atomic(auth,db):
    setup(auth);t=table(auth);result=extract(auth,t)['results'][0];row=result['records'][0]
    url=f'/api/v1/tables/{t["id"]}/ai/drafts/{result["draft_id"]}/confirm'
    invalid=auth.post(url,json={'records':[row,{}]});assert invalid.status_code==422
    assert db.scalar(select(func.count()).select_from(DataRecord))==0
    response=auth.post(f'/api/v1/tables/{t["id"]}/fields',json={'name':'新增字段','type':'short_text'});assert response.status_code in (200,201),response.text
    assert auth.post(url,json={'records':[row]}).status_code==409

def test_auth_config_and_invalid_image(client,auth):
    t=table(auth)
    assert auth.post(f'/api/v1/tables/{t["id"]}/ai/extract',files={'image':('x.png',b'not an image','image/png')}).status_code==422
    assert auth.post(f'/api/v1/tables/{t["id"]}/ai/extract',files={'image':('x.png',png(),'image/png')}).status_code==409
    assert auth.put('/api/v1/ai/config',json={'default_model':'unknown'}).status_code==422
    client.cookies.clear();assert client.get('/api/v1/ai/config').status_code==401


def test_local_text_extraction_without_provider_key(auth):
    target = table(auth)
    url = f'/api/v1/tables/{target["id"]}/ai/extract-text'
    with patch.object(ai.httpx, 'post') as upstream:
        response = auth.post(url, json={'text': '姓名：张三，年龄：32'})
        assert response.status_code == 200, response.text
        result = response.json()['results'][0]
        assert result['model'] == 'rules'
        fields = {field['name']: field['key'] for field in target['fields']}
        assert result['records'] == [{fields['姓名']: '张三', fields['年龄']: '32'}]
        assert auth.post(url, json={'text': '请整理这份报告'}).json()['code'] == 'AI_NOT_CONFIGURED'
        upstream.assert_not_called()

def test_ocr_orientation_and_mapping():
    fields=[{'key':'name','name':'姓名','type':'short_text','options':[]},{'key':'age','name':'年龄','type':'number','options':[]}]
    html='<table><tr><td>1</td><td>姓名</td><td>张三</td></tr><tr><td>2</td><td>年龄</td><td>76</td></tr></table>'
    assert ai.ocr_records(html,fields)==[{'name':'张三','age':'76'}]
    assert ai.ocr_records('|姓名|年龄|\n|---|---|\n|张三|76|\n|李四|25|',fields)==[{'name':'张三','age':'76'},{'name':'李四','age':'25'}]
    assert ai.chat_records('```json\n{"records":[{"name":"张三"}]}\n```')==[{'name':'张三'}]

def test_upstream_redacted_and_truncation():
    import httpx
    from app.errors import ApiError
    with patch.object(ai.httpx,'post',return_value=httpx.Response(401,json={'error':'private-test-key'})):
        with pytest.raises(ApiError) as exc:ai.recognize('private-test-key','glm-4v-flash','data:image/png;base64,xxx',[])
        assert 'private-test-key' not in exc.value.message
    response=httpx.Response(200,json={'choices':[{'finish_reason':'length','message':{'content':'{}'}}]})
    with patch.object(ai.httpx,'post',return_value=response):
        with pytest.raises(ApiError) as exc:ai.recognize('private-test-key','glm-4v-flash','data:image/png;base64,xxx',[])
        assert exc.value.code=='AI_TRUNCATED'
def test_flash_default_and_comparison_setting_preserves_secret(auth,db):
    from app.models import AiConnection
    from app.services.encryption import decrypt_config
    assert auth.get('/api/v1/ai/config').json()['default_model']=='glm-4v-flash'
    setup(auth)
    response=auth.put('/api/v1/ai/config',json={'default_model':'glm-4v-flash','compare_models':True})
    assert response.status_code==200
    assert response.json()['compare_models'] is True
    assert 'private-test-key' not in response.text
    db.expire_all()
    stored=db.get(AiConnection,1)
    assert 'private-test-key' not in stored.encrypted_config
    assert decrypt_config(stored.encrypted_config)['api_key']=='private-test-key'
    assert auth.get('/api/v1/ai/config').json()['default_model']=='glm-4v-flash'
