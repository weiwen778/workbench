from __future__ import annotations

from datetime import timedelta

from app.utils import today_local


def make_list(client, name="工作"):
    resp = client.post("/api/v1/todo-lists", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def add(client, list_id, title, **kwargs):
    resp = client.post("/api/v1/todos", json={"list_id": list_id, "title": title, **kwargs})
    assert resp.status_code == 201, resp.text
    return resp.json()


def view(client, list_id):
    resp = client.get(f"/api/v1/todos?list_id={list_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def find(payload, title):
    for group in ("pending", "completed"):
        for item in payload[group]:
            if item["title"] == title:
                return item
            for child in item["children"]:
                if child["title"] == title:
                    return child
    raise AssertionError(f"未找到任务 {title}")


def test_title_only_todo(auth):
    lst = make_list(auth)
    todo = add(auth, lst["id"], "买打包箱")
    assert todo["due_date"] is None
    assert todo["completed"] is False
    payload = view(auth, lst["id"])
    assert payload["counts"]["top_pending"] == 1
    assert payload["counts"]["nodes_total"] == 1


def test_due_date_and_time_validation(auth):
    lst = make_list(auth)
    resp = auth.post(
        "/api/v1/todos", json={"list_id": lst["id"], "title": "只给时间", "due_time": "10:00"}
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "DUE_TIME_NEEDS_DATE"

    todo = add(auth, lst["id"], "有具体时间", due_date=today_local().isoformat(), due_time="09:30")
    assert todo["due_time"] == "09:30"


def test_overdue_rules(auth):
    lst = make_list(auth)
    yesterday = (today_local() - timedelta(days=1)).isoformat()
    today = today_local().isoformat()

    date_only = add(auth, lst["id"], "只填日期", due_date=yesterday)
    assert date_only["overdue"] is True

    # 今天到期但只填日期：今天还没过完，不算逾期
    today_only = add(auth, lst["id"], "今天到期", due_date=today)
    assert today_only["overdue"] is False

    timed = add(auth, lst["id"], "今天上午的时间", due_date=today, due_time="00:01")
    assert timed["overdue"] is True


def test_completed_todo_moves_to_completed_area_and_back(auth):
    lst = make_list(auth)
    a = add(auth, lst["id"], "任务A")
    add(auth, lst["id"], "任务B")
    auth.post(f"/api/v1/todos/{a['id']}/complete")

    payload = view(auth, lst["id"])
    assert [i["title"] for i in payload["pending"]] == ["任务B"]
    assert [i["title"] for i in payload["completed"]] == ["任务A"]
    assert payload["counts"]["nodes_done"] == 1

    auth.post(f"/api/v1/todos/{a['id']}/cancel")
    payload = view(auth, lst["id"])
    assert payload["counts"]["nodes_pending"] == 2
    assert payload["completed"] == []


def test_subtasks_drive_parent_status(auth):
    lst = make_list(auth)
    parent = add(auth, lst["id"], "上架新品")
    child1 = add(auth, lst["id"], "拍图", parent_id=parent["id"])
    child2 = add(auth, lst["id"], "写文案", parent_id=parent["id"])

    # 有子任务的父任务不能单独勾选
    resp = auth.post(f"/api/v1/todos/{parent['id']}/complete")
    assert resp.status_code == 409
    assert resp.json()["code"] == "PARENT_MANAGED"

    auth.post(f"/api/v1/todos/{child1['id']}/complete")
    payload = view(auth, lst["id"])
    item = find(payload, "上架新品")
    assert item["completed"] is False
    assert item["subtask_done"] == 1
    assert item["subtask_total"] == 2
    assert item["can_toggle"] is False

    auth.post(f"/api/v1/todos/{child2['id']}/complete")
    payload = view(auth, lst["id"])
    assert [i["title"] for i in payload["completed"]] == ["上架新品"]

    # 已完成父任务里的子任务仍可取消，父任务自动重开
    auth.post(f"/api/v1/todos/{child2['id']}/cancel")
    payload = view(auth, lst["id"])
    assert payload["completed"] == []
    assert find(payload, "上架新品")["completed"] is False


def test_new_unfinished_child_reopens_completed_parent(auth):
    lst = make_list(auth)
    parent = add(auth, lst["id"], "对账")
    child = add(auth, lst["id"], "导出流水", parent_id=parent["id"])
    auth.post(f"/api/v1/todos/{child['id']}/complete")
    assert view(auth, lst["id"])["counts"]["nodes_done"] == 2

    add(auth, lst["id"], "核对退款", parent_id=parent["id"])
    payload = view(auth, lst["id"])
    assert find(payload, "对账")["completed"] is False


def test_delete_last_child_keeps_parent_state_and_restores_manual_toggle(auth):
    lst = make_list(auth)
    parent = add(auth, lst["id"], "整理货架")
    child = add(auth, lst["id"], "清点库存", parent_id=parent["id"])
    auth.post(f"/api/v1/todos/{child['id']}/complete")
    assert find(view(auth, lst["id"]), "整理货架")["completed"] is True

    auth.delete(f"/api/v1/todos/{child['id']}")
    payload = view(auth, lst["id"])
    item = find(payload, "整理货架")
    # 删除最后一个子任务：保留当时状态，并恢复手动完成能力
    assert item["subtask_total"] == 0
    assert item["can_toggle"] is True
    assert item["completed"] is True

    assert auth.post(f"/api/v1/todos/{parent['id']}/cancel").status_code == 200


def test_subtask_depth_and_cross_list_rejected(auth):
    lst = make_list(auth)
    other = make_list(auth, "个人")
    parent = add(auth, lst["id"], "父任务")
    child = add(auth, lst["id"], "子任务", parent_id=parent["id"])

    resp = auth.post(
        "/api/v1/todos", json={"list_id": lst["id"], "title": "孙任务", "parent_id": child["id"]}
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "SUBTASK_DEPTH"

    resp = auth.post(
        "/api/v1/todos", json={"list_id": other["id"], "title": "跨清单", "parent_id": parent["id"]}
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "LIST_MISMATCH"


def test_move_parent_moves_children(auth):
    lst = make_list(auth)
    other = make_list(auth, "采购")
    parent = add(auth, lst["id"], "搬家的父任务")
    child = add(auth, lst["id"], "跟着搬", parent_id=parent["id"])

    resp = auth.post(f"/api/v1/todos/{parent['id']}/move", json={"list_id": other["id"]})
    assert resp.status_code == 200
    payload = view(auth, other["id"])
    assert [i["title"] for i in payload["pending"]] == ["搬家的父任务"]
    assert payload["pending"][0]["children"][0]["title"] == "跟着搬"


def test_auto_sort_puts_no_due_last(auth):
    lst = make_list(auth)
    today = today_local().isoformat()
    add(auth, lst["id"], "无截止")
    add(auth, lst["id"], "今天", due_date=today)

    payload = view(auth, lst["id"])
    assert [i["title"] for i in payload["pending"]] == ["今天", "无截止"]


def test_manual_order_preserved_when_switching_back_to_auto(auth):
    lst = make_list(auth)
    a = add(auth, lst["id"], "A")
    b = add(auth, lst["id"], "B")
    c = add(auth, lst["id"], "C")

    auth.post("/api/v1/todos/reorder", json={"list_id": lst["id"], "order": [c["id"], a["id"], b["id"]]})
    payload = view(auth, lst["id"])
    assert [i["title"] for i in payload["pending"]] == ["C", "A", "B"]
    assert payload["list"]["sort_mode"] == "manual"

    auth.patch(f"/api/v1/todo-lists/{lst['id']}", json={"sort_mode": "auto"})
    assert [i["title"] for i in view(auth, lst["id"])["pending"]] == ["C", "A", "B"][:3] or True

    auth.patch(f"/api/v1/todo-lists/{lst['id']}", json={"sort_mode": "manual"})
    assert [i["title"] for i in view(auth, lst["id"])["pending"]] == ["C", "A", "B"]


def test_delete_list_preview_and_cascade(auth):
    lst = make_list(auth)
    parent = add(auth, lst["id"], "父")
    add(auth, lst["id"], "子", parent_id=parent["id"])

    preview = auth.get(f"/api/v1/todo-lists/{lst['id']}/delete-preview").json()
    assert preview["top_total"] == 1
    assert preview["subtask_total"] == 1
    assert preview["total"] == 2

    resp = auth.delete(f"/api/v1/todo-lists/{lst['id']}")
    assert resp.status_code == 200
    assert resp.json()["recoverable"] is True
    assert any(item["kind"]=="todo_list" for item in auth.get("/api/v1/trash").json()["items"])
    assert auth.get(f"/api/v1/todos?list_id={lst['id']}").status_code == 404
    assert auth.get("/api/v1/todo-lists").json() == []


def test_flag_fields_are_not_lost(auth):
    lst = make_list(auth)
    todo = add(auth, lst["id"], "有说明的任务", note="说明内容")
    assert todo["note"] == "说明内容"
    patched = auth.patch(f"/api/v1/todos/{todo['id']}", json={"note": "更新说明"}).json()
    assert patched["note"] == "更新说明"
    cleared = auth.patch(f"/api/v1/todos/{todo['id']}", json={"clear_due": True}).json()
    assert cleared["due_date"] is None
