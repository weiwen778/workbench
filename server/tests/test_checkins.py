from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from app.services.periods import period_bounds
from app.utils import today_local


def make_target(client, kind="shop", name="天猫店"):
    resp = client.post("/api/v1/work-targets", json={"kind": kind, "name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_group(client, name="订单处理"):
    resp = client.post("/api/v1/checkin-groups", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_rule(client, target_id, group_id, title="检查订单", period="daily"):
    resp = client.post(
        f"/api/v1/work-targets/{target_id}/rules",
        json={"group_id": group_id, "title": title, "period": period},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def list_today(client, kind="shop", period="daily", status="all"):
    resp = client.get(f"/api/v1/checkin-instances?kind={kind}&period={period}&status={status}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def all_items(payload):
    return [item for group in payload["groups"] for item in group["items"]]


# ---------------------------------------------------------------- 周期计算


def test_period_bounds_are_calendar_based():
    assert period_bounds("daily", date(2026, 10, 25)) == (date(2026, 10, 25), date(2026, 10, 26))
    # 2026-10-25 是周日，本周从 10-19（周一）开始
    assert period_bounds("weekly", date(2026, 10, 25)) == (date(2026, 10, 19), date(2026, 10, 26))
    # 自然月，不是固定 30 天
    assert period_bounds("monthly", date(2026, 2, 10)) == (date(2026, 2, 1), date(2026, 3, 1))
    assert period_bounds("monthly", date(2026, 12, 31)) == (date(2026, 12, 1), date(2027, 1, 1))


def test_new_target_and_rule_appear_in_current_period(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])

    payload = list_today(auth)
    items = all_items(payload)
    assert len(items) == 1
    assert items[0]["title"] == "检查订单"
    assert items[0]["completed"] is False
    assert payload["statistics"]["total"] == 1


def test_weekly_rule_added_midweek_enters_current_week(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"], title="每周盘点", period="weekly")

    payload = list_today(auth, period="weekly")
    assert len(all_items(payload)) == 1
    item = all_items(payload)[0]
    assert item["period_type"] == "weekly"
    assert date.fromisoformat(item["period_start"]).weekday() == 0


def test_repeated_reads_do_not_duplicate(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    for _ in range(3):
        assert len(all_items(list_today(auth))) == 1


def test_complete_is_idempotent_and_keeps_time(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    item = all_items(list_today(auth))[0]

    first = auth.post(f"/api/v1/checkin-instances/{item['id']}/complete", json={"note": "今天没有新订单"})
    assert first.status_code == 200
    first_time = first.json()["completed_at"]
    assert first_time

    second = auth.post(f"/api/v1/checkin-instances/{item['id']}/complete", json={})
    assert second.status_code == 200
    assert second.json()["completed_at"] == first_time
    assert second.json()["note"] == "今天没有新订单"

    payload = list_today(auth)
    assert payload["statistics"]["completed"] == 1
    assert payload["statistics"]["rate"] == 100


def test_cancel_clears_time_but_keeps_note_and_syncs_latest_requirement(auth):
    target = make_target(auth)
    group = make_group(auth)
    rule = make_rule(auth, target["id"], group["id"], title="检查订单")
    item = all_items(list_today(auth))[0]
    auth.post(f"/api/v1/checkin-instances/{item['id']}/complete", json={"note": "无新订单"})

    # 修改已完成事项：当前记录保留完成时内容
    auth.patch(f"/api/v1/checkin-rules/{rule['id']}", json={"title": "检查订单并核对退款"})
    completed_item = all_items(list_today(auth))[0]
    assert completed_item["title"] == "检查订单"

    cancel = auth.post(f"/api/v1/checkin-instances/{item['id']}/cancel")
    assert cancel.status_code == 200
    body = cancel.json()
    assert body["completed"] is False
    assert body["completed_at"] is None
    assert body["note"] == "无新订单"
    assert body["title"] == "检查订单并核对退款"


def test_unfinished_instance_updates_immediately_and_moves_group(auth):
    target = make_target(auth)
    group = make_group(auth)
    other_group = make_group(auth, "内容发布")
    rule = make_rule(auth, target["id"], group["id"])

    auth.patch(
        f"/api/v1/checkin-rules/{rule['id']}",
        json={"title": "检查订单和售后", "group_id": other_group["id"]},
    )
    payload = list_today(auth)
    assert [g["group_name"] for g in payload["groups"]] == ["内容发布"]
    assert all_items(payload)[0]["title"] == "检查订单和售后"


def test_ended_period_is_locked_and_cannot_be_completed(auth, db):
    from app.models import CheckinInstance

    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    item = all_items(list_today(auth))[0]

    inst = db.get(CheckinInstance, item["id"])
    yesterday = today_local() - timedelta(days=1)
    inst.period_start = yesterday - timedelta(days=1)
    inst.period_end = yesterday
    db.commit()

    payload = list_today(auth)
    assert all_items(payload)[0]["locked"] is False  # 今天的新实例仍然可做

    resp = auth.post(f"/api/v1/checkin-instances/{item['id']}/complete", json={})
    assert resp.status_code == 409
    assert resp.json()["code"] == "PERIOD_LOCKED"

    history = auth.get("/api/v1/checkin-instances/history?kind=shop&period=daily").json()
    old = next(i for i in history["items"] if i["id"] == item["id"])
    assert old["locked"] is True
    assert old["completed"] is False


def test_statistics_rate_is_null_when_no_items(auth):
    make_target(auth)
    payload = list_today(auth)
    assert payload["statistics"]["total"] == 0
    assert payload["statistics"]["rate"] is None


def test_status_filter_and_target_filter(auth):
    t1 = make_target(auth, name="天猫店")
    t2 = make_target(auth, name="小红书店")
    group = make_group(auth)
    make_rule(auth, t1["id"], group["id"], title="订单A")
    make_rule(auth, t2["id"], group["id"], title="订单B")

    items = all_items(list_today(auth))
    assert len(items) == 2
    # 同一分组里聚合两个店铺
    assert list_today(auth)["groups"][0]["total"] == 2

    auth.post(f"/api/v1/checkin-instances/{items[0]['id']}/complete", json={})
    pending = list_today(auth, status="pending")
    assert len(all_items(pending)) == 1
    done = list_today(auth, status="done")
    assert len(all_items(done)) == 1

    only_t2 = auth.get(
        f"/api/v1/checkin-instances?kind=shop&period=daily&target_id={t2['id']}"
    ).json()
    assert {i["target_id"] for i in all_items(only_t2)} == {t2["id"]}


def test_social_and_shop_are_separate(auth):
    shop = make_target(auth, kind="shop", name="天猫店")
    social = make_target(auth, kind="social", name="小红书号")
    group = make_group(auth)
    make_rule(auth, shop["id"], group["id"], title="店铺订单")
    make_rule(auth, social["id"], group["id"], title="发布笔记")

    shop_items = all_items(list_today(auth, kind="shop"))
    social_items = all_items(list_today(auth, kind="social"))
    assert [i["title"] for i in shop_items] == ["店铺订单"]
    assert [i["title"] for i in social_items] == ["发布笔记"]


def test_archive_hides_target_and_locks_records(auth, db):
    from app.models import CheckinInstance

    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    item = all_items(list_today(auth))[0]

    assert auth.post(f"/api/v1/work-targets/{target['id']}/archive").status_code == 200
    assert list_today(auth)["statistics"]["total"] == 0

    inst = db.get(CheckinInstance, item["id"])
    assert inst.locked is True
    assert inst.lock_reason == "已暂停"

    resp = auth.post(f"/api/v1/checkin-instances/{item['id']}/complete", json={})
    assert resp.status_code == 409


def test_restore_target_generates_from_next_period(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    auth.post(f"/api/v1/work-targets/{target['id']}/archive")

    resp = auth.post(f"/api/v1/work-targets/{target['id']}/restore")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    # 每日事项从下一个自然日继续，归档期间不补工作
    assert body["generate_from"] == (today_local() + timedelta(days=1)).isoformat()
    assert list_today(auth)["statistics"]["total"] == 0


def test_duplicate_target_name_rejected(auth):
    make_target(auth, name="天猫店")
    resp = auth.post("/api/v1/work-targets", json={"kind": "shop", "name": "天猫店"})
    assert resp.status_code == 409
    assert resp.json()["code"] == "NAME_DUPLICATED"
    # 不同类型可以同名
    assert auth.post("/api/v1/work-targets", json={"kind": "social", "name": "天猫店"}).status_code == 201


def test_group_delete_blocked_when_in_use(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    resp = auth.delete(f"/api/v1/checkin-groups/{group['id']}")
    assert resp.status_code == 409
    assert resp.json()["code"] == "GROUP_IN_USE"


def test_rule_change_period_is_pending(auth):
    target = make_target(auth)
    group = make_group(auth)
    rule = make_rule(auth, target["id"], group["id"], period="daily")

    resp = auth.patch(f"/api/v1/checkin-rules/{rule['id']}", json={"period": "weekly"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["period_change"]["pending"] is True
    effective = body["period_change"]["effective_from"]
    today = today_local()
    expected = today + timedelta(days=1)  # 每日事项当前周期到明天 00:00 结束
    assert effective == expected.isoformat()
    # 当前周期实例仍然是每日，且没有被删除
    assert len(all_items(list_today(auth))) == 1


def test_rule_versions_recorded(auth):
    target = make_target(auth)
    group = make_group(auth)
    rule = make_rule(auth, target["id"], group["id"])
    auth.patch(f"/api/v1/checkin-rules/{rule['id']}", json={"title": "检查订单并核对退款"})
    versions = auth.get(f"/api/v1/checkin-rules/{rule['id']}/versions").json()
    assert len(versions) >= 2
    assert versions[0]["title"] == "检查订单并核对退款"


def test_history_endpoint_excludes_other_periods(auth):
    target = make_target(auth)
    group = make_group(auth)
    make_rule(auth, target["id"], group["id"])
    resp = auth.get("/api/v1/checkin-instances/history?kind=shop&period=daily")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


def test_daily_weekly_monthly_rules_do_not_generate_each_others_instances(auth, db):
    from app.models import CheckinInstance, CheckinRule
    target = make_target(auth)
    group = make_group(auth)
    expected = {"daily": "日常巡检", "weekly": "周度复盘", "monthly": "月度利润核对"}
    for period, title in expected.items():
        make_rule(auth, target["id"], group["id"], title=title, period=period)
    for period, title in expected.items():
        items = all_items(list_today(auth, period=period))
        assert {item["title"] for item in items} == {title}
    for instance in db.query(CheckinInstance).all():
        assert instance.period_type == db.get(CheckinRule, instance.rule_id).period


def test_unified_projects_keep_periods_and_target_statistics(auth):
    shop = make_target(auth, name="打卡项目甲")
    social = make_target(auth, kind="social", name="打卡项目乙")
    group = make_group(auth)
    for period in ("daily", "weekly", "monthly"):
        make_rule(auth, shop["id"], group["id"], title=period + "甲", period=period)
        make_rule(auth, social["id"], group["id"], title=period + "乙", period=period)
        payload = list_today(auth, kind="all", period=period)
        assert {item["target_id"] for item in all_items(payload)} == {shop["id"], social["id"]}
        assert payload["statistics"]["total"] == 2
        selected = auth.get("/api/v1/checkin-instances", params={"kind":"all", "period":period, "target_id":social["id"]}).json()
        assert len(all_items(selected)) == 1
        assert selected["statistics"]["total"] == 1
        instance = all_items(selected)[0]
        assert auth.post(f"/api/v1/checkin-instances/{instance['id']}/complete", json={}).status_code == 200
        selected = auth.get("/api/v1/checkin-instances", params={"kind":"all", "period":period, "target_id":social["id"]}).json()
        assert selected["statistics"]["completed"] == 1
        history = auth.get("/api/v1/checkin-instances/history", params={"kind":"all", "period":period, "target_id":social["id"]}).json()
        assert len(history["items"]) == 1
        assert history["items"][0]["period_type"] == period
    assert len(all_items(list_today(auth, kind="shop"))) == 1
    assert len(all_items(list_today(auth, kind="social"))) == 1
