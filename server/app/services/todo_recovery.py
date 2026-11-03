"""Preserve deleted todo trees in the existing 30-day trash without schema changes."""
from datetime import date,time,datetime
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from ..models import Todo,TodoList
from .trash import push

FIELDS=('id','parent_id','title','note','due_date','due_time','completed_at','sort_index')


def capture(db,todo=None,lst=None):
    if lst:
        rows=list(db.scalars(select(Todo).where(Todo.list_id==lst.id)))
        kind='todo_list';id=lst.id;name=lst.name
    else:
        lst=db.get(TodoList,todo.list_id)
        rows=[todo]+list(db.scalars(select(Todo).where(Todo.parent_id==todo.id)))
        kind='todo';id=todo.id;name=todo.title
    snapshot={'list':{'id':lst.id,'name':lst.name,'sort_mode':lst.sort_mode},'todos':[jsonable_encoder({key:getattr(row,key) for key in FIELDS}) for row in rows]}
    push(db,kind,id,name,snapshot,parent_id=lst.id)


def restore_tree(db,entry):
    snapshot=entry.snapshot or {};source=snapshot['list']
    lst=db.get(TodoList,source['id']) if entry.kind=='todo' else None
    if not lst:
        lst=TodoList(name=source['name'],sort_mode=source.get('sort_mode','auto'));db.add(lst);db.flush()
    mapping={};rows=snapshot.get('todos',[])
    for original in sorted(rows,key=lambda item:item.get('parent_id') is not None):
        parent=original.get('parent_id');parent_id=mapping.get(parent)
        if parent and parent_id is None:
            existing=db.get(Todo,parent)
            if existing and existing.list_id==lst.id:parent_id=parent
        values={key:original.get(key) for key in ('title','note','due_date','due_time','completed_at','sort_index')}
        for key,parser in [('due_date',date.fromisoformat),('due_time',time.fromisoformat),('completed_at',lambda v:datetime.fromisoformat(v.replace('Z','+00:00')).replace(tzinfo=None))]:
            if values[key]:values[key]=parser(values[key])
        todo=Todo(list_id=lst.id,parent_id=parent_id,**values);db.add(todo);db.flush();mapping[original['id']]=todo.id
    from ..routers.todos import _recompute_parent
    for parent in {row.get('parent_id') for row in rows if row.get('parent_id')}:
        _recompute_parent(db,mapping.get(parent,parent))
    return {'list_id':lst.id,'restored_todos':len(mapping),'url':f'/todos/{lst.id}'}