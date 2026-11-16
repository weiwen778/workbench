"""Version-aware bounded cache; computed/cross-table sources stay uncached."""
import copy,json,threading,time
from collections import OrderedDict
from sqlalchemy import select,func
from ..models import DataTable,DataRecord,DataField
from ..agent_runtime import execution
from .table_expressions import COMPUTED

_cache=OrderedDict();_lock=threading.Lock();LIMIT=64;TTL=60


def get_key(db,board,widgets,dates):
    if execution.get() is not None:return None
    ids=sorted({w.table_id for w in widgets})
    tables=list(db.scalars(select(DataTable).where(DataTable.id.in_(ids))))
    fields=list(db.scalars(select(DataField).where(DataField.table_id.in_(ids)).order_by(DataField.id)))
    if len(tables)!=len(ids) or any(t.deleted_at or t.kind!='physical' for t in tables) or any(f.type in COMPUTED for f in fields):return None
    versions=list(db.execute(select(DataRecord.table_id,func.count(),func.max(DataRecord.updated_at),func.sum(DataRecord.version)).where(DataRecord.table_id.in_(ids),DataRecord.deleted_at.is_(None)).group_by(DataRecord.table_id)))
    return json.dumps([board.user_id,board.id,board.version,dates.model_dump(),[list(r) for r in versions],[(t.id,t.schema_version,t.deleted_at) for t in tables],[(f.id,f.key,f.type,f.options,f.config) for f in fields]],default=str,sort_keys=True)


def get(key):
    if key is None:return None
    with _lock:
        entry=_cache.get(key)
        if not entry or time.monotonic()-entry[0]>TTL:
            _cache.pop(key,None);return None
        _cache.move_to_end(key);return copy.deepcopy(entry[1])


def put(key,result):
    if key is None:return
    with _lock:
        _cache[key]=(time.monotonic(),copy.deepcopy(result));_cache.move_to_end(key)
        while len(_cache)>LIMIT:_cache.popitem(last=False)