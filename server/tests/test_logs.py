from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.models import AppLog, utcnow
from app.services import log_store


def _flush():
    log_store.flush_now()


def test_client_log_requires_login(client):
    response = client.post("/api/v1/logs/client", json={"message": "匿名错误"})
    assert response.status_code == 401


def test_client_log_is_stored_scrubbed_and_searchable(auth, db):
    response = auth.post(
        "/api/v1/logs/client",
        json={
            "level": "error",
            "message": "组件崩溃 token=super-secret-value",
            "stack": "Error: boom\n  at App",
            "route": "/todos",
            "context": {"component": "TodosPage"},
        },
    )
    assert response.status_code == 202, response.text
    _flush()

    listed = auth.get("/api/v1/logs", params={"source": "frontend", "q": "组件崩溃"})
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["source"] == "frontend"
    assert item["level"] == "ERROR"
    assert "super-secret-value" not in item["message"]
    assert "***" in item["message"]
    assert item["path"] == "/todos"
    assert item["user_id"] is not None

    detail = auth.get(f"/api/v1/logs/{item['id']}")
    assert detail.status_code == 200
    assert "at App" in detail.json()["stack"]
    assert detail.json()["context"] == {"component": "TodosPage"}


def test_request_logs_capture_status_and_request_id(auth):
    response = auth.get("/api/v1/auth/me")
    request_id = response.headers["X-Request-ID"]
    _flush()
    listed = auth.get("/api/v1/logs", params={"source": "request", "request_id": request_id})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["path"] == "/api/v1/auth/me"
    assert item["method"] == "GET"
    assert item["status"] == 200
    assert item["duration_ms"] is not None
    assert item["request_id"] == request_id
    assert item["user_id"] is not None


def test_log_filters_and_summary(auth, db):
    now = utcnow()
    db.add_all([
        AppLog(created_at=now - timedelta(minutes=5), level="ERROR", source="job", logger="worker", message="后台任务失败"),
        AppLog(created_at=now - timedelta(minutes=4), level="INFO", source="backend", logger="app", message="普通信息"),
    ])
    db.commit()
    _flush()

    errors = auth.get("/api/v1/logs", params={"level": "error"})
    assert errors.status_code == 200
    assert [row["message"] for row in errors.json()["items"]] == ["后台任务失败"]

    bad = auth.get("/api/v1/logs", params={"level": "nope"})
    assert bad.status_code == 422

    summary = auth.get("/api/v1/logs/summary")
    assert summary.status_code == 200
    assert summary.json()["counts"]["error"] >= 1
    assert summary.json()["counts"]["info"] >= 1


def test_log_detail_missing_returns_404(auth):
    assert auth.get("/api/v1/logs/999999").status_code == 404


def test_log_export_csv_and_json(auth, db):
    db.add(AppLog(level="WARNING", source="backend", logger="test", message="导出标记-abc"))
    db.commit()
    _flush()

    csv_response = auth.get("/api/v1/logs/export", params={"format": "csv", "q": "导出标记-abc"})
    assert csv_response.status_code == 200
    assert "text/csv" in csv_response.headers["content-type"]
    assert "导出标记-abc" in csv_response.text

    json_response = auth.get("/api/v1/logs/export", params={"format": "json", "q": "导出标记-abc"})
    assert json_response.status_code == 200
    assert json_response.json()[0]["message"] == "导出标记-abc"


def test_retention_cleanup_and_clear(auth, db):
    old = AppLog(created_at=utcnow() - timedelta(days=40), level="INFO", source="backend", logger="test", message="旧日志")
    fresh = AppLog(level="INFO", source="backend", logger="test", message="新日志")
    db.add_all([old, fresh])
    db.commit()

    removed = log_store.cleanup(db, 30)
    db.commit()
    assert removed == 1
    assert db.scalar(select(AppLog).where(AppLog.message == "新日志")) is not None

    cleared = auth.delete("/api/v1/logs")
    assert cleared.status_code == 200
    assert cleared.json()["removed"] >= 1
