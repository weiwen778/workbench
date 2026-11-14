"""Parsers and fetchers for common public sources.

Includes Alibaba/1688 rule channels, RunSignup race listings, and US federal
holidays. All outbound requests go through ``public_http.fetch_public``.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

from app.config import settings
from app.services.feed_parsers import FeedParseError, clean_text, parse_datetime, safe_http_url
from app.services.public_http import USER_AGENT, fetch_public

RUNSIGNUP_COUNTRIES: tuple[str, ...] = (
    "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU",
    "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL",
    "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC",
    "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV",
    "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG",
    "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD",
    "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
    "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM",
    "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH",
    "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK",
    "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH",
    "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW",
    "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR",
    "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR",
    "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC",
    "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
    "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL",
    "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY",
    "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT",
    "ZA", "ZM", "ZW",
)

RUNSIGNUP_US_STATES: tuple[str, ...] = (
    "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA",
    "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS",
    "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
)

_US_HOLIDAY_RULES: list[tuple[str, str, ...]] = [
    ("new-year-day", "元旦", 1, 1),
    ("martin-luther-king-jr-day", "马丁·路德·金日", "nth_monday", 1, 3),
    ("presidents-day", "总统日", "nth_monday", 2, 3),
    ("memorial-day", "阵亡将士纪念日", "last_monday", 5),
    ("juneteenth", "六月节", 6, 19),
    ("independence-day", "独立日", 7, 4),
    ("labor-day", "劳动节", "nth_monday", 9, 1),
    ("columbus-day", "哥伦布日", "nth_monday", 10, 2),
    ("veterans-day", "退伍军人节", 11, 11),
    ("thanksgiving-day", "感恩节", "nth_thursday", 11, 4),
    ("christmas-day", "圣诞节", 12, 25),
]


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Return the n-th weekday (0=Mon) of a month; negative n counts from end."""
    if n > 0:
        first = date(year, month, 1)
        offset = (weekday - first.weekday()) % 7
        return first + timedelta(days=offset + (n - 1) * 7)
    days_in_month = monthrange(year, month)[1]
    last = date(year, month, days_in_month)
    offset = (last.weekday() - weekday) % 7
    return last - timedelta(days=offset + (-n - 1) * 7)


def _observe(d: date) -> date:
    """Federal holiday observed date: Saturday -> Friday, Sunday -> Monday."""
    if d.weekday() == 5:  # Saturday
        return d - timedelta(days=1)
    if d.weekday() == 6:  # Sunday
        return d + timedelta(days=1)
    return d


def us_holidays(start: date, end: date) -> list[dict]:
    """Return US federal holidays between start and end (inclusive), observed."""
    rows: list[dict] = []
    for year in range(start.year, end.year + 1):
        for slug, title, *rule in _US_HOLIDAY_RULES:
            if rule[0] == "nth_monday":
                actual = _nth_weekday(year, rule[1], 0, rule[2])
            elif rule[0] == "last_monday":
                actual = _nth_weekday(year, rule[1], 0, -1)
            elif rule[0] == "nth_thursday":
                actual = _nth_weekday(year, rule[1], 3, rule[2])
            else:
                actual = date(year, rule[0], rule[1])
            observed = _observe(actual)
            if start <= observed <= end:
                rows.append({
                    "kind": "holiday",
                    "date": observed.isoformat(),
                    "title": title,
                    "url": f"https://www.timeanddate.com/holidays/us/{slug}",
                })
    rows.sort(key=lambda row: (row["date"], row["title"]))
    return rows


