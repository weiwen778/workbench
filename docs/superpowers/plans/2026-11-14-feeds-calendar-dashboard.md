# 信息聚合·日历与数据栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/feeds` 的“常用信息源”页签改成一页 5 区块的“日历 + 数据栏”：日历显示 RunSignup 全球赛事和美国联邦节日，数据栏显示订阅文章、Alibaba/1688 规则和其他平台入口。

**Architecture:** 后端新增 `common_sources.py` 负责公网源抓取与解析，复用 `feed_snapshots` 的锁、退避、状态；`feed_service.py` 负责快照合并、刷新调度和聚合 payload；`routers/feeds.py` 暴露日历与数据栏接口。前端新增 `CalendarDashboard`、`CalendarGrid`、`DataPanels` 三个组件，替换 `CommonPanel`，页签 `sources` 改名为 `calendar`。

**Tech Stack:** FastAPI + SQLAlchemy + BeautifulSoup + feedparser + pytest；React 18 + MUI 6 + @tanstack/react-query + TypeScript + Vite。

**Spec:** `docs/superpowers/specs/2026-11-14-feeds-calendar-dashboard-design.md`

## Global Constraints

- 不改数据库结构；复用 `feed_snapshots`，赛事/规则使用 `source_id = "common:<key>"`。
- 所有出站请求走 `public_http.fetch_public`：只连已校验 IP、12s 超时、2MB 上限、每次重定向重新校验。
- 赛事和节日只存/返回 `YYYY-MM-DD` 日期，不做 UTC 时区换算。
- 成功但 0 条按失败处理（`EMPTY_PAYLOAD`），保留上次成功快照，状态 `stale`。
- RunSignup 单国失败保留该国旧条目；全部国家失败才把整源记为失败。
- 手动刷新 60 秒最小区间；冷却中返回 `{"queued": false, "reason": "cooldown"}`。
- 不自动翻译；RunSignup 赛事名保留英文。
- 不抓 TEMU 登录态、不为 Pinterest 加代理；两者只保留入口。
- 仓库当前有无关的未提交改动；每个任务只 `git add` 本任务涉及的文件，不要 `git add -A`。

## Review Focus

- **空/零条上游响应**：接口 200 但解析出 0 条时，必须保留旧快照，不能把日历或规则清空。测试在 Task 4。
- **部分国家失败**：RunSignup 250 个国家中部分失败时，失败国家的旧赛事必须保留，成功国家必须替换。测试在 Task 3/4。
- **日期边界**：月历起止日、观察日（如 2026-07-03 独立日）必须落在正确日期，不能因 UTC 偏移前一天。测试在 Task 2/5。
- **上游结构变化**：1688 签名失败、RunSignup HTML 改版、Alibaba JSON 缺字段时必须降级为失败并保留旧数据，不能 500。测试在 Task 2/4。
- **刷新冷却/并发**：60 秒内重复手动刷新不得再次打源；后台与手动刷新不得把 `locked_until` 卡死。测试在 Task 4/5。

---

## File Structure

- Create: `server/app/services/common_sources.py` — 国家列表、Alibaba/1688/RunSignup/节日解析与抓取、合并函数。
- Modify: `server/app/services/feed_service.py` — 通用源刷新、快照合并、日历/数据栏聚合、调度接入。
- Modify: `server/app/services/public_http.py` — 保留重复 `Set-Cookie`，DNS 结果优先 IPv4。
- Modify: `server/app/config.py` — `feed_common_enabled`、RunSignup 国家/并发/间隔/窗口配置。
- Modify: `server/app/routers/feeds.py` — `/feeds/calendar`、`/feeds/data-panels`、`/feeds/common/{key}/refresh`。
- Create: `server/tests/test_common_sources.py` — 解析、合并、节日、国家列表测试。
- Modify: `server/tests/test_feeds.py` — 刷新、日历、数据栏、冷却 API 测试。
- Modify: `web-react/src/feeds/api.ts` — 新接口类型与请求函数。
- Create: `web-react/src/feeds/CalendarDashboard.tsx` — 页面容器、查询、刷新。
- Create: `web-react/src/feeds/CalendarGrid.tsx` — 月历网格与当天详情。
- Create: `web-react/src/feeds/DataPanels.tsx` — 数据 1–4 区块。
- Modify: `web-react/src/pages/Feeds.tsx` — 第三个页签改名“日历”，渲染 `CalendarDashboard`。
- Delete: `web-react/src/feeds/CommonPanel.tsx` — 不再使用。

---

### Task 1: public_http 支持重复 Set-Cookie 并优先 IPv4

**Files:**
- Modify: `server/app/services/public_http.py`
- Test: `server/tests/test_public_http.py` (new)

**Interfaces:**
- Produces: `PublicResponse.set_cookies: list[str]`
- Produces: `public_target(url) -> tuple[parts, port, address]` 在多个 DNS 结果中优先 IPv4。
- Produces: `read_set_cookies(response) -> list[str]`

- [ ] **Step 1: Write the failing tests**

```python
import socket
from types import SimpleNamespace

from app.services.public_http import public_target, read_set_cookies


def test_set_cookie_values_are_not_collapsed():
    response = SimpleNamespace(getheaders=lambda: [
        ("Set-Cookie", "_m_h5_tk=abc_123; Path=/"),
        ("Set-Cookie", "_m_h5_tk_enc=xyz; Path=/"),
    ])
    assert read_set_cookies(response) == [
        "_m_h5_tk=abc_123; Path=/",
        "_m_h5_tk_enc=xyz; Path=/",
    ]


def test_public_target_prefers_ipv4(monkeypatch):
    infos = [
        (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2606:2800:220:1:248:1893:25c8:1946", 443, 0, 0)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
    ]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: infos)
    _, _, address = public_target("https://example.com/")
    assert address == "93.184.216.34"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pytest tests/test_public_http.py -q`
Expected: FAIL — `read_set_cookies` 不存在，`set_cookies` 字段不存在。

- [ ] **Step 3: Implement**

