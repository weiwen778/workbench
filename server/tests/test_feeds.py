from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.errors import ApiError
from app.main import app
from app.models import FeedEntry, FeedSnapshot, FeedSubscription, TranslationConnection, User, utcnow
from app.security import hash_password
from app.services import feed_parsers as parsers
from app.services import feed_service as service
from app.services import feed_translation as translation
from app.services import providers
from app.services.feed_parsers import FeedParseError
from app.services.public_http import PublicHttpError, public_target


DAILYHOT = {
    "code": 200,
    "updateTime": "2026-11-13T18:00:00Z",
    "data": [
        {"id": "one", "title": " 第一条 ", "url": "https://example.com/one", "hot": 12345, "desc": "<b>摘要</b>"},
        {"id": "two", "title": "第二条", "url": "javascript:alert(1)", "hot": 99},
        {"id": "three", "title": "", "url": "https://example.com/empty"},
    ],
}

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<title>Example Feed</title><link>https://example.com</link><language>en</language>
<item><title>Hello &amp; world</title><link>https://example.com/a</link><guid>g-1</guid>
<description><![CDATA[<p>Safe <b>summary</b></p><script>alert(1)</script>]]></description>
<pubDate>Fri, 13 Nov 2026 18:00:00 GMT</pubDate><comments>https://example.com/discuss</comments></item>
<item><title>No date</title><link>https://example.com/b</link><guid>g-2</guid></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Feed</title><link href="https://example.org/"/><updated>2026-11-13T19:00:00Z</updated>
<entry><id>tag:example.org,2026:1</id><title>Atom item</title><link rel="alternate" href="/posts/1"/>
<summary type="html">&lt;p&gt;Atom summary&lt;/p&gt;</summary><published>2026-11-13T18:30:00Z</published></entry>
</feed>"""

GOOGLE = b"""<?xml version="1.0"?><rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
<channel><title>Trends</title><lastBuildDate>Fri, 13 Nov 2026 18:00:00 GMT</lastBuildDate>
<item><title>Super Bowl</title><link>https://trends.google.com/trends/explore?q=Super+Bowl&amp;geo=US</link>
<pubDate>Fri, 13 Nov 2026 17:00:00 GMT</pubDate><ht:approx_traffic>200+</ht:approx_traffic>
<ht:news_item><ht:news_item_title>News A</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url><ht:news_item_source>Example</ht:news_item_source></ht:news_item>
<ht:news_item><ht:news_item_title>News B</ht:news_item_title><ht:news_item_url>https://example.com/b</ht:news_item_url><ht:news_item_source>Example</ht:news_item_source></ht:news_item>
</item></channel></rss>"""


def _parsed_entry(title="A title", key="k-1"):
    return {
        "source_id": "", "external_id": key, "entry_key": key,
        "title": title, "url": "https://example.com/item", "summary": "Summary",
        "language": "en", "published_at": datetime(2026, 11, 13, 18, 0),
        "rank": None, "heat": "", "heat_label": "", "link_kind": "article",
        "discussion_url": "", "news": [],
    }


def _response():
    return SimpleNamespace(status=200, headers={}, body=b"<rss/>", final_url="https://example.com/feed")


def test_dailyhot_parser_preserves_order_rank_and_heat():
    entries, updated = parsers.parse_dailyhot(DAILYHOT, "weibo")
    assert updated == datetime(2026, 11, 13, 18, 0)
    assert [entry["title"] for entry in entries] == ["第一条", "第二条"]
    assert [entry["rank"] for entry in entries] == [1, 2]
    assert entries[0]["heat"] == "1.2 万"
    assert entries[0]["summary"] == "摘要"
    assert entries[0]["language"] == "zh"
    assert entries[1]["url"] == ""
    with pytest.raises(FeedParseError):
        parsers.parse_dailyhot({"code": 500, "data": []}, "weibo")
    with pytest.raises(FeedParseError):
        parsers.parse_dailyhot({"code": 200}, "weibo")


def test_rss_and_atom_parsing_sanitizes_html_and_keeps_links():
    rss = parsers.parse_feed(RSS, "https://example.com/feed")
    assert rss["title"] == "Example Feed"
    assert rss["kind"] == "rss"
    assert [entry["title"] for entry in rss["entries"]] == ["Hello & world", "No date"]
    assert "alert" not in rss["entries"][0]["summary"]
    assert rss["entries"][0]["published_at"] == datetime(2026, 11, 13, 18, 0)
    assert rss["entries"][0]["discussion_url"] == "https://example.com/discuss"
    assert rss["entries"][1]["published_at"] is None
    atom = parsers.parse_feed(ATOM, "https://example.org/feed")
    assert atom["kind"] == "atom"
    assert atom["entries"][0]["url"] == "https://example.org/posts/1"
    assert atom["entries"][0]["summary"] == "Atom summary"
    assert atom["entries"][0]["published_at"] == datetime(2026, 11, 13, 18, 30)


def test_google_trends_rss_keeps_traffic_and_news_without_rank():
    entries, updated, provider = parsers.parse_google_trends(GOOGLE)
    assert provider == "Google Trends RSS"
    assert updated == datetime(2026, 11, 13, 18, 0)
    assert entries[0]["rank"] is None
    assert entries[0]["heat"] == "200+"
    assert entries[0]["heat_label"] == "搜索量"
    assert [news["title"] for news in entries[0]["news"]] == ["News A", "News B"]
    assert entries[0]["link_kind"] == "topic"


def test_xml_entities_are_rejected():
    malicious = b'<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><title>&xxe;</title></channel></rss>'
    with pytest.raises(FeedParseError) as error:
        parsers.parse_feed(malicious)
    assert error.value.code == "UNSAFE_XML"
    with pytest.raises(FeedParseError) as error:
        parsers.parse_feed(b"<html><head><title>Not a feed</title></head><body>Hello</body></html>")
    assert error.value.code in {"BAD_XML", "NOT_A_FEED"}


def test_public_target_rejects_private_and_unsupported_targets():
    for url in (
        "http://127.0.0.1/feed",
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.1/feed",
    ):
        with pytest.raises(PublicHttpError) as error:
            public_target(url)
        assert error.value.code == "PRIVATE_ADDRESS"
    for url in ("ftp://example.com/feed", "http://example.com:8080/feed", "http://user:pass@example.com/feed"):
        with pytest.raises(PublicHttpError) as error:
            public_target(url)
        assert error.value.code == "URL_REJECTED"


def test_hot_failure_keeps_last_snapshot_and_marks_stale(db, monkeypatch):
    def ok(source, etag, last_modified):
        return {
            "entries": [{
                "source_id": "weibo", "external_id": "one", "entry_key": "one",
                "title": "旧条目", "url": "https://example.com/one", "summary": "",
                "language": "zh", "published_at": None, "rank": 1, "heat": "",
                "heat_label": "", "link_kind": "article", "discussion_url": "", "news": [],
            }],
            "provider": "测试源", "provider_note": "", "etag": "e1", "last_modified": None,
        }

    monkeypatch.setattr(service, "_fetch_hot_payload", ok)
    assert service.refresh_hot_source("weibo", force=True)["status"] == "updated"
    db.expire_all()
    before = db.get(FeedSnapshot, "weibo")
    entries = before.entries
    success = before.last_success_at

    def fail(source, etag, last_modified):
        raise PublicHttpError("TIMEOUT", "来源请求超时")

    monkeypatch.setattr(service, "_fetch_hot_payload", fail)
    assert service.refresh_hot_source("weibo", force=True)["status"] == "failed"
    db.expire_all()
    after = db.get(FeedSnapshot, "weibo")
    assert after.entries == entries
    assert after.last_success_at == success
    assert after.last_error == "来源请求超时"
    assert service.hot_payload(db)["sections"][0]["sources"][0]["status"] == "stale"


def test_hot_empty_snapshot_is_distinct_from_failure(db, monkeypatch):
    monkeypatch.setattr(service, "_fetch_hot_payload", lambda *args: {
        "entries": [], "provider": "测试源", "provider_note": "", "etag": None, "last_modified": None,
    })
    assert service.refresh_hot_source("zhihu", force=True)["status"] == "updated"
    db.expire_all()
    row = db.get(FeedSnapshot, "zhihu")
    assert row.entries == []
    assert row.last_success_at is not None
    source = next(
        item for section in service.hot_payload(db)["sections"]
        for item in section["sources"] if item["id"] == "zhihu"
    )
    assert source["status"] == "empty"


def test_hot_refresh_requests_are_merged():
    started, joined = service.request_hot_refresh(["weibo"], force=True)
    try:
        assert started == ["weibo"]
        started_again, joined_again = service.request_hot_refresh(["weibo"], force=True)
        assert started_again == []
        assert joined_again == ["weibo"]
    finally:
        service._release(["hot:weibo"])


def test_defaults_are_idempotent_and_deleted_defaults_are_not_restored(auth, db):
    first = auth.get("/api/v1/feeds/subscriptions")
    assert first.status_code == 200
    items = first.json()["items"]
    assert {item["default_key"] for item in items} == {"hacker-news", "openai-news"}
    hn = next(item for item in items if item["default_key"] == "hacker-news")
    openai = next(item for item in items if item["default_key"] == "openai-news")

    assert auth.patch(f"/api/v1/feeds/subscriptions/{hn['id']}", json={"enabled": False}).status_code == 200
    assert auth.delete(f"/api/v1/feeds/subscriptions/{openai['id']}").status_code == 200
    again = auth.get("/api/v1/feeds/subscriptions").json()["items"]
    assert len(again) == 1
    assert again[0]["id"] == hn["id"]
    assert again[0]["enabled"] is False
    assert db.query(FeedSubscription).count() == 2


def test_refresh_subscription_deduplicates_and_preserves_read_favourite(auth, db, monkeypatch):
    items = auth.get("/api/v1/feeds/subscriptions").json()["items"]
    hn = next(item for item in items if item["default_key"] == "hacker-news")
    monkeypatch.setattr(service, "fetch_public", lambda *args, **kwargs: _response())
    parsed = {
        "title": "Hacker News", "kind": "rss", "upstream_updated_at": None,
        "entries": [_parsed_entry("Original title")],
    }
    monkeypatch.setattr(service, "parse_feed", lambda body, url: parsed)
    assert service.refresh_subscription(hn["id"], force=True)["status"] == "updated"
    first = auth.get(f"/api/v1/feeds/entries?subscription_id={hn['id']}").json()
    assert first["total"] == 1
    entry = first["items"][0]
    assert auth.patch(f"/api/v1/feeds/entries/{entry['id']}", json={"read": True, "favorite": True}).status_code == 200

    parsed["entries"][0]["title"] = "Updated title"
    assert service.refresh_subscription(hn["id"], force=True)["status"] == "updated"
    second = auth.get(f"/api/v1/feeds/entries?subscription_id={hn['id']}").json()
    assert second["total"] == 1
    assert second["items"][0]["title"] == "Updated title"
    assert second["items"][0]["read"] is True
    assert second["items"][0]["favorite"] is True


def test_subscription_304_updates_success_without_duplicates(auth, db, monkeypatch):
    items = auth.get("/api/v1/feeds/subscriptions").json()["items"]
    hn = next(item for item in items if item["default_key"] == "hacker-news")
    monkeypatch.setattr(service, "fetch_public", lambda *args, **kwargs: _response())
    monkeypatch.setattr(service, "parse_feed", lambda body, url: {
        "title": "Hacker News", "kind": "rss", "upstream_updated_at": None,
        "entries": [_parsed_entry("Cached item")],
    })
    service.refresh_subscription(hn["id"], force=True)
    first = db.query(FeedEntry).filter(FeedEntry.subscription_id == hn["id"]).one()
    first_success = db.get(FeedSubscription, hn["id"]).last_success_at
    monkeypatch.setattr(service, "fetch_public", lambda *args, **kwargs: SimpleNamespace(
        status=304, headers={"etag": "e2"}, body=b"", final_url="https://example.com/feed",
    ))
    result = service.refresh_subscription(hn["id"], force=True)
    assert result["status"] == "not_modified"
    db.expire_all()
    rows = db.query(FeedEntry).filter(FeedEntry.subscription_id == hn["id"]).all()
    assert len(rows) == 1 and rows[0].id == first.id
    subscription = db.get(FeedSubscription, hn["id"])
    assert subscription.last_success_at > first_success
    assert subscription.etag == "e2"


def test_hot_refresh_respects_interval_unless_forced(db, monkeypatch):
    monkeypatch.setattr(service, "_fetch_hot_payload", lambda *args: {
        "entries": [], "provider": "测试源", "provider_note": "", "etag": None, "last_modified": None,
    })
    assert service.refresh_hot_source("bilibili", force=True)["status"] == "updated"
    assert service.refresh_hot_source("bilibili", force=False)["status"] == "skipped"


def test_delete_subscription_keeps_favourites_but_hides_normal_entries(auth, monkeypatch):
    items = auth.get("/api/v1/feeds/subscriptions").json()["items"]
    hn = next(item for item in items if item["default_key"] == "hacker-news")
    monkeypatch.setattr(service, "fetch_public", lambda *args, **kwargs: _response())
    monkeypatch.setattr(service, "parse_feed", lambda body, url: {
        "title": "Hacker News", "kind": "rss", "upstream_updated_at": None,
        "entries": [_parsed_entry("Saved item")],
    })
    service.refresh_subscription(hn["id"], force=True)
    entry = auth.get(f"/api/v1/feeds/entries?subscription_id={hn['id']}").json()["items"][0]
    auth.patch(f"/api/v1/feeds/entries/{entry['id']}", json={"favorite": True})
    assert auth.delete(f"/api/v1/feeds/subscriptions/{hn['id']}").status_code == 200
    assert auth.get("/api/v1/feeds/entries").json()["total"] == 0
    saved = auth.get("/api/v1/feeds/entries?favorite=true").json()
    assert saved["total"] == 1
    assert saved["items"][0]["subscription_deleted"] is True


def test_translation_cache_and_failures(db, monkeypatch):
    db.add(TranslationConnection(provider="mymemory", enabled=True))
    db.commit()
    calls = []
    monkeypatch.setattr(translation.prov, "translate", lambda provider, text, source, target, config: (calls.append(text) or f"译：{text}", "test"))
    first = translation.translate_texts(db, ["Hello"])
    assert first["items"][0]["cached"] is False
    assert calls == ["Hello"]
    second = translation.translate_texts(db, ["Hello"])
    assert second["items"][0]["cached"] is True
    assert calls == ["Hello"]
    translation.translate_texts(db, ["Hello changed"])
    assert calls == ["Hello", "Hello changed"]

    def fail(*args, **kwargs):
        raise providers.UpstreamError("UPSTREAM_ERROR", "服务暂时不可用")

    monkeypatch.setattr(translation.prov, "translate", fail)
    failed = translation.translate_texts(db, ["New failing title"])
    assert failed["error"]
    assert not failed["items"]
    assert db.query(translation.FeedTranslation).filter_by(source_text="New failing title").count() == 0


def test_translation_requires_configuration(auth):
    response = auth.post("/api/v1/feeds/translations", json={"texts": ["Hello"]})
    assert response.status_code == 409
    assert response.json()["code"] == "TRANSLATION_NOT_CONFIGURED"


def test_entry_state_is_isolated_between_users(auth, db, monkeypatch):
    items = auth.get("/api/v1/feeds/subscriptions").json()["items"]
    hn = next(item for item in items if item["default_key"] == "hacker-news")
    monkeypatch.setattr(service, "fetch_public", lambda *args, **kwargs: _response())
    monkeypatch.setattr(service, "parse_feed", lambda body, url: {
        "title": "Hacker News", "kind": "rss", "upstream_updated_at": None,
        "entries": [_parsed_entry("Private entry")],
    })
    service.refresh_subscription(hn["id"], force=True)
    entry = auth.get(f"/api/v1/feeds/entries?subscription_id={hn['id']}").json()["items"][0]
    db.add(User(username="second", password_hash=hash_password("second12345")))
    db.commit()
    with TestClient(app) as other:
        other.get("/api/v1/health")
        login = other.post("/api/v1/auth/login", json={"username": "second", "password": "second12345"})
        assert login.status_code == 200, login.text
        other.headers.update({"X-CSRF-Token": other.cookies.get("wb_csrf") or ""})
        assert other.get("/api/v1/feeds/entries").json()["total"] == 0
        assert other.patch(f"/api/v1/feeds/entries/{entry['id']}", json={"read": True}).status_code == 404


def test_hot_and_common_endpoints_return_cached_contract(auth, db, monkeypatch):
    monkeypatch.setattr(service, "_fetch_hot_payload", lambda *args: {
        "entries": [{
            "source_id": "weibo", "external_id": "one", "entry_key": "one", "title": "榜单条目",
            "url": "https://example.com/item", "summary": "", "language": "zh",
            "published_at": None, "rank": 1, "heat": "1.0 万", "heat_label": "热度",
            "link_kind": "search", "discussion_url": "", "news": [],
        }],
        "provider": "测试源", "provider_note": "", "etag": None, "last_modified": None,
    })
    service.refresh_hot_source("weibo", force=True)
    payload = auth.get("/api/v1/feeds/hot").json()
    source = next(
        item for section in payload["sections"] for item in section["sources"] if item["id"] == "weibo"
    )
    assert source["status"] == "ok"
    assert source["entries"][0]["title"] == "榜单条目"
    assert source["entries"][0]["link_kind"] == "search"
    assert source["entries"][0]["fetched_at"]
    common = auth.get("/api/v1/feeds/common").json()
    assert len(common["groups"]) == 3
    assert common["groups"][0]["items"][0]["url"].startswith("https://")
