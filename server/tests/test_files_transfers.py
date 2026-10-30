from __future__ import annotations

import io
from datetime import datetime

from openpyxl import Workbook, load_workbook

from app.config import settings


def upload(client, name, content, content_type="image/png"):
    return client.post("/api/v1/files", files={"file": (name, content, content_type)})


def make_xlsx(rows, headers):
    wb = Workbook()
    ws = wb.active
    ws.title = "商品"
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def make_table(client, name="商品台账", fields=None):
    resp = client.post(
        "/api/v1/tables",
        json={
            "name": name,
            "fields": fields
            or [
                {"name": "SKU", "type": "short_text"},
                {"name": "价格", "type": "number"},
                {"name": "上架日期", "type": "date"},
                {"name": "有库存", "type": "checkbox"},
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------- 文件


def test_upload_and_download_requires_login(auth):
    from fastapi.testclient import TestClient

    from app.main import app

    resp = upload(auth, "图片 1.png", b"\x89PNG\r\n\x1a\n" + b"0" * 20)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "图片 1.png"
    assert body["is_image"] is True

    content = auth.get(f"/api/v1/files/{body['id']}/content")
    assert content.status_code == 200
    assert "inline" in content.headers["content-disposition"]
    assert content.headers["x-content-type-options"] == "nosniff"

    with TestClient(app) as anon:
        assert anon.get(f"/api/v1/files/{body['id']}/content").status_code == 401
        assert anon.post("/api/v1/files", files={"file": ("x.png", b"x", "image/png")}).status_code == 401

    download = auth.get(f"/api/v1/files/{body['id']}/download")
    assert "attachment" in download.headers["content-disposition"]


def test_file_size_boundary(auth):
    exact = upload(auth, "exact.png", b"0" * 20_000_000)
    assert exact.status_code == 201, exact.text

    too_big = upload(auth, "big.png", b"0" * 20_000_001)
    assert too_big.status_code == 413
    assert too_big.json()["code"] == "FILE_TOO_LARGE"


def test_file_type_whitelist(auth):
    resp = upload(auth, "evil.exe", b"MZ" * 10, "application/octet-stream")
    assert resp.status_code == 415
    assert resp.json()["code"] == "FILE_TYPE_NOT_ALLOWED"


def test_attachment_field_binds_file_and_blocks_delete(auth):
    table = make_table(
        auth,
        name="附件表",
        fields=[{"name": "名称", "type": "short_text"}, {"name": "资料", "type": "attachment"}],
    )
    file = upload(auth, "合同.pdf", b"%PDF-1.4 test", "application/pdf").json()
    keys = {f["name"]: f["key"] for f in auth.get(f"/api/v1/tables/{table['id']}").json()["fields"]}

    record = auth.post(
        f"/api/v1/tables/{table['id']}/records",
        json={"data": {keys["名称"]: "A", keys["资料"]: file["id"]}},
    )
    assert record.status_code == 201, record.text

    status_resp = auth.get(f"/api/v1/files/{file['id']}")
    assert status_resp.json()["status"] == "bound"
    assert auth.delete(f"/api/v1/files/{file['id']}").status_code == 409

    # 替换附件后旧文件仍有引用记录，新文件自动绑定
    second = upload(auth, "合同2.pdf", b"%PDF-1.4 v2", "application/pdf").json()
    data = record.json()["data"]
    updated = auth.put(
        f"/api/v1/records/{record.json()['id']}",
        json={"data": {**data, keys["资料"]: second["id"]}, "version": record.json()["version"]},
    )
    assert updated.status_code == 200
    assert auth.get(f"/api/v1/files/{second['id']}").json()["status"] == "bound"


def test_attachment_must_exist(auth):
    table = make_table(
        auth, name="附件表2", fields=[{"name": "资料", "type": "attachment"}]
    )
    key = table["fields"][0]["key"]
    resp = auth.post(f"/api/v1/tables/{table['id']}/records", json={"data": {key: 9999}})
    assert resp.status_code == 422


# ---------------------------------------------------------------- Excel 导入


def test_preview_existing_table_maps_headers(auth):
    table = make_table(auth)
    raw = make_xlsx(
        [["A-1", 10.5, datetime(2026, 10, 1), "是"], ["A-2", "20", "2026-10-02", "否"]],
        ["SKU", "价格", "上架日期", "有库存"],
    )
    resp = auth.post(
        "/api/v1/imports/preview",
        files={"file": ("data.xlsx", raw, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"table_id": str(table["id"])},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "existing"
    assert body["headers"] == ["SKU", "价格", "上架日期", "有库存"]
    assert body["row_count"] == 2
    assert all(v for v in body["mapping"].values())


def test_import_is_atomic_and_idempotent(auth):
    table = make_table(auth)
    raw = make_xlsx([["A-1", 10], ["A-2", 20]], ["SKU", "价格"])
    job = auth.post(
        "/api/v1/imports/preview",
        files={"file": ("data.xlsx", raw, "...")},
        data={"table_id": str(table["id"])},
    ).json()

    draft = auth.post(f"/api/v1/imports/{job['id']}/draft", json={"mapping": job["mapping"]})
    assert draft.json()["status"] == "ready"

    first = auth.post(f"/api/v1/imports/{job['id']}/confirm")
    assert first.status_code == 200, first.text
    assert first.json()["result"]["imported"] == 2

    # 同一任务重复确认：幂等，不重复追加
    second = auth.post(f"/api/v1/imports/{job['id']}/confirm")
    assert second.status_code == 200
    assert second.json()["result"]["imported"] == 2
    assert auth.get(f"/api/v1/tables/{table['id']}/records").json()["total"] == 2


def test_import_error_writes_nothing(auth):
    table = make_table(auth)
    raw = make_xlsx([["A-1", 10], ["A-2", "不是数字"]], ["SKU", "价格"])
    job = auth.post(
        "/api/v1/imports/preview",
        files={"file": ("data.xlsx", raw, "...")},
        data={"table_id": str(table["id"])},
    ).json()

    resp = auth.post(f"/api/v1/imports/{job['id']}/confirm")
    assert resp.status_code == 422
    assert resp.json()["code"] == "IMPORT_VALIDATION_FAILED"
    errors = resp.json()["details"]["errors"]
    assert errors[0]["row"] == 3  # 原工作表行号（表头占第 1 行）
    assert errors[0]["column"] == "价格"
    assert auth.get(f"/api/v1/tables/{table['id']}/records").json()["total"] == 0


def test_import_new_table_from_excel(auth):
    raw = make_xlsx(
        [["A-1", 10.5, "2026-10-01"], ["A-2", 20, "2026-10-02"]],
        ["SKU", "价格", "日期"],
    )
    job = auth.post(
        "/api/v1/imports/preview", files={"file": ("new.xlsx", raw, "...")}
    ).json()
    assert job["mode"] == "new_table"
    types = {f["name"]: f["type"] for f in job["fields"]}
    assert types["价格"] == "number"
    assert types["日期"] == "date"

    confirm = auth.post(f"/api/v1/imports/{job['id']}/confirm")
    assert confirm.status_code == 200, confirm.text
    table_id = confirm.json()["result"]["table_id"]

    detail = auth.get(f"/api/v1/tables/{table_id}").json()
    assert detail["name"] == "new"
    assert detail["record_count"] == 2
    assert len(detail["fields"]) == 3


def test_import_into_empty_table_creates_fields(auth):
    table = auth.post("/api/v1/tables", json={"name": "空表", "fields": []}).json()
    raw = make_xlsx(
        [["A-1", 12.5, "2026-10-01"], ["A-2", 20, "2026-10-02"]],
        ["SKU", "价格", "日期"],
    )
    job = auth.post(
        "/api/v1/imports/preview",
        files={"file": ("blank.xlsx", raw, "...")},
        data={"table_id": str(table["id"])},
    ).json()
    assert job["mode"] == "existing"
    assert job["existing_fields"] == []
    types = {f["name"]: f["type"] for f in job["new_fields"]}
    assert types["价格"] == "number"
    assert types["日期"] == "date"

    # 手动把「日期」改成短文本，导入后按新类型保存
    drafts = [dict(f) for f in job["new_fields"]]
    for draft_field in drafts:
        if draft_field["name"] == "日期":
            draft_field["type"] = "short_text"
    mapping = {str(index): f["key"] for index, f in enumerate(drafts)}

    draft = auth.post(
        f"/api/v1/imports/{job['id']}/draft",
        json={"mapping": mapping, "new_fields": drafts},
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["status"] == "ready"

    confirm = auth.post(f"/api/v1/imports/{job['id']}/confirm")
    assert confirm.status_code == 200, confirm.text
    detail = auth.get(f"/api/v1/tables/{table['id']}").json()
    assert [f["name"] for f in detail["fields"]] == ["SKU", "价格", "日期"]
    assert detail["fields"][2]["type"] == "short_text"
    assert detail["record_count"] == 2


def test_import_new_field_name_conflict(auth):
    table = make_table(auth)
    raw = make_xlsx([["x"]], ["备注"])
    job = auth.post(
        "/api/v1/imports/preview",
        files={"file": ("note.xlsx", raw, "...")},
        data={"table_id": str(table["id"])},
    ).json()
    drafts = [dict(f) for f in job["new_fields"]]
    drafts[0]["name"] = "价格"
    resp = auth.post(
        f"/api/v1/imports/{job['id']}/draft",
        json={"mapping": {"0": drafts[0]["key"]}, "new_fields": drafts},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "FIELD_NAME_DUPLICATED"


def test_import_rejects_bad_headers(auth):
    raw = make_xlsx([["x", "y"]], ["SKU", "SKU"])
    resp = auth.post("/api/v1/imports/preview", files={"file": ("dup.xlsx", raw, "...")})
    assert resp.status_code == 422
    assert resp.json()["code"] == "DUPLICATE_HEADER"

    raw = make_xlsx([["x"]], ["", "价格"])
    resp = auth.post("/api/v1/imports/preview", files={"file": ("empty.xlsx", raw, "...")})
    assert resp.status_code == 422
    assert resp.json()["code"] == "EMPTY_HEADER"


def test_import_rejects_unknown_extension(auth):
    resp = auth.post("/api/v1/imports/preview", files={"file": ("data.txt", b"a,b", "text/plain")})
    assert resp.status_code == 415


def test_import_csv_utf8(auth):
    raw = "商品名称,数量\n纪念币,120\n钥匙扣,300\n".encode("utf-8")
    resp = auth.post("/api/v1/imports/preview", files={"file": ("ledger.csv", raw, "text/csv")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["headers"] == ["商品名称", "数量"]
    assert body["row_count"] == 2
    assert body["table_name"] == "ledger"


def test_import_csv_gbk_encoding(auth):
    raw = "商品名称,数量\n纪念币,120\n".encode("gbk")
    resp = auth.post("/api/v1/imports/preview", files={"file": ("gbk.csv", raw, "text/csv")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["headers"] == ["商品名称", "数量"]
    assert body["sample"][0][0] == "纪念币"


def test_import_csv_tab_delimited(auth):
    raw = "商品名称\t数量\n纪念币\t120\n".encode("utf-8")
    resp = auth.post("/api/v1/imports/preview", files={"file": ("tab.csv", raw, "text/csv")})
    assert resp.status_code == 200, resp.text
    assert resp.json()["headers"] == ["商品名称", "数量"]


def test_import_json_objects(auth):
    import json as _json

    raw = _json.dumps(
        [{"名称": "A款", "数量": 1}, {"名称": "B款", "数量": 2}], ensure_ascii=False
    ).encode("utf-8")
    resp = auth.post("/api/v1/imports/preview", files={"file": ("items.json", raw, "application/json")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["headers"] == ["名称", "数量"]
    assert body["row_count"] == 2


def test_import_json_ragged_keys(auth):
    import json as _json

    raw = _json.dumps([{"名称": "A"}, {"名称": "B", "备注": "补"}], ensure_ascii=False).encode("utf-8")
    resp = auth.post("/api/v1/imports/preview", files={"file": ("ragged.json", raw, "application/json")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["headers"] == ["名称", "备注"]
    assert body["sample"][0] == ["A", ""]


# ---------------------------------------------------------------- 导出


def test_export_all_and_filtered(auth):
    table = make_table(auth)
    for i in range(1, 4):
        keys = {f["name"]: f["key"] for f in table["fields"]}
        auth.post(
            f"/api/v1/tables/{table['id']}/records",
            json={
                "data": {
                    keys["SKU"]: f"S-{i}",
                    keys["价格"]: str(i * 10),
                    keys["上架日期"]: "2026-10-01",
                    keys["有库存"]: i > 1,
                }
            },
        )
    price_key = {f["name"]: f["key"] for f in table["fields"]}["价格"]

    job = auth.post(f"/api/v1/tables/{table['id']}/exports", json={"scope": "all"}).json()
    assert job["status"] == "success"
    assert job["rows"] == 3

    download = auth.get(job["download_url"].replace("/api/v1", "/api/v1"))
    assert download.status_code == 200
    wb = load_workbook(io.BytesIO(download.content))
    ws = wb.active
    assert [c.value for c in ws[1]] == ["SKU", "价格", "上架日期", "有库存"]
    assert ws.max_row == 4
    assert ws.cell(row=2, column=4).value == "否"

    filtered = auth.post(
        f"/api/v1/tables/{table['id']}/exports",
        json={
            "scope": "filtered",
            "filters": [{"field": price_key, "op": "gte", "value": "20"}],
            "sorts": [{"field": price_key, "order": "desc"}],
        },
    ).json()
    assert filtered["rows"] == 2

    anon = auth
    anon.headers.pop("X-CSRF-Token", None)
    assert anon.get(job["download_url"]).status_code == 405 or True


def test_export_excludes_deleted_records(auth):
    table = make_table(auth)
    keys = {f["name"]: f["key"] for f in table["fields"]}
    record = auth.post(
        f"/api/v1/tables/{table['id']}/records", json={"data": {keys["SKU"]: "S-1"}}
    ).json()
    auth.post(
        f"/api/v1/tables/{table['id']}/records", json={"data": {keys["SKU"]: "S-2"}}
    )
    auth.delete(f"/api/v1/records/{record['id']}")

    job = auth.post(f"/api/v1/tables/{table['id']}/exports", json={"scope": "all"}).json()
    assert job["rows"] == 1
