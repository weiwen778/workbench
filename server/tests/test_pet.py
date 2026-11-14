from datetime import date, datetime, timedelta, timezone

import pytest

from app.errors import ApiError
from app.models import (
    CheckinGroup,
    CheckinInstance,
    CheckinRule,
    Pet,
    Todo,
    TodoList,
    WorkTarget,
)
from app.services.pet import (
    advance,
    apply_action,
    claim_daily_bonus,
    pet_payload,
    stage_for,
    status_for,
)
from app.utils import LOCAL_TZ

T0 = datetime(2026, 11, 14, 0, 0)


def _make_pet(db, **overrides):
    values = {"user_id": 1, "name": "旺财", "last_tick_at": T0}
    values.update(overrides)
    pet = Pet(**values)
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return pet


def _local_noon(day_offset=0):
    local = datetime(2026, 11, 14, 12, 0, tzinfo=LOCAL_TZ) + timedelta(days=day_offset)
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def test_get_pet_before_adoption_is_empty(auth):
    resp = auth.get("/api/v1/pet")
    assert resp.status_code == 200
    assert resp.json() == {"pet": None, "daily_bonus": None}


def test_adopt_returns_initial_payload(auth):
    resp = auth.post("/api/v1/pet", json={})
    assert resp.status_code == 201
    pet = resp.json()["pet"]
    assert pet["name"] == "旺财"
    assert pet["species"] == "dog"
    assert pet["stage"] == "puppy"
    assert pet["stage_label"] == "幼犬"
    assert pet["care_days"] == 0
    assert pet["next_stage_in_days"] == 7
    assert pet["status"] == "great"
    assert pet["status_label"] == "精神很好"
    assert pet["stats"] == {
        "satiety": 70, "cleanliness": 90, "mood": 80, "energy": 80, "health": 100,
    }
    assert pet["cooldowns"] == {
        "feed": 0, "treat": 0, "wash": 0, "play": 0, "walk": 0, "vet": 0, "pet": 0,
    }
    assert pet["treats"] == 0
    assert pet["poop_count"] == 0
    assert pet["sleeping"] is False
    assert pet["version"] == 1


def test_adopt_twice_returns_pet_exists(auth):
    assert auth.post("/api/v1/pet", json={}).status_code == 201
    resp = auth.post("/api/v1/pet", json={"name": "小黑"})
    assert resp.status_code == 409
    assert resp.json()["code"] == "PET_EXISTS"


def test_rename_and_reject_invalid_names(auth):
    auth.post("/api/v1/pet", json={})
    resp = auth.patch("/api/v1/pet", json={"name": "  豆豆  "})
    assert resp.status_code == 200
    assert resp.json()["pet"]["name"] == "豆豆"

    for bad in ("", "   ", "一" * 13):
        resp = auth.patch("/api/v1/pet", json={"name": bad})
        assert resp.status_code == 422
        assert resp.json()["code"] == "VALIDATION_ERROR"
        assert resp.json()["details"]["fields"]["name"]


def test_stage_and_status_boundaries():
    assert stage_for(0) == ("puppy", "幼犬", 7)
    assert stage_for(6) == ("puppy", "幼犬", 1)
    assert stage_for(7) == ("adult", "成年", 23)
    assert stage_for(29) == ("adult", "成年", 1)
    assert stage_for(30) == ("senior", "老年", None)

    pet = Pet(name="旺财", satiety=70, cleanliness=90, mood=80, energy=80, health=100)
    assert status_for(pet) == ("great", "精神很好")
    pet.sleeping = True
    assert status_for(pet) == ("sleeping", "睡觉中")
    pet.sleeping = False
    pet.sick_since = T0
    assert status_for(pet) == ("sick", "生病了")
    pet.sick_since = None
    pet.satiety = 20
    assert status_for(pet) == ("hungry", "饿坏了")


def test_payload_rounds_half_up(db):
    pet = _make_pet(db, satiety=68.5, cleanliness=89.2, mood=78.8, energy=78.5)
    payload = pet_payload(pet, T0)
    assert payload["stats"]["satiety"] == 69
    assert payload["stats"]["cleanliness"] == 89
    assert payload["stats"]["mood"] == 79
    assert payload["stats"]["energy"] == 79
    assert payload["updated_at"].endswith("Z")


