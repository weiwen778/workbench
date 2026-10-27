from __future__ import annotations


def payload(kind_key="店铺", freq="每天"):
    return {
        "_说明": ["这行会被忽略"],
        "分类": ["内容发布", "客户回复"],
        kind_key: [
            {
                "名称": "义乌礼品店",
                "平台": "1688",
                "备注": "主店",
                "任务": [
                    {"名称": "发布 1 条内容", "分类": "内容发布", "频率": freq},
                    {"名称": "回复全部评论", "分类": "客户回复", "频率": "每周", "说明": "每天看一次"},
                ],
            }
        ],
    }


def test_import_creates_groups_targets_and_rules(auth):
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=payload())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["created"] == {"targets": 1, "groups": 2, "rules": 2}
    assert body["reused"] == {"targets": 0, "groups": 0}
    assert body["skipped"] == []

    targets = auth.get("/api/v1/work-targets", params={"kind": "shop"}).json()
    assert [t["name"] for t in targets] == ["义乌礼品店"]
    target = targets[0]
    assert target["platform"] == "1688"

    rules = auth.get(f"/api/v1/work-targets/{target['id']}/rules").json()
    assert {r["title"] for r in rules} == {"发布 1 条内容", "回复全部评论"}
    assert {r["group_name"] for r in rules} == {"内容发布", "客户回复"}
    periods = {r["title"]: r["effective_period"] for r in rules}
    assert periods["发布 1 条内容"] == "daily"
    assert periods["回复全部评论"] == "weekly"

    groups = {g["name"] for g in auth.get("/api/v1/checkin-groups").json()}
    assert {"内容发布", "客户回复"} <= groups


def test_import_twice_reuses_and_skips(auth):
    first = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=payload())
    assert first.status_code == 201, first.text

    second = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=payload())
    assert second.status_code == 201, second.text
    body = second.json()
    assert body["created"] == {"targets": 0, "groups": 0, "rules": 0}
    assert body["reused"]["targets"] == 1
    assert body["skipped_total"] == 2
    assert {s["reason"] for s in body["skipped"]} == {"同名任务已存在"}

    targets = auth.get("/api/v1/work-targets", params={"kind": "shop"}).json()
    assert len(targets) == 1


def test_import_adds_rules_to_existing_target(auth):
    auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=payload())
    extra = {
        "店铺": [
            {
                "名称": "义乌礼品店",
                "任务": [{"名称": "整理库存", "分类": "内容发布", "频率": "每月"}],
            }
        ]
    }
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=extra)
    assert resp.status_code == 201, resp.text
    assert resp.json()["created"] == {"targets": 0, "groups": 0, "rules": 1}

    target = auth.get("/api/v1/work-targets", params={"kind": "shop"}).json()[0]
    rules = auth.get(f"/api/v1/work-targets/{target['id']}/rules").json()
    assert "整理库存" in {r["title"] for r in rules}


def test_import_social_uses_account_key(auth):
    data = payload(kind_key="账号")
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "social"}, json=data)
    assert resp.status_code == 201, resp.text
    targets = auth.get("/api/v1/work-targets", params={"kind": "social"}).json()
    assert [t["name"] for t in targets] == ["义乌礼品店"]
    assert targets[0]["kind"] == "social"


def test_import_rejects_unknown_frequency(auth):
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=payload(freq="看心情"))
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "IMPORT_INVALID"
    assert body["details"]["total_errors"] >= 1
    assert any("频率" in e for e in body["details"]["errors"])

    # 出错时不能写入任何内容
    assert auth.get("/api/v1/work-targets", params={"kind": "shop"}).json() == []


def test_import_rejects_missing_target_list(auth):
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json={})
    assert resp.status_code == 422
    assert resp.json()["code"] == "IMPORT_INVALID"


def test_import_rejects_blank_name(auth):
    data = {"店铺": [{"名称": "  ", "任务": []}]}
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=data)
    assert resp.status_code == 422
    assert any("名称不能为空" in e for e in resp.json()["details"]["errors"])


def test_import_defaults_group_and_period(auth):
    data = {"店铺": [{"名称": "东莞厂", "任务": [{"名称": "对账"}]}]}
    resp = auth.post("/api/v1/checkin-imports", params={"kind": "shop"}, json=data)
    assert resp.status_code == 201, resp.text

    target = auth.get("/api/v1/work-targets", params={"kind": "shop"}).json()[0]
    rule = auth.get(f"/api/v1/work-targets/{target['id']}/rules").json()[0]
    assert rule["group_name"] == "默认分类"
    assert rule["effective_period"] == "daily"


def test_template_download(auth):
    resp = auth.get("/api/v1/checkin-imports/template", params={"kind": "social"})
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    body = resp.json()
    assert "账号" in body
    assert isinstance(body["_说明"], list)
    assert body["账号"][0]["任务"][0]["频率"] == "每天"

    shop_tpl = auth.get("/api/v1/checkin-imports/template", params={"kind": "shop"}).json()
    assert "店铺" in shop_tpl