def parse_alibaba(payload: dict) -> list[dict]:
    """Parse Alibaba rule channel latest-rules payload."""
    rows: list[dict] = []
    for item in payload.get("model") or []:
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get("ruleTitle"), 500)
        rule_id = item.get("ruleId")
        modified = item.get("modifiedTime")
        if not title or not rule_id or modified is None:
            continue
        try:
            published = datetime.fromtimestamp(modified / 1000, tz=timezone.utc).replace(tzinfo=None)
        except (TypeError, ValueError, OverflowError):
            continue
        category = item.get("category") or {}
        rows.append({
            "title": title,
            "url": f"https://rule.alibaba.com/rule/detail/{rule_id}.htm",
            "published_at": published,
            "badge": clean_text(category.get("categoryName"), 80),
            "summary": "",
        })
    rows.sort(key=lambda row: (row["published_at"] or datetime.min, row["title"]), reverse=True)
    return rows


def parse_1688(payload: dict) -> list[dict]:
    """Parse 1688 rule channel payload."""
    ret = payload.get("ret") or []
    if ret and not str(ret[0]).startswith("SUCCESS"):
        raise FeedParseError("1688_ERROR", str(ret[0]))
    data = payload.get("data")
    model = data.get("model") if isinstance(data, dict) else data
    if model is None:
        model = []
    rows: list[dict] = []
    for item in model or []:
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get("ruleTitle"), 500)
        rule_id = item.get("ruleId")
        modified = item.get("modifiedTime")
        category_id = item.get("lastCategoryId")
        if not title or not rule_id or not modified or not category_id:
            continue
        published = parse_datetime(modified)
        if published is None:
            continue
        detail_url = (
            f"https://rule.1688.com/?type=detail&ruleId={rule_id}&cId={category_id}"
            f"#/rule/detail?ruleId={rule_id}&cId={category_id}"
        )
        rows.append({
            "title": title,
            "url": detail_url,
            "published_at": published,
            "badge": clean_text(item.get("lastCategoryName"), 80),
            "summary": "",
        })
    rows.sort(key=lambda row: (row["published_at"] or datetime.min, row["title"]), reverse=True)
    return rows


def parse_1688_cookies(values: list[str]) -> dict[str, str]:
    """Extract _m_h5_tk and _m_h5_tk_enc from Set-Cookie values."""
    cookies: dict[str, str] = {}
    for raw in values or []:
        part = raw.split(";", 1)[0].strip()
        if "=" in part:
            name, value = part.split("=", 1)
            cookies[name.strip()] = value.strip()
    return cookies


def sign_1688(token: str, timestamp: int, data: str, app_key: str = "12574478") -> str:
    """Sign a 1688 mtop request using the token+timestamp+appKey+data recipe."""
    return hashlib.md5(f"{token}&{timestamp}&{app_key}&{data}".encode()).hexdigest()


