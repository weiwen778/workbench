from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import CheckinInstance, Pet, Todo
from ..utils import iso_z, local_midnight_utc, utc_to_local

STAT_KEYS = ("satiety", "cleanliness", "mood", "energy")
AWAY_DECAY = {"satiety": 1.5, "cleanliness": 0.8, "mood": 1.2, "energy": 1.5}
SLEEP_ENERGY_GAIN = 12.0
NEGLECT_AFTER_HOURS = 12.0
HEALTH_LOSS_PER_DAY = 20.0
HEALTH_REGEN_PER_DAY = 8.0
HEALTH_FLOOR = 10.0
MAX_CATCHUP_DAYS = 90
ACTION_COOLDOWNS = {
    "feed": 1800,
    "treat": 3600,
    "wash": 7200,
    "play": 1200,
    "walk": 14400,
    "vet": 28800,
    "pet": 5,
}
CARE_ACTIONS = {"feed", "treat", "wash", "play", "walk", "vet"}
COOLDOWN_FIELDS = {
    "feed": "last_fed_at",
    "treat": "last_treated_at",
    "wash": "last_washed_at",
    "play": "last_played_at",
    "walk": "last_walked_at",
    "vet": "last_vet_at",
    "pet": "last_petted_at",
}
PET_ACTIONS = {"feed", "treat", "wash", "play", "walk", "sleep", "wake", "vet", "pet"}


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


def _remaining(last: datetime | None, now: datetime, seconds: int) -> int:
    if last is None:
        return 0
    elapsed = max(0.0, (now - last).total_seconds())
    return max(0, int(math.ceil(seconds - elapsed)))


def _hour_bucket(now: datetime) -> datetime:
    local = utc_to_local(now)
    bucket = local.replace(minute=0, second=0, microsecond=0)
    return bucket.astimezone(timezone.utc).replace(tzinfo=None)


def _seconds_to_next_hour(now: datetime) -> int:
    local = utc_to_local(now)
    next_hour = local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return max(0, int(math.ceil((next_hour - local).total_seconds())))


def _cooldowns(pet: Pet, now: datetime) -> dict[str, int]:
    result = {
        action: _remaining(getattr(pet, COOLDOWN_FIELDS[action]), now, seconds)
        for action, seconds in ACTION_COOLDOWNS.items()
    }
    if pet.pet_bonus_total >= 15 and pet.pet_bonus_hour == _hour_bucket(now):
        result["pet"] = max(result["pet"], _seconds_to_next_hour(now))
    return result


def _mark_care(pet: Pet, now: datetime) -> None:
    day = utc_to_local(now).date()
    if pet.last_care_date != day:
        pet.last_care_date = day
        pet.care_days += 1


