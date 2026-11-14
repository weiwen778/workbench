"""Information hub refresh, cache, subscription and status logic."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..errors import ApiError
from ..models import FeedEntry, FeedSnapshot, FeedSubscription, utcnow
from ..utils import iso_z
from .common_sources import COMMON_SOURCES, fetch_runsignup_all, merge_runsignup_entries
from .feed_catalog import COMMON_BY_KEY, DIRECT_PROVIDERS, HOT_SECTIONS, HOT_SOURCE_IDS, HOT_SOURCES, DEFAULT_SUBSCRIPTIONS
from .feed_parsers import (
    FeedParseError, normalize_link, parse_dailyhot, parse_direct_bilibili,
    parse_direct_weibo, parse_direct_zhihu, parse_feed, parse_google_trends, safe_http_url,
    stable_hash,
)
from .public_http import PublicHttpError, fetch_public, public_target

logger = logging.getLogger("workbench.feeds")

HOT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
}
BROWSER_UA = HOT_HEADERS["User-Agent"]
DIRECT = {
    "weibo": {
        "url": "https://weibo.com/ajax/side/hotSearch",
        "headers": {"Referer": "https://weibo.com/", "Accept": "application/json, text/plain, */*", "User-Agent": BROWSER_UA},
        "parser": parse_direct_weibo,
    },
    "zhihu": {
        "url": "https://api.zhihu.com/topstory/hot-lists/total?limit=50",
        "headers": {"Accept": "application/json, text/plain, */*", "User-Agent": BROWSER_UA},
        "parser": parse_direct_zhihu,
    },
    "bilibili": {
        "url": "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1",
        "headers": {"Referer": "https://www.bilibili.com/", "Accept": "application/json, text/plain, */*", "User-Agent": BROWSER_UA},
        "parser": parse_direct_bilibili,
    },
}

_RUNNING: set[str] = set()
_RUNNING_LOCK = threading.Lock()


def _reserve(keys: list[str]) -> tuple[list[str], list[str]]:
    started: list[str] = []
    joined: list[str] = []
    with _RUNNING_LOCK:
        for key in keys:
            if key in _RUNNING:
                joined.append(key)
            else:
                _RUNNING.add(key)
                started.append(key)
    return started, joined


def _release(keys: list[str]) -> None:
    with _RUNNING_LOCK:
        for key in keys:
            _RUNNING.discard(key)


def _backoff(failures: int, retry_after: int | None = None) -> int:
    if retry_after:
        return min(settings.feed_retry_max_seconds, max(30, retry_after))
    return min(settings.feed_retry_max_seconds, 120 * (2 ** min(max(0, failures - 1), 5)))


def normalize_subscription_url(raw: str) -> tuple[str, str]:
    normalized = normalize_subscription_syntax(raw)
    # DNS validation happens at save/preview time and again before every fetch.
    try:
        public_target(normalized)
    except PublicHttpError as error:
        raise ApiError(error.code, error.message, 422)
    return normalized, hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_subscription_syntax(raw: str) -> str:
    value = (raw or "").strip()
    if value and not value.lower().startswith(("http://", "https://")):
        value = "https://" + value
    if not value or len(value) > 2048:
        raise ApiError("INVALID_FEED_URL", "请输入有效的 RSS 或 Atom 地址", 422)
    parts = urlsplit(value)
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        raise ApiError("INVALID_FEED_URL", "只允许 HTTP 或 HTTPS 地址", 422)
    if parts.username is not None or parts.password is not None:
        raise ApiError("INVALID_FEED_URL", "订阅地址不能包含账号密码", 422)
    host = parts.hostname.lower()
    try:
        port = parts.port or (443 if parts.scheme.lower() == "https" else 80)
    except ValueError:
        raise ApiError("INVALID_FEED_URL", "订阅地址端口不合法", 422)
    netloc = host
    if port not in ({443} if parts.scheme.lower() == "https" else {80}):
        netloc = f"{host}:{port}"
    return f"{parts.scheme.lower()}://{netloc}{parts.path or '/'}" + (f"?{parts.query}" if parts.query else "")


def _fetch_headers(source_id: str) -> dict[str, str]:
    if source_id == "google-trends-us":
        return {"Accept": "application/rss+xml, application/xml, text/xml, */*"}
    return HOT_HEADERS


def _hot_url(source: dict) -> str:
    if source["id"] == "google-trends-us":
        return settings.feed_google_trends_url
    base = (settings.feed_dailyhot_base_url or "").rstrip("/")
    return f"{base}/{source['route']}" if base else ""


def _json_body(response) -> dict:
    charset = "utf-8"
    content_type = response.headers.get("content-type", "")
    if "charset=" in content_type:
        charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip() or "utf-8"
    try:
        return json.loads(response.body.decode(charset, errors="replace"))
    except (ValueError, LookupError):
        raise FeedParseError("BAD_JSON", "来源返回的 JSON 无法解析")


def _serialize_entry(entry: dict) -> dict:
    item = dict(entry)
    published = item.get("published_at")
    if isinstance(published, datetime):
        item["published_at"] = iso_z(published)
    item["news"] = [
        {**news, "title": news.get("title", ""), "url": news.get("url", ""), "source": news.get("source", "")}
        for news in (item.get("news") or [])[:3]
    ]
    return item


def _parse_hot_body(source: dict, response) -> tuple[list[dict], datetime | None, str]:
    if source["id"] == "google-trends-us":
        entries, updated, provider = parse_google_trends(response.body)
        return entries, updated, provider
    payload = _json_body(response)
    entries, updated = parse_dailyhot(payload, source["id"])
    return entries, updated, "DailyHotApi"


def _fetch_hot_payload(source: dict, etag: str | None, last_modified: str | None) -> dict:
    source_id = source["id"]
    primary_error: Exception | None = None
    primary_url = _hot_url(source)
    if primary_url:
        try:
            response = fetch_public(
                primary_url, timeout=settings.feed_timeout_seconds,
                max_bytes=settings.feed_max_bytes, max_redirects=settings.feed_max_redirects,
                headers=_fetch_headers(source_id), etag=etag, last_modified=last_modified,
            )
            if response.status == 304:
                return {"not_modified": True, "etag": etag, "last_modified": last_modified}
            entries, updated, provider = _parse_hot_body(source, response)
            if entries or source_id not in DIRECT:
                return {
                    "entries": entries, "upstream_updated_at": updated, "provider": provider,
                    "provider_note": "", "etag": response.headers.get("etag"),
                    "last_modified": response.headers.get("last-modified"),
                }
            primary_error = FeedParseError("EMPTY_PRIMARY", "DailyHotApi 没有返回可用条目")
        except (PublicHttpError, FeedParseError) as error:
            primary_error = error

    direct = DIRECT.get(source_id)
    if not direct:
        if primary_error:
            raise primary_error
        raise PublicHttpError("NO_SOURCE", "没有配置可用的来源地址")
    try:
        response = fetch_public(
            direct["url"], timeout=settings.feed_timeout_seconds,
            max_bytes=settings.feed_max_bytes, max_redirects=settings.feed_max_redirects,
            headers=direct["headers"],
        )
        if response.status == 304:
            return {"not_modified": True, "etag": etag, "last_modified": last_modified}
        entries, updated = direct["parser"](_json_body(response))
        note = ""
        if primary_error:
            note = "DailyHotApi 兼容实例不可用，已读取平台公开接口"
        return {
            "entries": entries, "upstream_updated_at": updated,
            "provider": DIRECT_PROVIDERS[source_id], "provider_note": note,
            "etag": response.headers.get("etag"), "last_modified": response.headers.get("last-modified"),
        }
    except (PublicHttpError, FeedParseError, ValueError) as fallback_error:
        if primary_error:
            raise FeedParseError(
                "ALL_SOURCES_FAILED",
                f"DailyHotApi：{getattr(primary_error, 'message', str(primary_error))}；直连接口：{getattr(fallback_error, 'message', str(fallback_error))}",
            )
        raise fallback_error


def _claim_snapshot(
    db: Session, source_id: str, force: bool, lock_seconds: int | None = None,
) -> tuple[dict | None, str]:
    now = utcnow()
    row = db.get(FeedSnapshot, source_id)
    if row is None:
        db.add(FeedSnapshot(
            source_id=source_id, entries=[], provider="", provider_note="",
            consecutive_failures=0,
        ))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    row = db.scalar(
        select(FeedSnapshot).where(FeedSnapshot.source_id == source_id).with_for_update(skip_locked=True)
    )
    if row is None:
        return None, "joined"
    if row.locked_until and row.locked_until > now:
        return None, "joined"
    if not force and row.next_attempt_at and row.next_attempt_at > now:
        return None, "skipped"
    lock_seconds = lock_seconds if lock_seconds is not None else settings.feed_timeout_seconds + 15
    row.locked_until = now + timedelta(seconds=lock_seconds)
    row.last_attempt_at = now
    db.commit()
    return {
        "etag": row.etag, "last_modified": row.last_modified,
        "failures": row.consecutive_failures, "entries": row.entries or [],
    }, "started"


def _record_hot_failure(source_id: str, code: str, message: str, retry_after: int | None = None) -> None:
    with SessionLocal() as db:
        row = db.get(FeedSnapshot, source_id)
        if not row:
            return
        now = utcnow()
        row.consecutive_failures = (row.consecutive_failures or 0) + 1
        row.last_attempt_at = now
        row.last_error = (message or "刷新失败")[:1000]
        row.error_code = code[:64]
        row.next_attempt_at = now + timedelta(seconds=_backoff(row.consecutive_failures, retry_after))
        row.locked_until = None
        db.commit()


def _record_hot_success(source_id: str, payload: dict) -> None:
    with SessionLocal() as db:
        row = db.get(FeedSnapshot, source_id)
        if not row:
            return
        now = utcnow()
        if not payload.get("not_modified"):
            row.entries = [_serialize_entry(entry) for entry in payload.get("entries", [])]
            row.provider = (payload.get("provider") or row.provider or "")[:120]
            row.provider_note = (payload.get("provider_note") or "")[:300]
            row.upstream_updated_at = payload.get("upstream_updated_at")
            if payload.get("etag") is not None:
                row.etag = str(payload["etag"])[:500]
            if payload.get("last_modified") is not None:
                row.last_modified = str(payload["last_modified"])[:500]
        row.fetched_at = now
        row.last_success_at = now
        row.last_error = None
        row.error_code = None
        row.consecutive_failures = 0
        row.next_attempt_at = now + timedelta(seconds=settings.feed_hot_interval_seconds)
        row.locked_until = None
        db.commit()


def _record_common_success(
    source_id: str,
    entries: list[dict],
    provider: str,
    note: str,
    interval: int,
    upstream_updated_at: datetime | None = None,
) -> None:
    with SessionLocal() as db:
        row = db.get(FeedSnapshot, source_id)
        if not row:
            return
        now = utcnow()
        row.entries = [_serialize_entry(entry) for entry in entries]
        row.provider = (provider or row.provider or "")[:120]
        row.provider_note = (note or "")[:300]
        row.upstream_updated_at = upstream_updated_at
        row.fetched_at = now
        row.last_success_at = now
        row.last_error = None
        row.error_code = None
        row.consecutive_failures = 0
        row.next_attempt_at = now + timedelta(seconds=interval)
        row.locked_until = None
        db.commit()


def refresh_hot_source(source_id: str, force: bool = False) -> dict:
    source = HOT_SOURCES.get(source_id)
    if not source:
        raise ApiError("UNKNOWN_FEED_SOURCE", "未知信息源", 404)
    with SessionLocal() as db:
        claim, state = _claim_snapshot(db, source_id, force)
    if not claim:
        return {"source_id": source_id, "status": state}
    started = time.monotonic()
    try:
        result = _fetch_hot_payload(source, claim["etag"], claim["last_modified"])
        _record_hot_success(source_id, result)
        status = "not_modified" if result.get("not_modified") else "updated"
        logger.info(
            "feed hot refresh source=%s status=%s entries=%s provider=%s duration_ms=%s",
            source_id, status, len(result.get("entries") or []), result.get("provider", ""),
            int((time.monotonic() - started) * 1000),
        )
        return {"source_id": source_id, "status": status, "entries": len(result.get("entries") or [])}
    except PublicHttpError as error:
        _record_hot_failure(source_id, error.code, error.message, error.retry_after)
        logger.warning(
            "feed hot refresh failed source=%s code=%s status=%s duration_ms=%s",
            source_id, error.code, error.status, int((time.monotonic() - started) * 1000),
        )
        return {"source_id": source_id, "status": "failed", "code": error.code, "message": error.message}
    except FeedParseError as error:
        _record_hot_failure(source_id, error.code, error.message)
        logger.warning(
            "feed hot parse failed source=%s code=%s duration_ms=%s",
            source_id, error.code, int((time.monotonic() - started) * 1000),
        )
        return {"source_id": source_id, "status": "failed", "code": error.code, "message": error.message}
    except Exception:
        _record_hot_failure(source_id, "INTERNAL_ERROR", "刷新来源时出现内部错误")
        logger.exception("feed hot refresh internal error source=%s", source_id)
        return {"source_id": source_id, "status": "failed", "code": "INTERNAL_ERROR"}


def run_hot_refresh(source_ids: list[str], force: bool) -> None:
    def work(source_id: str):
        try:
            refresh_hot_source(source_id, force=force)
        except Exception:
            logger.exception("feed hot background task failed source=%s", source_id)

    try:
        with ThreadPoolExecutor(max_workers=min(4, max(1, len(source_ids)))) as pool:
            list(pool.map(work, source_ids))
    finally:
        _release([f"hot:{source_id}" for source_id in source_ids])


def request_hot_refresh(source_ids: list[str], force: bool) -> tuple[list[str], list[str]]:
    ids = [source_id for source_id in source_ids if source_id in HOT_SOURCES]
    if not ids:
        return [], []
    started, joined = _reserve([f"hot:{source_id}" for source_id in ids])
    return [key.split(":", 1)[1] for key in started], [key.split(":", 1)[1] for key in joined]


# ---------------------------------------------------------------- common sources


COMMON_LINK_KEYS = ("temu-seller", "pinterest-trends", "runsignup")


def refresh_common_source(key: str, force: bool = False) -> dict:
    source = COMMON_SOURCES.get(key)
    if not source:
        raise ApiError("UNKNOWN_COMMON_SOURCE", "未知通用信息源", 404)
    if not settings.feed_common_enabled:
        return {"key": key, "status": "disabled"}
    sid = f"common:{key}"
    with SessionLocal() as db:
        lock_seconds = 600 if key == "runsignup" else 60
        claim, state = _claim_snapshot(db, sid, force, lock_seconds=lock_seconds)
    if not claim:
        return {"key": key, "status": state}
    started = time.monotonic()
    try:
        if key == "runsignup":
            start = date.today()
            end = start + timedelta(days=settings.feed_runsignup_window_days)
            results, _failures = fetch_runsignup_all(
                start, end, concurrency=settings.feed_runsignup_concurrency,
            )
            successes = sum(v is not None for v in results.values())
            if successes == 0:
                raise PublicHttpError("ALL_COUNTRIES_FAILED", "所有国家赛事抓取失败")
            entries = merge_runsignup_entries(claim["entries"], results)
            provider = source["platform"]
            note = f"{successes}/{len(results)} 个国家成功"
            interval = settings.feed_runsignup_interval_seconds
        else:
            entries = source["fetch"]()
            provider = source["platform"]
            note = source.get("note") or ""
            interval = source["interval"]

        if entries == []:
            _record_hot_failure(sid, "EMPTY_PAYLOAD", "来源返回空数据")
            return {"key": key, "status": "failed", "code": "EMPTY_PAYLOAD", "message": "来源返回空数据"}

        _record_common_success(sid, entries, provider, note, interval)
        logger.info(
            "feed common refresh key=%s status=updated entries=%s provider=%s duration_ms=%s",
            key, len(entries), provider, int((time.monotonic() - started) * 1000),
        )
        return {"key": key, "status": "updated", "entries": len(entries)}
    except PublicHttpError as error:
        _record_hot_failure(sid, error.code, error.message, error.retry_after)
        logger.warning(
            "feed common refresh failed key=%s code=%s status=%s duration_ms=%s",
            key, error.code, error.status, int((time.monotonic() - started) * 1000),
        )
        return {"key": key, "status": "failed", "code": error.code, "message": error.message}
    except FeedParseError as error:
        _record_hot_failure(sid, error.code, error.message)
        logger.warning(
            "feed common parse failed key=%s code=%s duration_ms=%s",
            key, error.code, int((time.monotonic() - started) * 1000),
        )
        return {"key": key, "status": "failed", "code": error.code, "message": error.message}
    except Exception:
        _record_hot_failure(sid, "INTERNAL_ERROR", "刷新通用来源时出现内部错误")
        logger.exception("feed common refresh internal error key=%s", key)
        return {"key": key, "status": "failed", "code": "INTERNAL_ERROR"}


def run_common_refresh(keys: list[str], force: bool) -> None:
    def work(key: str):
        try:
            refresh_common_source(key, force=force)
        except Exception:
            logger.exception("feed common background task failed key=%s", key)

    try:
        with ThreadPoolExecutor(max_workers=min(3, max(1, len(keys)))) as pool:
            list(pool.map(work, keys))
    finally:
        _release([f"common:{key}" for key in keys])


def request_common_refresh(keys: list[str], force: bool) -> tuple[list[str], list[str]]:
    valid = [key for key in keys if key in COMMON_SOURCES]
    if not valid:
        return [], []
    started, joined = _reserve([f"common:{key}" for key in valid])
    return [key.split(":", 1)[1] for key in started], [key.split(":", 1)[1] for key in joined]


def common_due_keys(db: Session, limit: int = 10) -> list[str]:
    now = utcnow()
    due: list[str] = []
    for key in COMMON_SOURCES:
        row = db.get(FeedSnapshot, f"common:{key}")
        if row is None or row.next_attempt_at is None or row.next_attempt_at <= now:
            due.append(key)
        if len(due) >= limit:
            break
    return due


def common_cooldown_remaining(db: Session, key: str, seconds: int = 60) -> int:
    row = db.get(FeedSnapshot, f"common:{key}")
    if row is None or row.last_attempt_at is None:
        return 0
    now = utcnow()
    remaining = (row.last_attempt_at + timedelta(seconds=seconds) - now).total_seconds()
    return max(0, math.ceil(remaining))


def common_payload(db: Session) -> dict:
    rows = {row.source_id: row for row in db.scalars(select(FeedSnapshot)).all()}
    sources = []
    for source in COMMON_SOURCES.values():
        sid = f"common:{source['key']}"
        row = rows.get(sid)
        if not settings.feed_common_enabled:
            status = "disabled"
            entries: list[dict] = []
        else:
            status = _source_status(row)
            entries = []
            if row and row.last_success_at:
                entries = list(row.entries or [])
        interval = settings.feed_runsignup_interval_seconds if source["key"] == "runsignup" else source["interval"]
        sources.append({
            "key": source["key"],
            "title": source["title"],
            "platform": source["platform"],
            "url": source["url"],
            "note": source.get("note") or "",
            "data_kind": source.get("data_kind") or "",
            "status": status,
            "entries": entries,
            "last_success_at": iso_z(row.last_success_at) if row else None,
            "last_error": row.last_error if row else None,
            "interval_seconds": interval,
        })
    links = [
        {
            "key": key,
            "title": item["title"],
            "platform": item["platform"],
            "url": item["url"],
            "note": item.get("note") or "",
        }
        for key in COMMON_LINK_KEYS
        for item in [COMMON_BY_KEY.get(key)]
        if item
    ]
    return {"sources": sources, "links": links}


# ---------------------------------------------------------------- subscriptions


def _claim_subscription(db: Session, subscription_id: int, force: bool) -> tuple[dict | None, str]:
    now = utcnow()
    row = db.scalar(
        select(FeedSubscription).where(FeedSubscription.id == subscription_id).with_for_update(skip_locked=True)
    )
    if row is None or row.deleted_at is not None or not row.enabled:
        return None, "skipped"
    if row.locked_until and row.locked_until > now:
        return None, "joined"
    if not force and row.next_attempt_at and row.next_attempt_at > now:
        return None, "skipped"
    row.locked_until = now + timedelta(seconds=settings.feed_timeout_seconds + 15)
    row.last_attempt_at = now
    db.commit()
    return {
        "url": row.url, "title": row.title, "etag": row.etag, "last_modified": row.last_modified,
        "failures": row.consecutive_failures, "user_id": row.user_id,
    }, "started"


def _record_subscription_failure(subscription_id: int, code: str, message: str, retry_after: int | None = None) -> None:
    with SessionLocal() as db:
        row = db.get(FeedSubscription, subscription_id)
        if not row:
            return
        now = utcnow()
        row.consecutive_failures = (row.consecutive_failures or 0) + 1
        row.last_attempt_at = now
        row.last_error = (message or "刷新失败")[:1000]
        row.error_code = code[:64]
        row.next_attempt_at = now + timedelta(seconds=_backoff(row.consecutive_failures, retry_after))
        row.locked_until = None
        db.commit()


def _upsert_entries(db: Session, subscription_id: int, parsed: dict) -> int:
    existing = {
        entry.entry_key: entry
        for entry in db.scalars(select(FeedEntry).where(FeedEntry.subscription_id == subscription_id)).all()
    }
    now = utcnow()
    seen: set[str] = set()
    added = 0
    for item in parsed.get("entries", [])[:settings.feed_max_entries]:
        key = item.get("entry_key") or stable_hash(item.get("external_id") or item.get("url") or item.get("title"))
        if not key or key in seen:
            continue
        seen.add(key)
        row = existing.get(key)
        if row is None:
            row = FeedEntry(
                subscription_id=subscription_id, entry_key=key,
                external_id=str(item.get("external_id") or "")[:512],
                title=str(item.get("title") or "(无标题条目)")[:1000],
                url=safe_http_url(item.get("url"))[:2048],
                summary=str(item.get("summary") or "")[:2000],
                language=str(item.get("language") or "")[:16],
                link_kind=str(item.get("link_kind") or "article")[:16],
                discussion_url=safe_http_url(item.get("discussion_url"))[:2048],
                published_at=item.get("published_at"),
                discovered_at=now,
            )
            db.add(row)
            existing[key] = row
            added += 1
        else:
            row.external_id = str(item.get("external_id") or row.external_id)[:512]
            row.title = str(item.get("title") or row.title)[:1000]
            row.url = safe_http_url(item.get("url")) or row.url
            row.summary = str(item.get("summary") or "")[:2000]
            row.language = str(item.get("language") or row.language)[:16]
            row.link_kind = str(item.get("link_kind") or row.link_kind)[:16]
            row.discussion_url = safe_http_url(item.get("discussion_url")) or row.discussion_url
            row.published_at = item.get("published_at") or row.published_at
            row.updated_at = now
    db.flush()

    rows = db.scalars(
        select(FeedEntry).where(FeedEntry.subscription_id == subscription_id).order_by(
            func.coalesce(FeedEntry.published_at, FeedEntry.discovered_at).desc(), FeedEntry.id.desc()
        )
    ).all()
    for old in rows[settings.feed_max_entries:]:
        if old.favorite_at is None:
            db.delete(old)

    subscription = db.get(FeedSubscription, subscription_id)
    if subscription and (not subscription.title or subscription.title == "订阅源"):
        subscription.title = (parsed.get("title") or subscription.title)[:200]
    if subscription:
        subscription.feed_kind = parsed.get("kind") or subscription.feed_kind
    return added


def _record_subscription_success(subscription_id: int, parsed: dict | None, response) -> None:
    with SessionLocal() as db:
        row = db.get(FeedSubscription, subscription_id)
        if not row:
            return
        now = utcnow()
        if row.deleted_at is not None or not row.enabled:
            # A disable/delete that happened while the request was in flight
            # must not introduce new entries after the user's action.
            row.locked_until = None
            row.last_attempt_at = now
            db.commit()
            return
        if parsed is not None:
            _upsert_entries(db, subscription_id, parsed)
        if response is not None:
            if response.headers.get("etag") is not None:
                row.etag = str(response.headers["etag"])[:500]
            if response.headers.get("last-modified") is not None:
                row.last_modified = str(response.headers["last-modified"])[:500]
        row.last_attempt_at = now
        row.last_success_at = now
        row.last_error = None
        row.error_code = None
        row.consecutive_failures = 0
        row.next_attempt_at = now + timedelta(seconds=settings.feed_rss_interval_seconds)
        row.locked_until = None
        db.commit()


def refresh_subscription(subscription_id: int, force: bool = False) -> dict:
    with SessionLocal() as db:
        claim, state = _claim_subscription(db, subscription_id, force)
    if not claim:
        return {"subscription_id": subscription_id, "status": state}
    started = time.monotonic()
    try:
        response = fetch_public(
            claim["url"], timeout=settings.feed_timeout_seconds,
            max_bytes=settings.feed_max_bytes, max_redirects=settings.feed_max_redirects,
            headers={"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},
            etag=claim["etag"], last_modified=claim["last_modified"],
        )
        if response.status == 304:
            _record_subscription_success(subscription_id, None, response)
            logger.info("feed subscription refresh id=%s status=not_modified duration_ms=%s", subscription_id, int((time.monotonic() - started) * 1000))
            return {"subscription_id": subscription_id, "status": "not_modified"}
        parsed = parse_feed(response.body, claim["url"])
        _record_subscription_success(subscription_id, parsed, response)
        logger.info(
            "feed subscription refresh id=%s status=updated entries=%s duration_ms=%s",
            subscription_id, len(parsed.get("entries") or []), int((time.monotonic() - started) * 1000),
        )
        return {"subscription_id": subscription_id, "status": "updated", "entries": len(parsed.get("entries") or [])}
    except PublicHttpError as error:
        _record_subscription_failure(subscription_id, error.code, error.message, error.retry_after)
        logger.warning("feed subscription refresh failed id=%s code=%s status=%s duration_ms=%s", subscription_id, error.code, error.status, int((time.monotonic() - started) * 1000))
        return {"subscription_id": subscription_id, "status": "failed", "code": error.code, "message": error.message}
    except FeedParseError as error:
        _record_subscription_failure(subscription_id, error.code, error.message)
        logger.warning("feed subscription parse failed id=%s code=%s duration_ms=%s", subscription_id, error.code, int((time.monotonic() - started) * 1000))
        return {"subscription_id": subscription_id, "status": "failed", "code": error.code, "message": error.message}
    except Exception:
        _record_subscription_failure(subscription_id, "INTERNAL_ERROR", "刷新订阅时出现内部错误")
        logger.exception("feed subscription refresh internal error id=%s", subscription_id)
        return {"subscription_id": subscription_id, "status": "failed", "code": "INTERNAL_ERROR"}


def run_subscription_refresh(subscription_ids: list[int], force: bool) -> None:
    def work(subscription_id: int):
        try:
            refresh_subscription(subscription_id, force=force)
        except Exception:
            logger.exception("feed subscription background task failed id=%s", subscription_id)

    try:
        with ThreadPoolExecutor(max_workers=min(3, max(1, len(subscription_ids)))) as pool:
            list(pool.map(work, subscription_ids))
    finally:
        _release([f"sub:{subscription_id}" for subscription_id in subscription_ids])


def request_subscription_refresh(subscription_ids: list[int], force: bool) -> tuple[list[int], list[int]]:
    started, joined = _reserve([f"sub:{subscription_id}" for subscription_id in subscription_ids])
    return [int(key.split(":", 1)[1]) for key in started], [int(key.split(":", 1)[1]) for key in joined]


# ---------------------------------------------------------------- payloads


def _source_status(row: FeedSnapshot | None) -> str:
    if row is None:
        return "idle"
    now = utcnow()
    if row.locked_until and row.locked_until > now:
        return "refreshing"
    if row.last_error and row.last_success_at:
        return "stale"
    if row.last_error:
        return "error"
    if row.last_success_at is None:
        return "idle"
    if not row.entries:
        return "empty"
    return "ok"


def _entry_with_translation(entry: dict, translations: dict[str, str], source_id: str, fetched_at) -> dict:
    item = dict(entry)
    item["source_id"] = source_id
    item["fetched_at"] = iso_z(fetched_at) if isinstance(fetched_at, datetime) else fetched_at
    title = str(item.get("title") or "")
    item["translation"] = translations.get(title) or ""
    return item


def hot_payload(db: Session) -> dict:
    rows = {row.source_id: row for row in db.scalars(select(FeedSnapshot)).all()}
    all_titles = [
        entry.get("title") for row in rows.values() for entry in (row.entries or [])
        if entry.get("language") != "zh" and entry.get("title")
    ]
    from .feed_translation import load_translations
    translations = load_translations(db, all_titles)
    sources = []
    for source_id in HOT_SOURCE_IDS:
        source = HOT_SOURCES[source_id]
        row = rows.get(source_id)
        entries = []
        if row and row.last_success_at:
            entries = [
                _entry_with_translation(entry, translations, source_id, row.fetched_at)
                for entry in (row.entries or [])
            ]
        sources.append({
            **source,
            "auto_update": True,
            "interval_seconds": settings.feed_hot_interval_seconds,
            "status": _source_status(row),
            "provider": row.provider if row else "",
            "provider_note": row.provider_note if row else "",
            "last_attempt_at": iso_z(row.last_attempt_at) if row else None,
            "last_success_at": iso_z(row.last_success_at) if row else None,
            "upstream_updated_at": iso_z(row.upstream_updated_at) if row else None,
            "next_attempt_at": iso_z(row.next_attempt_at) if row else None,
            "last_error": row.last_error if row else None,
            "error_code": row.error_code if row else None,
            "entry_count": len(entries),
            "entries": entries,
        })
    return {
        "sections": [
            {"key": section["key"], "label": section["label"], "description": section["description"],
             "sources": [source for source in sources if source["section"] == section["key"]]}
            for section in HOT_SECTIONS
        ],
        "source_count": len(sources),
        "generated_at": iso_z(utcnow()),
    }


def _subscription_status(row: FeedSubscription, unread: int, entry_count: int) -> str:
    if not row.enabled:
        return "disabled"
    now = utcnow()
    if row.locked_until and row.locked_until > now:
        return "refreshing"
    if row.last_error and row.last_success_at:
        return "stale"
    if row.last_error:
        return "error"
    if row.last_success_at is None:
        return "idle"
    if not entry_count:
        return "empty"
    return "ok"


def subscription_payload(db: Session, row: FeedSubscription, translations: dict[str, str] | None = None) -> dict:
    counts = db.execute(
        select(func.count(FeedEntry.id), func.count(FeedEntry.id).filter(FeedEntry.read_at.is_(None)))
        .where(FeedEntry.subscription_id == row.id)
    ).one()
    entry_count = int(counts[0] or 0)
    unread = int(counts[1] or 0)
    return {
        "id": row.id,
        "title": row.title,
        "url": row.url,
        "host": urlsplit(row.url).hostname or row.url,
        "feed_kind": row.feed_kind,
        "enabled": row.enabled,
        "is_default": row.is_default,
        "default_key": row.default_key,
        "status": _subscription_status(row, unread, entry_count),
        "last_attempt_at": iso_z(row.last_attempt_at),
        "last_success_at": iso_z(row.last_success_at),
        "next_attempt_at": iso_z(row.next_attempt_at),
        "last_error": row.last_error,
        "error_code": row.error_code,
        "entry_count": entry_count,
        "unread_count": unread,
        "created_at": iso_z(row.created_at),
        "updated_at": iso_z(row.updated_at),
    }


def ensure_default_subscriptions(db: Session, user_id: int) -> None:
    changed = False
    for default in DEFAULT_SUBSCRIPTIONS:
        existing = db.scalar(
            select(FeedSubscription).where(
                FeedSubscription.user_id == user_id,
                FeedSubscription.default_key == default["key"],
            )
        )
        if existing:
            continue
        url = normalize_subscription_syntax(default["url"])
        url_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        by_url = db.scalar(
            select(FeedSubscription).where(
                FeedSubscription.user_id == user_id, FeedSubscription.url_key == url_key
            )
        )
        if by_url:
            if not by_url.default_key:
                by_url.default_key = default["key"]
                by_url.is_default = True
                changed = True
            continue
        db.add(FeedSubscription(
            user_id=user_id, url=url, url_key=url_key, title=default["title"],
            feed_kind=default["kind"], enabled=True, is_default=True, default_key=default["key"],
        ))
        changed = True
    if changed:
        db.commit()


def list_subscriptions(db: Session, user_id: int) -> list[FeedSubscription]:
    ensure_default_subscriptions(db, user_id)
    return list(db.scalars(
        select(FeedSubscription).where(
            FeedSubscription.user_id == user_id, FeedSubscription.deleted_at.is_(None)
        ).order_by(FeedSubscription.is_default.desc(), FeedSubscription.id)
    ).all())


def preview_subscription(url: str) -> dict:
    normalized, _ = normalize_subscription_url(url)
    try:
        response = fetch_public(
            normalized, timeout=settings.feed_timeout_seconds,
            max_bytes=settings.feed_max_bytes, max_redirects=settings.feed_max_redirects,
            headers={"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},
        )
    except PublicHttpError as error:
        raise ApiError(error.code, error.message, 502)
    try:
        parsed = parse_feed(response.body, normalized)
    except FeedParseError as error:
        raise ApiError(error.code, error.message, 422)
    return {
        "url": normalized,
        "title": parsed["title"],
        "feed_kind": parsed["kind"],
        "entry_count": len(parsed["entries"]),
        "entries": [
            {
                "title": entry["title"],
                "url": entry["url"],
                "published_at": iso_z(entry["published_at"]) if isinstance(entry["published_at"], datetime) else None,
            }
            for entry in parsed["entries"][:5]
        ],
    }


def add_subscription(db: Session, user: int, url: str, title: str | None = None) -> FeedSubscription:
    normalized, url_key = normalize_subscription_url(url)
    existing = db.scalar(
        select(FeedSubscription).where(
            FeedSubscription.user_id == user, FeedSubscription.url_key == url_key
        )
    )
    if existing:
        if existing.deleted_at is None and existing.enabled:
            raise ApiError("FEED_ALREADY_EXISTS", "这个订阅已经存在", 409)
        existing.deleted_at = None
        existing.enabled = True
        existing.next_attempt_at = None
        existing.last_error = None
        existing.error_code = None
        if title and title.strip():
            existing.title = title.strip()[:200]
        db.commit()
        return existing
    active = db.scalar(
        select(func.count(FeedSubscription.id)).where(
            FeedSubscription.user_id == user, FeedSubscription.deleted_at.is_(None)
        )
    ) or 0
    if active >= settings.feed_max_subscriptions:
        raise ApiError("FEED_LIMIT", f"最多添加 {settings.feed_max_subscriptions} 个订阅", 409)
    row = FeedSubscription(
        user_id=user, url=normalized, url_key=url_key,
        title=(title or urlsplit(normalized).hostname or "订阅源").strip()[:200],
        feed_kind="rss", enabled=True, is_default=False,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        row = db.scalar(select(FeedSubscription).where(
            FeedSubscription.user_id == user, FeedSubscription.url_key == url_key
        ))
        if row:
            row.deleted_at = None
            row.enabled = True
            db.commit()
            return row
        raise
    db.refresh(row)
    return row


def get_subscription(db: Session, user: int, subscription_id: int) -> FeedSubscription:
    row = db.get(FeedSubscription, subscription_id)
    if not row or row.user_id != user:
        raise ApiError("NOT_FOUND", "订阅不存在", 404)
    return row


def update_subscription(db: Session, user: int, subscription_id: int, title: str | None, enabled: bool | None) -> FeedSubscription:
    row = get_subscription(db, user, subscription_id)
    if row.deleted_at is not None:
        raise ApiError("NOT_FOUND", "订阅不存在", 404)
    if title is not None:
        value = title.strip()
        if not value:
            raise ApiError("TITLE_REQUIRED", "请填写订阅名称", 422)
        row.title = value[:200]
    if enabled is not None:
        row.enabled = enabled
        row.next_attempt_at = None
        if enabled:
            row.error_code = None
    db.commit()
    return row


def delete_subscription(db: Session, user: int, subscription_id: int) -> None:
    row = get_subscription(db, user, subscription_id)
    row.enabled = False
    row.deleted_at = utcnow()
    row.next_attempt_at = None
    db.commit()


def _entry_payload(row: FeedEntry, subscription: FeedSubscription, translations: dict[str, str]) -> dict:
    title = row.title
    return {
        "id": row.id,
        "source_id": f"subscription:{row.subscription_id}",
        "subscription_id": row.subscription_id,
        "subscription_title": subscription.title,
        "subscription_url": subscription.url,
        "subscription_deleted": subscription.deleted_at is not None,
        "external_id": row.external_id,
        "title": title,
        "url": row.url,
        "summary": row.summary,
        "language": row.language,
        "link_kind": row.link_kind,
        "discussion_url": row.discussion_url,
        "published_at": iso_z(row.published_at),
        "discovered_at": iso_z(row.discovered_at),
        "read": row.read_at is not None,
        "favorite": row.favorite_at is not None,
        "translation": translations.get(title) or "",
    }


def list_entries(
    db: Session, user: int, *, subscription_id: int | None = None,
    unread: bool = False, favorite: bool = False, limit: int = 100, offset: int = 0,
) -> dict:
    conditions = [FeedSubscription.user_id == user]
    if subscription_id is not None:
        conditions.append(FeedEntry.subscription_id == subscription_id)
    if unread:
        conditions.append(FeedEntry.read_at.is_(None))
    if favorite:
        conditions.append(FeedEntry.favorite_at.is_not(None))
    else:
        # Deleted subscriptions are hidden except in the favourites view.
        conditions.append(FeedSubscription.deleted_at.is_(None))
    base = select(FeedEntry, FeedSubscription).join(
        FeedSubscription, FeedSubscription.id == FeedEntry.subscription_id
    ).where(*conditions)
    total = db.scalar(
        select(func.count(FeedEntry.id)).select_from(FeedEntry).join(
            FeedSubscription, FeedSubscription.id == FeedEntry.subscription_id
        ).where(*conditions)
    ) or 0
    rows = db.execute(
        base.order_by(
            func.coalesce(FeedEntry.published_at, FeedEntry.discovered_at).desc(),
            FeedEntry.id.desc(),
        ).offset(max(0, offset)).limit(limit)
    ).all()
    titles = [entry.title for entry, _ in rows if entry.language != "zh"]
    from .feed_translation import load_translations
    translations = load_translations(db, titles)
    return {
        "total": int(total),
        "items": [_entry_payload(entry, subscription, translations) for entry, subscription in rows],
        "limit": limit,
        "offset": offset,
    }


def get_entry(db: Session, user: int, entry_id: int) -> tuple[FeedEntry, FeedSubscription]:
    row = db.get(FeedEntry, entry_id)
    if not row:
        raise ApiError("NOT_FOUND", "条目不存在", 404)
    subscription = db.get(FeedSubscription, row.subscription_id)
    if not subscription or subscription.user_id != user:
        raise ApiError("NOT_FOUND", "条目不存在", 404)
    return row, subscription


def update_entry(db: Session, user: int, entry_id: int, *, read: bool | None, favorite: bool | None) -> dict:
    row, subscription = get_entry(db, user, entry_id)
    now = utcnow()
    if read is not None:
        row.read_at = now if read else None
    if favorite is not None:
        row.favorite_at = now if favorite else None
    db.commit()
    db.refresh(row)
    from .feed_translation import load_translations
    translations = load_translations(db, [row.title] if row.language != "zh" else [])
    return _entry_payload(row, subscription, translations)


def due_subscription_ids(db: Session, user_id: int | None = None, limit: int = 20) -> list[int]:
    now = utcnow()
    conditions = [
        FeedSubscription.enabled.is_(True),
        FeedSubscription.deleted_at.is_(None),
        or_(FeedSubscription.next_attempt_at.is_(None), FeedSubscription.next_attempt_at <= now),
    ]
    if user_id is not None:
        conditions.append(FeedSubscription.user_id == user_id)
    return list(db.scalars(
        select(FeedSubscription.id).where(*conditions).order_by(FeedSubscription.id).limit(limit)
    ).all())


def refresh_due_all() -> None:
    if not settings.feed_enabled:
        return
    hot_started, _ = request_hot_refresh(HOT_SOURCE_IDS, force=False)
    if hot_started:
        run_hot_refresh(hot_started, force=False)
    with SessionLocal() as db:
        subscription_ids = due_subscription_ids(db, limit=20)
    if subscription_ids:
        started, _ = request_subscription_refresh(subscription_ids, force=False)
        if started:
            run_subscription_refresh(started, force=False)
    if settings.feed_common_enabled:
        with SessionLocal() as db:
            common_keys = common_due_keys(db, limit=10)
        if common_keys:
            started, _ = request_common_refresh(common_keys, force=False)
            if started:
                run_common_refresh(started, force=False)


async def refresh_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(refresh_due_all)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("feed refresh loop failed; retrying later")
        await asyncio.sleep(max(30, settings.feed_scheduler_interval_seconds))
