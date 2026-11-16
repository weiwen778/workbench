from __future__ import annotations

from datetime import timedelta

from app.models import NoteRevision
from app.models import utcnow


def new_note(client, **kwargs):
    resp = client.post("/api/v1/notes", json={"title": "运营方法", "content": "# 标题\n\n内容", **kwargs})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_folder_and_tag_crud(auth):
    folder = auth.post("/api/v1/note-folders", json={"name": "运营"}).json()
    tag = auth.post("/api/v1/note-tags", json={"name": "选品"}).json()
    note = new_note(auth, folder_id=folder["id"], tags=["选品", "复盘"])

    assert note["tags"] == ["选品", "复盘"]
    folders = auth.get("/api/v1/note-folders").json()
    assert folders["folders"][0]["note_count"] == 1

    # 删除文件夹：笔记转到未分类，不删除笔记
    assert auth.delete(f"/api/v1/note-folders/{folder['id']}").status_code == 200
    moved = auth.get(f"/api/v1/notes/{note['id']}").json()
    assert moved["folder_id"] is None

    # 删除标签只解除关联
    assert auth.delete(f"/api/v1/note-tags/{tag['id']}").status_code == 200
    assert "选品" not in auth.get(f"/api/v1/notes/{note['id']}").json()["tags"]


def test_create_note_rejects_missing_folder(auth):
    response = auth.post("/api/v1/notes", json={"title": "失效文件夹中的笔记", "folder_id": 999})
    assert response.status_code == 422
    assert response.json()["code"] == "FOLDER_NOT_FOUND"


def test_note_metadata_change_rejects_stale_editor_without_creating_revision(auth):
    folder = auth.post("/api/v1/note-folders", json={"name": "运营"}).json()
    note = new_note(auth, tags=["原标签"])
    path = f"/api/v1/notes/{note['id']}"
    moved = auth.put(path, json={"folder_id": folder["id"], "version": note["version"]}).json()
    assert moved["version"] == note["version"] + 1

    tagged = auth.put(path, json={"tags": ["新标签"], "version": moved["version"]}).json()
    assert tagged["version"] == moved["version"] + 1
    assert tagged["revision_count"] == note["revision_count"]
    stale = auth.put(path, json={"content": "旧编辑", "tags": ["原标签"], "folder_id": None, "version": moved["version"]})
    assert stale.status_code == 409
    assert auth.get(path).json()["tags"] == ["新标签"]

    unchanged = auth.put(path, json={"tags": [" 新标签 ", "新标签"], "version": tagged["version"]}).json()
    assert unchanged["version"] == tagged["version"]


def test_search_by_title_and_content_with_filters(auth):
    folder = auth.post("/api/v1/note-folders", json={"name": "客服"}).json()
    tag = auth.post("/api/v1/note-tags", json={"name": "话术"}).json()
    new_note(auth, title="退货话术", content="先安抚", folder_id=folder["id"], tags=["话术"])
    new_note(auth, title="采购清单", content="纸箱")

    assert len(auth.get("/api/v1/notes?q=退货").json()) == 1
    assert len(auth.get("/api/v1/notes?q=纸箱").json()) == 1
    assert len(auth.get("/api/v1/notes?q=不存在").json()) == 0
    assert len(auth.get(f"/api/v1/notes?folder_id={folder['id']}").json()) == 1
    assert len(auth.get(f"/api/v1/notes?tag_id={tag['id']}").json()) == 1


def test_first_save_creates_revision_and_conflict(auth):
    note = new_note(auth)
    assert note["revision_count"] == 1

    saved = auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "# 标题\n\n更新内容", "version": note["version"], "mode": "auto"},
    )
    assert saved.status_code == 200
    assert saved.json()["version"] == note["version"] + 1

    conflict = auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "另一个设备的内容", "version": note["version"], "mode": "auto"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "VERSION_CONFLICT"
    assert conflict.json()["details"]["server_content"].startswith("# 标题")


