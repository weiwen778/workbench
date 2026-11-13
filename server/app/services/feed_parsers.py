"""Adapters for hot-list JSON, RSS and Atom feeds.

All source-specific quirks stay in this module. Output entries use one shape
regardless of upstream format. Titles and summaries are converted to plain
text and links are restricted to public HTTP(S) URLs.
"""
from __future__ import annotations

import calendar
import hashlib
import html as html_lib
import ipaddress
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urljoin, urlsplit

import feedparser
from bs4 import BeautifulSoup
from defusedxml import ElementTree as SafeElementTree

CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


class FeedParseError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def clean_text(value, limit: int = 1000) -> str:
    if value is None:
        return ""
    text = str(value)
    if "<" in text:
        try:
            soup = BeautifulSoup(text, "html.parser")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            text = soup.get_text(" ", strip=True)
        except Exception:
            text = html_lib.unescape(text)
    elif "&" in text:
        text = html_lib.unescape(text)
    text = CONTROL.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def safe_http_url(value) -> str:
    raw = str(value or "").strip()
    if not raw or len(raw) > 2048 or any(ord(ch) < 32 for ch in raw):
        return ""
    try:
        parts = urlsplit(raw)
        if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
            return ""
        if parts.username is not None or parts.password is not None:
            return ""
        host = parts.hostname
        try:
            if not ipaddress.ip_address(host).is_global:
                return ""
        except ValueError:
            pass
        _ = parts.port
        return raw
    except ValueError:
        return ""


def normalize_link(value) -> str:
    raw = safe_http_url(value)
    if not raw:
        return ""
    parts = urlsplit(raw)
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    port = parts.port or (443 if scheme == "https" else 80)
    netloc = host
    if port not in ({443} if scheme == "https" else {80}):
        netloc = f"{host}:{port}"
    path = parts.path or "/"
    return f"{scheme}://{netloc}{path}" + (f"?{parts.query}" if parts.query else "")


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()[:48]


def detect_language(value: str) -> str:
    return "zh" if CJK.search(value or "") else "en"


def normalize_language(value, title: str) -> str:
    code = str(value or "").strip().lower().replace("_", "-")
    if code.startswith("zh"):
        return "zh"
    if code.startswith("en"):
        return "en"
    if code.startswith("ja"):
        return "ja"
    if code.startswith("ko"):
        return "ko"
    return detect_language(title)


def _datetime_from_struct(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(calendar.timegm(value), tz=timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError, OverflowError):
        return None


def parse_datetime(value) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _format_heat(value) -> str:
    if value is None or value == "":
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return clean_text(value, 40)
    if number >= 10_000:
        return f"{number / 10_000:.1f} 万"
    if number >= 100:
        return f"{number:,.0f}"
    return f"{number:g}"


def _heat_from_detail(value) -> str:
    text = clean_text(value, 80)
    match = re.search(r"([\d.]+)\s*(万|亿)?", text)
    if not match:
        return text
    number = float(match.group(1))
    if match.group(2) == "亿":
        number *= 100_000_000
    elif match.group(2) == "万":
        number *= 10_000
    return _format_heat(number)


def link_kind(source_id: str, url: str) -> str:
    if source_id == "weibo" or "s.weibo.com" in url:
        return "search"
    if "trends.google.com" in url:
        return "topic"
    return "article"


def assert_safe_xml(body: bytes) -> None:
    head = body.lower()
    if b"<!entity" in head:
        raise FeedParseError("UNSAFE_XML", "来源包含不允许的 XML 实体")


def _base_entry(
    *, source_id: str, title: str, url: str, external_id: str, language: str,
    summary: str = "", published_at: datetime | None = None, rank: int | None = None,
    heat: str = "", heat_label: str = "", discussion_url: str = "",
) -> dict:
    return {
        "source_id": source_id,
        "external_id": external_id[:512],
        "entry_key": stable_hash(external_id or url or title),
        "title": title,
        "url": url,
        "summary": summary,
        "language": language,
        "published_at": published_at,
        "rank": rank,
        "heat": heat,
        "heat_label": heat_label,
        "link_kind": link_kind(source_id, url),
        "discussion_url": discussion_url,
        "news": [],
    }


def _dailyhot_items(payload, source_id: str) -> tuple[list[dict], datetime | None]:
    if not isinstance(payload, dict):
        raise FeedParseError("BAD_HOT_JSON", "来源返回的不是热榜 JSON")
    code = payload.get("code")
    if code not in (None, 0, 200):
        raise FeedParseError("BAD_HOT_JSON", f"来源返回错误码 {code}")
    data = payload.get("data")
    if not isinstance(data, list):
        raise FeedParseError("BAD_HOT_JSON", "来源缺少榜单列表")
    entries: list[dict] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get("title") or item.get("name") or item.get("word"), 500)
        if not title:
            continue
        url = safe_http_url(item.get("url") or item.get("mobileUrl") or item.get("link"))
        summary = clean_text(item.get("desc") or item.get("description"), 300)
        heat_value = item.get("hot")
        heat = _format_heat(heat_value) if heat_value not in (None, "") else ""
        entry = _base_entry(
            source_id=source_id, title=title, url=url,
            external_id=str(item.get("id") or item.get("token") or url or title),
            language="zh", summary=summary, rank=index + 1, heat=heat,
            heat_label="热度" if heat else "",
        )
        entries.append(entry)
    return entries, parse_datetime(payload.get("updateTime"))


