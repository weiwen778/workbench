from sqlalchemy import event

from app.db import engine
from app.models import CheckinGroup, CheckinRule, WorkTarget
from app.routers.checkins import list_instances


def test_listing_batches_queries_and_preserves_instances(db):
    group = CheckinGroup(name="Batch regression")
    db.add(group)
    db.flush()
    for number in range(4):
        target = WorkTarget(kind="shop", name=f"Target {number}")
        db.add(target)
        db.flush()
        db.add_all([CheckinRule(target_id=target.id, group_id=group.id,
                                title=f"Rule {index}", period="daily") for index in range(40)])
    db.commit()
    selects = []
    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    try:
        first = list_instances(kind="shop", period="daily", target_id=None,
                               status="all", period_start=None, db=db)
        first_ids = {item["id"] for group in first["groups"] for item in group["items"]}
        assert len(first_ids) == 160
        assert len(selects) <= 10
        selects.clear()
        second = list_instances(kind="shop", period="daily", target_id=None,
                                status="all", period_start=None, db=db)
        assert {item["id"] for group in second["groups"] for item in group["items"]} == first_ids
        assert len(selects) <= 10
    finally:
        event.remove(engine, "before_cursor_execute", capture)