def test_auto_save_does_not_snapshot_within_interval(auth):
    note = new_note(auth)
    before = auth.get(f"/api/v1/notes/{note['id']}/revisions").json()
    for i in range(3):
        resp = auth.put(
            f"/api/v1/notes/{note['id']}",
            json={"content": f"内容 {i}", "version": note["version"] + i, "mode": "auto"},
        )
        assert resp.status_code == 200
    after = auth.get(f"/api/v1/notes/{note['id']}/revisions").json()
    assert len(after) == len(before)

    manual = auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "手动保存", "version": note["version"] + 3, "mode": "manual"},
    )
    assert manual.status_code == 200
    assert len(auth.get(f"/api/v1/notes/{note['id']}/revisions").json()) == len(after) + 1


def test_interval_revision_after_five_minutes(auth, db):
    note = new_note(auth)
    rev = db.query(NoteRevision).filter(NoteRevision.note_id == note["id"]).first()
    rev.created_at = utcnow() - timedelta(minutes=6)
    db.commit()

    resp = auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "六分钟后的编辑", "version": note["version"], "mode": "auto"},
    )
    assert resp.status_code == 200
    assert len(auth.get(f"/api/v1/notes/{note['id']}/revisions").json()) == 2


def test_restore_revision_keeps_current_as_backup(auth):
    note = new_note(auth)
    updated = auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "第二版", "version": note["version"], "mode": "manual"},
    ).json()
    revisions = auth.get(f"/api/v1/notes/{note['id']}/revisions").json()
    first_rev = revisions[-1]

    restored = auth.post(
        f"/api/v1/notes/{note['id']}/revisions/{first_rev['id']}/restore",
        json={"version": updated["version"]},
    )
    assert restored.status_code == 200
    assert restored.json()["content"] == "# 标题\n\n内容"

    after = auth.get(f"/api/v1/notes/{note['id']}/revisions").json()
    assert any(r["reason"] == "restore" for r in after)
    # 恢复前的第二版仍保留在历史里
    detail = auth.get(f"/api/v1/notes/{note['id']}/revisions/{after[0]['id']}").json()
    assert detail["content"] == "第二版"


