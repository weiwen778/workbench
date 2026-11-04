"""Disposable test DB only; invoked by workspace-regressions.mjs."""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
assert os.environ.get('WB_ENV') == 'test'
assert 'wb_modal_layout_' in os.environ.get('WB_DATABASE_URL', '')
from app.db import SessionLocal
from app.models import DataTable, DataField, DataRecord
with SessionLocal() as db:
    table = DataTable(name='万行导出测试')
    db.add(table); db.flush()
    fields=[DataField(table_id=table.id,name=name,type=kind,key=key,sort_order=i) for i,(name,kind,key) in enumerate([('编号','number','number'),('姓名','short_text','name')])]
    db.add_all(fields)
    db.add_all([DataRecord(table_id=table.id,data={'number':i,'name':f'模拟人员{i}'}) for i in range(10000)])
    db.commit()