def _strip_utm_params(url: str) -> str:
    """Remove utm_* query parameters from a URL while preserving fragment."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.startswith("utm_")]
    query = urlencode(kept)
    fragment = f"#{parts.fragment}" if parts.fragment else ""
    return f"{parts.scheme}://{parts.netloc}{parts.path}" + (f"?{query}" if query else "") + fragment


def parse_runsignup(html: bytes | str, country: str, start: date, end: date) -> list[dict]:
    """Parse a RunSignup race search result page into race entries."""
    soup = BeautifulSoup(html, "html.parser")
    seen: set[tuple[str, str]] = set()
    rows: list[dict] = []
    for anchor in soup.select("a.rsuTileGrid__item--findRace"):
        href = anchor.get("href") or ""
        base_url = safe_http_url(urljoin("https://runsignup.com/", href))
        url = _strip_utm_params(base_url)
        if not url:
            continue
        content = anchor.select_one(".rsuTileGrid__item__content")
        if not content:
            continue
        divs = [d for d in content.find_all("div", recursive=False)]
        if not divs:
            continue
        title_el = content.select_one(".fs-md-2")
        title = clean_text(title_el.get_text(" ", strip=True) if title_el else divs[0].get_text(" ", strip=True), 300)
        info_divs = divs[1:] if title_el and divs and divs[0] is title_el else divs
        if len(info_divs) < 3:
            continue
        date_text = info_divs[0].get_text(" ", strip=True)
        city = clean_text(info_divs[1].get_text(" ", strip=True), 120)
        distance_spans = info_divs[2].find_all("span")
        distance = clean_text(distance_spans[0].get_text(" ", strip=True) if distance_spans else info_divs[2].get_text(" ", strip=True), 80)
        try:
            race_date = datetime.strptime(date_text, "%a %m/%d/%y").date()
        except ValueError:
            continue
        if not (start <= race_date <= end):
            continue
        key = (race_date.isoformat(), title)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "kind": "race",
            "date": race_date.isoformat(),
            "title": title,
            "url": url,
            "country": country.upper(),
            "city": city,
            "distance": distance,
        })
        if len(rows) >= 30:
            break
    rows.sort(key=lambda row: (row["date"], row["title"]))
    return rows


def runsignup_countries() -> tuple[str, ...]:
    """Return the configured RunSignup country codes."""
    configured = (settings.feed_runsignup_countries or "").strip()
    if not configured or configured.lower() == "all":
        return RUNSIGNUP_COUNTRIES
    codes = tuple(code.strip().upper() for code in configured.split(",") if code.strip())
    return tuple(code for code in codes if code in RUNSIGNUP_COUNTRIES)


def fetch_runsignup_country(country: str, start: date, end: date, state: str | None = None) -> list[dict]:
    """Fetch RunSignup race listings for a single country or US state."""
    params: dict[str, str] = {
        "country": country,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    if state:
        params["state"] = state
    url = f"https://runsignup.com/Races?{urlencode(params)}"
    response = fetch_public(
        url,
        timeout=settings.feed_timeout_seconds,
        max_bytes=settings.feed_max_bytes,
        max_redirects=settings.feed_max_redirects,
        headers={"User-Agent": USER_AGENT},
    )
    return parse_runsignup(response.body, country, start, end)


def fetch_runsignup_all(
    start: date,
    end: date,
    countries: tuple[str, ...] | None = None,
    concurrency: int = 8,
) -> tuple[dict[str, list[dict] | None], int]:
    """Fetch RunSignup races for many countries concurrently.

    US is expanded into per-state queries; the whole country counts as one
    failure if any state query fails.
    """
    if countries is None:
        countries = runsignup_countries()

    tasks: list[tuple[str, str | None]] = []
    for country in countries:
        if country == "US":
            for state in RUNSIGNUP_US_STATES:
                tasks.append(("US", state))
        else:
            tasks.append((country, None))

    results: dict[str, list[dict] | None] = {}
    us_state_rows: list[list[dict]] = []
    us_failed = False
    failures = 0

    def _run(country: str, state: str | None) -> tuple[str, str | None, list[dict] | None]:
        try:
            rows = fetch_runsignup_country(country, start, end, state=state)
            return (country, state, rows)
        except Exception as exc:
            logger.warning("RunSignup fetch failed for %s%s: %s", country, f"/{state}" if state else "", exc)
            return (country, state, None)

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        future_to_task = {
            executor.submit(_run, country, state): (country, state)
            for country, state in tasks
        }
        for future in as_completed(future_to_task):
            country, state, rows = future.result()
            if country == "US":
                if rows is None:
                    if not us_failed:
                        us_failed = True
                        failures += 1
                else:
                    us_state_rows.append(rows)
            else:
                if rows is None:
                    failures += 1
                results[country] = rows

    if us_failed:
        results["US"] = None
    elif us_state_rows:
        combined: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for rows in us_state_rows:
            for row in rows:
                key = (row["date"], row["title"])
                if key in seen:
                    continue
                seen.add(key)
                combined.append(row)
        combined.sort(key=lambda row: (row["date"], row["title"]))
        results["US"] = combined

    return results, failures


def merge_runsignup_entries(previous: list[dict], results: dict[str, list[dict] | None]) -> list[dict]:
    """Merge new per-country results into the previous race list."""
    by_country: dict[str, list[dict]] = {}
    for row in previous:
        by_country.setdefault(row.get("country", ""), []).append(row)

    merged: list[dict] = []
    for country, old_rows in by_country.items():
        new_rows = results.get(country)
        if new_rows is None:
            merged.extend(old_rows)
        else:
            merged.extend(new_rows)

    for country, new_rows in results.items():
        if country not in by_country and new_rows is not None:
            merged.extend(new_rows)

    merged.sort(key=lambda row: (row.get("date", ""), row.get("title", "")))
    return merged[:1000]


def fetch_alibaba_rules() -> list[dict]:
    """Fetch latest rules from Alibaba rule channel."""
    url = (
        "https://rulechannel.alibaba.com/rulechannel/newrule/rule/latest"
        "?terminal=PC&pageIndex=1&pageSize=10&language=zh_CN"
    )
    response = fetch_public(
        url,
        timeout=settings.feed_timeout_seconds,
        max_bytes=2 * 1024 * 1024,
        headers={"User-Agent": USER_AGENT},
    )
    try:
        payload = json.loads(response.body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise FeedParseError("BAD_ALIBABA_JSON", f"无法解析阿里巴巴规则响应: {exc}")
    return parse_alibaba(payload)


def fetch_1688_rules() -> list[dict]:
    """Fetch latest rules from 1688 rule channel via mtop API."""
    cookie_url = (
        "https://h5api.m.taobao.com/h5/mtop.alibaba.rulechannel.newrule.rule.list/1.0/"
        "?jsv=2.7.5&appKey=12574478"
    )
    cookie_response = fetch_public(cookie_url, timeout=settings.feed_timeout_seconds, max_bytes=1024 * 1024)
    cookies = parse_1688_cookies(cookie_response.set_cookies)
    token = (cookies.get("_m_h5_tk") or "").split("_")[0]
    if not token:
        raise FeedParseError("1688_TOKEN", "未能获取 1688 mtop token")

    data = json.dumps(
        {
            "pageIndex": 1,
            "pageSize": 10,
            "lastCategoryId": 0,
            "parentCategoryId": 0,
            "identityCode": "",
            "terminal": "PC",
            "buCode": "CNA1688",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    t = int(time.time() * 1000)
    sign = sign_1688(token, t, data)
    query = urlencode({"jsv": "2.7.5", "appKey": "12574478", "t": str(t), "sign": sign, "data": data})
    api_url = f"https://h5api.m.taobao.com/h5/mtop.alibaba.rulechannel.newrule.rule.list/1.0/?{query}"
    response = fetch_public(
        api_url,
        timeout=settings.feed_timeout_seconds,
        max_bytes=2 * 1024 * 1024,
        headers={
            "Cookie": f"_m_h5_tk={cookies.get('_m_h5_tk', '')}; _m_h5_tk_enc={cookies.get('_m_h5_tk_enc', '')}",
            "Referer": "https://rule.1688.com/",
        },
    )
    try:
        payload = json.loads(response.body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise FeedParseError("BAD_1688_JSON", f"无法解析 1688 规则响应: {exc}")
    return parse_1688(payload)


COMMON_SOURCES: dict[str, dict] = {
    "alibaba-rules": {
        "key": "alibaba-rules",
        "title": "阿里国际站规则",
        "platform": "Alibaba.com",
        "url": "https://rulechannel.alibaba.com/icbu",
        "note": "公开规则与公告",
        "interval": 3600,
        "data_kind": "rules",
        "fetch": fetch_alibaba_rules,
    },
    "1688-rules": {
        "key": "1688-rules",
        "title": "1688 规则中心",
        "platform": "1688",
        "url": "https://rule.1688.com/",
        "note": "公开规则与公告",
        "interval": 3600,
        "data_kind": "rules",
        "fetch": fetch_1688_rules,
    },
    "runsignup": {
        "key": "runsignup",
        "title": "RunSignup 全球赛事",
        "platform": "RunSignup",
        "url": "https://runsignup.com/Races",
        "note": "",
        "interval": 21600,
        "data_kind": "races",
        "fetch": None,
    },
}