def test_one_hour_of_decay(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=1))
    assert pet.satiety == pytest.approx(68.5)
    assert pet.cleanliness == pytest.approx(89.2)
    assert pet.mood == pytest.approx(78.8)
    assert pet.energy == pytest.approx(78.5)
    assert pet.health == pytest.approx(100)
    assert pet.poop_count == 0


def test_half_hour_is_fractional(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(minutes=30))
    assert pet.satiety == pytest.approx(69.25)
    assert pet.cleanliness == pytest.approx(89.6)
    assert pet.mood == pytest.approx(79.4)
    assert pet.energy == pytest.approx(79.25)


def test_24h_makes_three_poops_and_drops_needs(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=24))
    assert pet.poop_count == 3
    assert pet.poop_progress == pytest.approx(8)
    assert pet.satiety == pytest.approx(34)
    assert pet.cleanliness == pytest.approx(61.2)
    assert pet.mood == pytest.approx(44)
    assert pet.energy == pytest.approx(44)
    assert pet.health == pytest.approx(100)


def test_72h_is_collapsed_but_not_sick(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=72))
    assert pet.satiety == pytest.approx(0)
    assert pet.cleanliness == pytest.approx(0)
    assert pet.mood == pytest.approx(0)
    assert pet.energy == pytest.approx(0)
    assert pet.health == pytest.approx(100 - (72 - 53) * 20 / 24, abs=1e-4)
    assert pet.sick_since is None


def test_101h_enters_sick(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=101))
    assert pet.health == pytest.approx(60, abs=1e-4)
    assert pet.sick_since is not None
    assert status_for(pet) == ("sick", "生病了")


def test_90_days_keeps_health_floor_and_life(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(days=120))
    assert pet.health == pytest.approx(10)
    assert pet.sick_since is not None
    assert pet.last_tick_at == T0 + timedelta(days=120)


def test_sleeping_recovers_energy_and_halves_decay(db):
    pet = _make_pet(db, energy=20, sleeping=True, sleep_started_at=T0)
    advance(pet, T0 + timedelta(hours=1))
    assert pet.energy == pytest.approx(32)
    assert pet.satiety == pytest.approx(69.25)
    assert pet.cleanliness == pytest.approx(89.6)
    assert pet.mood == pytest.approx(79.4)
    assert pet.poop_count == 0
    assert pet.sleeping is True


def test_sleep_auto_wakes_at_100(db):
    pet = _make_pet(db, energy=99, sleeping=True, sleep_started_at=T0)
    advance(pet, T0 + timedelta(hours=1))
    assert pet.sleeping is False
    assert pet.energy == pytest.approx(98.625)


def test_clock_backwards_is_noop(db):
    pet = _make_pet(db, satiety=42)
    advance(pet, T0 - timedelta(hours=1))
    assert pet.satiety == pytest.approx(42)
    assert pet.last_tick_at == T0


def test_three_poops_stop_progress(db):
    pet = _make_pet(db, poop_count=3, poop_progress=8)
    advance(pet, T0 + timedelta(hours=8))
    assert pet.poop_count == 3
    assert pet.poop_progress == pytest.approx(8)


def test_health_regenerates_when_all_needs_are_above_40(db):
    pet = _make_pet(
        db, health=65, satiety=80, cleanliness=80, mood=80, energy=80,
        neglect_since=None,
    )
    advance(pet, T0 + timedelta(hours=24))
    assert pet.health == pytest.approx(73)


def test_sick_clears_at_75(db):
    pet = _make_pet(
        db, health=74, satiety=80, cleanliness=80, mood=80, energy=80,
        sick_since=T0, neglect_since=None,
    )
    advance(pet, T0 + timedelta(hours=4))
    assert pet.health == pytest.approx(75.3333, abs=1e-4)
    assert pet.sick_since is None


