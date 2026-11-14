from __future__ import annotations

import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Pet
from ..utils import iso_z

STAT_KEYS = ("satiety", "cleanliness", "mood", "energy")
AWAY_DECAY = {"satiety": 1.5, "cleanliness": 0.8, "mood": 1.2, "energy": 1.5}
SLEEP_ENERGY_GAIN = 12.0
NEGLECT_AFTER_HOURS = 12.0
HEALTH_LOSS_PER_DAY = 20.0
HEALTH_REGEN_PER_DAY = 8.0
HEALTH_FLOOR = 10.0
MAX_CATCHUP_DAYS = 90


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


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _decay_awake(pet: Pet, hours: float) -> None:
    poop_mult = 1 + 0.5 * pet.poop_count
    mood_mult = (1 + 0.25 * pet.poop_count) * (1.5 if pet.sick_since is not None else 1)
    energy_mult = 1.25 if pet.sick_since is not None else 1
    pet.satiety = _clamp(pet.satiety - AWAY_DECAY["satiety"] * hours)
    pet.cleanliness = _clamp(pet.cleanliness - AWAY_DECAY["cleanliness"] * poop_mult * hours)
    pet.mood = _clamp(pet.mood - AWAY_DECAY["mood"] * mood_mult * hours)
    pet.energy = _clamp(pet.energy - AWAY_DECAY["energy"] * energy_mult * hours)
    if pet.poop_count >= 3:
        pet.poop_progress = 8.0
        return
    pet.poop_progress += hours
    while pet.poop_progress >= 8 and pet.poop_count < 3:
        pet.poop_progress -= 8
        pet.poop_count += 1
    if pet.poop_count >= 3:
        pet.poop_progress = 8.0


def _decay_sleeping(pet: Pet, hours: float) -> None:
    pet.energy = _clamp(pet.energy + SLEEP_ENERGY_GAIN * hours)
    pet.satiety = _clamp(pet.satiety - AWAY_DECAY["satiety"] * 0.5 * hours)
    pet.cleanliness = _clamp(pet.cleanliness - AWAY_DECAY["cleanliness"] * 0.5 * hours)
    pet.mood = _clamp(pet.mood - AWAY_DECAY["mood"] * 0.5 * hours)


def _settle_health_and_sick(pet: Pet, cursor_start: datetime, cursor_end: datetime) -> None:
    core = (pet.satiety, pet.cleanliness, pet.mood, pet.energy)
    core_min = min(core)
    if core_min < 10:
        if pet.neglect_since is None:
            pet.neglect_since = cursor_end
    else:
        pet.neglect_since = None

    if pet.neglect_since is not None:
        age_start = max(0.0, (cursor_start - pet.neglect_since).total_seconds() / 3600)
        age_end = max(0.0, (cursor_end - pet.neglect_since).total_seconds() / 3600)
        decay_hours = max(0.0, age_end - max(age_start, NEGLECT_AFTER_HOURS))
        pet.health = _clamp(pet.health - HEALTH_LOSS_PER_DAY / 24 * decay_hours, HEALTH_FLOOR)
    elif core_min >= 40:
        pet.health = _clamp(
            pet.health + HEALTH_REGEN_PER_DAY / 24 * (cursor_end - cursor_start).total_seconds() / 3600
        )

    if pet.sick_since is None and pet.health <= 60 + 1e-9:
        pet.sick_since = cursor_end
    elif pet.sick_since is not None and pet.health >= 75 - 1e-9:
        pet.sick_since = None


def advance(pet: Pet, now: datetime) -> None:
    if now <= pet.last_tick_at:
        return
    remaining_hours = (now - pet.last_tick_at).total_seconds() / 3600
    remaining_hours = min(remaining_hours, MAX_CATCHUP_DAYS * 24)
    cursor = pet.last_tick_at

    while remaining_hours > 1e-9:
        step = min(remaining_hours, 1.0)
        step_start = cursor
        step_end = cursor + timedelta(hours=step)

        if pet.sleeping:
            to_full = max(0.0, (100 - pet.energy) / SLEEP_ENERGY_GAIN)
            sleep_h = min(step, to_full)
            if sleep_h > 0:
                _decay_sleeping(pet, sleep_h)
            awake_h = step - sleep_h
            if awake_h > 1e-9:
                pet.sleeping = False
                pet.sleep_started_at = None
                _decay_awake(pet, awake_h)
        else:
            _decay_awake(pet, step)

        _settle_health_and_sick(pet, step_start, step_end)
        cursor = step_end
        remaining_hours -= step

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
