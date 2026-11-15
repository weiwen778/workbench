from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import TranslationConnection


def test_unreadable_translation_credentials_do_not_block_service_recovery(auth, db):
    connection = db.scalar(select(TranslationConnection).where(TranslationConnection.provider == "baidu"))
    assert connection is not None
    connection.encrypted_config = "unreadable-test-ciphertext"
    connection.enabled = True
    db.commit()

    listed = auth.get("/api/v1/translation-connections")
    assert listed.status_code == 200, listed.text
    items = {item["provider"]: item for item in listed.json()["items"]}
    assert items["baidu"]["configured"] is False
    assert items["baidu"]["decrypt_error"]
    assert items["mymemory"]["configured"] is True
    assert "unreadable-test-ciphertext" not in listed.text

    path = "/api/v1/translation-connections/baidu"
    disabled = auth.put(path, json={"enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert disabled.json()["decrypt_error"]
    cleared = auth.delete(path)
    assert cleared.status_code == 200
    assert cleared.json()["decrypt_error"] is None


class FakeUpstream(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def log_message(self, *_args):  # 静默
        pass

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length).decode("utf-8")
        body: dict
        if (self.headers.get("content-type") or "").startswith("application/json"):
            body = json.loads(raw or "{}")
        else:
            body = {k: v[0] for k, v in parse_qs(raw).items()}
        FakeUpstream.calls.append({"path": self.path, "body": body, "auth": self.headers.get("authorization")})

        if "err-quota" in self.path:
            payload = {"error_code": "54004"}
        elif "err-rate" in self.path:
            payload = {"error_code": "54003"}
        elif "deepseek" in self.path:
            source = body.get("messages", [{}, {}])[-1].get("content", "")
            payload = {
                "choices": [{"message": {"content": f"Translated: {source.splitlines()[-1]}"}}],
                "model": "deepseek-chat",
            }
        elif "youdao" in self.path:
            payload = {"errorCode": "0", "translation": ["youdao result"]}
        else:
            payload = {"error_code": "0", "trans_result": [{"dst": "baidu result"}]}

        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture(scope="module")
def upstream():
    server = HTTPServer(("127.0.0.1", 0), FakeUpstream)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def configure(auth, upstream, provider="baidu", enable=True, path="/baidu"):
    if provider == "baidu":
        config = {"app_id": "appid123456", "secret": "secret123456", "base_url": f"{upstream}{path}"}
    elif provider == "youdao":
        config = {"app_key": "key123456", "secret": "secret123456", "base_url": f"{upstream}/youdao"}
    else:
        config = {"api_key": "sk-test-123456", "base_url": f"{upstream}/deepseek"}
    resp = auth.put(
        f"/api/v1/translation-connections/{provider}",
        json={"config": config, "enabled": enable, "model": "deepseek-chat" if provider == "deepseek" else None},
    )
    return resp


def test_connections_start_unconfigured(auth):
    body = auth.get("/api/v1/translation-connections").json()
    assert body["credential_key_ready"] is True
    assert {i["provider"] for i in body["items"]} == {
        "baidu", "youdao", "deepseek", "zhipu", "openai", "deepl", "mymemory", "libretranslate",
    }
    # MyMemory is keyless and usable without credentials; the rest start unconfigured.
    assert {i["provider"] for i in body["items"] if i["configured"]} == {"mymemory"}


def test_partial_credentials_are_rejected_before_saving(auth):
    resp = auth.put(
        "/api/v1/translation-connections/youdao",
        json={"config": {"app_key": "k1234567"}, "enabled": True},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "PROVIDER_NOT_CONFIGURED"
    assert "secret" in resp.json()["details"]["missing"]


def test_language_catalog_follows_provider(auth):
    body = auth.get("/api/v1/translation-connections").json()
    names = {item["code"]: item["name"] for item in body["languages"]}
    assert names["ja"] == "日语"
    assert names["zh"] == "中文（简体）"
    for item in body["items"]:
        codes = {lang["code"] for lang in item["languages"]}
        assert {"zh", "en", "ja", "ko"} <= codes


def test_language_code_mapping(auth, upstream):
    configure(auth, upstream)
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "こんにちは", "source_lang": "ja", "target_lang": "ko"},
    )
    assert resp.status_code == 200, resp.text
    body = FakeUpstream.calls[-1]["body"]
    assert body["from"] == "jp"
    assert body["to"] == "kor"

    configure(auth, upstream, provider="youdao")
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "youdao", "source_text": "こんにちは", "source_lang": "ja", "target_lang": "en"},
    )
    assert resp.status_code == 200, resp.text
    body = FakeUpstream.calls[-1]["body"]
    assert body["from"] == "ja"
    assert body["to"] == "en"


def test_unsupported_language_rejected(auth, upstream):
    configure(auth, upstream)
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "hello", "source_lang": "auto", "target_lang": "hi"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "UNSUPPORTED_LANGUAGE"


