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


def test_logout_revokes_copied_cookie(auth):
    from app.config import settings

    token = auth.cookies.get(settings.cookie_name)
    assert token
    assert auth.post("/api/v1/auth/logout").status_code == 200
    auth.cookies.set(settings.cookie_name, token, path="/")
    assert auth.get("/api/v1/auth/me").status_code == 401


def test_login_lockout_applies_across_proxy_addresses(auth):
    from app.db import SessionLocal
    from app.models import LoginAttempt

    with SessionLocal() as session:
        for index in range(20):
            session.add(LoginAttempt(username='admin', ip=f'198.51.{index // 250}.{index % 250}', success=False))
        session.commit()
    response = auth.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'admin12345'})
    assert response.status_code == 429, response.text


def test_five_failures_from_one_address_still_lock(auth):
    from app.db import SessionLocal
    from app.models import LoginAttempt

    with SessionLocal() as session:
        for _ in range(5):
            session.add(LoginAttempt(username='admin', ip='testclient', success=False))
        session.commit()
    response = auth.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'admin12345'})
    assert response.status_code == 429, response.text


def test_cleanup_removes_expired_login_attempts(auth, db):
    from datetime import timedelta
    from sqlalchemy import func, select
    from app.maintenance import run_cleanup
    from app.models import LoginAttempt, utcnow

    db.add(LoginAttempt(username='old-user', ip='198.51.100.1', success=False, created_at=utcnow() - timedelta(days=30)))
    db.commit()
    result = run_cleanup()
    assert result['login_attempts'] >= 1
    assert db.scalar(select(func.count(LoginAttempt.id)).where(LoginAttempt.username == 'old-user')) == 0


def test_checkin_navigation_labels_persist_without_affecting_other_preferences(auth):
    initial = auth.get('/api/v1/preferences').json()
    assert initial['checkin_shop_label'] == '店铺打卡'
    assert initial['checkin_social_label'] == '社媒打卡'
    response = auth.put('/api/v1/preferences', json={'checkin_shop_label': '  运营巡检  '})
    assert response.status_code == 200
    assert response.json()['checkin_shop_label'] == '运营巡检'
    assert response.json()['checkin_social_label'] == '社媒打卡'
    assert response.json()['theme'] == initial['theme']
    assert response.json()['theme_color'] == initial['theme_color']
    assert auth.put('/api/v1/preferences', json={'checkin_social_label': '内容执行'}).status_code == 200
    assert auth.get('/api/v1/auth/me').json()['user']['checkin_shop_label'] == '运营巡检'
    assert auth.get('/api/v1/auth/me').json()['user']['checkin_social_label'] == '内容执行'
    for value in ['', '   ', '字' * 41, 123, ['错误']]:
        bad = auth.put('/api/v1/preferences', json={'checkin_shop_label': value})
        assert bad.status_code == 422
    assert auth.get('/api/v1/preferences').json()['checkin_shop_label'] == '运营巡检'


def test_checkin_navigation_labels_are_account_specific(auth):
    from app.db import SessionLocal
    from app.models import User
    from app.security import hash_password

    assert auth.put('/api/v1/preferences', json={'checkin_shop_label': '管理员巡检'}).status_code == 200
    with SessionLocal() as db:
        db.add(User(username='operator', password_hash=hash_password('operator12345')))
        db.commit()
    auth.post('/api/v1/auth/logout')
    login = auth.post('/api/v1/auth/login', json={'username': 'operator', 'password': 'operator12345'})
    assert login.status_code == 200
    assert login.json()['user']['checkin_shop_label'] == '店铺打卡'
    assert auth.get('/api/v1/preferences').json()['checkin_social_label'] == '社媒打卡'