def parse_dailyhot(payload, source_id: str) -> tuple[list[dict], datetime | None]:
    return _dailyhot_items(payload, source_id)


def parse_direct_weibo(payload) -> tuple[list[dict], datetime | None]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise FeedParseError("BAD_HOT_JSON", "微博接口返回结构异常")
    items = payload["data"].get("realtime")
    if not isinstance(items, list):
        raise FeedParseError("BAD_HOT_JSON", "微博接口缺少热搜列表")
    entries: list[dict] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or item.get("is_ad"):
            continue
        title = clean_text(item.get("word") or item.get("note"), 500)
        if not title:
            continue
        rank = int(item.get("realpos") or index + 1)
        heat = _format_heat(item.get("num"))
        entries.append(_base_entry(
            source_id="weibo", title=title,
            url=f"https://s.weibo.com/weibo?q={quote(title)}",
            external_id=str(item.get("mid") or item.get("word_scheme") or title),
            language="zh", rank=rank, heat=heat, heat_label="热度" if heat else "",
        ))
    return entries, None


def parse_direct_zhihu(payload) -> tuple[list[dict], datetime | None]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise FeedParseError("BAD_HOT_JSON", "知乎接口返回结构异常")
    entries: list[dict] = []
    for index, item in enumerate(payload["data"]):
        if not isinstance(item, dict):
            continue
        target = item.get("target") or {}
        title = clean_text(target.get("title"), 500)
        if not title:
            continue
        question_id = str(target.get("id") or "")
        target_url = (
            f"https://www.zhihu.com/question/{question_id}"
            if question_id else safe_http_url(target.get("url"))
        )
        heat = _heat_from_detail(item.get("detail_text"))
        entries.append(_base_entry(
            source_id="zhihu", title=title, url=target_url,
            external_id=str(target.get("id") or target_url or title),
            language="zh", summary=clean_text(target.get("excerpt"), 300),
            rank=index + 1, heat=heat, heat_label="热度" if heat else "",
        ))
    return entries, None


def parse_direct_bilibili(payload) -> tuple[list[dict], datetime | None]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise FeedParseError("BAD_HOT_JSON", "B 站接口返回结构异常")
    items = payload["data"].get("list")
    if not isinstance(items, list):
        raise FeedParseError("BAD_HOT_JSON", "B 站接口缺少热门列表")
    entries: list[dict] = []
    latest: datetime | None = None
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get("title"), 500)
        if not title:
            continue
        bvid = str(item.get("bvid") or "")
        url = f"https://www.bilibili.com/video/{bvid}" if bvid else safe_http_url(item.get("short_link_v2"))
        published = None
        try:
            if item.get("pubdate"):
                published = datetime.fromtimestamp(int(item["pubdate"]), tz=timezone.utc).replace(tzinfo=None)
                latest = max(latest, published) if latest else published
        except (TypeError, ValueError, OverflowError):
            pass
        view = (item.get("stat") or {}).get("view")
        heat = _format_heat(view)
        entries.append(_base_entry(
            source_id="bilibili", title=title, url=url,
            external_id=str(bvid or item.get("aid") or url or title),
            language="zh", summary=clean_text(item.get("desc"), 300),
            published_at=published, rank=index + 1, heat=heat, heat_label="播放" if heat else "",
        ))
    return entries, latest