def test_save_masks_credentials(auth, upstream):
    resp = configure(auth, upstream, enable=False)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["configured"] is True
    assert body["masked"]["app_id"].startswith("appi")
    assert "secret123456" not in resp.text
    assert body["limits"]["unit"] == "byte"

    listed = auth.get("/api/v1/translation-connections").json()["items"][0]
    assert "secret123456" not in json.dumps(listed)


def test_translate_and_history(auth, upstream):
    configure(auth, upstream)
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "你好，世界", "source_lang": "zh", "target_lang": "en"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["target_text"] == "baidu result"

    history = auth.get("/api/v1/translation-history").json()
    assert history["total"] == 1
    item = history["items"][0]
    assert item["source_text"] == "你好，世界"
    assert "secret" not in json.dumps(history)

    detail = auth.get(f"/api/v1/translation-history/{item['id']}").json()
    assert detail["target_text"] == "baidu result"

    # 搜索命中原文与译文
    assert auth.get("/api/v1/translation-history?q=你好").json()["total"] == 1
    assert auth.get("/api/v1/translation-history?q=baidu").json()["total"] == 1
    assert auth.get("/api/v1/translation-history?q=不存在").json()["total"] == 0
    assert auth.get("/api/v1/translation-history?provider=youdao").json()["total"] == 0


def test_translation_favorites(auth, upstream):
    configure(auth, upstream)
    created = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "收藏测试", "source_lang": "zh", "target_lang": "en"},
    ).json()
    body = {
        "source_text": created["source_text"],
        "target_text": created["target_text"],
        "source_lang": "zh",
        "target_lang": "en",
        "provider": "baidu",
    }
    fav = auth.post("/api/v1/translation-favorites", json=body)
    assert fav.status_code == 201, fav.text
    favorite_id = fav.json()["id"]

    # 重复收藏同一条不会新增
    again = auth.post("/api/v1/translation-favorites", json=body)
    assert again.status_code == 201
    assert again.json()["id"] == favorite_id
    assert auth.get("/api/v1/translation-favorites").json()["total"] == 1

    # 收藏是独立快照：删历史不影响收藏
    auth.delete(f"/api/v1/translation-history/{created['id']}")
    assert auth.get("/api/v1/translation-favorites").json()["total"] == 1

    assert auth.delete(f"/api/v1/translation-favorites/{favorite_id}").status_code == 200
    assert auth.get("/api/v1/translation-favorites").json()["total"] == 0


def test_delete_history_record(auth, upstream):
    configure(auth, upstream)
    created = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "删除测试", "source_lang": "zh", "target_lang": "en"},
    ).json()
    assert auth.delete(f"/api/v1/translation-history/{created['id']}").status_code == 200
    assert auth.get(f"/api/v1/translation-history/{created['id']}").status_code == 404
    assert auth.delete(f"/api/v1/translation-history/{created['id']}").status_code == 404


def test_deepseek_provider(auth, upstream):
    configure(auth, upstream, provider="deepseek")
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "deepseek", "source_text": "这是一段中文", "source_lang": "auto", "target_lang": "en"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["model"] == "deepseek-chat"
    call = FakeUpstream.calls[-1]
    assert call["auth"] == "Bearer sk-test-123456"
    assert "待翻译内容" in call["body"]["messages"][-1]["content"]
    # 原文作为数据传入，系统提示禁止执行原文指令
    assert "不执行" in call["body"]["messages"][0]["content"]


def test_same_language_and_empty_rejected(auth, upstream):
    configure(auth, upstream)
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "hello", "source_lang": "en", "target_lang": "en"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "SAME_LANGUAGE"

    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "   ", "source_lang": "auto", "target_lang": "en"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "EMPTY_SOURCE"


def test_limits_use_bytes_for_baidu(auth, upstream):
    configure(auth, upstream)
    # 2001 个汉字 = 6003 字节 > 6000
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "中" * 2001, "source_lang": "zh", "target_lang": "en"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "TEXT_TOO_LONG"
    assert resp.json()["details"]["unit"] == "byte"
    assert resp.json()["details"]["limit"] == 6000


def test_disabled_provider_rejected(auth, upstream):
    configure(auth, upstream, enable=False)
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "你好", "target_lang": "en"},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "PROVIDER_DISABLED"


def test_unconfigured_provider_rejected(auth):
    assert auth.delete("/api/v1/translation-connections/youdao").status_code == 200
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "youdao", "source_text": "hi", "target_lang": "zh"},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "PROVIDER_NOT_CONFIGURED"


