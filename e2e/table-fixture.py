"""Create a new isolated 1000-row browser fixture; refuses an occupied test port."""
from pathlib import Path
import os,subprocess,time,urllib.request,json,sys
root=Path(__file__).resolve().parents[1];target=root/'.run/table-upgrade-test';target.mkdir(parents=True,exist_ok=True,mode=0o700)
dist=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'web/dist'
assert (dist/'index.html').is_file(),'Build the frontend before starting the fixture'
try:
 urllib.request.urlopen('http://127.0.0.1:18747/api/v1/health',timeout=1)
 raise RuntimeError('Test port is already in use')
except urllib.error.URLError:pass
database=target/('fixture-'+str(int(time.time()))+'.sqlite3')
os.environ.update(WB_ENV='test',WB_DATABASE_URL='sqlite:///'+str(database),WB_STORAGE_DIR=str(target/'storage'),WB_ADMIN_USERNAME='admin',WB_ADMIN_PASSWORD='admin12345')
os.chdir(root/'server');sys.path.insert(0,str(root/'server'))
from app.main import bootstrap
from app.db import Base,engine,SessionLocal
from app import models
from app.services.table_expressions import configure
Base.metadata.create_all(engine);bootstrap()
with SessionLocal() as db:
 source=models.DataTable(name='关联数据源');table=models.DataTable(name='表格功能验收');db.add_all([source,table]);db.flush()
 label=models.DataField(table_id=source.id,name='名称',type='short_text');amount=models.DataField(table_id=source.id,name='数值',type='number');db.add_all([label,amount]);db.flush()
 links=[models.DataRecord(table_id=source.id,data={label.key:'来源A',amount.key:'12.5'}),models.DataRecord(table_id=source.id,data={label.key:'来源B',amount.key:'7.5'})];db.add_all(links);db.flush()
 definitions=[('名称','short_text',None),('数量','number',None),('单价','number',None),('状态','select',None),('日期','date',None),('启用','checkbox',None),('备注','long_text',None),('链接','url',None),('附件','attachment',None),('关联','reference',{'table_id':source.id,'label_field':label.key,'multiple':True}),('金额','formula',{'expression':'{数量}*{单价}'}),('查找名称','lookup',None),('关联合计','rollup',None)]
 fields=[]
 for i,(name,kind,config) in enumerate(definitions):
  f=models.DataField(table_id=table.id,name=name,type=kind,config=config,sort_order=i,options=[{'id':'todo','name':'待处理'},{'id':'done','name':'已完成'}] if kind=='select' else None);db.add(f);fields.append(f)
 db.flush()
 fields[11].config={'reference_field':fields[9].key,'target_field':label.key};fields[12].config={'reference_field':fields[9].key,'target_field':amount.key,'operation':'sum'}
 for f in fields:configure(db,f,fields)
 for i in range(1000):
  values=[f'记录{i+1:03d}',str(i%10+1),'2.5','todo' if i%2 else 'done','2026-10-31',bool(i%2),f'第 {i+1} 条的备注','https://example.com',None,[links[0].id,links[1].id]]
  db.add(models.DataRecord(table_id=table.id,data={fields[j].key:value for j,value in enumerate(values)}))
 db.commit();fixture={'table_id':table.id,'source_id':source.id,'fields':{f.name:f.key for f in fields},'database':str(database)}
(target/'fixture.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2))
script=f"""from pathlib import Path
import sys
sys.path.insert(0,{str(root/'server')!r})
from app.main import app
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
dist=Path(sys.argv[1]).resolve()
app.router.routes=[route for route in app.router.routes if getattr(route,'name',None) not in {{'assets','_spa'}}]
app.mount('/assets',StaticFiles(directory=dist/'assets'),name='test-assets')
@app.get('/{{full_path:path}}',include_in_schema=False)
def ui(full_path:str):
 target=(dist/full_path).resolve()
 return FileResponse(target if target.is_relative_to(dist) and target.is_file() else dist/'index.html')
uvicorn.run(app,host='127.0.0.1',port=18747)
"""
(target/'serve-table-upgrade.py').write_text(script)
p=subprocess.Popen([str(root/'server/.venv/bin/python'),str(target/'serve-table-upgrade.py'),str(dist)],cwd=root/'server',env=os.environ.copy(),stdout=(target/'server.log').open('a'),stderr=subprocess.STDOUT,start_new_session=True)
(target/'api.pid').write_text(str(p.pid))
for i in range(80):
 try:
  with urllib.request.urlopen('http://127.0.0.1:18747/api/v1/health',timeout=1) as r:assert r.status==200
  print(json.dumps({'fixture_ready':True,'pid':p.pid,'table_id':table.id,'rows':1000}));break
 except Exception:time.sleep(.2)
else:raise RuntimeError('Test service did not start')
