from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import (
    ActivityInterval,
    CheckinGroup,
    CheckinRule,
    CheckinRuleVersion,
    WorkTarget,
    utcnow,
)
from ..services.checkins import ensure_target_period

router = APIRouter(tags=["checkin-import"], dependencies=[Depends(get_current_user)])

KINDS = {"shop", "social"}
MAX_TARGETS = 200
MAX_RULES = 2000
DEFAULT_GROUP = "默认分类"

TARGET_KEYS = ("店铺", "账号", "店铺账号", "打卡对象", "targets", "target")
GROUP_KEYS = ("分类", "分组", "groups")
RULE_KEYS = ("任务", "打卡任务", "任务列表", "rules", "rule", "items")
NAME_KEYS = ("名称", "名字", "name")
PLATFORM_KEYS = ("平台", "platform")
NOTE_KEYS = ("备注", "note")
TITLE_KEYS = ("名称", "标题", "title", "name")
DESC_KEYS = ("说明", "描述", "description")
FREQ_KEYS = ("频率", "周期", "多久一次", "period", "frequency")
GROUP_REF_KEYS = ("分类", "分组", "group", "group_name")

PERIODS = {
    "daily": "daily", "每天": "daily", "每日": "daily", "一天": "daily",
    "一天一次": "daily", "日": "daily", "按天": "daily",
    "weekly": "weekly", "每周": "weekly", "一周": "weekly", "周": "weekly", "按周": "weekly",
    "monthly": "monthly", "每月": "monthly", "一月": "monthly", "月": "monthly", "按月": "monthly",
}


