from pathlib import Path
import json,os,sys,subprocess

import argparse
from urllib.parse import urlsplit
parser=argparse.ArgumentParser(description='Seed an empty isolated PostgreSQL test database from a marked synthetic SQLite preview.')
parser.add_argument('--runtime',type=Path,required=True)
parser.add_argument('--source-sqlite',type=Path,required=True)
parser.add_argument('--manifest',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
runtime=json.loads(args.runtime.read_text());target=Path(runtime['target']);target.mkdir(parents=True,exist_ok=True)
url=urlsplit(runtime['databases']['performance'].replace('postgresql+psycopg:','postgresql:'))
assert url.hostname in {'localhost','127.0.0.1','::1'} and url.path.lstrip('/').startswith('workbench_element_test')
assert runtime['username'].startswith('perf-')
assert args.source_sqlite.is_file() and args.manifest.is_file()
os.environ.update(WB_ENV='test',WB_DATABASE_URL=runtime['databases']['performance'],WB_STORAGE_DIR=str(target/'storage'),WB_ADMIN_USERNAME=runtime['username'],WB_ADMIN_PASSWORD=runtime['password'])
sys.path.insert(0,str(root/'server'))
from sqlalchemy import create_engine,select,insert,text
from app.db import Base,engine,SessionLocal
from app.main import bootstrap
from app import models
Base.metadata.create_all(engine);bootstrap()
manifest=json.loads(args.manifest.read_text())
assert manifest['marker'].startswith('DEMO-YEAR-')
source=create_engine('sqlite:///'+str(args.source_sqlite.resolve()))
counts={}
allowed={'checkin_groups','work_targets','activity_intervals','checkin_rules','checkin_rule_versions','checkin_instances','todo_lists','todos','data_tables','data_fields','data_records','note_folders','notes','note_revisions','note_tags','note_tag_links','memos','translation_history','translation_favorites','dashboards'}
with source.connect() as src,engine.begin() as dest:
    assert not dest.scalar(select(models.DataTable.id).limit(1)), 'Target must be an empty isolated test database'
    uid=dest.scalar(select(models.User.id))
    for table in Base.metadata.sorted_tables:
        ids=manifest['entities'].get(table.name,[])
        if table.name not in allowed or not ids:continue
        rows=[dict(row) for row in src.execute(select(table).where(table.c.id.in_(ids)).order_by(table.c.id)).mappings()]
        if table.name=='dashboards':
            for row in rows:row['user_id']=uid
        if rows:dest.execute(insert(table),rows)
        dest.execute(text("SELECT setval(pg_get_serial_sequence(:table, 'id'), COALESCE((SELECT MAX(id) FROM \""+table.name+"\"), 1), true)"),{'table':table.name})
        counts[table.name]=len(rows)
    # More folders and tags exercise navigation N+1 without inserting giant note bodies.
    for i in range(40):
        f=models.NoteFolder.__table__;tid=dest.scalar(insert(f).values(name=f'PERF-folder-{i}',sort_order=100+i).returning(f.c.id))
        tag=models.NoteTag.__table__;tagid=dest.scalar(insert(tag).values(name=f'PERF-tag-{i}').returning(tag.c.id))
        n=models.Note.__table__;nid=dest.scalar(insert(n).values(title=f'PERF-note-{i}',content='Synthetic performance data only. '*20,folder_id=tid).returning(n.c.id))
        dest.execute(insert(models.NoteTagLink.__table__).values(note_id=nid,tag_id=tagid))
        dest.execute(insert(models.TodoList.__table__).values(name=f'PERF-list-{i}',sort_order=100+i))
(target/'dataset.json').write_text(json.dumps(counts,indent=2))
print(json.dumps({'seeded_synthetic_counts':counts,'additional_navigation_entries':40},ensure_ascii=False,indent=2))
