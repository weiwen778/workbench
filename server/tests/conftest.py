from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="wb_test_"))
os.environ["WB_DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["WB_STORAGE_DIR"] = str(_TMP / "storage")
os.environ["WB_ENV"] = "test"
os.environ["WB_ALLOW_INSECURE_UPSTREAM"] = "1"
os.environ["WB_ADMIN_USERNAME"] = "admin"
os.environ["WB_ADMIN_PASSWORD"] = "admin12345"
# 固定的测试主密钥（Fernet key），不是生产凭据
os.environ.setdefault(
    "WB_ENCRYPTION_KEY",
    "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    CheckinGroup,
    CheckinInstance,
    CheckinRule,
    CheckinRuleVersion,
    DataField,
    DataRecord,
    DataTable,
    DataTransferJob,
    FileObject,
    FileRef,
    LoginAttempt,
    Memo,
    Note,
    NoteFolder,
    NoteRevision,
    NoteTag,
    NoteTagLink,
    Todo,
    TodoList,
    TranslationConnection,
    TranslationHistory,
    TrashEntry,
    User,
    UserSession,
    WorkTarget,
)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.add(User(username="admin", password_hash=_hash("admin12345"), theme="light"))
        for provider in ("baidu", "youdao", "deepseek"):
            db.add(TranslationConnection(provider=provider, enabled=False))
        db.commit()
    yield


def _hash(password: str) -> str:
    from app.security import hash_password

    return hash_password(password)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("wb_csrf") or ""


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        c.get("/api/v1/health")  # 触发 CSRF Cookie
        yield c


@pytest.fixture
def auth(client: TestClient) -> TestClient:
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin12345"})
    assert resp.status_code == 200, resp.text
    client.headers.update({"X-CSRF-Token": _csrf(client)})
    return client


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session
