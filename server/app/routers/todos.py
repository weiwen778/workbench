from __future__ import annotations

from typing import Annotated

from datetime import date, datetime, time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import Todo, TodoList, utcnow
from ..utils import LOCAL_TZ, iso_z, now_local, parse_date, today_local

router = APIRouter(tags=["todos"], dependencies=[Depends(get_current_user)])

TodoTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ListPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_mode: str | None = None


class TodoIn(BaseModel):
    list_id: int
    parent_id: int | None = None
    title: TodoTitle
    note: str | None = Field(default=None, max_length=5000)
    due_date: str | None = None
    due_time: str | None = None


class TodoPatch(BaseModel):
    title: TodoTitle | None = None
    note: str | None = Field(default=None, max_length=5000)
    due_date: str | None = None
    due_time: str | None = None
    clear_due: bool = False


class MoveIn(BaseModel):
    list_id: int


class ReorderIn(BaseModel):
    start_index: int = Field(default=0,ge=0)
    list_id: int
    order: list[int]


def _due_at(todo: Todo) -> datetime | None:
    if not todo.due_date:
        return None
    if todo.due_time:
        return datetime.combine(todo.due_date, todo.due_time, tzinfo=LOCAL_TZ)
    return datetime.combine(todo.due_date, time(23, 59, 59), tzinfo=LOCAL_TZ)


def _parse_due_date(value: str | None) -> date | None:
    try:
        return parse_date(value)
    except ValueError as error:
        raise ApiError("INVALID_DUE_DATE", "请输入有效的截止日期", 422) from error


def _parse_due_time(value: str | None) -> time | None:
    if not value:
        return None
    try:
        parsed = time.fromisoformat(value)
    except ValueError as error:
        raise ApiError("INVALID_DUE_TIME", "请输入有效的截止时间", 422) from error
    if parsed.tzinfo is not None:
        raise ApiError("INVALID_DUE_TIME", "截止时间应使用本地时间", 422)
    return parsed


def is_overdue(todo: Todo) -> bool:
    if not todo.due_date or todo.completed_at:
        return False
    now = now_local()
    if todo.due_time:
        return now > datetime.combine(todo.due_date, todo.due_time, tzinfo=LOCAL_TZ)
    return now.date() > todo.due_date


def serialize(todo: Todo, children: list[Todo] | None = None) -> dict:
    children = children or []
    total = len(children)
    done = sum(1 for c in children if c.completed_at)
    if total:
        completed = done == total
    else:
        completed = todo.completed_at is not None
    return {
        "id": todo.id,
        "list_id": todo.list_id,
        "parent_id": todo.parent_id,
        "title": todo.title,
        "note": todo.note,
        "due_date": todo.due_date.isoformat() if todo.due_date else None,
        "due_time": todo.due_time.strftime("%H:%M") if todo.due_time else None,
        "completed": completed,
        "completed_at": iso_z(todo.completed_at) if completed else None,
        "overdue": is_overdue(todo),
        "subtask_total": total,
        "subtask_done": done,
        "can_toggle": total == 0,
        "sort_index": todo.sort_index,
        "version": todo.version,
        "children": [serialize(c) for c in children],
    }


def _lists_payload(db: Session) -> list[dict]:
    lists = db.scalars(select(TodoList).order_by(TodoList.sort_order, TodoList.id)).all()
    counts = {row.list_id: row for row in db.execute(select(
        Todo.list_id,
        func.count(Todo.id).label('total_nodes'),
        func.sum(case((Todo.parent_id.is_(None), 1), else_=0)).label('top_total'),
        func.sum(case((Todo.completed_at.is_(None), 1), else_=0)).label('pending'),
        func.sum(case((Todo.completed_at.is_not(None), 1), else_=0)).label('done'),
    ).group_by(Todo.list_id))}
    return [{'id': lst.id, 'name': lst.name, 'sort_mode': lst.sort_mode, 'sort_order': lst.sort_order,
             **{key: int(getattr(counts.get(lst.id), key, 0) or 0) for key in ('top_total', 'pending', 'done', 'total_nodes')}} for lst in lists]


@router.get("/todo-lists")
def list_lists(db: Session = Depends(get_db)):
    return _lists_payload(db)


