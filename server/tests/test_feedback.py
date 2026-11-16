from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.models import AppLog, FeedbackIntegration, FeedbackSubmission
from app.services import feedback, log_store


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = str(self._payload)

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def enable(auth, *, repo="weiwen778/workbench", token="ghp_test_secret", labels=None):
    response = auth.put("/api/v1/feedback/config", json={
        "repo": repo, "token": token, "labels": labels or [], "enabled": True,
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_config_is_admin_only_and_token_is_encrypted(auth, db):
    assert enable(auth, labels=["bug"])["configured"] is True

    listed = auth.get("/api/v1/feedback/config")
    body = listed.json()
    assert body["repo"] == "weiwen778/workbench"
    assert body["enabled"] is True
    assert body["masked_token"].startswith("ghp_")
    assert "ghp_test_secret" not in listed.text
    assert body["labels"] == ["bug"]

    row = db.scalar(select(FeedbackIntegration))
    assert row.encrypted_token and "ghp_test_secret" not in row.encrypted_token


def test_config_validates_repo(auth):
    response = auth.put("/api/v1/feedback/config", json={"repo": "../../etc/passwd"})
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_REPO"


def test_config_requires_details_before_enable(auth):
    response = auth.put("/api/v1/feedback/config", json={"enabled": True})
    assert response.status_code == 409 or response.status_code == 422


def test_submission_is_rejected_when_channel_disabled(auth):
    response = auth.post("/api/v1/feedback", json={"kind": "bug", "title": "问题", "body": "描述"})
    assert response.status_code == 409
    assert response.json()["code"] == "FEEDBACK_NOT_CONFIGURED"


def test_submission_creates_issue_with_environment_and_logs(auth, db, monkeypatch):
    enable(auth)
    calls: list[dict] = []

    def fake_request(method, url, token, **kwargs):
        calls.append({"method": method, "url": url, "token": token, "json": kwargs.get("json")})
        return FakeResponse(201, {"number": 42, "html_url": "https://github.com/weiwen778/workbench/issues/42"})

    monkeypatch.setattr(feedback, "_request", fake_request)

    db.add(AppLog(level="ERROR", source="request", logger="api", message="请求炸了", path="/api/v1/todos", method="GET", status=500, request_id="req-1"))
    db.commit()
    log_store.flush_now()

    response = auth.post("/api/v1/feedback", json={
        "kind": "bug",
        "title": "任务列表打不开",
        "body": "点击任务后白屏",
        "include_logs": True,
        "route": "/todos",
        "url": "http://localhost/todos",
        "user_agent": "TestAgent/1.0",
        "viewport": "1280x800",
        "app_version": "2.1.0",
        "request_id": "req-1",
    })
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "sent"
    assert body["issue_url"].endswith("/issues/42")
    assert body["issue_number"] == 42

    assert calls and calls[-1]["url"].endswith("/repos/weiwen778/workbench/issues")
    payload = calls[-1]["json"]
    assert payload["title"] == "[Bug] 任务列表打不开"
    assert "点击任务后白屏" in payload["body"]
    assert "TestAgent/1.0" in payload["body"]
    assert "请求炸了" in payload["body"]

    row = db.get(FeedbackSubmission, body["id"])
    assert row.status == "sent"
    assert row.attempts == 1
    assert row.log_snapshot and "请求炸了" in row.log_snapshot


def test_failed_submission_can_be_retried(auth, monkeypatch):
    enable(auth)
    responses = [FakeResponse(500, {"message": "boom"}), FakeResponse(201, {"number": 7, "html_url": "https://github.com/x/y/issues/7"})]
    calls: list[dict] = []

    def fake_request(method, url, token, **kwargs):
        calls.append(kwargs)
        return responses.pop(0)

    monkeypatch.setattr(feedback, "_request", fake_request)
    created = auth.post("/api/v1/feedback", json={"kind": "feature", "title": "想要暗色图表", "body": "图表也跟随主题"})
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "failed"
    assert body["error"]

    retried = auth.post(f"/api/v1/feedback/{body['id']}/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "sent"
    assert retried.json()["issue_number"] == 7
    assert retried.json()["attempts"] == 2

    again = auth.post(f"/api/v1/feedback/{body['id']}/retry")
    assert again.status_code == 409


def test_missing_labels_fall_back_without_labels(auth, monkeypatch):
    enable(auth, labels=["bug"])
    calls: list[dict] = []
    responses = [FakeResponse(422, {"message": "Validation Failed"}), FakeResponse(201, {"number": 9, "html_url": "https://github.com/x/y/issues/9"})]

    def fake_request(method, url, token, **kwargs):
        payload = kwargs.get("json") or {}
        calls.append({**payload, "labels": list(payload.get("labels") or [])})
        return responses.pop(0)

    monkeypatch.setattr(feedback, "_request", fake_request)
    response = auth.post("/api/v1/feedback", json={"kind": "bug", "title": "标签测试", "body": "内容"})
    assert response.status_code == 201
    assert response.json()["status"] == "sent"
    assert "labels" in calls[0]
    assert not calls[1]["labels"]
    assert "标签" in (response.json()["error"] or "")


def test_connection_test_reports_github_errors(auth, monkeypatch):
    enable(auth)
    monkeypatch.setattr(feedback, "_request", lambda *a, **k: FakeResponse(401, {"message": "Bad credentials"}))
    response = auth.post("/api/v1/feedback/config/test")
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "令牌" in response.json()["message"]


def test_history_lists_submissions(auth, db):
    db.add(FeedbackSubmission(user_id=1, kind="bug", title="历史", body="内容", status="sent", issue_number=1, issue_url="https://github.com/x/y/issues/1", environment={}))
    db.commit()
    response = auth.get("/api/v1/feedback")
    assert response.status_code == 200
    assert response.json()["total"] >= 1
    assert response.json()["items"][0]["title"] == "历史"


@pytest.mark.parametrize("title", ["", "x" * 201])
def test_submission_validates_title(auth, title):
    enable(auth)
    response = auth.post("/api/v1/feedback", json={"kind": "bug", "title": title, "body": ""})
    assert response.status_code == 422
