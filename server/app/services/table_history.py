"""Journal entries retain attachment versions until their record is purged."""
import copy,uuid
from sqlalchemy import select
from ..models import TableChange,FileRef,FileObject,utcnow
from ..utils import iso_z

def snapshot(record):return {'data':copy.deepcopy(record.data),'deleted':record.deleted_at is not None,'version':record.version,'created_at':iso_z(record.created_at)}

def hold_files(db,entries,fields):
    keys={f.key for f in fields if f.type=='attachment'}
    if not keys:return
    wanted=set()
    for entry in entries:
        for state in [entry.get('before'),entry.get('after')]:
            if not state:continue
            for key in keys:
                value=state['data'].get(key)
                if isinstance(value,int) and not isinstance(value,bool):wanted.add((entry['id'],value))
    if not wanted:return
    owners={owner for owner,_ in wanted};available=set(db.scalars(select(FileObject.id).where(FileObject.id.in_({fid for _,fid in wanted}))))
    existing={(r.owner_id,r.file_id) for r in db.scalars(select(FileRef).where(FileRef.owner_type=='table_change_record',FileRef.owner_id.in_(owners)))}
    for owner,fid in wanted-existing:
        if fid in available:db.add(FileRef(file_id=fid,owner_type='table_change_record',owner_id=owner))

def append(db,table,label,entries,fields):
    uid=db.info.get('table_actor_id')
    if not uid or not entries:return
    op=TableChange(table_id=table.id,user_id=uid,request_id=uuid.uuid4().hex,digest='legacy',label=label,schema_version=table.schema_version,changes=entries,source=db.info.get('table_actor','用户')[:100],action='edit')
    db.add(op);hold_files(db,entries,fields)
    for redo in db.scalars(select(TableChange).where(TableChange.table_id==table.id,TableChange.user_id==uid,TableChange.action=='undo',TableChange.undone_by.is_(None))):redo.undone_by=-1