@router.post("/todo-lists", status_code=201)
def create_list(payload: ListIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if db.scalar(select(TodoList).where(TodoList.name == name)):
        raise ApiError("NAME_DUPLICATED", "清单名称已存在", 409, {"field": "name"})
    lst = TodoList(name=name, sort_order=(db.scalar(select(func.max(TodoList.sort_order))) or 0) + 1)
    db.add(lst)
    db.commit()
    return {"id": lst.id, "name": lst.name, "sort_mode": lst.sort_mode}


@router.patch("/todo-lists/{list_id}")
def update_list(list_id: int, payload: ListPatch, db: Session = Depends(get_db)):
    lst = db.get(TodoList, list_id)
    if not lst:
        raise ApiError("NOT_FOUND", "清单不存在", 404)
    if payload.name is not None:
        lst.name = payload.name.strip()
    if payload.sort_mode is not None:
        if payload.sort_mode not in {"auto", "manual"}:
            raise ApiError("INVALID_SORT_MODE", "排序方式只能是自动或手动", 422)
        lst.sort_mode = payload.sort_mode
    db.commit()
    return {"id": lst.id, "name": lst.name, "sort_mode": lst.sort_mode}


@router.get("/todo-lists/{list_id}/delete-preview")
def delete_preview(list_id: int, db: Session = Depends(get_db)):
    lst = db.get(TodoList, list_id)
    if not lst:
        raise ApiError("NOT_FOUND", "清单不存在", 404)
    top = db.scalar(select(func.count(Todo.id)).where(Todo.list_id == list_id, Todo.parent_id.is_(None))) or 0
    sub = db.scalar(select(func.count(Todo.id)).where(Todo.list_id == list_id, Todo.parent_id.is_not(None))) or 0
    return {"list_name": lst.name, "top_total": top, "subtask_total": sub, "total": top + sub}


@router.delete("/todo-lists/{list_id}")
def delete_list(list_id: int, db: Session = Depends(get_db)):
    lst = db.get(TodoList, list_id)
    if not lst:
        raise ApiError("NOT_FOUND", "清单不存在", 404)
    from ..services.todo_recovery import capture
    capture(db,lst=lst)
    db.query(Todo).filter(Todo.list_id == list_id, Todo.parent_id.is_not(None)).delete(
        synchronize_session=False
    )
    db.query(Todo).filter(Todo.list_id == list_id).delete(synchronize_session=False)
    db.delete(lst)
    # Preserve a snapshot before removing rows and their list.
    db.commit()
    return {"ok": True, "recoverable": True}


@router.get("/todos")
def list_todos(
    list_id: int = Query(...),
    sort: str | None = None,
    page: Annotated[int | None,Query(ge=1)] = None,
    completed_page: Annotated[int,Query(ge=1)] = 1,
    focus:int|None=None,
    page_size: Annotated[int,Query(ge=1,le=100)] = 50,
    db: Session = Depends(get_db),
):
    lst = db.get(TodoList, list_id)
    if not lst:
        raise ApiError("NOT_FOUND", "清单不存在", 404)
    mode = sort or lst.sort_mode
    if page is not None:
        base=select(Todo).where(Todo.list_id==list_id,Todo.parent_id.is_(None))
        pending_query=base.where(Todo.completed_at.is_(None))
        done_query=base.where(Todo.completed_at.is_not(None))
        pending_total=db.scalar(select(func.count()).select_from(pending_query.subquery())) or 0
        done_total=db.scalar(select(func.count()).select_from(done_query.subquery())) or 0
        order=[Todo.sort_index,Todo.id] if mode=='manual' else [Todo.due_date.is_(None),Todo.due_date,Todo.due_time.is_(None),Todo.due_time,Todo.sort_index,Todo.id]
        if focus:
            focused=db.get(Todo,focus)
            if focused and focused.list_id==list_id:
                top_id=focused.parent_id or focused.id
                top=db.get(Todo,top_id)
                target=done_query if top.completed_at else pending_query
                ordering=[Todo.completed_at.desc(),Todo.id] if top.completed_at else order
                ranked=target.with_only_columns(Todo.id,func.row_number().over(order_by=ordering).label('rank')).subquery()
                rank=db.scalar(select(ranked.c.rank).where(ranked.c.id==top_id))
                if rank:
                    if top.completed_at:completed_page=(rank-1)//page_size+1
                    else:page=(rank-1)//page_size+1
        page=min(page,max(1,(pending_total+page_size-1)//page_size));completed_page=min(completed_page,max(1,(done_total+page_size-1)//page_size))
        pending_rows=list(db.scalars(pending_query.order_by(*order).offset((page-1)*page_size).limit(page_size)))
        done_rows=list(db.scalars(done_query.order_by(Todo.completed_at.desc(),Todo.id).offset((completed_page-1)*page_size).limit(page_size)))
        children={}
        ids=[t.id for t in pending_rows+done_rows]
        if ids:
            for child in db.scalars(select(Todo).where(Todo.parent_id.in_(ids)).order_by(Todo.sort_index,Todo.id)):
                children.setdefault(child.parent_id,[]).append(child)
        total=db.scalar(select(func.count()).select_from(Todo).where(Todo.list_id==list_id)) or 0
        done_count=db.scalar(select(func.count()).select_from(Todo).where(Todo.list_id==list_id,Todo.completed_at.is_not(None))) or 0
        return {'list':{'id':lst.id,'name':lst.name,'sort_mode':mode},'pending':[serialize(t,children.get(t.id,[])) for t in pending_rows],
                'completed':[serialize(t,children.get(t.id,[])) for t in done_rows],
                'counts':{'nodes_total':total,'nodes_pending':total-done_count,'nodes_done':done_count,'top_pending':pending_total,'top_done':done_total},
                'lists':_lists_payload(db),'page':page,'completed_page':completed_page,'page_size':page_size}
    todos = db.scalars(select(Todo).where(Todo.list_id == list_id)).all()
    by_parent: dict[int | None, list[Todo]] = {}
    for t in todos:
        by_parent.setdefault(t.parent_id, []).append(t)

    def overdue_rank(t: Todo) -> tuple:
        if not t.due_date:
            return (1, date.max.toordinal(), time.max)
        return (0, t.due_date.toordinal(), t.due_time or time.min)

    top = by_parent.get(None, [])
    if mode == "manual":
        top.sort(key=lambda t: (t.sort_index, t.id))
    else:
        top.sort(key=lambda t: (overdue_rank(t), t.sort_index, t.id))

    items = []
    for parent in top:
        children = sorted(by_parent.get(parent.id, []), key=lambda c: (c.sort_index, c.id))
        items.append(serialize(parent, children))

    pending = [i for i in items if not i["completed"]]
    done = [i for i in items if i["completed"]]
    done.sort(key=lambda i: (i["completed_at"] or ""), reverse=True)
    return {
        "list": {"id": lst.id, "name": lst.name, "sort_mode": mode},
        "pending": pending,
        "completed": done,
        "counts": {
            "nodes_total": len(todos),
            "nodes_pending": sum(1 for t in todos if t.completed_at is None),
            "nodes_done": sum(1 for t in todos if t.completed_at is not None),
            "top_pending": len(pending),
            "top_done": len(done),
        },
        "lists": _lists_payload(db),
    }


def _recompute_parent(db: Session, parent_id: int | None) -> None:
    if not parent_id:
        return
    parent = db.get(Todo, parent_id)
    if not parent:
        return
    children = db.scalars(select(Todo).where(Todo.parent_id == parent_id)).all()
    if not children:
        return
    all_done = all(c.completed_at is not None for c in children)
    if all_done and parent.completed_at is None:
        parent.completed_at = utcnow()
        parent.version += 1
    elif not all_done and parent.completed_at is not None:
        parent.completed_at = None
        parent.version += 1
    db.flush()


@router.post("/todos", status_code=201)
def create_todo(payload: TodoIn, db: Session = Depends(get_db)):
    lst = db.get(TodoList, payload.list_id)
    if not lst:
        raise ApiError("NOT_FOUND", "清单不存在", 404)
    parent = None
    if payload.parent_id:
        parent = db.get(Todo, payload.parent_id)
        if not parent:
            raise ApiError("PARENT_NOT_FOUND", "父任务不存在", 422)
        if parent.parent_id:
            raise ApiError("SUBTASK_DEPTH", "子任务不能再有子任务", 422)
        if parent.list_id != payload.list_id:
            raise ApiError("LIST_MISMATCH", "子任务必须与父任务属于同一清单", 422)

    due_date = _parse_due_date(payload.due_date)
    due_time = _parse_due_time(payload.due_time)
    if due_time and not due_date:
        raise ApiError("DUE_TIME_NEEDS_DATE", "指定时间需要同时选择日期", 422)

    todo = Todo(
        list_id=payload.list_id,
        parent_id=payload.parent_id,
        title=payload.title,
        note=payload.note,
        due_date=due_date,
        due_time=due_time,
        sort_index=(db.scalar(select(func.max(Todo.sort_index)).where(Todo.list_id == payload.list_id)) or 0) + 1,
    )
    db.add(todo)
    db.flush()
    # 已完成父任务新增未完成子任务 → 父任务恢复未完成
    if parent and parent.completed_at is not None:
        parent.completed_at = None
        parent.version += 1
    db.commit()
    return serialize(todo)


@router.patch("/todos/{todo_id}")
def update_todo(todo_id: int, payload: TodoPatch, db: Session = Depends(get_db)):
    todo = db.get(Todo, todo_id)
    if not todo:
        raise ApiError("NOT_FOUND", "待办不存在", 404)
    if payload.title is not None:
        todo.title = payload.title
    if payload.note is not None:
        todo.note = payload.note
    if payload.clear_due:
        todo.due_date = None
        todo.due_time = None
    else:
        if payload.due_date is not None:
            todo.due_date = _parse_due_date(payload.due_date)
        if "due_time" in payload.model_fields_set:
            todo.due_time = _parse_due_time(payload.due_time)
        if todo.due_time and not todo.due_date:
            raise ApiError("DUE_TIME_NEEDS_DATE", "指定时间需要同时选择日期", 422)
    todo.version += 1
    db.commit()
    children = db.scalars(select(Todo).where(Todo.parent_id == todo.id)).all()
    return serialize(todo, list(children))


@router.post("/todos/{todo_id}/complete")
def complete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.get(Todo, todo_id)
    if not todo:
        raise ApiError("NOT_FOUND", "待办不存在", 404)
    children = db.scalars(select(Todo).where(Todo.parent_id == todo.id)).all()
    if children:
        raise ApiError(
            "PARENT_MANAGED",
            "该任务有子任务，完成状态由子任务决定，请逐项勾选子任务",
            409,
        )
    if todo.completed_at is None:
        todo.completed_at = utcnow()
        todo.version += 1
        _recompute_parent(db, todo.parent_id)
    db.commit()
    return serialize(todo)


@router.post("/todos/{todo_id}/cancel")
def cancel_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.get(Todo, todo_id)
    if not todo:
        raise ApiError("NOT_FOUND", "待办不存在", 404)
    children = db.scalars(select(Todo).where(Todo.parent_id == todo.id)).all()
    if children:
        raise ApiError("PARENT_MANAGED", "该任务有子任务，请取消对应子任务", 409)
    if todo.completed_at is not None:
        todo.completed_at = None
        todo.version += 1
        _recompute_parent(db, todo.parent_id)
    db.commit()
    return serialize(todo)


@router.post("/todos/{todo_id}/move")
def move_todo(todo_id: int, payload: MoveIn, db: Session = Depends(get_db)):
    todo = db.get(Todo, todo_id)
    if not todo:
        raise ApiError("NOT_FOUND", "待办不存在", 404)
    if not db.get(TodoList, payload.list_id):
        raise ApiError("NOT_FOUND", "清单不存在", 404)
    if todo.parent_id is not None and payload.list_id != todo.list_id:
        raise ApiError(
            "CHILD_MOVE",
            "子任务不能单独移动到其他清单，请移动父任务",
            409,
        )
    old_parent = todo.parent_id
    todo.list_id = payload.list_id
    for child in db.scalars(select(Todo).where(Todo.parent_id == todo.id)).all():
        child.list_id = payload.list_id
    db.flush()
    _recompute_parent(db, old_parent)
    db.commit()
    return serialize(todo)


@router.post("/todos/reorder")
def reorder(payload: ReorderIn, db: Session = Depends(get_db)):
    for index, todo_id in enumerate(payload.order):
        todo = db.get(Todo, todo_id)
        if todo and todo.list_id == payload.list_id:
            todo.sort_index = payload.start_index + index + 1
    lst = db.get(TodoList, payload.list_id)
    if lst:
        lst.sort_mode = "manual"
    db.commit()
    return {"ok": True}


@router.delete("/todos/{todo_id}")
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.get(Todo, todo_id)
    if not todo:
        raise ApiError("NOT_FOUND", "待办不存在", 404)
    from ..services.todo_recovery import capture
    capture(db,todo=todo)
    parent_id = todo.parent_id
    children = db.scalars(select(Todo).where(Todo.parent_id == todo.id)).all()
    for child in children:
        db.delete(child)
    db.flush()
    db.delete(todo)
    db.flush()
    # 删除最后一个子任务时父任务保留当时状态，恢复手动完成能力
    _recompute_parent(db, parent_id)
    db.commit()
    return {"ok": True, "recoverable": True, "deleted_subtasks": len(children)}
