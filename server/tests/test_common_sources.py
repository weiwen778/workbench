import hashlib
import json
from datetime import date, datetime
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from app.services import common_sources
from app.services.common_sources import (
    RUNSIGNUP_COUNTRIES, RUNSIGNUP_US_STATES, parse_1688, parse_1688_cookies,
    parse_alibaba, parse_runsignup, us_holidays,
)
from app.services.feed_parsers import FeedParseError


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


def test_fetch_runsignup_country_uses_start_date_end_date(monkeypatch):
    captured = {}

    def fake(url, **kwargs):
        captured["url"] = url
        return SimpleNamespace(body=b"<html></html>", headers={}, status=200)

    monkeypatch.setattr(common_sources, "fetch_public", fake)
    common_sources.fetch_runsignup_country("CA", date(2026, 11, 14), date(2026, 12, 14), state="NY")
    url = captured["url"]
    assert "country=CA" in url
    assert "start_date=2026-11-14" in url
    assert "end_date=2026-12-14" in url
    assert "state=NY" in url
    assert "start=2026-11-14" not in url
    assert "end=2026-12-14" not in url


def test_fetch_runsignup_all_counts_us_failure_once(monkeypatch):
    calls = []

    def fake(country, start, end, state=None):
        calls.append(state)
        if state == "CA":
            return [{"kind": "race", "date": "2026-11-14", "title": "CA Race", "country": "US", "url": "u1", "city": "", "distance": ""}]
        raise RuntimeError("boom")

    monkeypatch.setattr(common_sources, "RUNSIGNUP_US_STATES", ("CA", "NY"))
    monkeypatch.setattr(common_sources, "fetch_runsignup_country", fake)
    results, failures = common_sources.fetch_runsignup_all(
        date(2026, 11, 14), date(2026, 12, 14), countries=("US",), concurrency=2,
    )
    assert [row["title"] for row in results["US"]] == ["CA Race"]
    assert failures == 1


def test_fetch_runsignup_all_us_none_when_all_states_fail(monkeypatch):
    def fake(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(common_sources, "RUNSIGNUP_US_STATES", ("CA", "NY"))
    monkeypatch.setattr(common_sources, "fetch_runsignup_country", fake)
    results, failures = common_sources.fetch_runsignup_all(
        date(2026, 11, 14), date(2026, 12, 14), countries=("US",), concurrency=2,
    )
    assert results["US"] is None
    assert failures == 1


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
    assert rows[0]["published_at"] == datetime(2026, 11, 6, 2, 13, 20)


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


def test_fetch_1688_rules_uses_exact_mtop_business_payload(monkeypatch):
    calls = []

    def fake(url, **kwargs):
        calls.append(url)
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
    rows = common_sources.fetch_1688_rules()
    assert rows[0]["title"] == "规则"
    api_url = calls[1]
    data_param = parse_qs(urlparse(api_url).query)["data"][0]
    payload = json.loads(data_param)
    assert payload["identityCode"] == "4"
    assert payload["buCode"] == 333
    assert payload["lastCategoryId"] is None
    assert payload["parentCategoryId"] is None
    assert payload["pageIndex"] == 1
    assert payload["pageSize"] == 10
    assert payload["terminal"] == "PC"


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