def test_restore_revision_rejects_stale_version(auth):
    note = new_note(auth)
    updated = auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "第二版", "version": note["version"], "mode": "manual"},
    ).json()
    first_rev = auth.get(f"/api/v1/notes/{note['id']}/revisions").json()[-1]
    stale = auth.post(
        f"/api/v1/notes/{note['id']}/revisions/{first_rev['id']}/restore",
        json={"version": note["version"]},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "VERSION_CONFLICT"
    assert auth.get(f"/api/v1/notes/{note['id']}").json()["version"] == updated["version"]


def test_revision_cap_is_100(auth, db):
    note = new_note(auth)
    for i in range(110):
        db.add(NoteRevision(note_id=note["id"], title="t", content=f"v{i}", reason="manual"))
    db.commit()
    auth.put(
        f"/api/v1/notes/{note['id']}",
        json={"content": "触发裁剪", "version": note["version"], "mode": "manual"},
    )
    assert len(auth.get(f"/api/v1/notes/{note['id']}/revisions").json()) <= 100


def test_note_image_reference_and_trash_restore(auth, db):
    from app.models import FileRef

    files = {"file": ("a.png", b"\x89PNG\r\n\x1a\n" + b"0" * 100, "image/png")}
    uploaded = auth.post("/api/v1/files", files=files).json()

    note = new_note(
        auth,
        title="图片笔记",
        content=f"![图](/api/v1/files/{uploaded['id']}/content)",
        tags=["图"],
    )
    refs = db.query(FileRef).filter(FileRef.owner_type == "note", FileRef.owner_id == note["id"]).all()
    assert len(refs) == 1
    assert db.get(__import__("app.models", fromlist=["FileObject"]).FileObject, uploaded["id"]).status == "bound"

    assert auth.delete(f"/api/v1/notes/{note['id']}").status_code == 200
    assert auth.get("/api/v1/notes").json() == []

    entry = auth.get("/api/v1/trash?kind=note").json()["items"][0]
    assert entry["entity_id"] == note["id"]
    restored = auth.post(f"/api/v1/trash/note/{note['id']}/restore")
    assert restored.status_code == 200
    assert auth.get(f"/api/v1/notes/{note['id']}").json()["tags"] == ["图"]


def test_note_body_size_limit(auth):
    big = "a" * (1024 * 1024 + 10)
    resp = auth.post("/api/v1/notes", json={"title": "太大", "content": big})
    assert resp.status_code == 413


def test_memo_create_and_fields(auth):
    resp = auth.post(
        "/api/v1/memos",
        json={"title": "供应商", "content": "张老板 13800000000\n备货 3 天", "category": "采购", "color": "yellow"},
    )
    assert resp.status_code == 201, resp.text
    memo = resp.json()
    assert memo["title"] == "供应商"
    assert memo["display_category"] == "采购"
    assert memo["color"] == "yellow"

    assert auth.get("/api/v1/memos/categories").json() == ["采购"]

    updated = auth.patch(f"/api/v1/memos/{memo['id']}", json={"color": "blue", "category": "物流"})
    assert updated.json()["color"] == "blue"
    assert set(auth.get("/api/v1/memos/categories").json()) == {"物流"}


def test_memo_blank_content_and_limits(auth):
    assert auth.post("/api/v1/memos", json={"content": "   "}).status_code == 422
    assert auth.post("/api/v1/memos", json={"content": "a" * 2001}).status_code == 422
    assert auth.post("/api/v1/memos", json={"content": "正文", "color": "rainbow"}).status_code == 422


def test_memo_untitled_and_category_filters(auth):
    auth.post("/api/v1/memos", json={"content": "随手记"})
    auth.post("/api/v1/memos", json={"content": "有分类", "category": "采购"})
    items = auth.get("/api/v1/memos").json()
    assert len(items) == 2
    assert any(i["display_title"] == "无标题便利贴" for i in items)

    assert len(auth.get("/api/v1/memos?category=采购").json()) == 1
    assert len(auth.get("/api/v1/memos?category=__uncategorized__").json()) == 1
    assert len(auth.get("/api/v1/memos?q=随手").json()) == 1
    assert len(auth.get("/api/v1/memos?q=不存在").json()) == 0


def test_memo_delete_and_restore_keeps_color(auth, db):
    memo = auth.post(
        "/api/v1/memos", json={"title": "T", "content": "正文\n第二行", "category": "采购", "color": "pink"}
    ).json()
    auth.delete(f"/api/v1/memos/{memo['id']}")
    assert auth.get("/api/v1/memos").json() == []

    restored = auth.post(f"/api/v1/trash/memo/{memo['id']}/restore")
    assert restored.status_code == 200
    items = auth.get("/api/v1/memos").json()
    assert items[0]["color"] == "pink"
    assert items[0]["content"] == "正文\n第二行"
    assert items[0]["category"] == "采购"


def test_memo_version_conflict(auth):
    memo = auth.post("/api/v1/memos", json={"content": "初版"}).json()
    first = auth.patch(f"/api/v1/memos/{memo['id']}", json={"content": "改一", "version": memo["version"]})
    assert first.status_code == 200
    second = auth.patch(f"/api/v1/memos/{memo['id']}", json={"content": "改二", "version": memo["version"]})
    assert second.status_code == 409


def test_note_can_be_moved_to_uncategorized_without_deleting_content(auth):
    folder = auth.post('/api/v1/note-folders', json={'name': '待整理'}).json()
    note = new_note(auth, folder_id=folder['id'])
    moved = auth.put(f"/api/v1/notes/{note['id']}", json={'folder_id': None, 'version': note['version']})
    assert moved.status_code == 200
    assert moved.json()['folder_id'] is None
    assert moved.json()['content'] == note['content']
    folders = auth.get('/api/v1/note-folders').json()
    assert folders['uncategorized'] == 1
    assert folders['folders'][0]['note_count'] == 0


def test_memo_manual_order(auth):
    created = [
        auth.post("/api/v1/memos", json={"content": f"排序测试{i}", "category": "排序测试"}).json()
        for i in range(3)
    ]
    items = auth.get("/api/v1/memos?category=排序测试").json()
    assert [item["id"] for item in items] == [created[2]["id"], created[1]["id"], created[0]["id"]]

    wanted = [created[0]["id"], created[1]["id"], created[2]["id"]]
    before = {item["id"]: item["updated_at"] for item in items}
    assert auth.put("/api/v1/memos/order", json={"ids": wanted}).status_code == 200
    items = auth.get("/api/v1/memos?category=排序测试").json()
    assert [item["id"] for item in items] == wanted
    assert {item["id"]: item["updated_at"] for item in items} == before

    assert auth.put("/api/v1/memos/order", json={"ids": [created[0]["id"], 999999]}).status_code == 404
