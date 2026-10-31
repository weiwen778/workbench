"""A deliberately small integration API; browser routes remain cookie-only."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agent_access import get_agent_token, require_scope
from ..agent_guide import GUIDE
from ..db import get_db
from ..errors import ApiError
from ..models import AgentToken, DataRecord, Todo
from . import tables, todos
from .agent_tokens import token_payload

router = APIRouter(prefix='/agent', tags=['Agent'])
read_todos = Depends(require_scope('todos:read'))
write_todos = Depends(require_scope('todos:write'))
read_tables = Depends(require_scope('tables:read'))
write_tables = Depends(require_scope('tables:write'))


class TodoPatch(todos.TodoPatch):
    version: int = Field(ge=1)


class CompletionIn(BaseModel):
    completed: bool


class RecordPatch(BaseModel):
    version: int = Field(ge=1)
    data: dict


def _todo(db, todo_id, lock=False):
    stmt = select(Todo).where(Todo.id == todo_id)
    todo = db.scalar(stmt.with_for_update() if lock else stmt)
    if todo is None:
        raise ApiError('NOT_FOUND', '待办不存在', 404)
    return todo


def _record(db, record_id, lock=False):
    stmt = select(DataRecord).where(DataRecord.id == record_id, DataRecord.deleted_at.is_(None))
    record = db.scalar(stmt.with_for_update() if lock else stmt)
    if record is None:
        raise ApiError('NOT_FOUND', '数据不存在', 404)
    tables._get_table(db, record.table_id)
    return record


def _version(row, expected):
    if row.version != expected:
        raise ApiError('VERSION_CONFLICT', '内容已被修改，请重新读取后核对再提交', 409,
                       {'current_version': row.version})


@router.get('/me')
def me(token: AgentToken = Depends(get_agent_token)):
    return token_payload(token)


@router.get('/guide')
def guide(_token=Depends(get_agent_token)):
    return {'guide': GUIDE}


@router.get('/todo-lists')
def todo_lists(_token=read_todos, db: Session = Depends(get_db)):
    return todos.list_lists(db)


@router.post('/todo-lists', status_code=201)
def create_list(payload: todos.ListIn, _token=write_todos, db: Session = Depends(get_db)):
    return todos.create_list(payload, db)


@router.get('/todos')
def list_todos(list_id: int, _token=read_todos, db: Session = Depends(get_db)):
    return todos.list_todos(list_id=list_id, sort=None, db=db)


@router.get('/todos/{todo_id}')
def get_todo(todo_id: int, _token=read_todos, db: Session = Depends(get_db)):
    todo = _todo(db, todo_id)
    children = list(db.scalars(select(Todo).where(Todo.parent_id == todo.id).order_by(Todo.sort_index, Todo.id)))
    return todos.serialize(todo, children)


@router.post('/todos', status_code=201)
def create_todo(payload: todos.TodoIn, _token=write_todos, db: Session = Depends(get_db)):
    return todos.create_todo(payload, db)


@router.patch('/todos/{todo_id}')
def update_todo(todo_id: int, payload: TodoPatch, _token=write_todos, db: Session = Depends(get_db)):
    todo = _todo(db, todo_id, lock=True)
    _version(todo, payload.version)
    return todos.update_todo(todo_id, todos.TodoPatch(**payload.model_dump(exclude={'version'})), db)


@router.put('/todos/{todo_id}/completion')
def completion(todo_id: int, payload: CompletionIn, _token=write_todos, db: Session = Depends(get_db)):
    _todo(db, todo_id, lock=True)
    return todos.complete_todo(todo_id, db) if payload.completed else todos.cancel_todo(todo_id, db)


@router.get('/tables')
def list_tables(_token=read_tables, db: Session = Depends(get_db)):
    return tables.list_tables(db=db)


@router.get('/tables/{table_id}')
def get_table(table_id: int, _token=read_tables, db: Session = Depends(get_db)):
    return tables.get_table(table_id, db)


@router.get('/tables/{table_id}/records')
def list_records(table_id: int, page: int = Query(default=1, ge=1),
                 page_size: int = Query(default=50), _token=read_tables, db: Session = Depends(get_db)):
    return tables.list_records(table_id, page=page, page_size=page_size, filters=None, sorts=None, db=db)


@router.post('/tables/{table_id}/records', status_code=201)
def create_record(table_id: int, payload: tables.RecordIn, _token=write_tables, db: Session = Depends(get_db)):
    return tables.create_record(table_id, payload, db)


@router.get('/records/{record_id}')
def get_record(record_id: int, _token=read_tables, db: Session = Depends(get_db)):
    return tables.record_payload(_record(db, record_id),db)


@router.patch('/records/{record_id}')
def update_record(record_id: int, payload: RecordPatch, _token=write_tables, db: Session = Depends(get_db)):
    record = _record(db, record_id, lock=False)
    _version(record, payload.version)
    merged = {**record.data, **payload.data}
    return tables.update_record(record_id, tables.RecordIn(data=merged, version=payload.version), db)
