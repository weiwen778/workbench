from __future__ import annotations

import math
from datetime import datetime

from sqlalchemy.orm import Session

from ..models import Pet
from ..utils import iso_z

STAT_KEYS = ("satiety", "cleanliness", "mood", "energy")


def round_stat(value: float) -> int:
    return int(math.floor(max(0.0, value) + 0.5))


def stage_for(care_days: int) -> tuple[str, str, int | None]:
    if care_days < 7:
        return "puppy", "幼犬", 7 - care_days
    if care_days < 30:
        return "adult", "成年", 30 - care_days
    return "senior", "老年", None


def status_for(pet: Pet) -> tuple[str, str]:
    if pet.sleeping:
        return "sleeping", "睡觉中"
    if pet.sick_since is not None:
        return "sick", "生病了"
    if pet.satiety <= 20:
        return "hungry", "饿坏了"
    if pet.energy <= 20:
        return "tired", "困得不行"
    if pet.cleanliness <= 20:
        return "dirty", "脏兮兮"
    if pet.mood <= 20:
        return "sad", "不开心"
    if min(pet.satiety, pet.cleanliness, pet.mood, pet.energy) >= 70:
        return "great", "精神很好"
    return "ok", "还不错"


def advance(pet: Pet, now: datetime) -> None:
    """Task 2 替换为真实补算；Task 1 只保证读取不重复计时。"""
    if now > pet.last_tick_at:
        pet.last_tick_at = now


def claim_daily_bonus(db: Session, pet: Pet, now: datetime) -> dict | None:
    """Task 4 实现。"""
    return None


def pet_payload(pet: Pet, now: datetime) -> dict:
    stage, stage_label, next_stage_in_days = stage_for(pet.care_days)
    status, status_label = status_for(pet)
    return {
        "id": pet.id,
        "name": pet.name,
        "species": pet.species,
        "stage": stage,
        "stage_label": stage_label,
        "care_days": pet.care_days,
        "stats": {key: round_stat(getattr(pet, key)) for key in STAT_KEYS + ("health",)},
        "status": status,
        "status_label": status_label,
        "sleeping": pet.sleeping,
        "poop_count": pet.poop_count,
        "treats": pet.treats,
        "cooldowns": {
            "feed": 0, "treat": 0, "wash": 0, "play": 0, "walk": 0, "vet": 0, "pet": 0,
        },
        "next_stage_in_days": next_stage_in_days,
        "version": pet.version,
        "updated_at": iso_z(pet.updated_at),
    }
