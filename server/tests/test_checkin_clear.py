from datetime import timedelta

import pytest
from sqlalchemy import event, func, select

from app.db import engine
from app.models import (ActivityInterval, CheckinGroup, CheckinInstance, CheckinRule,
                        CheckinRuleVersion, DataTable, LoginAttempt, TodoList, User, WorkTarget, utcnow)

MODELS = (CheckinInstance, CheckinRuleVersion, CheckinRule, ActivityInterval, WorkTarget, CheckinGroup)
PASSWORD = "admin12345"
CONFIRMATION = "删除全部打卡内容"


def counts(db):
    return tuple(db.scalar(select(func.count()).select_from(model)) for model in MODELS)


@pytest.fixture
def seeded(auth, db):
    for kind in ("shop", "social"):
        response = auth.post("/api/v1/checkin-imports", params={"kind": kind}, json={
            "groups": ["Shared"], "targets": [{"name": kind, "rules": [{"title": "Task", "group": "Shared"}]}],
        })
        assert response.status_code == 201, response.text
    target = db.scalar(select(WorkTarget).where(WorkTarget.kind == "social"))
    assert auth.post(f"/api/v1/work-targets/{target.id}/archive").status_code == 200
    instance = db.scalar(select(CheckinInstance).where(CheckinInstance.target_id != target.id))
    assert auth.post(f"/api/v1/checkin-instances/{instance.id}/complete", json={"note": "Retain until confirmed"}).status_code == 200
    db.add_all([TodoList(name="Unrelated todo"), DataTable(name="Unrelated table")])
    db.commit()
    return counts(db)


def clear(auth, password=PASSWORD, **kwargs):
    return auth.post("/api/v1/checkin-data/clear", json={"password": password, "confirmation": CONFIRMATION, **kwargs})


def test_clear_requires_login(client):
    assert client.get("/api/v1/checkin-data/summary").status_code == 401
    assert clear(client).status_code == 401


def test_wrong_password_and_missing_confirmation_preserve_everything(auth, db, seeded):
    preview = auth.get("/api/v1/checkin-data/summary").json()
    assert preview["shops"] == preview["social_accounts"] == 1
    assert preview["rules"] == 2
    assert clear(auth, "wrong").status_code == 403
    assert counts(db) == seeded
    assert clear(auth, confirmation="wrong").status_code == 422
    assert clear(auth, password="").status_code == 422
    assert auth.post("/api/v1/checkin-data/clear", json={"password": PASSWORD}).status_code == 422
    assert counts(db) == seeded


def test_clear_requires_csrf(auth, db, seeded):
    del auth.headers["X-CSRF-Token"]
    response = clear(auth)
    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_FAILED"
    assert counts(db) == seeded


def test_correct_password_clears_entire_checkin_module_only(auth, db, seeded):
    response = clear(auth)
    assert response.status_code == 200, response.text
    assert tuple(response.json()["deleted"].values()) == seeded
    assert counts(db) == (0,) * len(MODELS)
    assert db.scalar(select(func.count()).select_from(TodoList)) == 1
    assert db.scalar(select(func.count()).select_from(DataTable)) == 1
    assert db.scalar(select(func.count()).select_from(User)) == 1
    assert auth.get("/api/v1/auth/me").status_code == 200
    assert auth.get("/api/v1/checkin-instances").json()["groups"] == []
    assert clear(auth).status_code == 200  # Empty module can be cleared again safely.


def test_clear_uses_current_password_not_initial_environment_password(auth, db, seeded):
    response = auth.post("/api/v1/auth/password", json={"old_password": PASSWORD, "new_password": "new-password123"})
    assert response.status_code == 200
    assert clear(auth).status_code == 403
    assert counts(db) == seeded
    assert clear(auth, "new-password123").status_code == 200


def test_clear_throttles_password_attempts_and_recovers_after_expiry(auth, db, seeded):
    for _ in range(5):
        assert clear(auth, "wrong").status_code == 403
    assert clear(auth).status_code == 429
    assert counts(db) == seeded
    for attempt in db.scalars(select(LoginAttempt).where(LoginAttempt.username.like("checkin-clear:%"))):
        attempt.created_at = utcnow() - timedelta(hours=1)
    db.commit()
    assert clear(auth).status_code == 200


def test_clear_is_atomic_on_database_failure(auth, db, seeded):
    def fail_parent_delete(_conn, _cursor, statement, _params, _context, _many):
        if statement.startswith("DELETE FROM work_targets"):
            raise RuntimeError("Simulated database failure")
    event.listen(engine, "before_cursor_execute", fail_parent_delete)
    try:
        with pytest.raises(RuntimeError, match="Simulated database failure"):
            clear(auth)
    finally:
        event.remove(engine, "before_cursor_execute", fail_parent_delete)
    db.expire_all()
    assert counts(db) == seeded
