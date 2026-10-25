from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import User

router = APIRouter(tags=["preferences"])


class ThemeIn(BaseModel):
    theme: str


@router.get("/preferences")
def get_preferences(user: User = Depends(get_current_user)):
    return {"theme": user.theme}


@router.put("/preferences")
def update_preferences(
    payload: ThemeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.theme not in {"light", "dark"}:
        raise ApiError("INVALID_THEME", "主题只能是 light 或 dark", 422)
    user.theme = payload.theme
    db.commit()
    return {"theme": user.theme}