def _pick(data: dict, keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def _text(value: Any, where: str, label: str, limit: int, errors: list[str], required: bool = False):
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            errors.append(f"{where}：{label}不能为空")
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if len(value) > limit:
        errors.append(f"{where}：{label}最多 {limit} 个字")
        return None
    return value or None


def parse_payload(payload: Any) -> tuple[list[str], list[dict], list[str]]:
    """把用户填的 JSON 解析成 (分类列表, 待导入对象, 错误列表)。"""
    errors: list[str] = []
    if not isinstance(payload, dict):
        return [], [], ["文件最外层必须是一个用 { } 包起来的对象"]

    raw_targets = _pick(payload, TARGET_KEYS)
    if raw_targets is None:
        errors.append("缺少「店铺」或「账号」列表")
        raw_targets = []
    elif isinstance(raw_targets, dict):
        raw_targets = [raw_targets]
    if not isinstance(raw_targets, list):
        errors.append("「店铺」/「账号」必须是一个列表")
        raw_targets = []
    elif len(raw_targets) > MAX_TARGETS:
        errors.append(f"一次最多导入 {MAX_TARGETS} 个对象，当前有 {len(raw_targets)} 个")

    groups: list[str] = []

    def add_group(name: str) -> None:
        if name and name not in groups:
            groups.append(name)

    raw_groups = _pick(payload, GROUP_KEYS)
    if raw_groups is not None:
        if isinstance(raw_groups, str):
            raw_groups = [raw_groups]
        if not isinstance(raw_groups, list):
            errors.append("「分类」必须是一个列表")
        else:
            for index, item in enumerate(raw_groups):
                value = item if isinstance(item, str) else _pick(item, NAME_KEYS) if isinstance(item, dict) else None
                name = _text(value, f"分类第 {index + 1} 项", "分类名称", 100, errors, required=True)
                add_group(name)

    targets: list[dict] = []
    total_rules = 0
    for index, item in enumerate(raw_targets):
        where = f"第 {index + 1} 个对象"
        if not isinstance(item, dict):
            errors.append(f"{where}必须是一个用 {{ }} 包起来的对象")
            continue
        name = _text(_pick(item, NAME_KEYS), where, "名称", 100, errors, required=True)
        platform = _text(_pick(item, PLATFORM_KEYS), where, "平台", 100, errors)
        note = _text(_pick(item, NOTE_KEYS), where, "备注", 2000, errors)

        raw_rules = _pick(item, RULE_KEYS)
        if raw_rules is None:
            raw_rules = []
        elif isinstance(raw_rules, dict):
            raw_rules = [raw_rules]
        if not isinstance(raw_rules, list):
            errors.append(f"{where}的「任务」必须是一个列表")
            raw_rules = []

        rules: list[dict] = []
        for rule_index, rule in enumerate(raw_rules):
            rule_where = f"{where}的第 {rule_index + 1} 个任务"
            total_rules += 1
            if not isinstance(rule, dict):
                errors.append(f"{rule_where}必须是一个用 {{ }} 包起来的对象")
                continue
            title = _text(_pick(rule, TITLE_KEYS), rule_where, "名称", 200, errors, required=True)
            group_name = _text(_pick(rule, GROUP_REF_KEYS), rule_where, "分类", 100, errors) or DEFAULT_GROUP
            description = _text(_pick(rule, DESC_KEYS), rule_where, "说明", 5000, errors)

            raw_freq = _pick(rule, FREQ_KEYS)
            if raw_freq is None:
                period = "daily"
            else:
                period = PERIODS.get(str(raw_freq).strip().lower())
                if not period:
                    errors.append(f"{rule_where}：频率只能填 每天 / 每周 / 每月，现在是「{raw_freq}」")
                    period = "daily"

            if title:
                rules.append(
                    {"title": title, "group": group_name, "period": period, "description": description}
                )
                add_group(group_name)

        targets.append({"name": name, "platform": platform, "note": note, "rules": rules})

    if total_rules > MAX_RULES:
        errors.append(f"一次最多导入 {MAX_RULES} 个任务，当前有 {total_rules} 个")
    return groups, targets, errors


@router.post("/checkin-imports", status_code=201)
def import_checkins(
    payload: dict = Body(...),
    kind: str = Query(default="shop"),
    db: Session = Depends(get_db),
):
    if kind not in KINDS:
        raise ApiError("INVALID_KIND", "类型只能是 shop 或 social", 422)

    groups, targets, errors = parse_payload(payload)
    if errors:
        raise ApiError(
            "IMPORT_INVALID",
            "文件里有需要修改的地方，这次没有导入任何内容",
            422,
            {"errors": errors[:50], "total_errors": len(errors)},
        )

    created = {"targets": 0, "groups": 0, "rules": 0}
    reused = {"targets": 0, "groups": 0}
    skipped: list[dict] = []

    group_cache: dict[str, CheckinGroup] = {}
    group_sort = db.scalar(select(func.max(CheckinGroup.sort_order))) or 0
    for name in groups:
        existing = db.scalar(select(CheckinGroup).where(CheckinGroup.name == name))
        if existing:
            group_cache[name] = existing
            reused["groups"] += 1
            continue
        group_sort += 1
        group = CheckinGroup(name=name, sort_order=group_sort)
        db.add(group)
        db.flush()
        group_cache[name] = group
        created["groups"] += 1

    target_sort = db.scalar(select(func.max(WorkTarget.sort_order))) or 0
    for item in targets:
        target = db.scalar(
            select(WorkTarget).where(
                WorkTarget.kind == kind,
                WorkTarget.name == item["name"],
                WorkTarget.status == "active",
            )
        )
        if target:
            reused["targets"] += 1
        else:
            target_sort += 1
            target = WorkTarget(
                kind=kind,
                name=item["name"],
                platform=item["platform"],
                note=item["note"],
                sort_order=target_sort,
            )
            db.add(target)
            db.flush()
            db.add(ActivityInterval(target_id=target.id, start_at=utcnow(), reason="创建"))
            created["targets"] += 1

        rule_sort = db.scalar(
            select(func.max(CheckinRule.sort_order)).where(CheckinRule.target_id == target.id)
        ) or 0
        for rule in item["rules"]:
            duplicate = db.scalar(
                select(CheckinRule).where(
                    CheckinRule.target_id == target.id,
                    CheckinRule.title == rule["title"],
                )
            )
            if duplicate:
                skipped.append(
                    {"target": target.name, "title": rule["title"], "reason": "同名任务已存在"}
                )
                continue
            group = group_cache[rule["group"]]
            rule_sort += 1
            record = CheckinRule(
                target_id=target.id,
                group_id=group.id,
                title=rule["title"],
                description=rule["description"],
                period=rule["period"],
                sort_order=rule_sort,
            )
            db.add(record)
            db.flush()
            db.add(
                CheckinRuleVersion(
                    rule_id=record.id,
                    title=record.title,
                    description=record.description,
                    group_id=group.id,
                    group_name=group.name,
                    period=record.period,
                    change_summary="导入创建",
                )
            )
            ensure_target_period(db, target, rule["period"])
            created["rules"] += 1

    db.commit()
    return {
        "created": created,
        "reused": reused,
        "skipped": skipped[:50],
        "skipped_total": len(skipped),
    }


@router.get("/checkin-imports/template")
def import_template(kind: str = Query(default="shop")):
    label = "账号" if kind == "social" else "店铺"
    platform = "抖音" if kind == "social" else "1688"
    sample = {
        "_说明": [
            f"在「{label}」里填你要打卡的对象，一个对象一条。",
            "每个对象的「任务」里填要打卡的事；频率写 每天 / 每周 / 每月，不写就是每天。",
            "「分类」可以单独列一份；任务里写了但没列出来的分类会自动创建。",
            "已经有同名的不会重复创建；同一个对象下同名的任务会被跳过。",
            "填完另存为 .json 文件（UTF-8 编码），回到页面点「导入」选这个文件。",
            "以 _ 开头的字段只是给你看的说明，导入时会自动忽略。",
        ],
        "分类": ["内容发布", "客户回复"],
        label: [
            {
                "名称": "这是示例，可以整条删掉",
                "平台": platform,
                "备注": "备注可以不填",
                "任务": [
                    {"名称": "发布 1 条内容", "分类": "内容发布", "频率": "每天", "说明": ""},
                    {"名称": "回复全部评论", "分类": "客户回复", "频率": "每周"},
                ],
            }
        ],
    }
    body = json.dumps(sample, ensure_ascii=False, indent=2)
    filename = quote(f"打卡导入模板-{label}.json")
    return JSONResponse(
        content=json.loads(body),
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
