from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_admin_user, get_current_user
from ..errors import ApiError
from ..models import TranslationConnection, TranslationFavorite, TranslationHistory, utcnow
from ..services import providers as prov
from ..services.encryption import decrypt_config, encrypt_config, mask
from ..services.languages import language_catalog, languages_for, supports
from ..utils import iso_z

router = APIRouter(tags=["translate"], dependencies=[Depends(get_current_user)])

PROVIDERS = {
    "baidu": "百度翻译",
    "youdao": "有道翻译",
    "deepseek": "DeepSeek",
    "zhipu": "智谱 GLM",
    "openai": "OpenAI 兼容",
    "deepl": "DeepL",
    "mymemory": "MyMemory（免费）",
    "libretranslate": "LibreTranslate",
}
FIELDS = {
    "baidu": ["app_id", "secret"],
    "youdao": ["app_key", "secret"],
    "deepseek": ["api_key"],
    "zhipu": ["api_key"],
    "openai": ["api_key"],
    "deepl": ["api_key"],
    "mymemory": [],
    "libretranslate": ["api_key"],
}
REQUIRED = {
    "baidu": ["app_id", "secret"],
    "youdao": ["app_key", "secret"],
    "deepseek": ["api_key"],
    "zhipu": ["api_key"],
    "openai": ["api_key"],
    "deepl": ["api_key"],
    "mymemory": [],
    "libretranslate": ["base_url"],
}
KEYLESS = {"mymemory"}
MODEL_PROVIDERS = {"deepseek", "zhipu", "openai"}
DEFAULT_MODELS = {"deepseek": "deepseek-chat", "zhipu": "glm-4-flash", "openai": "gpt-4o-mini"}
LABELS = {
    "app_id": "APP ID",
    "app_key": "应用 ID",
    "secret": "应用密钥",
    "api_key": "API Key",
    "base_url": "接口地址",
}


class ConnectionIn(BaseModel):
    enabled: bool | None = None
    config: dict | None = None
    model: str | None = Field(default=None, max_length=100)


class TranslateIn(BaseModel):
    provider: str
    source_text: str
    source_lang: str = "auto"
    target_lang: str = "en"


class FavoriteIn(BaseModel):
    source_text: str = Field(min_length=1, max_length=20_000)
    target_text: str = Field(min_length=1, max_length=40_000)
    source_lang: str = "auto"
    target_lang: str = "en"
    provider: str
    model: str | None = Field(default=None, max_length=100)


def _conn(db: Session, provider: str) -> TranslationConnection:
    if provider not in PROVIDERS:
        raise ApiError("UNKNOWN_PROVIDER", "未知翻译服务", 422)
    conn = db.scalar(select(TranslationConnection).where(TranslationConnection.provider == provider))
    if not conn:
        conn = TranslationConnection(provider=provider, enabled=False)
        db.add(conn)
        db.commit()
    return conn


def _ai_key(db: Session) -> str:
    from ..models import AiConnection
    connection = db.get(AiConnection, 1)
    if not connection or not connection.encrypted_config:
        return ""
    try:
        return decrypt_config(connection.encrypted_config).get("api_key", "")
    except ApiError:
        return ""


def _effective_config(db: Session, conn: TranslationConnection) -> dict:
    config = decrypt_config(conn.encrypted_config) if conn.encrypted_config else {}
    if conn.provider == "zhipu" and not config.get("api_key"):
        key = _ai_key(db)
        if key:
            config = {**config, "api_key": key}
    if conn.model:
        config = {**config, "model": conn.model}
    return config


def connection_payload(db: Session, conn: TranslationConnection) -> dict:
    key_ready = bool(settings.encryption_key)
    decrypt_error = None
    try:
        config = _effective_config(db, conn)
    except ApiError as exc:
        decrypt_error = exc.message
        config = {}
    masked = {field: mask(config.get(field)) for field in FIELDS.get(conn.provider, [])}
    return {
        "provider": conn.provider,
        "name": PROVIDERS.get(conn.provider, conn.provider),
        "enabled": conn.enabled,
        "configured": decrypt_error is None and (bool(config) or conn.provider in KEYLESS),
        "credential_key_ready": key_ready,
        "masked": masked,
        "base_url": config.get("base_url") or "",
        "model": conn.model,
        "limits": prov.limits_for(conn.provider),
        "languages": languages_for(conn.provider),
        "last_test_ok": conn.last_test_ok,
        "last_test_message": conn.last_test_message,
        "last_tested_at": iso_z(conn.last_tested_at),
        "updated_at": iso_z(conn.updated_at),
        "decrypt_error": decrypt_error,
    }


@router.get("/translation-connections")
def list_connections(db: Session = Depends(get_db)):
    items = []
    for provider in PROVIDERS:
        conn = _conn(db, provider)
        items.append(connection_payload(db, conn))
    return {
        "credential_key_ready": bool(settings.encryption_key),
        "message": None
        if settings.encryption_key
        else "服务端尚未配置翻译凭据主密钥（WB_ENCRYPTION_KEY），暂时无法保存或使用翻译服务",
        "items": items,
        "languages": language_catalog(),
    }


