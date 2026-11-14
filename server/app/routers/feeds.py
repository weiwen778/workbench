from __future__ import annotations

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import FeedSubscription, User
from ..services import feed_service as service
from ..services.common_sources import COMMON_SOURCES
from ..services.feed_catalog import COMMON_GROUPS, HOT_SOURCE_IDS
from ..services.feed_translation import translate_texts, translation_status

router = APIRouter(tags=["feeds"], dependencies=[Depends(get_current_user)])


class HotRefreshIn(BaseModel):
    source_ids: list[str] | None = Field(default=None, max_length=10)
    force: bool = False


class SubscribeIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=200)


class SubscriptionPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    enabled: bool | None = None


class SubscriptionRefreshIn(BaseModel):
    subscription_ids: list[int] | None = Field(default=None, max_length=50)
    force: bool = False


class EntryPatch(BaseModel):
    read: bool | None = None
    favorite: bool | None = None


class TranslateIn(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=20)
    target_lang: str = "zh"
    provider: str | None = Field(default=None, max_length=20)


@router.get("/feeds/hot")
def hot_list(db: Session = Depends(get_db)):
    payload = service.hot_payload(db)
    payload["translation"] = translation_status(db)
    return payload


@router.post("/feeds/hot/refresh", status_code=202)
def refresh_hot(payload: HotRefreshIn, background: BackgroundTasks):
    if not settings.feed_enabled:
        raise ApiError("FEED_DISABLED", "信息聚合已关闭，不会发起外部请求", 409)
    ids = payload.source_ids or HOT_SOURCE_IDS
    started, joined = service.request_hot_refresh(ids, payload.force)
    if started:
        background.add_task(service.run_hot_refresh, started, payload.force)
    return {"started": started, "joined": joined}


@router.get("/feeds/subscriptions")
def subscriptions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = service.list_subscriptions(db, user.id)
    return {
        "items": [service.subscription_payload(db, row) for row in rows],
        "translation": translation_status(db),
    }


@router.post("/feeds/subscriptions/preview")
def preview_subscription(payload: SubscribeIn):
    return service.preview_subscription(payload.url)


@router.post("/feeds/subscriptions", status_code=201)
def create_subscription(payload: SubscribeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = service.add_subscription(db, user.id, payload.url, payload.title)
    return service.subscription_payload(db, row)


@router.patch("/feeds/subscriptions/{subscription_id}")
def update_subscription(
    subscription_id: int, payload: SubscriptionPatch,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    row = service.update_subscription(db, user.id, subscription_id, payload.title, payload.enabled)
    return service.subscription_payload(db, row)


@router.delete("/feeds/subscriptions/{subscription_id}")
def delete_subscription(subscription_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    service.delete_subscription(db, user.id, subscription_id)
    return {"deleted": True}


@router.post("/feeds/subscriptions/refresh", status_code=202)
def refresh_subscriptions(
    payload: SubscriptionRefreshIn, background: BackgroundTasks,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    if not settings.feed_enabled:
        raise ApiError("FEED_DISABLED", "信息聚合已关闭，不会发起外部请求", 409)
    if payload.subscription_ids:
        rows = db.scalars(
            select(FeedSubscription.id).where(
                FeedSubscription.user_id == user.id,
                FeedSubscription.id.in_(payload.subscription_ids),
                FeedSubscription.enabled.is_(True),
                FeedSubscription.deleted_at.is_(None),
            )
        ).all()
        ids = list(rows)
    elif payload.force:
        ids = list(db.scalars(
            select(FeedSubscription.id).where(
                FeedSubscription.user_id == user.id,
                FeedSubscription.enabled.is_(True),
                FeedSubscription.deleted_at.is_(None),
            )
        ).all())
    else:
        ids = service.due_subscription_ids(db, user.id)
    started, joined = service.request_subscription_refresh(ids, payload.force)
    if started:
        background.add_task(service.run_subscription_refresh, started, payload.force)
    return {"started": started, "joined": joined}


@router.get("/feeds/entries")
def entries(
    subscription_id: int | None = None,
    unread: bool = False,
    favorite: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if subscription_id is not None:
        row = service.get_subscription(db, user.id, subscription_id)
        if row.deleted_at is not None and not favorite:
            raise ApiError("NOT_FOUND", "订阅不存在", 404)
    return service.list_entries(
        db, user.id, subscription_id=subscription_id, unread=unread,
        favorite=favorite, limit=limit, offset=offset,
    )


@router.patch("/feeds/entries/{entry_id}")
def update_entry(entry_id: int, payload: EntryPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.read is None and payload.favorite is None:
        raise ApiError("NO_CHANGES", "没有需要更新的状态", 422)
    return service.update_entry(db, user.id, entry_id, read=payload.read, favorite=payload.favorite)


@router.post("/feeds/translations")
def translate_titles(payload: TranslateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.target_lang != "zh":
        raise ApiError("UNSUPPORTED_LANGUAGE", "信息聚合首版仅支持中文译文", 422)
    return translate_texts(db, payload.texts, payload.provider)


@router.get("/feeds/translation-status")
def get_translation_status(db: Session = Depends(get_db)):
    return translation_status(db)


@router.get("/feeds/calendar")
def calendar(
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
):
    if end < start or (end - start).days > 62:
        raise ApiError("INVALID_RANGE", "日期范围最多 62 天", 422)
    return service.calendar_payload(db, start, end)


@router.get("/feeds/data-panels")
def data_panels(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.data_panels_payload(db, user.id)


@router.post("/feeds/common/{key}/refresh", status_code=202)
def refresh_common_key(key: str, background: BackgroundTasks, db: Session = Depends(get_db)):
    if not settings.feed_enabled or not settings.feed_common_enabled:
        raise ApiError("FEED_DISABLED", "信息聚合已关闭，不会发起外部请求", 409)
    if key not in COMMON_SOURCES:
        raise ApiError("UNKNOWN_COMMON_SOURCE", "未知通用信息源", 404)
    remaining = service.common_cooldown_remaining(db, key)
    if remaining > 0:
        return {"queued": False, "reason": "cooldown", "retry_after": remaining}
    started, joined = service.request_common_refresh([key], force=True)
    if started:
        background.add_task(service.run_common_refresh, started, True)
        return {"queued": True}
    return {"queued": False, "reason": "joined"}


@router.get("/feeds/common")
def common_sources(db: Session = Depends(get_db)):
    return {
        "groups": COMMON_GROUPS,
        "note": "公开数据自动刷新；需要登录的入口在浏览器打开。",
        "sources": service.common_payload(db)["sources"],
    }