def apply_action(pet: Pet, action: str, now: datetime) -> tuple[str, str]:
    if action not in PET_ACTIONS:
        raise ApiError("VALIDATION_ERROR", "未知的宠物动作", 422)

    advance(pet, now)
    if pet.sleeping and action != "wake":
        raise ApiError("PET_SLEEPING", "它正在睡觉，先叫醒它", 409)

    if action == "sleep":
        pet.sleeping = True
        pet.sleep_started_at = now
        return "slept", "睡着了"
    if action == "wake":
        pet.sleeping = False
        pet.sleep_started_at = None
        return "woke", "醒来了"

    if action == "pet" and pet.pet_bonus_total >= 15 and pet.pet_bonus_hour == _hour_bucket(now):
        raise ApiError(
            "PET_PET_LIMIT",
            "这个小时摸够啦，让它歇会儿",
            409,
            {"retry_after_seconds": _seconds_to_next_hour(now)},
        )

    remaining = _remaining(
        getattr(pet, COOLDOWN_FIELDS[action]),
        now,
        ACTION_COOLDOWNS[action],
    )
    if remaining > 0:
        raise ApiError(
            "PET_COOLDOWN",
            "还在冷却中",
            409,
            {"action": action, "remaining_seconds": remaining},
        )

    if action == "feed":
        if pet.satiety >= 95:
            raise ApiError("PET_TOO_FULL", "它已经吃饱了", 409)
        pet.satiety = _clamp(pet.satiety + 40)
        event, message = "fed", "吃饱啦，饱腹 +40"
    elif action == "treat":
        if pet.treats <= 0:
            raise ApiError("PET_NO_TREAT", "没有零食了", 409)
        pet.treats -= 1
        pet.satiety = _clamp(pet.satiety + 15)
        pet.mood = _clamp(pet.mood + 8)
        event, message = "treated", "零食真好吃，心情 +8"
    elif action == "wash":
        pet.cleanliness = _clamp(pet.cleanliness + 50)
        pet.energy = _clamp(pet.energy - 5)
        pet.poop_count = 0
        pet.poop_progress = 0
        event, message = "washed", "洗得干干净净"
    elif action == "play":
        if pet.sick_since is not None:
            raise ApiError("PET_SICK", "生病了，先看医生吧", 409)
        if pet.energy < 20:
            raise ApiError("PET_TOO_TIRED", "太累了，先睡一觉", 409)
        pet.mood = _clamp(pet.mood + 20)
        pet.energy = _clamp(pet.energy - 8)
        event, message = "played", "玩得很开心，心情 +20"
    elif action == "walk":
        if pet.sick_since is not None:
            raise ApiError("PET_SICK", "生病了，先看医生吧", 409)
        if pet.energy < 25:
            raise ApiError("PET_TOO_TIRED", "太累了，走不动", 409)
        if not 7 <= utc_to_local(now).hour < 22:
            raise ApiError("PET_DAYTIME_ONLY", "太晚了，明天再散步吧", 409)
        pet.mood = _clamp(pet.mood + 25)
        pet.satiety = _clamp(pet.satiety - 6)
        pet.energy = _clamp(pet.energy - 12)
        event, message = "walked", "散步回来了，心情 +25"
    elif action == "vet":
        if pet.health >= 85:
            raise ApiError("PET_NOT_SICK", "它很健康，不需要看医生", 409)
        pet.health = _clamp(pet.health + 20)
        event, message = "vetted", "看过医生，健康 +20"
    else:  # pet
        bucket = _hour_bucket(now)
        if pet.pet_bonus_hour != bucket:
            pet.pet_bonus_hour = bucket
            pet.pet_bonus_total = 0
        gain = min(3, 15 - pet.pet_bonus_total)
        pet.mood = _clamp(pet.mood + gain)
        pet.pet_bonus_total += gain
        event, message = "petted", "它蹭了蹭你的手，心情 +3"

    setattr(pet, COOLDOWN_FIELDS[action], now)
    if action in CARE_ACTIONS:
        _mark_care(pet, now)
    return event, message


def claim_daily_bonus(db: Session, pet: Pet, now: datetime) -> dict | None:
    day = utc_to_local(now).date()
    if pet.daily_bonus_date == day:
        return None

    start = local_midnight_utc(day)
    end = local_midnight_utc(day + timedelta(days=1))
    has_checkin = db.scalar(
        select(CheckinInstance.id)
        .where(CheckinInstance.completed_at >= start, CheckinInstance.completed_at < end)
        .limit(1)
    ) is not None
    has_todo = False
    if not has_checkin:
        has_todo = db.scalar(
            select(Todo.id)
            .where(Todo.completed_at >= start, Todo.completed_at < end)
            .limit(1)
        ) is not None
    if not (has_checkin or has_todo):
        return None

    pet.daily_bonus_date = day
    pet.mood = _clamp(pet.mood + 6)
    pet.treats = min(5, pet.treats + 1)
    return {
        "mood": 6,
        "treats": 1,
        "source": "checkin" if has_checkin else "todo",
        "date": day.isoformat(),
    }


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
        "cooldowns": _cooldowns(pet, now),
        "next_stage_in_days": next_stage_in_days,
        "version": pet.version,
        "updated_at": iso_z(pet.updated_at),
    }