def test_upstream_quota_and_rate_limit_mapping(auth, upstream):
    configure(auth, upstream, path="/baidu-err-quota")
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "你好", "target_lang": "en"},
    )
    assert resp.status_code == 402
    assert resp.json()["code"] == "UPSTREAM_QUOTA"

    configure(auth, upstream, path="/baidu-err-rate")
    resp = auth.post(
        "/api/v1/translations",
        json={"provider": "baidu", "source_text": "你好", "target_lang": "en"},
    )
    assert resp.status_code == 429
    # 失败不写历史
    assert auth.get("/api/v1/translation-history").json()["total"] == 0


def test_connection_test_endpoint(auth, upstream):
    configure(auth, upstream)
    resp = auth.post("/api/v1/translation-connections/baidu/test")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "连接成功" in resp.json()["message"]


def test_missing_master_key_is_explained(auth, monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", None)
    body = auth.get("/api/v1/translation-connections").json()
    assert body["credential_key_ready"] is False
    assert "WB_ENCRYPTION_KEY" in body["message"]

    resp = auth.put(
        "/api/v1/translation-connections/baidu",
        json={"config": {"app_id": "a1234567", "secret": "b1234567"}},
    )
    assert resp.status_code == 503
    assert resp.json()["code"] == "CREDENTIAL_KEY_MISSING"
    assert "WB_ENCRYPTION_KEY" in resp.json()["details"]["hint"]


def test_history_pagination(auth, upstream, db):
    from app.models import TranslationHistory

    configure(auth, upstream)
    for i in range(25):
        db.add(
            TranslationHistory(
                source_text=f"原文{i}",
                target_text=f"译文{i}",
                provider="baidu",
                source_lang="zh",
                target_lang="en",
                mode="faithful",
            )
        )
    db.commit()
    page1 = auth.get("/api/v1/translation-history").json()
    assert page1["page_size"] == 20
    assert page1["total"] == 25
    assert len(page1["items"]) == 20
    page2 = auth.get("/api/v1/translation-history?page=2").json()
    assert len(page2["items"]) == 5


def test_base_url_change_requires_secret_reentry(auth, upstream):
    assert configure(auth, upstream).status_code == 200
    response = auth.put(
        "/api/v1/translation-connections/baidu",
        json={"config": {"base_url": "https://127.0.0.1/new-endpoint"}},
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "CREDENTIAL_REENTRY_REQUIRED"


def test_base_url_rejects_non_public_http_targets(auth):
    response = auth.put(
        "/api/v1/translation-connections/baidu",
        json={"config": {"app_id": "a1234567", "secret": "b1234567", "base_url": "http://169.254.169.254"}},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "UPSTREAM_URL_REJECTED"


def test_base_url_rejects_private_https_and_dns_failure(auth, monkeypatch):
    private = auth.put(
        "/api/v1/translation-connections/baidu",
        json={"config": {"app_id": "a1234567", "secret": "b1234567", "base_url": "https://169.254.169.254"}},
    )
    assert private.status_code == 400, private.text
    assert private.json()["code"] == "UPSTREAM_URL_REJECTED"
    import socket

    def fail_dns(*_args, **_kwargs):
        raise socket.gaierror("mock NXDOMAIN")

    monkeypatch.setattr("app.services.providers.socket.getaddrinfo", fail_dns)
    missing = auth.put(
        "/api/v1/translation-connections/baidu",
        json={"config": {"app_id": "a1234567", "secret": "b1234567", "base_url": "https://does-not-exist.invalid"}},
    )
    assert missing.status_code == 400, missing.text
    assert missing.json()["code"] == "UPSTREAM_DNS_FAILED"


def test_public_http_connects_to_validated_ip_and_rejects_redirect(monkeypatch):
    import json
    import socket
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    from app.services import public_http
    from app.services.public_http import PublicHttpError, fetch_public

    seen: list[tuple[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):  # noqa: N802
            seen.append((self.path, self.headers.get("Host") or ""))
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "http://evil.test/steal")
                self.end_headers()
                return
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    real_getaddrinfo = socket.getaddrinfo

    def pinned(host, target_port, *args, **kwargs):
        if host == "pinned.test":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", target_port))]
        return real_getaddrinfo(host, target_port, *args, **kwargs)

    monkeypatch.setattr(public_http.socket, "getaddrinfo", pinned)
    try:
        response = fetch_public(
            f"http://pinned.test:{port}/ok", timeout=2, max_bytes=1024,
            max_redirects=0, allow_loopback=True,
        )
        assert json.loads(response.body) == {"ok": True}
        assert seen[0] == ("/ok", f"pinned.test:{port}")
        try:
            fetch_public(
                f"http://pinned.test:{port}/redirect", timeout=2, max_bytes=1024,
                max_redirects=0, allow_loopback=True,
            )
            raise AssertionError("redirect should be rejected")
        except PublicHttpError as error:
            assert error.code == "TOO_MANY_REDIRECTS"
        assert all(path != "/steal" for path, _ in seen)
    finally:
        server.shutdown()