@router.put("/translation-connections/{provider}")
def save_connection(provider: str, payload: ConnectionIn, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    conn = _conn(db, provider)
    if payload.config is not None:
        allowed = set(FIELDS[provider]) | {"base_url"}
        clean = {k: str(v).strip() for k, v in payload.config.items() if k in allowed and str(v).strip()}
        current = {}
        if conn.encrypted_config:
            try:
                current = decrypt_config(conn.encrypted_config)
            except ApiError:
                current = {}
        if "base_url" in clean and clean["base_url"] != current.get("base_url"):
            try:
                prov.validate_base_url(clean["base_url"])
            except prov.UpstreamError as error:
                raise ApiError(error.code, error.message, error.status)
            secret_field = {"baidu": "secret", "youdao": "secret", "deepl": "api_key"}.get(provider, "api_key")
            if secret_field in FIELDS[provider] and not clean.get(secret_field):
                raise ApiError(
                    "CREDENTIAL_REENTRY_REQUIRED",
                    "修改服务地址时请重新填写该服务的密钥，避免旧密钥被发送到新地址",
                    422, {"fields": [secret_field]},
                )
        current.update(clean)
        missing = [f for f in REQUIRED[provider] if not current.get(f)]
        if missing and not (provider == "zhipu" and _ai_key(db)):
            raise ApiError(
                "PROVIDER_NOT_CONFIGURED",
                "请填写完整凭据：" + "、".join(LABELS[f] for f in missing),
                422,
                {"missing": missing},
            )
        if current:
            conn.encrypted_config = encrypt_config(current)
    if payload.model is not None and provider in MODEL_PROVIDERS:
        conn.model = (payload.model or DEFAULT_MODELS[provider]).strip() or DEFAULT_MODELS[provider]
    if payload.enabled is not None:
        if payload.enabled:
            existing = _effective_config(db, conn)
            missing = [f for f in REQUIRED[provider] if not existing.get(f)]
            if missing:
                raise ApiError(
                    "PROVIDER_NOT_CONFIGURED",
                    "启用前请先填写完整凭据：" + "、".join(LABELS[f] for f in missing),
                    409,
                    {"missing": missing},
                )
        conn.enabled = payload.enabled
    conn.updated_at = utcnow()
    db.commit()
    return connection_payload(db, conn)


@router.delete("/translation-connections/{provider}")
def clear_connection(provider: str, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    conn = _conn(db, provider)
    conn.encrypted_config = None
    conn.enabled = False
    conn.model = None
    conn.last_test_ok = None
    conn.last_test_message = None
    db.commit()
    return connection_payload(db, conn)


@router.post("/translation-connections/{provider}/test")
def test_connection(provider: str, user=Depends(get_admin_user), db: Session = Depends(get_db)):
    conn = _conn(db, provider)
    config = _effective_config(db, conn)
    if not config and provider not in KEYLESS:
        raise ApiError("PROVIDER_NOT_CONFIGURED", "尚未配置该服务的凭据", 409)
    started = time.monotonic()
    try:
        text, model = prov.translate(provider, "连接测试", "zh", "en", config)
        ok, message = True, f"连接成功，返回：{text[:40]}"
    except prov.UpstreamError as exc:
        ok, message = False, exc.message
    except ApiError as exc:
        ok, message = False, exc.message
    duration = int((time.monotonic() - started) * 1000)
    conn.last_test_ok = ok
    conn.last_test_message = message
    conn.last_tested_at = utcnow()
    db.commit()
    return {"ok": ok, "message": message, "duration_ms": duration}


@router.post("/translations")
def translate(payload: TranslateIn, db: Session = Depends(get_db)):
    if payload.provider not in PROVIDERS:
        raise ApiError("UNKNOWN_PROVIDER", "未知翻译服务", 422)
    source_lang = payload.source_lang if payload.source_lang != "auto" else "auto"
    if source_lang != "auto" and not supports(payload.provider, source_lang):
        raise ApiError("UNSUPPORTED_LANGUAGE", f"{PROVIDERS[payload.provider]} 不支持这个源语言", 422)
    if not supports(payload.provider, payload.target_lang):
        raise ApiError("UNSUPPORTED_LANGUAGE", f"{PROVIDERS[payload.provider]} 不支持这个目标语言", 422)
    if source_lang == payload.target_lang:
        raise ApiError("SAME_LANGUAGE", "源语言与目标语言不能相同", 422)

    conn = _conn(db, payload.provider)
    config = _effective_config(db, conn)
    if not config and payload.provider not in KEYLESS:
        raise ApiError("PROVIDER_NOT_CONFIGURED", f"{PROVIDERS[payload.provider]} 尚未配置凭据", 409)
    if not conn.enabled:
        raise ApiError("PROVIDER_DISABLED", f"{PROVIDERS[payload.provider]} 已停用，请先在服务设置中启用", 409)

    text = payload.source_text.strip()
    prov.check_limit(payload.provider, text)

    started = time.monotonic()
    try:
        target_text, model = prov.translate(payload.provider, text, source_lang, payload.target_lang, config)
    except prov.UpstreamError as exc:
        raise ApiError(exc.code, exc.message, exc.status)
    duration = int((time.monotonic() - started) * 1000)

    history = TranslationHistory(
        source_text=text,
        target_text=target_text,
        source_lang=source_lang,
        target_lang=payload.target_lang,
        provider=payload.provider,
        model=model or conn.model,
        mode="faithful",
        duration_ms=duration,
    )
    db.add(history)
    db.commit()
    return {
        "id": history.id,
        "source_text": text,
        "target_text": target_text,
        "provider": payload.provider,
        "provider_name": PROVIDERS[payload.provider],
        "source_lang": source_lang,
        "target_lang": payload.target_lang,
        "model": history.model,
        "duration_ms": duration,
        "created_at": iso_z(history.created_at),
    }


@router.get("/translation-history")
def history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    q: str | None = None,
    provider: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(TranslationHistory).order_by(TranslationHistory.created_at.desc(), TranslationHistory.id.desc())
    if provider:
        stmt = stmt.where(TranslationHistory.provider == provider)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(TranslationHistory.source_text.like(like), TranslationHistory.target_text.like(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": h.id,
                "source_text": h.source_text,
                "target_text": h.target_text,
                "source_lang": h.source_lang,
                "target_lang": h.target_lang,
                "provider": h.provider,
                "provider_name": PROVIDERS.get(h.provider, h.provider),
                "model": h.model,
                "duration_ms": h.duration_ms,
                "created_at": iso_z(h.created_at),
            }
            for h in rows
        ],
    }


@router.delete("/translation-history")
def clear_history(db: Session = Depends(get_db)):
    result = db.execute(delete(TranslationHistory))
    db.commit()
    return {"deleted": result.rowcount or 0}


@router.get("/translation-history/{history_id}")
def history_detail(history_id: int, db: Session = Depends(get_db)):
    h = db.get(TranslationHistory, history_id)
    if not h:
        raise ApiError("NOT_FOUND", "历史记录不存在", 404)
    return {
        "id": h.id,
        "source_text": h.source_text,
        "target_text": h.target_text,
        "source_lang": h.source_lang,
        "target_lang": h.target_lang,
        "provider": h.provider,
        "provider_name": PROVIDERS.get(h.provider, h.provider),
        "model": h.model,
        "duration_ms": h.duration_ms,
        "created_at": iso_z(h.created_at),
    }


@router.delete("/translation-history/{history_id}")
def delete_history(history_id: int, db: Session = Depends(get_db)):
    h = db.get(TranslationHistory, history_id)
    if not h:
        raise ApiError("NOT_FOUND", "历史记录不存在", 404)
    db.delete(h)
    db.commit()
    return {"deleted": True}

def _favorite_payload(fav: TranslationFavorite) -> dict:
    return {
        "id": fav.id,
        "source_text": fav.source_text,
        "target_text": fav.target_text,
        "source_lang": fav.source_lang,
        "target_lang": fav.target_lang,
        "provider": fav.provider,
        "provider_name": PROVIDERS.get(fav.provider, fav.provider),
        "model": fav.model,
        "created_at": iso_z(fav.created_at),
    }


@router.get("/translation-favorites")
def list_favorites(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(TranslationFavorite).order_by(
            TranslationFavorite.created_at.desc(), TranslationFavorite.id.desc()
        )
    ).all()
    return {"total": len(rows), "items": [_favorite_payload(row) for row in rows]}


@router.post("/translation-favorites", status_code=201)
def add_favorite(payload: FavoriteIn, db: Session = Depends(get_db)):
    if payload.provider not in PROVIDERS:
        raise ApiError("UNKNOWN_PROVIDER", "未知翻译服务", 422)
    source = payload.source_text.strip()
    target = payload.target_text.strip()
    if not source or not target:
        raise ApiError("EMPTY_FAVORITE", "没有可收藏的内容", 422)
    existing = db.scalar(
        select(TranslationFavorite).where(
            TranslationFavorite.source_text == source,
            TranslationFavorite.target_text == target,
            TranslationFavorite.provider == payload.provider,
        )
    )
    if existing:
        return _favorite_payload(existing)
    fav = TranslationFavorite(
        source_text=source,
        target_text=target,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        provider=payload.provider,
        model=payload.model,
        created_at=utcnow(),
    )
    db.add(fav)
    db.commit()
    db.refresh(fav)
    return _favorite_payload(fav)


@router.delete("/translation-favorites/{favorite_id}")
def delete_favorite(favorite_id: int, db: Session = Depends(get_db)):
    fav = db.get(TranslationFavorite, favorite_id)
    if not fav:
        raise ApiError("NOT_FOUND", "收藏不存在", 404)
    db.delete(fav)
    db.commit()
    return {"deleted": True}