def parse_google_trends(body: bytes) -> tuple[list[dict], datetime | None, str]:
    assert_safe_xml(body)
    try:
        root = SafeElementTree.fromstring(body)
    except Exception:
        raise FeedParseError("BAD_XML", "Google Trends RSS 无法解析")

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    def child_text(node, name: str) -> str:
        for child in list(node):
            if local(child.tag) == name:
                return clean_text(child.text, 500)
        return ""

    channel = next((node for node in root.iter() if local(node.tag) == "channel"), root)
    entries: list[dict] = []
    for item in (node for node in channel.iter() if local(node.tag) == "item"):
        title = child_text(item, "title")
        if not title:
            continue
        link = safe_http_url(child_text(item, "link"))
        published = parse_datetime(child_text(item, "pubDate"))
        traffic = child_text(item, "approx_traffic")
        news = []
        for news_item in (node for node in item.iter() if local(node.tag) == "news_item"):
            news_title = child_text(news_item, "news_item_title")
            if not news_title:
                continue
            news.append({
                "title": news_title,
                "url": safe_http_url(child_text(news_item, "news_item_url")),
                "source": child_text(news_item, "news_item_source"),
            })
            if len(news) >= 3:
                break
        entry = _base_entry(
            source_id="google-trends-us", title=title, url=link,
            external_id=link or f"{title}:{child_text(item, 'pubDate')}",
            language="en", published_at=published, heat=traffic,
            heat_label="搜索量" if traffic else "", rank=None,
        )
        entry["news"] = news
        entries.append(entry)
    updated_text = child_text(channel, "lastBuildDate") or child_text(channel, "pubDate")
    return entries, parse_datetime(updated_text), "Google Trends RSS"


def parse_feed(body: bytes, feed_url: str = "") -> dict:
    assert_safe_xml(body)
    parsed = feedparser.parse(body)
    feed = parsed.feed or {}
    title = clean_text(feed.get("title"), 200)
    if parsed.bozo and not parsed.entries and not title:
        raise FeedParseError("BAD_XML", "RSS/Atom 无法解析")
    if not parsed.version and not parsed.entries:
        raise FeedParseError("NOT_A_FEED", "地址返回的内容不是 RSS 或 Atom")
    channel_language = feed.get("language")
    entries: list[dict] = []
    seen: set[str] = set()
    for item in parsed.entries:
        entry_url = safe_http_url(item.get("link"))
        if not entry_url:
            for candidate in item.get("links") or []:
                if candidate.get("rel") in {None, "alternate"}:
                    entry_url = safe_http_url(urljoin(feed_url, candidate.get("href") or ""))
                    if entry_url:
                        break
        if not entry_url:
            entry_url = safe_http_url(item.get("id"))
        entry_title = clean_text(item.get("title"), 500)
        if not entry_title:
            entry_title = "(无标题条目)"
        external_id = str(item.get("id") or item.get("guid") or entry_url or "")
        if not external_id:
            external_id = f"{entry_title}:{item.get('published') or item.get('updated') or ''}"
        key = stable_hash(external_id)
        if key in seen:
            continue
        seen.add(key)
        summary = item.get("summary") or item.get("description") or ""
        if not summary:
            content = item.get("content") or []
            if content and isinstance(content, list):
                summary = content[0].get("value", "") if isinstance(content[0], dict) else ""
        published = (
            _datetime_from_struct(item.get("published_parsed"))
            or _datetime_from_struct(item.get("updated_parsed"))
        )
        language = normalize_language(channel_language, entry_title)
        summary_text = clean_text(summary, 1000)
        if "Article URL:" in summary_text or "Comments URL:" in summary_text:
            summary_text = re.sub(r"Article URL:\s*\S+", "", summary_text, flags=re.I)
            summary_text = re.sub(r"Comments URL:\s*\S+", "", summary_text, flags=re.I)
            summary_text = re.sub(r"Points:\s*\d+\s*#\s*Comments:\s*\d+", "", summary_text, flags=re.I)
            summary_text = re.sub(r"\s+", " ", summary_text).strip()
        entries.append(_base_entry(
            source_id="", title=entry_title, url=entry_url, external_id=external_id,
            language=language, summary=summary_text, published_at=published,
            discussion_url=safe_http_url(item.get("comments")),
        ))
    updated = (
        _datetime_from_struct(feed.get("updated_parsed"))
        or _datetime_from_struct(feed.get("published_parsed"))
    )
    version = str(parsed.version or "")
    kind = "atom" if version.startswith("atom") else "rss"
    return {
        "title": title or clean_text(urlsplit(feed_url).hostname or "订阅源", 200),
        "kind": kind,
        "entries": entries,
        "upstream_updated_at": updated,
        "language": normalize_language(channel_language, ""),
    }
