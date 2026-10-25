from __future__ import annotations

import io
import json

from openpyxl import Workbook

ALL_FIELDS = [
    {"name": "SKU", "type": "short_text", "required": True},
    {"name": "备注", "type": "long_text"},
    {"name": "价格", "type": "number"},
    {"name": "上架日期", "type": "date"},
    {"name": "状态", "type": "select", "options": [{"id": "o1", "name": "在售"}, {"id": "o2", "name": "下架"}]},
    {"name": "渠道", "type": "multiselect", "options": [{"id": "c1", "name": "天猫"}, {"id": "c2", "name": "抖音"}]},
    {"name": "有库存", "type": "checkbox"},
    {"name": "链接", "type": "url"},
    {"name": "图片", "type": "attachment"},
]


def make_table(client, name="商品台账", fields=None):
    resp = client.post("/api/v1/tables", json={"name": name, "fields": ALL_FIELDS if fields is None else fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


def field_by_name(table, name):
    return next(f for f in table["fields"] if f["name"] == name)


def add_record(client, table_id, **data):
    keys = {f["name"]: f["key"] for f in client.get(f"/api/v1/tables/{table_id}").json()["fields"]}
    payload = {keys[k]: v for k, v in data.items()}
    return client.post(f"/api/v1/tables/{table_id}/records", json={"data": payload})


def test_create_table_with_nine_field_types(auth):
    table = make_table(auth)
    assert len(table["fields"]) == 9
    assert {f["type"] for f in table["fields"]} == {
        "short_text", "long_text", "number", "date", "select",
        "multiselect", "checkbox", "url", "attachment",
    }
    assert all(f["key"] for f in table["fields"])


def test_record_crud_and_zero_false_are_not_empty(auth):
    table = make_table(auth)
    resp = add_record(
        auth,
        table["id"],
        SKU="00123",
        **{
            "价格": "0",
            "有库存": False,
            "状态": "o1",
            "渠道": ["c1", "c1", "c2"],
            "上架日期": "2026-10-25",
            "链接": "https://example.com/item?id=1",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    data = body["data"]
    price_key = field_by_name(table, "价格")["key"]
    stock_key = field_by_name(table, "有库存")["key"]
    channel_key = field_by_name(table, "渠道")["key"]
    assert data[price_key] == "0"
    assert data[stock_key] is False
    assert data[channel_key] == ["c1", "c2"]  # 去重

    updated = auth.put(
        f"/api/v1/records/{body['id']}",
        json={"data": {**data, price_key: "12.50"}, "version": body["version"]},
    )
    assert updated.status_code == 200
    assert updated.json()["data"][price_key] == "12.5"
    assert updated.json()["version"] == body["version"] + 1


def test_record_validation_errors(auth):
    table = make_table(auth)
    keys = {f["name"]: f["key"] for f in table["fields"]}

    resp = add_record(auth, table["id"], SKU="A1", **{"价格": "1.1234567"})
    assert resp.status_code == 422
    assert "小数" in resp.json()["details"]["fields"]["价格"]

    resp = add_record(auth, table["id"], SKU="A1", **{"上架日期": "2026-13-01"})
    assert resp.status_code == 422

    resp = add_record(auth, table["id"], SKU="A1", **{"链接": "ftp://example.com"})
    assert resp.status_code == 422

    resp = add_record(auth, table["id"], SKU="A1", **{"状态": "not-an-option"})
    assert resp.status_code == 422

    # 必填为空
    resp = auth.post(f"/api/v1/tables/{table['id']}/records", json={"data": {keys["备注"]: "x"}})
    assert resp.status_code == 422
    assert "SKU" in resp.json()["details"]["fields"]

    # 未知字段
    resp = auth.post(f"/api/v1/tables/{table['id']}/records", json={"data": {"nope": 1}})
    assert resp.status_code == 422


def test_number_precision_limits(auth):
    table = make_table(auth)
    resp = add_record(auth, table["id"], SKU="A", **{"价格": "1234567890123456789"})
    assert resp.status_code == 422
    ok = add_record(auth, table["id"], SKU="A", **{"价格": "999999999999.999999"})
    assert ok.status_code == 201


def test_version_conflict(auth):
    table = make_table(auth)
    record = add_record(auth, table["id"], SKU="A").json()
    stale = record["version"]
    first = auth.put(
        f"/api/v1/records/{record['id']}", json={"data": record["data"], "version": stale}
    )
    assert first.status_code == 200
    second = auth.put(
        f"/api/v1/records/{record['id']}", json={"data": record["data"], "version": stale}
    )
    assert second.status_code == 409
    assert second.json()["code"] == "VERSION_CONFLICT"
    assert second.json()["details"]["current_version"] == stale + 1


def test_filters_sorting_and_pagination(auth):
    table = make_table(auth)
    for i in range(1, 6):
        add_record(
            auth,
            table["id"],
            SKU=f"SKU-{i}",
            **{"价格": str(i * 10), "状态": "o1" if i % 2 else "o2", "有库存": i > 3},
        )
    key_price = field_by_name(table, "价格")["key"]
    key_status = field_by_name(table, "状态")["key"]
    key_stock = field_by_name(table, "有库存")["key"]
    key_sku = field_by_name(table, "SKU")["key"]

    filters = json.dumps([{"field": key_price, "op": "between", "value": ["20", "40"]}])
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?filters={filters}")
    assert resp.status_code == 200, resp.text
    assert [r["data"][key_price] for r in resp.json()["items"]] == ["20", "30", "40"]

    filters = json.dumps([{"field": key_status, "op": "eq", "value": "o2"}])
    assert resp.json if True else None
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?filters={filters}")
    assert len(resp.json()["items"]) == 2

    filters = json.dumps([{"field": key_stock, "op": "eq", "value": True}])
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?filters={filters}")
    assert len(resp.json()["items"]) == 2

    filters = json.dumps([{"field": key_sku, "op": "contains", "value": "SKU-"}])
    sorts = json.dumps([{"field": key_price, "order": "desc"}])
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?filters={filters}&sorts={sorts}")
    assert [r["data"][key_price] for r in resp.json()["items"]] == ["50", "40", "30", "20", "10"]

    # 分页
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?page=1&page_size=20")
    assert resp.json()["total"] == 5
    assert len(resp.json()["items"]) == 5
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?page_size=30")
    assert resp.status_code == 422


def test_filter_and_sort_limits(auth):
    table = make_table(auth)
    key = table["fields"][0]["key"]
    eleven = json.dumps([{"field": key, "op": "contains", "value": "a"}] * 11)
    assert auth.get(f"/api/v1/tables/{table['id']}/records?filters={eleven}").status_code == 422

    four = json.dumps([{"field": key, "order": "asc"}] * 4)
    assert auth.get(f"/api/v1/tables/{table['id']}/records?sorts={four}").status_code == 422

    bad = json.dumps([{"field": "unknown", "op": "eq", "value": 1}])
    assert auth.get(f"/api/v1/tables/{table['id']}/records?filters={bad}").status_code == 422

    long_text_key = field_by_name(table, "备注")["key"]
    unsortable = json.dumps([{"field": long_text_key, "order": "asc"}])
    resp = auth.get(f"/api/v1/tables/{table['id']}/records?sorts={unsortable}")
    assert resp.status_code == 422
    assert resp.json()["code"] == "FIELD_NOT_SORTABLE"


def test_rename_field_keeps_values(auth):
    table = make_table(auth)
    record = add_record(auth, table["id"], SKU="A1").json()
    sku = field_by_name(table, "SKU")
    resp = auth.patch(f"/api/v1/fields/{sku['id']}", json={"name": "商品编码"})
    assert resp.status_code == 200
    assert resp.json()["key"] == sku["key"]
    detail = auth.get(f"/api/v1/records/{record['id']}").json()
    assert detail["data"][sku["key"]] == "A1"


def test_add_required_field_needs_default_or_backfill(auth):
    table = make_table(auth, name="库存表", fields=[{"name": "名称", "type": "short_text"}])
    add_record(auth, table["id"], 名称="A")

    resp = auth.post(
        f"/api/v1/tables/{table['id']}/fields",
        json={"name": "仓库", "type": "short_text", "required": True},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "REQUIRED_NEEDS_DEFAULT"

    resp = auth.post(
        f"/api/v1/tables/{table['id']}/fields",
        json={"name": "仓库", "type": "short_text", "required": True, "default_value": "主仓"},
    )
    assert resp.status_code == 201
    record = auth.get(f"/api/v1/tables/{table['id']}/records").json()["items"][0]
    assert record["data"][resp.json()["key"]] == "主仓"


def test_optional_to_required_checks_existing_data(auth):
    table = make_table(auth)
    add_record(auth, table["id"], SKU="A1")
    note_field = field_by_name(table, "备注")
    resp = auth.patch(f"/api/v1/fields/{note_field['id']}", json={"required": True})
    assert resp.status_code == 409
    assert resp.json()["code"] == "REQUIRED_CONFLICT"
    assert resp.json()["details"]["empty_count"] == 1


def test_type_change_blocked_when_data_exists(auth):
    table = make_table(auth)
    add_record(auth, table["id"], SKU="00123")
    sku = field_by_name(table, "SKU")
    resp = auth.patch(f"/api/v1/fields/{sku['id']}", json={"type": "number"})
    assert resp.status_code == 409
    assert resp.json()["code"] == "TYPE_CHANGE_BLOCKED"


def test_delete_field_requires_confirmation_and_reports_counts(auth):
    table = make_table(auth)
    record = add_record(auth, table["id"], SKU="A1", **{"备注": "有内容"}).json()
    note = field_by_name(table, "备注")
    auth.delete(f"/api/v1/records/{record['id']}")

    resp = auth.delete(f"/api/v1/fields/{note['id']}")
    assert resp.status_code == 409
    assert resp.json()["code"] == "DELETE_CONFIRM_REQUIRED"
    assert resp.json()["details"]["trashed"] == 1

    resp = auth.delete(f"/api/v1/fields/{note['id']}?confirm=true")
    assert resp.status_code == 200
    assert resp.json()["removed_trashed_values"] == 1


def test_option_delete_blocked_when_used(auth):
    table = make_table(auth)
    add_record(auth, table["id"], SKU="A1", **{"状态": "o1"})
    status_field = field_by_name(table, "状态")
    resp = auth.patch(
        f"/api/v1/fields/{status_field['id']}",
        json={"options": [{"id": "o2", "name": "下架"}]},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "OPTION_IN_USE"

    # 重命名选项保留 ID，现有数据仍有效
    resp = auth.patch(
        f"/api/v1/fields/{status_field['id']}",
        json={"options": [{"id": "o1", "name": "在售中"}, {"id": "o2", "name": "下架"}]},
    )
    assert resp.status_code == 200


def test_batch_delete_limit_and_trash(auth):
    table = make_table(auth)
    ids = [add_record(auth, table["id"], SKU=f"S{i}").json()["id"] for i in range(3)]
    resp = auth.post(f"/api/v1/tables/{table['id']}/records/batch-delete", json={"ids": ids})
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 3
    assert auth.get(f"/api/v1/tables/{table['id']}/records").json()["total"] == 0

    trash = auth.get("/api/v1/trash?kind=record").json()
    assert trash["total"] == 3
    assert all(item["remaining_days"] == 30 for item in trash["items"])

    resp = auth.post(
        f"/api/v1/tables/{table['id']}/records/batch-delete", json={"ids": list(range(200))}
    )
    assert resp.status_code == 422


def test_table_requires_at_least_one_field_for_records(auth):
    table = make_table(auth, name="空表", fields=[])
    resp = auth.post(f"/api/v1/tables/{table['id']}/records", json={"data": {}})
    assert resp.status_code == 409
    assert resp.json()["code"] == "NO_FIELDS"


def test_duplicate_table_name_rejected(auth):
    make_table(auth, name="台账A")
    resp = auth.post("/api/v1/tables", json={"name": "台账A", "fields": []})
    assert resp.status_code == 409


def test_deleted_table_hidden_from_list_and_detail(auth):
    table = make_table(auth)
    auth.delete(f"/api/v1/tables/{table['id']}")
    assert auth.get("/api/v1/tables").json() == []
    assert auth.get(f"/api/v1/tables/{table['id']}").status_code == 404


def make_xlsx(rows, headers=("SKU", "价格")):
    wb = Workbook()
    ws = wb.active
    ws.append(list(headers))
    for row in rows:
        ws.append(list(row))
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