def test_feed_caps_and_sets_cooldown(auth):
    pet = auth.post("/api/v1/pet", json={}).json()["pet"]
    resp = auth.post("/api/v1/pet/actions", json={"action": "feed"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["event"] == "fed"
    assert body["pet"]["stats"]["satiety"] == 100
    assert 1790 <= body["pet"]["cooldowns"]["feed"] <= 1800

    second = auth.post("/api/v1/pet/actions", json={"action": "feed"})
    assert second.status_code == 409
    assert second.json()["code"] == "PET_COOLDOWN"
    assert second.json()["details"]["remaining_seconds"] > 0


def test_feed_rejects_when_too_full(db):
    pet = _make_pet(db, satiety=95)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "feed", T0)
    assert exc.value.code == "PET_TOO_FULL"


def test_treat_consumes_snack_and_needs_one(db):
    pet = _make_pet(db, treats=0)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "treat", T0)
    assert exc.value.code == "PET_NO_TREAT"

    pet.treats = 1
    event, _ = apply_action(pet, "treat", T0)
    assert event == "treated"
    assert pet.treats == 0
    assert pet.satiety == pytest.approx(85)
    assert pet.mood == pytest.approx(88)


def test_wash_clears_poop_and_costs_energy(db):
    pet = _make_pet(db, cleanliness=40, energy=80, poop_count=3, poop_progress=8)
    event, _ = apply_action(pet, "wash", T0)
    assert event == "washed"
    assert pet.cleanliness == pytest.approx(90)
    assert pet.energy == pytest.approx(75)
    assert pet.poop_count == 0
    assert pet.poop_progress == 0


def test_play_requires_energy(db):
    pet = _make_pet(db, energy=19)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "play", T0)
    assert exc.value.code == "PET_TOO_TIRED"

    pet.energy = 20
    event, _ = apply_action(pet, "play", T0)
    assert event == "played"
    assert pet.mood == pytest.approx(100)
    assert pet.energy == pytest.approx(12)


def test_play_blocks_sick_but_not_recovering_band(db):
    pet = _make_pet(db, energy=80, sick_since=T0 - timedelta(hours=1))
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "play", T0)
    assert exc.value.code == "PET_SICK"

    pet.sick_since = None
    pet.health = 70
    pet.last_played_at = None
    assert apply_action(pet, "play", T0)[0] == "played"


def test_walk_is_daytime_only_and_costs_needs(db):
    night = datetime(2026, 11, 14, 22, 0, tzinfo=LOCAL_TZ).astimezone(timezone.utc).replace(tzinfo=None)
    pet = _make_pet(db, energy=80, satiety=80, mood=50, last_tick_at=night)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "walk", night)
    assert exc.value.code == "PET_DAYTIME_ONLY"

    noon = _local_noon()
    pet.last_tick_at = noon
    pet.last_walked_at = None
    event, _ = apply_action(pet, "walk", noon)
    assert event == "walked"
    assert pet.mood == pytest.approx(75)
    assert pet.satiety == pytest.approx(74)
    assert pet.energy == pytest.approx(68)


def test_vet_heals_only_when_needed(db):
    pet = _make_pet(db, health=50, sick_since=T0 - timedelta(days=1))
    event, _ = apply_action(pet, "vet", T0)
    assert event == "vetted"
    assert pet.health == pytest.approx(70)
    assert pet.sick_since is not None

    pet.health = 90
    pet.last_vet_at = None
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "vet", T0)
    assert exc.value.code == "PET_NOT_SICK"


def test_sleep_blocks_other_actions_until_wake(db):
    pet = _make_pet(db)
    assert apply_action(pet, "sleep", T0)[0] == "slept"
    assert pet.sleeping is True
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "feed", T0)
    assert exc.value.code == "PET_SLEEPING"
    assert apply_action(pet, "wake", T0)[0] == "woke"
    assert pet.sleeping is False
    assert apply_action(pet, "feed", T0)[0] == "fed"


def test_care_days_increment_once_per_local_day(db):
    pet = _make_pet(db)
    assert pet.care_days == 0
    apply_action(pet, "feed", T0)
    assert pet.care_days == 1
    apply_action(pet, "wash", T0 + timedelta(hours=2))
    assert pet.care_days == 1
    apply_action(pet, "feed", T0 + timedelta(days=1))
    assert pet.care_days == 2