在 `PublicResponse` 增加 `set_cookies: list[str] = field(default_factory=list)`（`from dataclasses import field`）。
新增：

```python
def read_set_cookies(response) -> list[str]:
    return [value for key, value in response.getheaders() if key.lower() == "set-cookie"]
```

`public_target` 返回前把已校验地址按 IPv4 优先排序：

```python
addresses.sort(key=lambda value: ipaddress.ip_address(value).version != 4)
return parts, port, addresses[0]
```

`fetch_public` 构造 `PublicResponse` 时传入 `set_cookies=read_set_cookies(response)`（304 分支也传）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pytest tests/test_public_http.py -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/app/services/public_http.py server/tests/test_public_http.py
git commit -m "fix: preserve set-cookie values and prefer ipv4"
```

---

### Task 2: 解析 Alibaba、1688、RunSignup 和美国节日

**Files:**
- Create: `server/app/services/common_sources.py`
- Test: `server/tests/test_common_sources.py`

**Interfaces:**
- Produces: `RUNSIGNUP_COUNTRIES: tuple[str, ...]`，至少 200 个 ISO 3166-1 alpha-2 代码。
- Produces: `RUNSIGNUP_US_STATES: tuple[str, ...]`，50 州 + DC。
- Produces: `COMMON_SOURCES: dict[str, dict]`，键为 `alibaba-rules`、`1688-rules`、`runsignup`；每项含 `key/title/platform/url/note/interval/data_kind/fetch`。
- Produces: `parse_alibaba(payload: dict) -> list[dict]`
- Produces: `parse_1688(payload: dict) -> list[dict]`
- Produces: `parse_1688_cookies(values: list[str]) -> dict[str, str]`
- Produces: `sign_1688(token: str, timestamp: int, data: str, app_key: str = "12574478") -> str`
- Produces: `parse_runsignup(html: bytes | str, country: str, start: date, end: date) -> list[dict]`
- Produces: `us_holidays(start: date, end: date) -> list[dict]`

**条目形状（规则）：** `{"title","url","published_at","badge","summary"}`；`published_at` 为 `datetime` 或 `None`。
**条目形状（赛事）：** `{"kind":"race","date":"YYYY-MM-DD","title","url","country","city","distance"}`。
**条目形状（节日）：** `{"kind":"holiday","date":"YYYY-MM-DD","title","url"}`。

- [ ] **Step 1: Write the failing parser tests**

```python
import hashlib
import json
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.services import common_sources
from app.services.common_sources import (
    RUNSIGNUP_COUNTRIES, RUNSIGNUP_US_STATES, parse_1688, parse_1688_cookies,
    parse_alibaba, parse_runsignup, us_holidays,
)
from app.services.feed_parsers import FeedParseError


def test_parse_alibaba_uses_latest_order_and_detail_url():
    payload = {"model": [
        {"ruleId": 1001, "ruleTitle": "禁止向欧盟销售食品仿制品", "modifiedTime": 1793931200000,
         "category": {"categoryName": "商品发布"}},
        {"ruleId": 1002, "ruleTitle": "第二条规定", "modifiedTime": 1793844800000,
         "category": {"categoryName": "交易履约"}},
    ]}
    rows = parse_alibaba(payload)
    assert [row["title"] for row in rows] == ["禁止向欧盟销售食品仿制品", "第二条规定"]
    assert rows[0]["url"] == "https://rule.alibaba.com/rule/detail/1001.htm"
    assert rows[0]["badge"] == "商品发布"
    assert rows[0]["published_at"] == datetime(2026, 11, 6, 0, 0)


def test_parse_alibaba_skips_incomplete_rows():
    assert parse_alibaba({"model": [{"ruleTitle": "缺 id"}, {"ruleId": 2}]}) == []


def test_parse_1688_reads_ret_and_string_modified_time():
    payload = {"ret": ["SUCCESS::success"], "data": {"model": [{
        "ruleId": "20010941", "ruleTitle": "服务商流量分发规则变更",
        "modifiedTime": "2026-09-28 17:56:08",
        "lastCategoryName": "更新公示", "lastCategoryId": "3044",
    }]}}
    rows = parse_1688(payload)
    assert rows[0]["title"] == "服务商流量分发规则变更"
    assert rows[0]["badge"] == "更新公示"
    assert rows[0]["published_at"] == datetime(2026, 9, 28, 17, 56, 8)
    assert "ruleId=20010941" in rows[0]["url"]
    assert "cId=3044" in rows[0]["url"]
    with pytest.raises(FeedParseError) as error:
        parse_1688({"ret": ["FAIL_SYS_BIZPARAM_MISSED::缺少业务参数"], "data": {}})
    assert error.value.code == "1688_ERROR"


def test_parse_1688_cookies_keeps_token_and_enc():
    assert parse_1688_cookies([
        "_m_h5_tk=abc_1794673644525; Path=/",
        "_m_h5_tk_enc=xyz; Path=/",
    ]) == {"_m_h5_tk": "abc_1794673644525", "_m_h5_tk_enc": "xyz"}


def test_sign_1688_matches_mtop_algorithm():
    data = '{"pageIndex":1}'
    expected = hashlib.md5(f"abc&1700000000000&12574478&{data}".encode()).hexdigest()
    assert common_sources.sign_1688("abc", 1700000000000, data) == expected


