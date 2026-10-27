from __future__ import annotations

from datetime import timedelta

from app.models import Memo, TrashEntry, utcnow


def make_table(client, name="台账"):
    resp = client.post(
        "/api/v1/tables",
        json={"name": name, "fields": [{"name": "名称", "type": "short_text"}]},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_trash_list_and_counts(auth):
    table = make_table(auth)
    auth.delete(f"/api/v1/tables/{table['id']}")
    memo = auth.post("/api/v1/memos", json={"content": "便签"}).json()
    auth.delete(f"/api/v1/memos/{memo['id']}")

    body = auth.get("/api/v1/trash").json()
    assert body["total"] == 2
    assert body["counts"]["table"] == 1
    assert body["counts"]["memo"] == 1
    assert all(item["remaining_days"] == 30 for item in body["items"])
    assert {item["kind_label"] for item in body["items"]} == {"表格", "便利贴"}

    only_memos = auth.get("/api/v1/trash?kind=memo").json()
    assert only_memos["total"] == 1


def test_restore_table_name_conflict(auth):
    table = make_table(auth, "台账A")
    auth.delete(f"/api/v1/tables/{table['id']}")
    make_table(auth, "台账A")

    resp = auth.post(f"/api/v1/trash/table/{table['id']}/restore")
    assert resp.status_code == 409
    assert resp.json()["code"] == "NAME_CONFLICT"


def test_restore_record_requires_parent_table(auth):
    table = make_table(auth)
    key = table["fields"][0]["key"]
    record = auth.post(
        f"/api/v1/tables/{table['id']}/records", json={"data": {key: "A"}}
    ).json()

    auth.delete(f"/api/v1/records/{record['id']}")
    auth.delete(f"/api/v1/tables/{table['id']}")

    resp = auth.post(f"/api/v1/trash/record/{record['id']}/restore")
    assert resp.status_code == 409
    assert resp.json()["code"] == "PARENT_TABLE_DELETED"

    assert auth.post(f"/api/v1/trash/table/{table['id']}/restore").status_code == 200
    assert auth.post(f"/api/v1/trash/record/{record['id']}/restore").status_code == 200
    assert auth.get(f"/api/v1/tables/{table['id']}/records").json()["total"] == 1


def test_restore_record_after_new_required_field(auth):
    table = make_table(auth)
    key = table["fields"][0]["key"]
    record = auth.post(f"/api/v1/tables/{table['id']}/records", json={"data": {key: "A"}}).json()
    auth.delete(f"/api/v1/records/{record['id']}")

    auth.post(
        f"/api/v1/tables/{table['id']}/fields",
        json={"name": "仓库", "type": "short_text", "required": True, "default_value": "主仓"},
    )

    resp = auth.post(f"/api/v1/trash/record/{record['id']}/restore")
    # 新增必填字段有默认值，可以按当前结构补齐后恢复
    assert resp.status_code == 200
    restored = auth.get(f"/api/v1/records/{record['id']}").json()
    assert "主仓" in restored["data"].values()


def test_restore_note_when_folder_deleted(auth):
    folder = auth.post("/api/v1/note-folders", json={"name": "旧文件夹"}).json()
    note = auth.post(
        "/api/v1/notes", json={"title": "笔记", "content": "正文", "folder_id": folder["id"], "tags": ["标签A"]}
    ).json()
    auth.delete(f"/api/v1/notes/{note['id']}")
    auth.delete(f"/api/v1/note-folders/{folder['id']}")

    resp = auth.post(f"/api/v1/trash/note/{note['id']}/restore")
    assert resp.status_code == 200
    assert "未分类" in resp.json()["message"]
    detail = auth.get(f"/api/v1/notes/{note['id']}").json()
    assert detail["folder_id"] is None
    # 仍有效的标签保留
    assert detail["tags"] == ["标签A"]


def test_restore_legacy_memo_without_title(auth, db):
    memo = Memo(content="老数据只有正文", title="", category=None, color="yellow")
    db.add(memo)
    db.commit()

    entry = TrashEntry(
        kind="memo",
        entity_id=memo.id,
        name="老数据",
        snapshot={"content": "老数据只有正文", "color": "green"},
        deleted_at=utcnow(),
        expires_at=utcnow() + timedelta(days=10),
    )
    db.add(entry)
    memo.deleted_at = utcnow()
    db.commit()

    assert auth.post(f"/api/v1/trash/memo/{memo.id}/restore").status_code == 200
    body = auth.get("/api/v1/memos").json()[0]
    assert body["content"] == "老数据只有正文"
    assert body["color"] == "yellow"  # 保留原颜色，不被旧快照覆盖


def test_purge_record_and_release_file(auth, db):
    from pathlib import Path

    from app.config import settings
    from app.models import FileObject

    table = auth.post(
        "/api/v1/tables",
        json={
            "name": "附件台账",
            "fields": [{"name": "名称", "type": "short_text"}, {"name": "附件", "type": "attachment"}],
        },
    ).json()
    file = auth.post(
        "/api/v1/files", files={"file": ("合同.pdf", b"%PDF-1.4 x", "application/pdf")}
    ).json()
    keys = {f["name"]: f["key"] for f in table["fields"]}
    record = auth.post(
        f"/api/v1/tables/{table['id']}/records",
        json={"data": {keys["名称"]: "A", keys["附件"]: file["id"]}},
    ).json()

    auth.delete(f"/api/v1/records/{record['id']}")
    path = settings.storage_dir / "files" / db.get(FileObject, file["id"]).storage_key
    assert path.exists()

    assert auth.delete(f"/api/v1/trash/record/{record['id']}").status_code == 200
    assert not path.exists()
    assert db.get(FileObject, file["id"]) is None
    assert auth.get("/api/v1/trash").json()["total"] == 0


def test_expired_entry_cannot_be_restored(auth, db):
    table = make_table(auth)
    auth.delete(f"/api/v1/tables/{table['id']}")
    entry = db.query(TrashEntry).filter(TrashEntry.entity_id == table["id"]).first()
    entry.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    assert auth.get("/api/v1/trash").json()["total"] == 0
    resp = auth.post(f"/api/v1/trash/table/{table['id']}/restore")
    assert resp.status_code == 410
    assert resp.json()["code"] == "TRASH_EXPIRED"

    purged = auth.post("/api/v1/trash/purge-expired").json()
    assert purged["purged"] == 1
    assert auth.get("/api/v1/trash").json()["total"] == 0


def test_purge_is_idempotent_friendly(auth, db):
    memo = auth.post("/api/v1/memos", json={"content": "待清理"}).json()
    auth.delete(f"/api/v1/memos/{memo['id']}")
    assert auth.delete(f"/api/v1/trash/memo/{memo['id']}").status_code == 200
    # 再次清理同一条：没有可清内容，返回 404 而不是 500
    assert auth.delete(f"/api/v1/trash/memo/{memo['id']}").status_code == 404