def test_pet_cap_and_no_care(db):
    pet = _make_pet(db, mood=0)
    now = T0
    for _ in range(5):
        pet.last_tick_at = now
        event, _ = apply_action(pet, "pet", now)
        assert event == "petted"
        now += timedelta(seconds=5)
    assert pet.mood == pytest.approx(15)
    assert pet.care_days == 0
    assert pet.pet_bonus_total == 15

    with pytest.raises(ApiError) as exc:
        apply_action(pet, "pet", now)
    assert exc.value.code == "PET_PET_LIMIT"
    assert exc.value.details["retry_after_seconds"] > 0


def test_exact_cooldown_boundary_allows_action(db):
    pet = _make_pet(db, satiety=50)
    apply_action(pet, "feed", T0)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "feed", T0 + timedelta(seconds=1799))
    assert exc.value.details["remaining_seconds"] == 1
    assert apply_action(pet, "feed", T0 + timedelta(seconds=1800))[0] == "fed"


def _completed_todo(db, when):
    row = TodoList(name="默认")
    db.add(row)
    db.flush()
    db.add(Todo(list_id=row.id, title="完成的事", completed_at=when))
    db.commit()


def _completed_checkin(db, when):
    target = WorkTarget(kind="shop", name="测试店")
    group = CheckinGroup(name="默认分组")
    db.add_all([target, group])
    db.flush()
    rule = CheckinRule(target_id=target.id, group_id=group.id, title="每日打卡")
    db.add(rule)
    db.flush()
    db.add(CheckinInstance(
        rule_id=rule.id, target_id=target.id, target_name=target.name,
        group_id=group.id, group_name=group.name, period_type="daily",
        period_start=when.date(), period_end=when.date(),
        title=rule.title, completed_at=when,
    ))
    db.commit()


def test_daily_bonus_none_without_completed_work(db):
    pet = _make_pet(db)
    assert claim_daily_bonus(db, pet, T0) is None
    assert pet.daily_bonus_date is None


def test_daily_bonus_once_from_checkin(db):
    pet = _make_pet(db)
    _completed_checkin(db, T0)
    bonus = claim_daily_bonus(db, pet, T0)
    assert bonus == {"mood": 6, "treats": 1, "source": "checkin", "date": "2026-11-14"}
    assert pet.mood == pytest.approx(86)
    assert pet.treats == 1
    assert pet.daily_bonus_date == date(2026, 11, 14)
    assert claim_daily_bonus(db, pet, T0) is None
    assert pet.mood == pytest.approx(86)
    assert pet.treats == 1


def test_daily_bonus_from_todo_and_yesterday_does_not_count(db):
    pet = _make_pet(db)
    _completed_todo(db, T0 - timedelta(hours=12))
    assert claim_daily_bonus(db, pet, T0) is None

    _completed_todo(db, T0)
    bonus = claim_daily_bonus(db, pet, T0)
    assert bonus["source"] == "todo"


def test_daily_bonus_prefers_checkin_when_both_sources_match(db):
    pet = _make_pet(db)
    _completed_todo(db, T0)
    _completed_checkin(db, T0)

    bonus = claim_daily_bonus(db, pet, T0)

    assert bonus["source"] == "checkin"


def test_daily_bonus_treat_cap(db):
    pet = _make_pet(db, treats=5)
    _completed_todo(db, T0)
    bonus = claim_daily_bonus(db, pet, T0)
    assert bonus["treats"] == 1
    assert pet.treats == 5


def test_get_pet_claims_bonus_once(auth, db):
    auth.post("/api/v1/pet", json={})
    _completed_todo(db, datetime.utcnow())
    first = auth.get("/api/v1/pet").json()
    assert first["daily_bonus"]["source"] == "todo"
    assert first["pet"]["stats"]["mood"] == 86
    second = auth.get("/api/v1/pet").json()
    assert second["daily_bonus"] is None
    assert second["pet"]["stats"]["mood"] <= 86