def test_fetch_1688_rules_sends_both_cookies_and_signature(monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append((url, kwargs.get("headers", {})))
        if len(calls) == 1:
            return SimpleNamespace(status=200, body=b"{}", headers={}, set_cookies=[
                "_m_h5_tk=abc_1794673644525; Path=/", "_m_h5_tk_enc=xyz; Path=/",
            ])
        body = json.dumps({"ret": ["SUCCESS::success"], "data": {"model": [{
            "ruleId": "1", "ruleTitle": "规则", "modifiedTime": "2026-09-28 17:56:08",
            "lastCategoryName": "更新公示", "lastCategoryId": "2",
        }]}}).encode()
        return SimpleNamespace(status=200, body=body, headers={}, set_cookies=[])

    monkeypatch.setattr(common_sources, "fetch_public", fake)
    monkeypatch.setattr(common_sources.time, "time", lambda: 1700000000.0)
    assert common_sources.fetch_1688_rules()[0]["title"] == "规则"
    _, headers = calls[1]
    assert "_m_h5_tk=abc_1794673644525" in headers["Cookie"]
    assert "_m_h5_tk_enc=xyz" in headers["Cookie"]
    assert "sign=" in calls[1][0] and "data=" in calls[1][0]


def test_parse_runsignup_filters_promoted_and_out_of_range():
    html = b"""<html><body>
    <a class="rsuTileGrid__item rsuTileGrid__item--findRace" href="/Race/US/CA/Avalon/Turkey-Trot-5K">
      <div class="rsuTileGrid__item__content">
        <div class="fs-md-2">Turkey Trot 5K</div><div>Sat 11/14/26</div>
        <div>Avalon, CA</div><div><span>3.1 Miles</span><span>5K</span></div>
      </div>
    </a>
    <a class="rsuTileGrid__item rsuTileGrid__item--findRace" href="/Race/US/CA/Old">
      <div class="rsuTileGrid__item__content">
        <div class="fs-md-2">Old Race</div><div>Sun 11/1/26</div>
        <div>Los Angeles, CA</div><div><span>5K</span></div>
      </div>
    </a>
    </body></html>"""
    rows = parse_runsignup(html, "US", date(2026, 11, 14), date(2026, 12, 14))
    assert len(rows) == 1
    assert rows[0] == {
        "kind": "race", "date": "2026-11-14", "title": "Turkey Trot 5K",
        "url": "https://runsignup.com/Race/US/CA/Avalon/Turkey-Trot-5K",
        "country": "US", "city": "Avalon, CA", "distance": "3.1 Miles",
    }


def test_us_holidays_observes_independence_day_on_july_3():
    rows = us_holidays(date(2026, 7, 1), date(2026, 7, 31))
    assert [(row["date"], row["title"]) for row in rows] == [("2026-07-03", "独立日")]
    assert rows[0]["url"].startswith("https://www.timeanddate.com/holidays/us/")
    year = us_holidays(date(2026, 1, 1), date(2026, 12, 31))
    assert len(year) == 11


def test_country_list_covers_major_markets():
    assert len(RUNSIGNUP_COUNTRIES) >= 200
    assert {"US", "CA", "GB", "AU", "JP", "DE", "FR", "SG"} <= set(RUNSIGNUP_COUNTRIES)
    assert len(RUNSIGNUP_US_STATES) == 51
    assert {"CA", "NY", "TX", "FL", "DC"} <= set(RUNSIGNUP_US_STATES)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pytest tests/test_common_sources.py -q`
Expected: FAIL — `common_sources` 不存在。

- [ ] **Step 3: Implement `common_sources.py`**

- `RUNSIGNUP_COUNTRIES`：从 `https://runsignup.com/Races` 国家下拉的 `option value` 生成，保留大写 ISO2，按字母排序；用元组字面量写入文件。
- `RUNSIGNUP_US_STATES`：从同一页 `#raceSearchState` 的 `option value` 生成，50 州 + `DC`，按字母排序；用元组字面量写入文件。
- `parse_alibaba`：取 `payload["model"]`；`modifiedTime` 是 epoch 毫秒，用 `datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)`；跳过无 `ruleTitle`/`ruleId`/`modifiedTime` 的行；`badge = category.categoryName`。
- `parse_1688`：取 `payload["data"]["model"]`，兼容 `payload["data"]` 是列表；`ret` 首项不以 `SUCCESS` 开头时抛 `FeedParseError("1688_ERROR", ret[0])`；`modifiedTime` 是 `"YYYY-MM-DD HH:MM:SS"` 字符串，用 `parse_datetime`；`badge = lastCategoryName`；详情 URL 为 `https://rule.1688.com/?type=detail&ruleId={ruleId}&cId={lastCategoryId}#/rule/detail?ruleId={ruleId}&cId={lastCategoryId}`。
- `parse_1688_cookies`：把 `Set-Cookie` 列表按 `;` 前的 `name=value` 拆成 dict，保留重复名最后一个。
- `parse_runsignup`：BeautifulSoup `select("a.rsuTileGrid__item--findRace")`；取 `.rsuTileGrid__item__content`，标题 `.fs-md-2`，再取 content 的直接子 `div`（跳过标题）依次得到日期 `%a %m/%d/%y`、城市、距离（距离取该 div 内第一个 `span` 的文本）；日期不在 `[start, end]` 跳过；URL 用 `safe_http_url(urljoin("https://runsignup.com/", href))`，去掉 `utm_*` 查询参数，为空则跳过；按 `(date,title)` 排序去重，单次查询最多 30 条。
- `us_holidays`：只做 11 个联邦假日，标题和规则固定为：元旦 1/1、马丁·路德·金日 1 月第 3 个周一、总统日 2 月第 3 个周一、阵亡将士纪念日 5 月最后一个周一、六月节 6/19、独立日 7/4、劳动节 9 月第 1 个周一、哥伦布日 10 月第 2 个周一、退伍军人节 11/11、感恩节 11 月第 4 个周四、圣诞节 12/25。周六观察日提前到周五，周日推迟到周一；按 `start.year` 到 `end.year` 生成后按范围过滤（不向相邻年份补日，避免跨年观察日让同一年出现 12 条）；URL 用 `https://www.timeanddate.com/holidays/us/{slug}`，slug 分别为 `new-year-day`、`martin-luther-king-jr-day`、`presidents-day`、`memorial-day`、`juneteenth`、`independence-day`、`labor-day`、`columbus-day`、`veterans-day`、`thanksgiving-day`、`christmas-day`。
- `fetch_alibaba_rules()`：`GET https://rulechannel.alibaba.com/rulechannel/newrule/rule/latest?terminal=PC&pageIndex=1&pageSize=10&language=zh_CN`；`fetch_public` 带浏览器 UA；`json.loads` 失败抛 `FeedParseError("BAD_ALIBABA_JSON", ...)`；成功返回 `parse_alibaba(payload)`。
- `sign_1688`：`hashlib.md5(f"{token}&{timestamp}&{app_key}&{data}".encode()).hexdigest()`。
- `fetch_1688_rules()`：先 GET `https://h5api.m.taobao.com/h5/mtop.alibaba.rulechannel.newrule.rule.list/1.0/?jsv=2.7.5&appKey=12574478`，用 `parse_1688_cookies(response.set_cookies)` 同时保留 `_m_h5_tk` 和 `_m_h5_tk_enc`；签名 token 取 `_m_h5_tk` 第一个下划线前的部分。`data` 用 `json.dumps` 生成完整参数（`pageIndex/pageSize/lastCategoryId/parentCategoryId/identityCode/terminal/buCode`，`ensure_ascii=False,separators=(",",":")`）；`t = int(time.time()*1000)`；`sign = sign_1688(token, t, data)`；第二次请求带 `Cookie: _m_h5_tk=...; _m_h5_tk_enc=...`、`jsv/appKey/t/sign/data`（`data` 用 `urlencode`），`Referer: https://rule.1688.com/`；返回 `parse_1688(payload)`。
- `COMMON_SOURCES`：`alibaba-rules` `{title:"阿里国际站规则",platform:"Alibaba.com",url:"https://rulechannel.alibaba.com/icbu",note:"公开规则与公告",interval:3600,data_kind:"rules",fetch:fetch_alibaba_rules}`；`1688-rules` 同理 `{title:"1688 规则中心",platform:"1688",url:"https://rule.1688.com/",interval:3600,data_kind:"rules",fetch:fetch_1688_rules}`；`runsignup` `{title:"RunSignup 全球赛事",platform:"RunSignup",url:"https://runsignup.com/Races",interval:21600,data_kind:"races",fetch:None}`，由 Task 4 用配置覆盖间隔并特殊处理。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pytest tests/test_common_sources.py -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/app/services/common_sources.py server/tests/test_common_sources.py
git commit -m "feat: parse common sources and us holidays"
```

---

### Task 3: RunSignup 全球抓取与按国家合并

**Files:**
- Modify: `server/app/services/common_sources.py`
- Modify: `server/app/config.py`
- Test: `server/tests/test_common_sources.py`

**Interfaces:**
- Produces: `runsignup_countries() -> tuple[str, ...]`，读取 `settings.feed_runsignup_countries`，`all`/空返回全量，逗号分隔返回子集。
- Produces: `fetch_runsignup_country(country: str, start: date, end: date, state: str | None = None) -> list[dict]`
- Produces: `fetch_runsignup_all(start: date, end: date, countries: tuple[str, ...] | None = None, concurrency: int = 8) -> tuple[dict[str, list[dict] | None], int]`，结果按国家聚合；US 由 51 个州查询合并。
- Produces: `merge_runsignup_entries(previous: list[dict], results: dict[str, list[dict] | None]) -> list[dict]`

**Config 新增：**

```python
feed_common_enabled: bool = True
feed_runsignup_countries: str = "all"
feed_runsignup_concurrency: int = Field(default=8, ge=1, le=16)
feed_runsignup_interval_seconds: int = Field(default=21600, ge=3600, le=86400)
feed_runsignup_window_days: int = Field(default=90, ge=30, le=365)
```

- [ ] **Step 1: Write the failing merge/fetch tests**

```python
from app.services import common_sources


def test_merge_keeps_failed_country_and_replaces_success(monkeypatch):
    previous = [
        {"kind": "race", "date": "2026-11-14", "title": "Old US", "country": "US", "url": "u1", "city": "", "distance": ""},
        {"kind": "race", "date": "2026-11-15", "title": "Old CA", "country": "CA", "url": "u2", "city": "", "distance": ""},
    ]
    results = {
        "US": [{"kind": "race", "date": "2026-11-14", "title": "New US", "country": "US", "url": "u3", "city": "", "distance": ""}],
        "CA": None,
    }
    merged = common_sources.merge_runsignup_entries(previous, results)
    assert [row["title"] for row in merged] == ["New US", "Old CA"]


def test_merge_clears_country_with_empty_success():
    previous = [{"kind": "race", "date": "2026-11-14", "title": "Old US", "country": "US", "url": "u1", "city": "", "distance": ""}]
    merged = common_sources.merge_runsignup_entries(previous, {"US": []})
    assert merged == []


def test_fetch_runsignup_all_isolates_country_failure(monkeypatch):
    def fake(country, start, end, state=None):
        if country == "CA":
            return [{"kind": "race", "date": "2026-11-14", "title": "CA Race", "country": "CA", "url": "u", "city": "", "distance": ""}]
        raise RuntimeError("boom")

    monkeypatch.setattr(common_sources, "fetch_runsignup_country", fake)
    results, failures = common_sources.fetch_runsignup_all(
        date(2026, 11, 14), date(2026, 12, 14), countries=("CA", "GB"), concurrency=2,
    )
    assert results["CA"][0]["title"] == "CA Race"
    assert results["GB"] is None
    assert failures == 1


def test_fetch_runsignup_all_queries_us_states(monkeypatch):
    calls = []

    def fake(country, start, end, state=None):
        calls.append((country, state))
        return [{"kind": "race", "date": "2026-11-14", "title": f"US {state}", "country": "US", "url": state, "city": "", "distance": ""}]

    monkeypatch.setattr(common_sources, "fetch_runsignup_country", fake)
    monkeypatch.setattr(common_sources, "RUNSIGNUP_US_STATES", ("CA", "NY"))
    results, failures = common_sources.fetch_runsignup_all(
        date(2026, 11, 14), date(2026, 12, 14), countries=("US",), concurrency=2,
    )
    assert set(calls) == {("US", "CA"), ("US", "NY")}
    assert [row["title"] for row in results["US"]] == ["US CA", "US NY"]
    assert failures == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pytest tests/test_common_sources.py -q`
Expected: FAIL — 函数不存在。

- [ ] **Step 3: Implement**

- `runsignup_countries()`：解析配置；`all`/空返回 `RUNSIGNUP_COUNTRIES`；逗号分隔时只保留常量里存在的代码。
- `fetch_runsignup_country`：参数为 `country`、`start_date`、`end_date`，`state` 非空时再加 `state`；`urlencode` 后拼 `https://runsignup.com/Races?`；`fetch_public` 带浏览器 UA；返回 `parse_runsignup(body, country, start, end)`。
- `fetch_runsignup_all`：把 US 展开成 `RUNSIGNUP_US_STATES` 的 51 个 `(US, state)` 任务，其他国家各一个 `(country, None)` 任务；`ThreadPoolExecutor(max_workers=concurrency)` 并发执行；US 的 51 个结果全部成功才按 `(date,title)` 排序聚合成 `results["US"]`，任一州失败则 `results["US"] = None` 且只把 US 计一次失败；其他国家异常记 `None`。返回 `(results, failure_count)`，日志记录失败国家，不抛出单国异常。
- `merge_runsignup_entries`：以 `country` 分组；`None` 保留旧条目，`[]` 删除旧条目，列表替换；最后按 `(date,title)` 排序，最多保留 1000 条。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pytest tests/test_common_sources.py -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/app/services/common_sources.py server/app/config.py server/tests/test_common_sources.py
git commit -m "feat: fetch and merge worldwide runsignup races"
```

---

### Task 4: 通用源刷新、快照、冷却和调度

**Files:**
- Modify: `server/app/services/feed_service.py`
- Modify: `server/app/services/common_sources.py`
- Test: `server/tests/test_feeds.py`

**Interfaces:**
- Produces: `refresh_common_source(key: str, force: bool = False) -> dict`
- Produces: `request_common_refresh(keys: list[str], force: bool) -> tuple[list[str], list[str]]`
- Produces: `run_common_refresh(keys: list[str], force: bool) -> None`
- Produces: `common_due_keys(db: Session) -> list[str]`
- Produces: `common_cooldown_remaining(db: Session, key: str, seconds: int = 60) -> int`
- Produces: `common_payload(db: Session) -> dict`，含 `sources` 和 `links`。

- [ ] **Step 1: Write the failing refresh tests**

```python
def test_common_empty_payload_keeps_previous_snapshot(db, monkeypatch):
    from app.models import FeedSnapshot
    from app.services import common_sources, feed_service

    db.add(FeedSnapshot(source_id="common:alibaba-rules", entries=[{
        "title": "旧规则", "url": "https://rule.alibaba.com/rule/detail/1.htm", "published_at": None,
        "badge": "", "summary": "",
    }], provider="Alibaba", provider_note="", consecutive_failures=0))
    db.commit()
    monkeypatch.setitem(common_sources.COMMON_SOURCES, "alibaba-rules", {
        **common_sources.COMMON_SOURCES["alibaba-rules"], "fetch": lambda: [],
    })
    result = feed_service.refresh_common_source("alibaba-rules", force=True)
    assert result["status"] == "failed"
    db.expire_all()
    row = db.get(FeedSnapshot, "common:alibaba-rules")
    assert row.entries[0]["title"] == "旧规则"
    assert row.last_error == "来源返回空数据"


def test_common_cooldown_blocks_repeat_refresh(db):
    from app.models import FeedSnapshot, utcnow
    from app.services import feed_service

    db.add(FeedSnapshot(source_id="common:1688-rules", entries=[], consecutive_failures=0, last_attempt_at=utcnow()))
    db.commit()
    assert feed_service.common_cooldown_remaining(db, "1688-rules") > 0
    row = db.get(FeedSnapshot, "common:1688-rules")
    row.last_attempt_at = utcnow().replace(year=2020)
    db.commit()
    assert feed_service.common_cooldown_remaining(db, "1688-rules") == 0


def test_common_due_keys_includes_missing_and_due(db):
    from app.models import FeedSnapshot, utcnow
    from app.services import feed_service

    db.add(FeedSnapshot(source_id="common:1688-rules", entries=[], consecutive_failures=0, next_attempt_at=utcnow().replace(year=2020)))
    db.commit()
    keys = feed_service.common_due_keys(db)
    assert "1688-rules" in keys
    assert "alibaba-rules" in keys


def test_common_disabled_returns_disabled_status(db, monkeypatch):
    from app.services import feed_service

    monkeypatch.setattr(feed_service.settings, "feed_common_enabled", False)
    assert feed_service.refresh_common_source("alibaba-rules", force=True)["status"] == "disabled"
    assert feed_service.common_payload(db)["sources"][0]["entries"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pytest tests/test_feeds.py -q`
Expected: FAIL — 函数不存在。

- [ ] **Step 3: Implement**

- `_claim_snapshot` 增加可选参数 `lock_seconds: int | None = None`（默认沿用 `settings.feed_timeout_seconds + 15`），第一个返回值（state dict）增加 `"entries": row.entries`，不影响热榜调用方；调用方仍解包 `claim, state = _claim_snapshot(...)`。
- 新增 `_record_common_success(key, entries, provider, note, interval, upstream_updated_at=None)`：写 `entries`、`provider`、`provider_note`、`fetched_at`、`last_success_at`、`upstream_updated_at`，清 `last_error`、`next_attempt_at = now + interval`、清锁；使用 `_serialize_entry`。
- `refresh_common_source`：
  - 未知 key 抛 `ApiError("UNKNOWN_COMMON_SOURCE", ..., 404)`。
  - `settings.feed_common_enabled` 为 false 时直接返回 `{"key": key, "status": "disabled"}`，不抓取、不写快照。
  - `claim, state = _claim_snapshot(db, f"common:{key}", force, lock_seconds=600 if key == "runsignup" else 60)`；`state != "started"` 返回 `{"key": key, "status": state}`（RunSignup 全球抓取可能超过默认 27 秒锁）。
  - `runsignup`：`start = date.today()`，`end = start + timedelta(days=settings.feed_runsignup_window_days)`；`results, failures = fetch_runsignup_all(start, end, concurrency=settings.feed_runsignup_concurrency)`；`successes = sum(v is not None for v in results.values())`；若 `successes == 0` 抛 `PublicHttpError("ALL_COUNTRIES_FAILED", ...)`；`entries = merge_runsignup_entries(claim["entries"], results)`；`note = f"{successes}/{len(results)} 个国家成功"`。
  - 其他 key：`entries = source["fetch"]()`；`provider/note` 用 `source["platform"]` 与 `source["note"]`。
  - `entries == []`：`_record_hot_failure(sid, "EMPTY_PAYLOAD", "来源返回空数据")`；返回 failed。
  - 成功：`_record_common_success(... interval)`；`runsignup` 的 interval 用 `settings.feed_runsignup_interval_seconds`，其余用 `source["interval"]`；返回 `{"key": key, "status": "updated", "entries": len(entries)}`。
  - 捕获 `PublicHttpError`/`FeedParseError`/`Exception`，复用热榜的失败记录与日志。
- `request_common_refresh`/`run_common_refresh`：仿照 hot，使用 `_reserve([f"common:{key}"])` / `_release`；`ThreadPoolExecutor(max_workers=min(3, len(keys)))`。
- `common_due_keys`：`COMMON_SOURCES` 全部 key，缺失快照或 `next_attempt_at` 为空/到期即返回；限制 10 个。
- `refresh_due_all` 末尾调用 `common_due_keys` + `run_common_refresh`；`settings.feed_common_enabled` 为 false 时跳过。
- `common_cooldown_remaining`：读 `common:<key>` 的 `last_attempt_at`，返回剩余秒数（向上取整，0 表示可用）。
- `common_payload`：为每个 key 返回 `{key,title,platform,url,note,data_kind,status,entries,last_success_at,last_error,interval_seconds}`；`entries` 仅在 `feed_common_enabled` 且 `last_success_at` 存在时返回；`status` 在关闭时为 `disabled`，否则用 `_source_status(row)`；`links` 为 TEMU/Pinterest/RunSignup 入口。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pytest tests/test_feeds.py -q`
Expected: PASS（包括原有热榜/订阅测试）。

- [ ] **Step 5: Commit**

```bash
git add server/app/services/feed_service.py server/app/services/common_sources.py server/tests/test_feeds.py
git commit -m "feat: refresh common snapshots with cooldown and merge"
```

---

### Task 5: 日历与数据栏 API

**Files:**
- Modify: `server/app/routers/feeds.py`
- Modify: `server/app/services/feed_service.py`
- Test: `server/tests/test_feeds.py`

**Interfaces:**
- Produces: `calendar_payload(db: Session, start: date, end: date) -> dict`
- Produces: `data_panels_payload(db: Session, user_id: int) -> dict`
- Produces: `GET /api/v1/feeds/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`
- Produces: `GET /api/v1/feeds/data-panels`
- Produces: `POST /api/v1/feeds/common/{key}/refresh`

- [ ] **Step 1: Write the failing API tests**

```python
def test_calendar_endpoint_returns_races_and_holidays(auth, db):
    from datetime import date
    from app.models import FeedSnapshot, utcnow

    db.add(FeedSnapshot(source_id="common:runsignup", entries=[{
        "kind": "race", "date": "2026-11-14", "title": "Turkey Trot 5K",
        "url": "https://runsignup.com/Race/US/CA/Avalon/Turkey-Trot-5K",
        "country": "US", "city": "Avalon, CA", "distance": "3.1 Miles",
    }], provider="RunSignup", provider_note="", last_success_at=utcnow(), consecutive_failures=0))
    db.commit()
    response = auth.get("/api/v1/feeds/calendar?start=2026-11-01&end=2026-12-15")
    assert response.status_code == 200
    body = response.json()
    assert any(item["title"] == "Turkey Trot 5K" for item in body["events"])
    assert any(item["title"] == "感恩节" and item["date"] == "2026-11-26" for item in body["events"])
    assert body["status"] == "ok"


def test_calendar_rejects_range_over_62_days(auth):
    response = auth.get("/api/v1/feeds/calendar?start=2026-01-01&end=2026-06-01")
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_RANGE"


def test_calendar_marks_range_beyond_race_window(auth):
    from datetime import date, timedelta
    start = date.today() + timedelta(days=100)
    end = start + timedelta(days=10)
    body = auth.get(f"/api/v1/feeds/calendar?start={start}&end={end}").json()
    assert body["race_window_exceeded"] is True


def test_data_panels_endpoint_returns_subscriptions_rules_links(auth):
    body = auth.get("/api/v1/feeds/data-panels").json()
    assert "items" in body["subscriptions"]
    assert {row["key"] for row in body["rules"]} == {"alibaba-rules", "1688-rules"}
    assert {row["key"] for row in body["links"]} >= {"temu-seller", "pinterest-trends", "runsignup"}


def test_common_refresh_unknown_key_and_cooldown(auth, db):
    assert auth.post("/api/v1/feeds/common/nope/refresh").status_code == 404
    from app.models import FeedSnapshot, utcnow
    db.add(FeedSnapshot(source_id="common:1688-rules", entries=[], consecutive_failures=0, last_attempt_at=utcnow()))
    db.commit()
    response = auth.post("/api/v1/feeds/common/1688-rules/refresh")
    assert response.status_code == 202
    body = response.json()
    assert body["queued"] is False
    assert body["reason"] == "cooldown"
    assert body["retry_after"] > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pytest tests/test_feeds.py -q`
Expected: FAIL — 404/路由不存在。

- [ ] **Step 3: Implement payloads**

`calendar_payload`：
- `settings.feed_common_enabled` 为 false 时直接返回 `{start,end,events:[],status:"disabled",last_success_at:null,last_error:null,race_window_exceeded:false}`，不读快照、不生成节日。
- 读 `common:runsignup`；只取 `last_success_at` 存在且 `settings.feed_common_enabled` 为 true 的条目，按 `start.isoformat() <= date <= end.isoformat()` 过滤。
- `events = race_entries + us_holidays(start, end)`；按 `(date, kind, title)` 排序。
- 返回 `{start,end,events,status,last_success_at,last_error,race_window_exceeded}`；`race_window_exceeded = end > date.today() + timedelta(days=settings.feed_runsignup_window_days)`。

`data_panels_payload`：
- `entries = list_entries(db, user_id, limit=30)`；`items = sorted(entries["items"], key=lambda item: item["read"])`（未读优先，组内保持时间倒序）。
- 未读数：`select(func.count(FeedEntry.id)).join(FeedSubscription).where(user_id, deleted_at is null, read_at is null)`。
- `rules` 从 `common_payload(db)["sources"]` 取 `alibaba-rules`、`1688-rules`。
- `links` 从 `COMMON_GROUPS` 取 `temu-seller`、`pinterest-trends`、`runsignup`，加中文 badge（需登录 / 服务器不可达 / 官方入口）。
- 返回 `{subscriptions:{items,total,unread}, rules, links}`，其中 `items` 是上面排序后的列表。

- [ ] **Step 4: Implement routes**

- `GET /feeds/calendar`：`start: date`, `end: date` 查询参数；`end < start` 或 `(end-start).days > 62` 抛 `ApiError("INVALID_RANGE", "日期范围最多 62 天", 422)`。
- `GET /feeds/data-panels`：依赖 `get_current_user` + `get_db`。
- `POST /feeds/common/{key}/refresh`：`feed_enabled` 或 `feed_common_enabled` 关闭返回 409 `FEED_DISABLED`；未知 key 404；`common_cooldown_remaining` > 0 返回 202 `{"queued": false, "reason": "cooldown", "retry_after": remaining}`；否则 `request_common_refresh([key], True)` + `background.add_task`，返回 `{"queued": true}` 或 `{"queued": false, "reason": "joined"}`。
- `GET /feeds/common` 保留 `groups`/`note`，`note` 改为“公开数据自动刷新；需要登录的入口在浏览器打开。”，增加 `sources: service.common_payload(db)["sources"]`，保证旧测试仍通过。

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && pytest tests/test_feeds.py -q`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add server/app/routers/feeds.py server/app/services/feed_service.py server/tests/test_feeds.py
git commit -m "feat: add calendar and data panel APIs"
```

---

### Task 6: 前端 API 类型与请求函数

**Files:**
- Modify: `web-react/src/feeds/api.ts`

**Interfaces:**
- Produces: `CalendarEvent`, `CalendarPayload`, `RuleSource`, `DataPanelsPayload`
- Produces: `getCalendar(start: string, end: string): Promise<CalendarPayload>`
- Produces: `getDataPanels(): Promise<DataPanelsPayload>`
- Produces: `refreshCommon(key: string): Promise<{ queued: boolean; reason?: string; retry_after?: number }>`

- [ ] **Step 1: Add types and functions**

```ts
export interface CalendarEvent {
  kind: 'race' | 'holiday'
  date: string
  title: string
  url: string
  country?: string
  city?: string
  distance?: string
}

export interface CalendarPayload {
  start: string
  end: string
  events: CalendarEvent[]
  status: string
  last_success_at: string | null
  last_error: string | null
  race_window_exceeded: boolean
}

export interface RuleSource {
  key: string
  title: string
  platform: string
  url: string
  note: string
  status: string
  entries: { title: string; url: string; published_at: string | null; badge: string; summary: string }[]
  last_success_at: string | null
  last_error: string | null
}

export interface DataPanelsPayload {
  subscriptions: { items: FeedEntry[]; total: number; unread: number }
  rules: RuleSource[]
  links: { key: string; title: string; url: string; badge: string }[]
}

export async function getCalendar(start: string, end: string): Promise<CalendarPayload> {
  return (await http.get('/feeds/calendar', { params: { start, end } })).data
}

export async function getDataPanels(): Promise<DataPanelsPayload> {
  return (await http.get('/feeds/data-panels')).data
}

export async function refreshCommon(key: string): Promise<{ queued: boolean; reason?: string; retry_after?: number }> {
  return (await http.post(`/feeds/common/${key}/refresh`)).data
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web-react && npm run typecheck`
Expected: PASS（新类型未被使用前也应通过）。

- [ ] **Step 3: Commit**

```bash
git add web-react/src/feeds/api.ts
git commit -m "feat: add calendar and data panel api types"
```

---

### Task 7: 日历网格与数据栏组件

**Files:**
- Create: `web-react/src/feeds/CalendarGrid.tsx`
- Create: `web-react/src/feeds/DataPanels.tsx`
- Create: `web-react/src/feeds/CalendarDashboard.tsx`
- Modify: `web-react/src/pages/Feeds.tsx`
- Delete: `web-react/src/feeds/CommonPanel.tsx`

**Interfaces:**
- `CalendarGrid` props: `{ month: Date; events: CalendarEvent[]; onMonthChange: (next: Date) => void; onRefresh: () => void; status: string; loading: boolean }`
- `CalendarDashboard` 自己取 42 天范围并渲染 5 区块网格；同时只取一次 `getDataPanels()`，把结果传给 4 个 `DataPanels`。
- `DataPanels` props: `{ section: 'subscriptions' | 'alibaba' | '1688' | 'links'; data: DataPanelsPayload | undefined; loading: boolean; onRefresh: () => void; refreshing: boolean }`

- [ ] **Step 1: Implement `CalendarGrid.tsx`**

- 周一为一周第一天；生成 `42` 个日期（月历 6 行）。
- 顶部：`YYYY年M月`、上月/下月/今天按钮、`StatusChip`、刷新按钮。
- 7 列星期头：一 二 三 四 五 六 日。
- 日期格：当天日期数字；最多 2 个 chip（赛事 `country · title`，节日 `title`）；超出显示 `+N`。
- 点击日期格打开 `Dialog`，列出当天全部条目，标题可点外链。
- 导出 `formatDateLocal(date: Date): string`，用 `getFullYear/getMonth+1/getDate` 补零生成 `YYYY-MM-DD`，禁止 `toISOString()`（避免 UTC 偏移）。
- 高亮今天；非本月日期淡化。
- 标题栏下方一行小字：“RunSignup 覆盖因国家而异，部分国家暂无赛事”。

- [ ] **Step 2: Implement `DataPanels.tsx`**

- 不自己取数，按 `section` 渲染：
  - `subscriptions`：订阅文章列表，未读圆点、来源、`relativeTime`；底部“查看全部”跳 `/feeds?tab=subscriptions`。
  - `alibaba` / `1688`：对应 `data.rules` 条目，`StatusChip` + 相对时间；失败保留旧条目；空态写明“上游暂无更新”。
  - `links`：入口卡片（TEMU/Pinterest/RunSignup），badge 用 `Chip`；右上“刷新全部”按钮。
- 每个区块 `Paper variant="outlined"`，标题栏 + 可滚动正文；标题栏右侧一个刷新图标按钮调用 `onRefresh`（数据 1 刷新订阅，数据 2/3 刷新对应规则，数据 4 刷新全部）；空态用 `EmptyHint`。

- [ ] **Step 3: Implement `CalendarDashboard.tsx`**

- 状态：`month`（当月 1 日）、`refreshing`。
- 从 `./CalendarGrid` 导入 `formatDateLocal`；在 `CalendarDashboard.tsx` 内定义 `monthGridRange(month: Date)`：以周一为第一天，`offset = (first.getDay() + 6) % 7`，start 往前 `offset` 天，end 为 start + 41 天，返回 `{start, end}` 两个 `YYYY-MM-DD` 字符串。
- `const range = monthGridRange(month)`；`useQuery(['feeds','calendar',range.start,range.end], () => getCalendar(range.start, range.end))`；`useQuery(['feeds','data-panels'], getDataPanels)`。
- `refresh` mutation：并行 `refreshCommon('runsignup')`、`refreshCommon('alibaba-rules')`、`refreshCommon('1688-rules')`、`refreshSubscriptions(undefined, true)`；有 `cooldown` 时 toast 提示；成功后 3 秒和 8 秒各 invalidate 一次两个 query（后台刷新是异步的）。
- 布局（桌面）：
  ```tsx
  gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.9fr)'
  gridTemplateRows: 'minmax(0, 1.8fr) minmax(0, 0.9fr)'
  gridTemplateAreas: '"calendar calendar data1" "data2 data3 data4"'
  ```
  窄屏 `gridTemplateColumns: '1fr'`、`gridTemplateAreas: '"calendar" "data1" "data2" "data3" "data4"'`，整页可滚动。
- 渲染 `CalendarGrid`（area calendar，`onRefresh={() => refreshCommon('runsignup')}`）和四个 `DataPanels`（section 分别为 `subscriptions`/`alibaba`/`1688`/`links`，各自放在 data1/data2/data3/data4 的 `Box` 里）。
- 每个 `DataPanels` 的 `onRefresh`：数据 1 调 `refreshSubscriptions(undefined, true)`；数据 2/3 调 `refreshCommon('alibaba-rules'|'1688-rules')`；数据 4 调 `refreshAll`。`refreshCommon` 返回 `cooldown` 时 toast 展示 `retry_after`。

- [ ] **Step 4: Integrate into Feeds.tsx**

- `TABS` 第三项改为 `{ key: 'calendar', label: '日历' }`。
- `tab` 解析改为：`const requested = params.get('tab'); const tab = requested === 'sources' ? 'calendar' : TABS.some((item) => item.key === requested) ? requested! : 'hot'`，避免旧书签落到热榜。
- 删除 `CommonPanel` import，改为 `CalendarDashboard`。
- 渲染：`tab === 'hot' ? <HotPanel /> : tab === 'subscriptions' ? <SubscriptionsPanel /> : <CalendarDashboard />`。
- 删除 `CommonPanel.tsx`（`rm web-react/src/feeds/CommonPanel.tsx`）。

- [ ] **Step 5: Typecheck and build**

Run: `cd web-react && npm run typecheck && npm run build`
Expected: PASS，无 TypeScript 错误。

- [ ] **Step 6: Commit**

```bash
git add web-react/src/feeds/CalendarGrid.tsx web-react/src/feeds/DataPanels.tsx web-react/src/feeds/CalendarDashboard.tsx web-react/src/pages/Feeds.tsx
git rm web-react/src/feeds/CommonPanel.tsx
git commit -m "feat: add calendar dashboard and data panels"
```

---

### Task 8: 全量验证与手工验收

**Files:** 无新增。

- [ ] **Step 1: Run backend tests**

Run: `cd server && pytest tests/test_common_sources.py tests/test_feeds.py tests/test_public_http.py -q`
Expected: PASS。

- [ ] **Step 2: Run frontend typecheck/build**

Run: `cd web-react && npm run typecheck && npm run build`
Expected: PASS。

- [ ] **Step 3: Manual smoke checklist**

- 打开 `/feeds?tab=calendar`，确认 5 区块布局：左上日历、右上订阅文章、底部三块规则/入口。
- 日历切上/下月，日期格显示赛事/节日；点 `+N` 打开当天详情。
- 数据 1 显示订阅文章；点标题打开原文；“查看全部”跳到订阅页。
- 数据 2/3 显示规则；刷新失败时保留旧数据并显示 `stale`。
- 点“刷新全部”，60 秒内再次点击提示冷却，不再打源。
- 缩窄窗口到移动宽度，区块纵向堆叠。
- 无历史赛事时日历只显示节日，不报错。

- [ ] **Step 4: Commit any fixes**

```bash
git add <only files changed by fixes>
git commit -m "fix: calendar dashboard smoke issues"
```
