from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import Dashboard, User, utcnow
from ..services.dashboard import DateRange, Widget, aggregate, validate_source
from ..utils import iso_z

router = APIRouter(tags=['dashboards'])


class BoardIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator('name')
    @classmethod
    def clean(cls, value):
        if not value.strip():
            raise ValueError('请填写看板名称')
        return value.strip()


class BoardUpdate(BoardIn):
    version: int = Field(ge=1)
    widgets: list[Widget] = Field(max_length=24)

    @model_validator(mode='after')
    def unique_ids(self):
        if len({w.id for w in self.widgets}) != len(self.widgets):
            raise ValueError('图表标识不能重复')
        return self


class PreviewIn(DateRange):
    widget: Widget


def board_payload(board):
    return {'id': board.id, 'name': board.name, 'widgets': board.widgets,
            'version': board.version, 'updated_at': iso_z(board.updated_at)}


def get_board(db, user, board_id, lock=False):
    stmt = select(Dashboard).where(Dashboard.id == board_id, Dashboard.user_id == user.id)
    board = db.scalar(stmt.with_for_update() if lock else stmt)
    if board is None:
        raise ApiError('NOT_FOUND', '看板不存在', 404)
    return board


@router.get('/dashboards')
def list_boards(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [board_payload(b) for b in db.scalars(select(Dashboard).where(
        Dashboard.user_id == user.id).order_by(Dashboard.id))]


@router.post('/dashboards', status_code=201)
def create_board(payload: BoardIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.scalar(select(func.count()).select_from(Dashboard).where(Dashboard.user_id == user.id)) >= 30:
        raise ApiError('DASHBOARD_LIMIT', '最多创建 30 个看板', 409)
    board = Dashboard(user_id=user.id, name=payload.name, widgets=[], version=1)
    db.add(board)
    db.commit()
    return board_payload(board)


@router.post('/dashboards/preview')
def preview(payload: PreviewIn, _user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    validate_source(db, payload.widget)
    return aggregate(db, [payload.widget], payload)[0]


@router.get('/dashboards/{board_id}/data')
def board_data(board_id: int, start_date: str | None = Query(default=None), end_date: str | None = Query(default=None),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from pydantic import ValidationError
    try:
        dates = DateRange(start_date=start_date, end_date=end_date)
    except ValidationError:
        raise ApiError('INVALID_DATE_RANGE', '请选择合法的起止日期，开始日期不能晚于结束日期', 422)
    board = get_board(db, user, board_id)
    widgets = [Widget.model_validate(w) for w in board.widgets]
    from ..services import dashboard_cache as cache
    key=cache.get_key(db,board,widgets,dates);result=cache.get(key)
    if result is not None:return {**result,'cached':True}
    result={'widgets':aggregate(db,widgets,dates),'generated_at':iso_z(utcnow()),'version':board.version,'cached':False}
    cache.put(key,result)
    return result


@router.put('/dashboards/{board_id}')
def update_board(board_id: int, payload: BoardUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    board = get_board(db, user, board_id, lock=True)
    if board.version != payload.version:
        raise ApiError('VERSION_CONFLICT', '看板配置已在其他位置修改，请刷新后再试', 409)
    old_widgets = {w['id']: w for w in board.widgets}
    for widget in payload.widgets:
        # Keep unchanged, broken-source cards editable/removable without blocking all other changes.
        if (Widget.model_validate(old_widgets[widget.id]).model_dump(mode='json') if widget.id in old_widgets else None) != widget.model_dump(mode='json'):
            validate_source(db, widget)
    board.name = payload.name
    board.widgets = [w.model_dump(mode='json') for w in payload.widgets]
    board.version += 1
    db.commit()
    return board_payload(board)


@router.delete('/dashboards/{board_id}')
def delete_board(board_id: int, version: int = Query(..., ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    board = get_board(db, user, board_id, lock=True)
    if board.version != version:
        raise ApiError('VERSION_CONFLICT', '看板配置已修改，请刷新后再试', 409)
    db.delete(board)
    db.commit()
    return {'ok': True}
