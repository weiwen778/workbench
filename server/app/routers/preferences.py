from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import User

router = APIRouter(tags=["preferences"])

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class PreferencesIn(BaseModel):
    theme: str | None = None
    theme_color: str | None = None


def _payload(user: User) -> dict:
    return {"theme": user.theme, "theme_color": user.theme_color}


@router.get("/preferences")
def get_preferences(user: User = Depends(get_current_user)):
    return _payload(user)


@router.put("/preferences")
def update_preferences(
    payload: PreferencesIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.theme is not None:
        if payload.theme not in {"light", "dark"}:
            raise ApiError("INVALID_THEME", "主题只能是 light 或 dark", 422)
        user.theme = payload.theme
    if payload.theme_color is not None:
        if not HEX_COLOR.match(payload.theme_color):
            raise ApiError("INVALID_THEME_COLOR", "主题色需要 #RRGGBB 格式", 422)
        user.theme_color = payload.theme_color.lower()
    db.commit()
    return _payload(user)
