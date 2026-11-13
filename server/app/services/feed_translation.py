"""Title translation for the information hub.

Uses the existing translation connections/credentials. Results are cached by
source text + target language, so unchanged titles never hit the provider twice.
"""
from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..errors import ApiError
from ..models import FeedTranslation, TranslationConnection, utcnow
from . import providers as prov
from .encryption import decrypt_config
from .languages import supports

PROVIDER_NAMES = {
    "baidu": "百度翻译", "youdao": "有道翻译", "deepseek": "DeepSeek",
    "zhipu": "智谱 GLM", "openai": "OpenAI 兼容", "deepl": "DeepL",
    "mymemory": "MyMemory（免费）", "libretranslate": "LibreTranslate",
}
KEYLESS = {"mymemory"}
TARGET_LANG = "zh"


def text_hash(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def _effective_config(db: Session, connection: TranslationConnection) -> dict:
    config = decrypt_config(connection.encrypted_config) if connection.encrypted_config else {}
    if connection.provider == "zhipu" and not config.get("api_key"):
        from ..models import AiConnection
        ai = db.get(AiConnection, 1)
        if ai and ai.encrypted_config:
            try:
                key = decrypt_config(ai.encrypted_config).get("api_key", "")
            except ApiError:
                key = ""
            if key:
                config = {**config, "api_key": key}
    if connection.model:
        config = {**config, "model": connection.model}
    return config


def _configured(provider: str, config: dict) -> bool:
    if provider in KEYLESS:
        return True
    if provider == "libretranslate":
        return bool(config.get("base_url"))
    return bool(config)


def active_connection(db: Session, requested: str | None = None) -> tuple[TranslationConnection, dict] | None:
    rows = list(db.scalars(
        select(TranslationConnection).where(TranslationConnection.enabled.is_(True)).order_by(TranslationConnection.id)
    ).all())
    if requested:
        rows = [row for row in rows if row.provider == requested] + [row for row in rows if row.provider != requested]
    for connection in rows:
        config = _effective_config(db, connection)
        if _configured(connection.provider, config) and supports(connection.provider, TARGET_LANG):
            return connection, config
    return None


def translation_status(db: Session) -> dict:
    active = active_connection(db)
    if not active:
        return {
            "configured": False,
            "provider": None,
            "provider_name": None,
            "target_lang": TARGET_LANG,
            "message": "尚未启用可用的翻译服务；原文与链接仍可正常使用。",
        }
    connection, _ = active
    return {
        "configured": True,
        "provider": connection.provider,
        "provider_name": PROVIDER_NAMES.get(connection.provider, connection.provider),
        "target_lang": TARGET_LANG,
        "message": "",
    }


def load_translations(db: Session, texts: list[str], target_lang: str = TARGET_LANG) -> dict[str, str]:
    values = list(dict.fromkeys(text.strip() for text in texts if text and text.strip()))
    if not values:
        return {}
    hashes = {text_hash(text): text for text in values}
    rows = db.scalars(
        select(FeedTranslation).where(
            FeedTranslation.target_lang == target_lang,
            FeedTranslation.text_hash.in_(list(hashes.keys())),
        )
    ).all()
    return {row.source_text: row.target_text for row in rows if row.source_text in values}


def translate_texts(db: Session, texts: list[str], requested_provider: str | None = None) -> dict:
    values = list(dict.fromkeys(text.strip()[:1000] for text in texts if text and text.strip()))
    if not values:
        return {"items": [], "provider": None, "provider_name": None, "error": ""}
    if len(values) > settings.feed_translation_batch:
        raise ApiError(
            "TOO_MANY_TEXTS", f"一次最多翻译 {settings.feed_translation_batch} 条标题", 422,
            {"limit": settings.feed_translation_batch},
        )
    cached = load_translations(db, values)
    missing = [text for text in values if text not in cached]
    status = translation_status(db)
    active = active_connection(db, requested_provider)
    if not active:
        if not missing:
            return {
                "items": [{"source_text": text, "target_text": cached[text], "cached": True} for text in values],
                "provider": None, "provider_name": None, "error": "",
            }
        raise ApiError("TRANSLATION_NOT_CONFIGURED", "尚未启用可用的翻译服务，请先在设置中配置并启用翻译服务", 409)

    connection, config = active
    provider = connection.provider
    if not supports(provider, TARGET_LANG):
        raise ApiError("UNSUPPORTED_LANGUAGE", "当前翻译服务不支持中文目标语言", 422)

    results: dict[str, tuple[str, str | None]] = {}
    errors: list[str] = []
    valid_missing: list[str] = []
    for text in missing:
        try:
            prov.check_limit(provider, text)
            valid_missing.append(text)
        except ApiError as error:
            errors.append(f"{text[:30]}：{error.message}")

    def call(text: str):
        try:
            value, model = prov.translate(provider, text, "auto", TARGET_LANG, config)
            return text, value, model, None
        except prov.UpstreamError as error:
            return text, "", None, error.message
        except ApiError as error:
            return text, "", None, error.message
        except Exception:
            return text, "", None, "翻译服务调用失败"

    if valid_missing:
        with ThreadPoolExecutor(max_workers=min(settings.feed_translation_concurrency, len(valid_missing))) as pool:
            for text, value, model, error in pool.map(call, valid_missing):
                if error:
                    errors.append(f"{text[:30]}：{error}")
                elif value:
                    results[text] = (value, model)
                else:
                    errors.append(f"{text[:30]}：翻译服务没有返回内容")

    now = utcnow()
    wrote = False
    for text, (value, model) in results.items():
        digest = text_hash(text)
        row = db.scalar(
            select(FeedTranslation).where(
                FeedTranslation.text_hash == digest, FeedTranslation.target_lang == TARGET_LANG
            )
        )
        if row:
            row.target_text = value
            row.provider = provider
            row.model = model
            row.updated_at = now
        else:
            db.add(FeedTranslation(
                text_hash=digest, target_lang=TARGET_LANG, source_text=text,
                target_text=value, provider=provider, model=model,
            ))
        wrote = True
    if wrote:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()

    items = []
    for text in values:
        if text in cached:
            items.append({"source_text": text, "target_text": cached[text], "cached": True})
        elif text in results:
            items.append({"source_text": text, "target_text": results[text][0], "cached": False})
    return {
        "items": items,
        "provider": provider,
        "provider_name": PROVIDER_NAMES.get(provider, provider),
        "target_lang": TARGET_LANG,
        "error": "；".join(errors)[:1000],
        "status": status,
    }
