from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import TranslationConnection, TranslationHistory, utcnow
from ..services import providers as prov
from ..services.encryption import decrypt_config, encrypt_config, mask
from ..utils import iso_z

router = APIRouter(tags=["translate"], dependencies=[Depends(get_current_user)])

PROVIDERS = {"baidu": "百度翻译", "youdao": "有道翻译", "deepseek": "DeepSeek"}
FIELDS = {
    "baidu": ["app_id", "secret"],
    "youdao": ["app_key", "secret"],
    "deepseek": ["api_key"],
}
LABELS = {
    "app_id": "APP ID",
    "app_key": "应用 ID",
    "secret": "应用密钥",
    "api_key": "API Key",
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


def _conn(db: Session, provider: str) -> TranslationConnection:
    if provider not in PROVIDERS:
        raise ApiError("UNKNOWN_PROVIDER", "未知翻译服务", 422)
    conn = db.scalar(select(TranslationConnection).where(TranslationConnection.provider == provider))
    if not conn:
        conn = TranslationConnection(provider=provider, enabled=False)
        db.add(conn)
        db.commit()
    return conn


def connection_payload(conn: TranslationConnection) -> dict:
    key_ready = bool(settings.encryption_key)
    config: dict = {}
    decrypt_error = None
    if key_ready:
        try:
            config = decrypt_config(conn.encrypted_config)
        except ApiError as exc:
            decrypt_error = exc.message
    masked = {field: mask(config.get(field)) for field in FIELDS.get(conn.provider, [])}
    return {
        "provider": conn.provider,
        "name": PROVIDERS.get(conn.provider, conn.provider),
        "enabled": conn.enabled,
        "configured": bool(config),
        "credential_key_ready": key_ready,
        "masked": masked,
        "base_url": config.get("base_url") or "",
        "model": conn.model,
        "limits": prov.limits_for(conn.provider),
        "last_test_ok": conn.last_test_ok,
        "last_test_message": conn.last_test_message,
        "last_tested_at": iso_z(conn.last_tested_at),
        "updated_at": iso_z(conn.updated_at),
        "decrypt_error": decrypt_error,
    }


@router.get("/translation-connections")
def list_connections(db: Session = Depends(get_db)):
    conns = db.scalars(select(TranslationConnection)).all()
    by_provider = {c.provider: c for c in conns}
    items = [connection_payload(_conn(db, p)) for p in PROVIDERS if p in by_provider]
    return {
        "credential_key_ready": bool(settings.encryption_key),
        "message": None
        if settings.encryption_key
        else "服务端尚未配置翻译凭据主密钥（WB_ENCRYPTION_KEY），暂时无法保存或使用翻译服务",
        "items": items,
    }


@router.put("/translation-connections/{provider}")
def save_connection(provider: str, payload: ConnectionIn, db: Session = Depends(get_db)):
    conn = _conn(db, provider)
    if payload.config is not None:
        allowed = set(FIELDS[provider]) | {"base_url"}
        clean = {k: str(v).strip() for k, v in payload.config.items() if k in allowed and str(v).strip()}
        if not clean:
            raise ApiError("CONFIG_EMPTY", "请填写该服务需要的凭据", 422)
        current = {}
        if conn.encrypted_config:
            try:
                current = decrypt_config(conn.encrypted_config)
            except ApiError:
                current = {}
        current.update(clean)
        conn.encrypted_config = encrypt_config(current)
    if payload.model is not None and provider == "deepseek":
        conn.model = payload.model or "deepseek-chat"
    if payload.enabled is not None:
        if payload.enabled:
            existing = decrypt_config(conn.encrypted_config) if conn.encrypted_config else {}
            missing = [f for f in FIELDS[provider] if not existing.get(f)]
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
    return connection_payload(conn)


@router.delete("/translation-connections/{provider}")
def clear_connection(provider: str, db: Session = Depends(get_db)):
    conn = _conn(db, provider)
    conn.encrypted_config = None
    conn.enabled = False
    conn.model = None
    conn.last_test_ok = None
    conn.last_test_message = None
    db.commit()
    return connection_payload(conn)


@router.post("/translation-connections/{provider}/test")
def test_connection(provider: str, db: Session = Depends(get_db)):
    conn = _conn(db, provider)
    config = decrypt_config(conn.encrypted_config)
    if not config:
        raise ApiError("PROVIDER_NOT_CONFIGURED", "尚未配置该服务的凭据", 409)
    if provider == "deepseek" and conn.model:
        config["model"] = conn.model
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
    source_lang = payload.source_lang if payload.source_lang in {"auto", "zh", "en"} else "auto"
    if payload.target_lang not in {"zh", "en"}:
        raise ApiError("INVALID_TARGET_LANG", "目标语言只能是中文或英语", 422)
    if source_lang == payload.target_lang:
        raise ApiError("SAME_LANGUAGE", "源语言与目标语言不能相同", 422)

    conn = _conn(db, payload.provider)
    config = decrypt_config(conn.encrypted_config)
    if not config:
        raise ApiError("PROVIDER_NOT_CONFIGURED", f"{PROVIDERS[payload.provider]} 尚未配置凭据", 409)
    if payload.provider == "deepseek" and conn.model:
        config["model"] = conn.model
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
    total = len(db.scalars(stmt).all())
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
