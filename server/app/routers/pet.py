from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError, field_error
from ..models import Pet, User, utcnow
from ..services.pet import advance, apply_action, claim_daily_bonus, pet_payload

router = APIRouter(tags=["pet"], dependencies=[Depends(get_current_user)])


class PetCreate(BaseModel):
    name: str | None = None


class PetRename(BaseModel):
    name: str


class PetAction(BaseModel):
    action: Literal["feed", "treat", "wash", "play", "walk", "sleep", "wake", "vet", "pet"]


def _clean_name(value: str, default: str | None = None) -> str:
    name = value.strip()
    if not name and default is not None:
        return default
    if not 1 <= len(name) <= 12:
        raise field_error("name", "名字需要 1–12 个字")
    return name


def _owned(db: Session, user: User) -> Pet:
    pet = db.scalar(select(Pet).where(Pet.user_id == user.id))
    if pet is None:
        raise ApiError("PET_NOT_FOUND", "还没有领养宠物", 404)
    return pet


@router.get("/pet")
def get_pet(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = utcnow()
    pet = db.scalar(select(Pet).where(Pet.user_id == user.id))
    if pet is None:
        return {"pet": None, "daily_bonus": None}
    advance(pet, now)
    bonus = claim_daily_bonus(db, pet, now)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now), "daily_bonus": bonus}


@router.post("/pet", status_code=201)
def adopt(body: PetCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.scalar(select(Pet.id).where(Pet.user_id == user.id)) is not None:
        raise ApiError("PET_EXISTS", "已经领养过了", 409)
    name = _clean_name(body.name, default="旺财") if body.name is not None else "旺财"
    now = utcnow()
    pet = Pet(user_id=user.id, name=name, last_tick_at=now)
    db.add(pet)
    try:
        db.commit()
    except IntegrityError:
        # 并发领养：唯一索引兜底，第二个请求返回 409 而不是 500。
        db.rollback()
        raise ApiError("PET_EXISTS", "已经领养过了", 409)
    db.refresh(pet)
    return {"pet": pet_payload(pet, now)}


@router.patch("/pet")
def rename(body: PetRename, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pet = _owned(db, user)
    now = utcnow()
    advance(pet, now)
    pet.name = _clean_name(body.name)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now)}


@router.post("/pet/actions")
def act(body: PetAction, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pet = _owned(db, user)
    now = utcnow()
    event, message = apply_action(pet, body.action, now)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now), "event": event, "message": message}
