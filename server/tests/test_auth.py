from __future__ import annotations


def test_health(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_login_sets_cookies_and_me(client):
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin12345"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["username"] == "admin"
    assert client.cookies.get("wb_session")

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["theme"] == "light"


def test_business_api_requires_login(client):
    resp = client.get("/api/v1/todos?list_id=1")
    assert resp.status_code == 401
    assert resp.json()["code"] == "UNAUTHENTICATED"


def test_wrong_password_gives_same_message(client):
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong-pass"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "INVALID_CREDENTIALS"

    resp2 = client.post("/api/v1/auth/login", json={"username": "nobody", "password": "whatever"})
    assert resp2.status_code == 401
    assert resp2.json()["message"] == resp.json()["message"]


def test_csrf_required_for_write(client):
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin12345"})
    resp = client.post("/api/v1/todo-lists", json={"name": "工作"})
    assert resp.status_code == 403
    assert resp.json()["code"] == "CSRF_FAILED"


def test_theme_preference_persisted(auth):
    resp = auth.put("/api/v1/preferences", json={"theme": "dark"})
    assert resp.status_code == 200
    assert resp.json()["theme"] == "dark"
    assert auth.get("/api/v1/preferences").json()["theme"] == "dark"


def test_theme_color_preference_persisted(auth):
    resp = auth.put("/api/v1/preferences", json={"theme_color": "#2563EB"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["theme_color"] == "#2563eb"
    assert auth.get("/api/v1/preferences").json()["theme_color"] == "#2563eb"
    assert auth.get("/api/v1/auth/me").json()["user"]["theme_color"] == "#2563eb"

    bad = auth.put("/api/v1/preferences", json={"theme_color": "red"})
    assert bad.status_code == 422
    assert bad.json()["code"] == "INVALID_THEME_COLOR"


def test_change_password_revokes_other_sessions():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as first, TestClient(app) as second:
        for c in (first, second):
            c.get("/api/v1/health")
            assert c.post(
                "/api/v1/auth/login", json={"username": "admin", "password": "admin12345"}
            ).status_code == 200
            c.headers.update({"X-CSRF-Token": c.cookies.get("wb_csrf") or ""})

        resp = first.post(
            "/api/v1/auth/password",
            json={"old_password": "admin12345", "new_password": "newpass12345"},
        )
        assert resp.status_code == 200, resp.text

        # 当前会话保留，另一会话被吊销
        assert first.get("/api/v1/auth/me").status_code == 200
        assert second.get("/api/v1/auth/me").status_code == 401


def test_logout_revokes_session(auth):
    assert auth.post("/api/v1/auth/logout").status_code == 200
    assert auth.get("/api/v1/auth/me").status_code == 401
