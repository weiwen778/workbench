from __future__ import annotations

import io
import struct
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.errors import ApiError
from app.main import _validate_production_password, app
from app.services.archive_safety import ensure_zip_within_limits
from app.services.public_http import is_public_ip


def agent_client(auth, **overrides):
    payload = {
        "name": "安全回归 Agent",
        "scopes": ["all:stage"],
        **overrides,
    }
    response = auth.post("/api/v1/agent-tokens", json=payload)
    assert response.status_code == 201, response.text
    token = response.json()
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer " + token["token"]
    return client, token


def test_agent_cannot_stage_translation_credentials(auth):
    client, _ = agent_client(auth, policy={
        "modules": [], "tables": [], "operations": ["create", "update", "delete"],
        "allow_schema": True, "allow_files": True, "allow_external": True,
        "allow_irreversible": True,
    })
    response = client.put(
        "/api/v1/agent/translation-connections/deepseek",
        json={"config": {"api_key": "attacker-key"}},
    )
    assert response.status_code in (403, 404), response.text


def test_review_token_without_explicit_policy_gets_a_policy(auth):
    _, token = agent_client(auth, write_mode="review")
    assert token["policy"] is not None
    listed = auth.get("/api/v1/agent-tokens").json()["items"]
    row = next(item for item in listed if item["id"] == token["id"])
    assert row["policy"] is not None
    assert row["policy"]["allow_external"] is False


def test_review_token_operation_scope_is_enforced(auth):
    client, _ = agent_client(
        auth,
        write_mode="review",
        policy={"operations": ["create"], "modules": ["notes"]},
    )
    note = auth.post("/api/v1/notes", json={"title": "不能删", "content": "正文"}).json()
    response = client.delete(f"/api/v1/agent/notes/{note['id']}")
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "AGENT_POLICY_OPERATION"


def test_table_whitelist_cannot_be_bypassed_with_template_query(auth):
    allowed = auth.post("/api/v1/tables", json={
        "name": "允许表", "fields": [{"name": "名称", "type": "short_text"}],
    }).json()
    denied = auth.post("/api/v1/tables", json={
        "name": "禁止表", "fields": [{"name": "名称", "type": "short_text"}],
    }).json()
    record = auth.post(f"/api/v1/tables/{denied['id']}/records", json={
        "data": {denied["fields"][0]["key"]: "不能碰"},
    }).json()
    client, _ = agent_client(auth, policy={
        "tables": [allowed["id"]],
        "operations": ["create", "update", "delete"],
    })
    response = client.post("/api/v1/agent/changes", json={"operations": [{
        "method": "DELETE",
        "path": f"/records/{record['id']}?x={{{{op0.id}}}}",
    }]})
    assert response.status_code == 403, response.text
    assert response.json()["code"] == "AGENT_POLICY_TABLE"


def test_revoking_token_rejects_pending_changes(auth):
    client, token = agent_client(auth)
    staged = client.post("/api/v1/agent/notes", json={"title": "待合并", "content": "正文"})
    assert staged.status_code == 202, staged.text
    change_id = staged.json()["id"]
    assert auth.delete(f"/api/v1/agent-tokens/{token['id']}").status_code == 200
    merged = auth.post(f"/api/v1/agent-changes/{change_id}/merge", json={"version": 1})
    assert merged.status_code == 409, merged.text
    assert auth.get(f"/api/v1/agent-changes/{change_id}").json()["status"] == "rejected"
    assert auth.get("/api/v1/agent-changes").json()["items"] == []


def test_password_change_revokes_agent_tokens(auth):
    client, _ = agent_client(auth)
    changed = auth.post("/api/v1/auth/password", json={
        "old_password": "admin12345",
        "new_password": "new-strong-password-123",
    })
    assert changed.status_code == 200, changed.text
    assert client.get("/api/v1/agent/todo-lists").status_code == 401


def test_public_ip_rejects_transition_addresses():
    assert is_public_ip("8.8.8.8")
    assert not is_public_ip("127.0.0.1")
    assert not is_public_ip("64:ff9b::7f00:1")
    assert not is_public_ip("64:ff9b::a9fe:a9fe")
    assert not is_public_ip("::ffff:127.0.0.1")
    assert not is_public_ip("2002:7f00:1::")


def test_zip_inspection_uses_actual_decompressed_size():
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("xl/sharedStrings.xml", b"0" * (2 * 1024 * 1024))
    data = bytearray(raw.getvalue())
    central = data.find(b"PK\x01\x02")
    assert central >= 0
    struct.pack_into("<I", data, central + 24, 100)  # lie about the uncompressed size
    with pytest.raises(ApiError) as error:
        ensure_zip_within_limits(bytes(data), max_total=10 * 1024 * 1024, max_entry=10 * 1024 * 1024)
    assert error.value.code in {"INVALID_WORKBOOK", "WORKBOOK_TOO_LARGE"}


def test_production_password_rejects_repository_placeholders():
    for password in ("", "admin12345", "请改成至少 12 位的强密码", "changeme", "short"):
        with pytest.raises(RuntimeError):
            _validate_production_password(password)
    _validate_production_password("this-is-a-long-random-password")
