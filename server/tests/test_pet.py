from datetime import datetime

from app.models import Pet
from app.services.pet import pet_payload, stage_for, status_for

T0 = datetime(2026, 11, 14, 0, 0)


def _make_pet(db, **overrides):
    pet = Pet(user_id=1, name="旺财", last_tick_at=T0, **overrides)
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return pet


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
