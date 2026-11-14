"""视频解析服务：把分享文案解析为可直接下载的媒体地址。

解析能力来自内嵌的 media-parser（见 ``media_parser/UPSTREAM.md``）。
本模块只做工作台需要的部分：平台开关、Cookie 映射、超时、结果归一化、
下载签名。上游 Flask/数据库/代理管理器均未引入。
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from urllib.parse import quote, urlparse

import requests

from ..config import settings
from ..errors import ApiError

MAX_TEXT_LENGTH = 4000

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PlatformSpec:
    key: str
    name: str
    module: str
    cookie_attr: str
    cookie_env: str
    referer: str
    retry_attempts: int = 1
    cookie_on_empty: bool = False
    cookie_aliases: tuple[str, ...] = ()


PLATFORMS: dict[str, PlatformSpec] = {
    "douyin": PlatformSpec(
        "douyin", "抖音", "douyin_parser", "media_douyin_cookie",
        "WB_MEDIA_DOUYIN_COOKIE", "https://www.douyin.com/",
        cookie_aliases=("DY_COOKIE",),
    ),
    "xhs": PlatformSpec(
        "xhs", "小红书", "xiaohongshu_parser", "media_xhs_cookie",
        "WB_MEDIA_XHS_COOKIE", "https://www.xiaohongshu.com/",
        retry_attempts=3, cookie_on_empty=True,
        cookie_aliases=("XIAOHONGSHU_COOKIE",),
    ),
    "kuaishou": PlatformSpec(
        "kuaishou", "快手", "kuaishou_parser", "media_kuaishou_cookie",
        "WB_MEDIA_KUAISHOU_COOKIE", "https://www.kuaishou.com/",
        cookie_aliases=("KS_COOKIE",),
    ),
}

CN_TO_KEY = {spec.name: key for key, spec in PLATFORMS.items()}
COOKIE_ENV = {key: f"{key.upper()}_COOKIE" for key in PLATFORMS}

_LOADED_MODULES: set[str] = set()
_TRANSPORT_READY = False
_semaphore: asyncio.Semaphore | None = None


def _parse_enabled_keys() -> list[str]:
    raw = (settings.media_platforms or "").strip()
    if not raw:
        return []
    keys = []
    for item in raw.replace(";", ",").split(","):
        key = item.strip().lower()
        if key in PLATFORMS and key not in keys:
            keys.append(key)
    return keys


def enabled_platforms() -> list[PlatformSpec]:
    return [PLATFORMS[key] for key in _parse_enabled_keys()]


def apply_cookie_env() -> None:
    """把 WB_MEDIA_*_COOKIE 映射为上游读取的标准环境变量。"""
    for spec in PLATFORMS.values():
        value = getattr(settings, spec.cookie_attr, None)
        if value and str(value).strip():
            os.environ[COOKIE_ENV[spec.key]] = str(value).strip()


def _cookie_configured(spec: PlatformSpec) -> bool:
    value = getattr(settings, spec.cookie_attr, None)
    if value and str(value).strip():
        return True
    if (os.getenv(COOKIE_ENV[spec.key]) or "").strip():
        return True
    return any((os.getenv(name) or "").strip() for name in spec.cookie_aliases)


def config_payload() -> dict:
    return {
        "enabled": bool(settings.media_enabled),
        "platforms": [
            {
                "key": spec.key,
                "name": spec.name,
                "cookie_configured": _cookie_configured(spec),
                "cookie_env": spec.cookie_env,
            }
            for spec in enabled_platforms()
        ],
    }


def _ensure_transport() -> None:
    """在任何解析请求发出前装好 SSRF 安全传输。"""
    global _TRANSPORT_READY
    if _TRANSPORT_READY:
        return
    try:
        from .media_transport import install_parser_transport

        install_parser_transport()
    except Exception as exc:  # pragma: no cover - environment issue
        raise ApiError("MEDIA_UNAVAILABLE", "解析器传输初始化失败，请检查服务端依赖", 503) from exc
    _TRANSPORT_READY = True


def _load_module(spec: PlatformSpec) -> None:
    """按平台独立载入 parser；单个平台失败不影响其他平台。"""
    if spec.module in _LOADED_MODULES:
        return
    _ensure_transport()
    try:
        from .media_parser.src.parser_factory import ParserFactory

        ParserFactory.load_modules((spec.module,))
    except Exception as exc:  # pragma: no cover - environment issue
        raise ApiError(
            "MEDIA_PLATFORM_UNAVAILABLE",
            f"{spec.name}解析器暂时不可用，请检查服务端依赖",
            503,
            {"platform": spec.key},
        ) from exc
    _LOADED_MODULES.add(spec.module)


def _load_parser_modules() -> None:
    """预载启用的 parser；失败时跳过，具体平台使用时再报错。"""
    for spec in enabled_platforms():
        try:
            _load_module(spec)
        except ApiError as exc:
            logger.warning("媒体解析器预载失败：%s（%s）", spec.name, exc.message)
            continue


def _spec_for_platform(cn_name: str | None) -> PlatformSpec | None:
    key = CN_TO_KEY.get(cn_name or "")
    if not key:
        return None
    spec = PLATFORMS.get(key)
    if spec is None or spec.key not in _parse_enabled_keys():
        return None
    return spec


def _cookie_error(spec: PlatformSpec) -> ApiError:
    return ApiError(
        "MEDIA_COOKIE_REQUIRED",
        f"该链接触发了{spec.name}的登录校验，请先在 .env 中配置 {spec.cookie_env} 后重试",
        409,
        {"platform": spec.key, "env": spec.cookie_env},
    )


def _convert(url: str | None) -> str:
    if not url:
        return ""
    try:
        from .media_parser.utils.web_fetcher import UrlParser

        return UrlParser.convert_to_https(url) or ""
    except Exception:
        return url if url.startswith("http") else ""


def _safe_execute(func, default=None):
    if not func or not callable(func):
        return default
    try:
        return func()
    except Exception:
        return default


def _fetch_with_retry(parser, spec: PlatformSpec) -> dict:
    attempts = max(1, spec.retry_attempts)
    result: dict = {}
    for index in range(attempts):
        result = {
            "title": parser.get_title_content(),
            "desc": _safe_execute(getattr(parser, "get_description", None)),
            "video_url": parser.get_real_video_url(),
            "video_list": _safe_execute(getattr(parser, "get_video_list", None), default=[]),
            "cover_url": parser.get_cover_photo_url(),
            "author": _safe_execute(getattr(parser, "get_author_info", None)),
            "image_list": _safe_execute(getattr(parser, "get_image_list", None), default=[]),
            "audio_url": _safe_execute(getattr(parser, "get_audio_url", None)),
            "subtitles": _safe_execute(getattr(parser, "get_subtitles", None)),
            "is_preview": _safe_execute(lambda: parser.is_preview, default=False),
            "full_duration": _safe_execute(lambda: parser.full_duration),
        }
        if result["video_url"] or result["video_list"] or result["image_list"] or result["audio_url"]:
            return result
        if index < attempts - 1:
            time.sleep(0.2)
    return result


def _terminal_detail(parser) -> dict | None:
    for name in ("terminal_error", "_terminal_filter_detail"):
        detail = getattr(parser, name, None)
        if isinstance(detail, dict) and detail:
            return detail
    return None


def _is_cookie_detail(detail: dict) -> bool:
    code = str(detail.get("error_code", "")).upper()
    message = str(detail.get("detail_msg") or detail.get("notice") or "").lower()
    return "COOKIE" in code or "cookie" in message


def _empty_result_error(parser, spec: PlatformSpec) -> ApiError:
    detail = _terminal_detail(parser)
    if detail:
        if _is_cookie_detail(detail):
            return _cookie_error(spec)
        message = detail.get("detail_msg") or detail.get("notice")
        code = str(detail.get("error_code") or "").upper()
        if "DELETE" in code or "PRIVATE" in code or "NOT_FOUND" in code:
            return ApiError("MEDIA_NOT_FOUND", str(message or "作品不存在或已删除"), 404)
        if message:
            return ApiError("MEDIA_UPSTREAM_ERROR", str(message), 502)
    if getattr(parser, "cookie_required", False) is True:
        return _cookie_error(spec)
    if spec.cookie_on_empty:
        return _cookie_error(spec)
    return ApiError("MEDIA_NOT_FOUND", "没有找到可下载的视频或图片，请检查链接是否有效", 404)


def _safe_filename(title: str, fallback: str, extension: str) -> str:
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", (title or "").strip())
    stem = re.sub(r"\s+", " ", stem).strip(" ._")[:80]
    return f"{stem or fallback}.{extension.lstrip('.')}"


def _extension(url: str, default: str) -> str:
    suffix = urlparse(url).path.rsplit(".", 1)[-1].lower() if "." in urlparse(url).path else ""
    if suffix in {"mp4", "mov", "m4v", "webm"}:
        return suffix
    if suffix in {"jpg", "jpeg", "png", "webp", "gif", "heic", "avif"}:
        return suffix
    if suffix in {"mp3", "m4a", "aac", "wav"}:
        return suffix
    return default


def _token_secret() -> bytes:
    if not settings.encryption_key:
        raise ApiError(
            "MEDIA_TOKEN_UNAVAILABLE",
            "服务端未配置 WB_ENCRYPTION_KEY，无法生成下载链接",
            503,
        )
    return settings.encryption_key.encode("utf-8")


def download_token(url: str, filename: str, platform: str, referer: str = "") -> str:
    payload = {
        "u": url,
        "n": filename,
        "p": platform,
        "r": referer,
        "e": int(time.time()) + int(settings.media_download_ttl_seconds),
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(body).decode("ascii").rstrip("=")
    signature = hmac.new(_token_secret(), encoded.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def decode_download_token(token: str) -> dict:
    try:
        encoded, signature = (token or "").rsplit(".", 1)
        expected = hmac.new(_token_secret(), encoded.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        if not isinstance(payload, dict) or not payload.get("u") or not payload.get("n"):
            raise ValueError("payload")
        if int(payload.get("e") or 0) < int(time.time()):
            raise ApiError("DOWNLOAD_TOKEN_EXPIRED", "下载链接已过期，请重新解析", 403)
        return payload
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError("DOWNLOAD_TOKEN_INVALID", "下载链接无效，请重新解析", 403) from exc


def _download_entry(url: str, filename: str, spec: PlatformSpec) -> dict:
    token = download_token(url, filename, spec.key, spec.referer)
    return {
        "url": f"/api/v1/media/download?token={quote(token)}",
        "filename": filename,
    }


def _normalize(data: dict, spec: PlatformSpec, redirect_url: str) -> dict:
    from .media_parser.utils.web_fetcher import UrlParser

    video_url = _convert(data.get("video_url"))
    video_list = []
    for item in data.get("video_list") or []:
        url = _convert(item)
        if url and url not in video_list:
            video_list.append(url)
    if not video_url and video_list:
        video_url = video_list[0]
    extra_videos = [url for url in video_list if url != video_url]

    images: list[dict] = []
    for item in data.get("image_list") or []:
        if isinstance(item, dict):
            images.append({
                "url": _convert(item.get("url")),
                "live_photo_url": _convert(item.get("live_photo_url")),
            })
        else:
            images.append({"url": _convert(item), "live_photo_url": ""})
    images = [item for item in images if item["url"]]

    title = (data.get("title") or "").strip()
    description = (data.get("desc") or "").strip()
    if not title and description:
        title = description

    cover_url = _convert(data.get("cover_url"))
    if not cover_url and images:
        cover_url = images[0]["url"]

    author_info = data.get("author")
    if isinstance(author_info, dict):
        author = author_info.get("nickname") or author_info.get("name") or ""
    else:
        author = author_info or ""

    audio_url = _convert(data.get("audio_url"))
    video_id = UrlParser.get_video_id(redirect_url)
    stem = _safe_filename(title, f"{spec.name}_{video_id or 'media'}", "mp4").rsplit(".", 1)[0]

    downloads: dict = {}
    image_downloads: list[dict] = []
    if video_url:
        downloads["video"] = _download_entry(
            video_url, _safe_filename(title, stem, _extension(video_url, "mp4")), spec
        )
    if cover_url:
        downloads["cover"] = _download_entry(
            cover_url, _safe_filename(f"{title}_封面", f"{stem}_cover", _extension(cover_url, "jpg")), spec
        )
    if audio_url:
        downloads["audio"] = _download_entry(
            audio_url, _safe_filename(f"{title}_音频", f"{stem}_audio", _extension(audio_url, "mp3")), spec
        )
    if extra_videos:
        downloads["videos"] = [
            _download_entry(
                url,
                _safe_filename(f"{title}_{index + 2}", f"{stem}_{index + 2}", _extension(url, "mp4")),
                spec,
            )
            for index, url in enumerate(extra_videos)
        ]
    for index, image in enumerate(images):
        entry = {
            "url": _download_entry(
                image["url"],
                _safe_filename(f"{title}_{index + 1}", f"{stem}_{index + 1}", _extension(image["url"], "jpg")),
                spec,
            )
        }
        if image.get("live_photo_url"):
            entry["live_photo_url"] = _download_entry(
                image["live_photo_url"],
                _safe_filename(f"{title}_{index + 1}_live", f"{stem}_{index + 1}_live", "mp4"),
                spec,
            )
        image_downloads.append(entry)

    return {
        "platform": spec.key,
        "platform_name": spec.name,
        "video_id": video_id,
        "title": title,
        "description": description,
        "author": author,
        "cover_url": cover_url,
        "video_url": video_url,
        "audio_url": audio_url,
        "images": images,
        "videos": extra_videos,
        "subtitles": data.get("subtitles") or None,
        "is_preview": bool(data.get("is_preview")),
        "downloads": downloads,
        "image_downloads": image_downloads,
    }


def parse_share(text: str) -> dict:
    if not settings.media_enabled:
        raise ApiError("MEDIA_DISABLED", "视频解析功能未启用", 503)
    raw = (text or "").strip()
    if not raw:
        raise ApiError("MEDIA_TEXT_REQUIRED", "请粘贴包含分享链接的文本", 422)
    if len(raw) > MAX_TEXT_LENGTH:
        raise ApiError("MEDIA_TEXT_TOO_LONG", f"分享文本不能超过 {MAX_TEXT_LENGTH} 个字符", 422)

    apply_cookie_env()
    _ensure_transport()
    _load_parser_modules()

    from .media_parser.src.parser_factory import ParserFactory
    from .media_parser.src.utils.parser_transport import Attempt, ParseFailure, attempt_context
    from .media_parser.utils.web_fetcher import UrlParser, WebFetcher

    share_url = UrlParser.get_url(raw)
    if not share_url:
        raise ApiError("MEDIA_URL_NOT_FOUND", "未在文本中找到有效的分享链接", 422)

    platform_cn = UrlParser.get_platform(share_url)
    spec = _spec_for_platform(platform_cn)
    if spec is None:
        raise ApiError(
            "MEDIA_PLATFORM_UNSUPPORTED",
            "暂不支持该平台，目前支持抖音、小红书、快手",
            422,
        )

    parser = None
    try:
        attempt = Attempt(time.monotonic() + max(5.0, settings.media_timeout_seconds))
        with attempt_context(attempt):
            redirect_url = WebFetcher.fetch_redirect_url(share_url)
            attempt.check()
            if not redirect_url:
                raise ApiError("MEDIA_REDIRECT_FAILED", "无法访问或识别该分享链接", 502)

            resolved_cn = UrlParser.get_platform(redirect_url) or platform_cn
            resolved = _spec_for_platform(resolved_cn)
            if resolved is None:
                raise ApiError("MEDIA_PLATFORM_UNSUPPORTED", "暂不支持该平台", 422)
            spec = resolved

            _load_module(spec)
            parser = ParserFactory.create_parser(resolved_cn, UrlParser.extract_video_address(redirect_url))
            attempt.check()
            data = _fetch_with_retry(parser, spec)
            attempt.check()

            if not any(data.get(key) for key in ("video_url", "video_list", "image_list", "audio_url")):
                raise _empty_result_error(parser, spec)

            return _normalize(data, spec, redirect_url)
    except ParseFailure as exc:
        if exc.code in {"XIAOHONGSHU_COOKIE_REQUIRED", "KUAISHOU_COOKIE_REQUIRED", "COOKIE_REQUIRED"}:
            raise _cookie_error(spec) from exc
        if exc.code == "PARSE_TIMEOUT":
            raise ApiError("MEDIA_TIMEOUT", "解析超时，请稍后重试", 504) from exc
        if exc.code == "PLATFORM_NOT_SUPPORTED":
            raise ApiError("MEDIA_PLATFORM_UNSUPPORTED", "暂不支持该平台", 422) from exc
        if exc.code == "REDIRECT_FAILED":
            raise ApiError("MEDIA_REDIRECT_FAILED", "无法访问或识别该分享链接", 502) from exc
        if exc.code == "TARGET_REJECTED":
            raise ApiError("MEDIA_TARGET_REJECTED", exc.message or "该链接指向了不允许访问的地址", 403) from exc
        raise ApiError("MEDIA_UPSTREAM_ERROR", exc.message or "解析失败，请稍后重试", 502) from exc
    except requests.Timeout as exc:
        raise ApiError("MEDIA_TIMEOUT", "解析超时，请稍后重试", 504) from exc
    except requests.RequestException as exc:
        raise ApiError("MEDIA_UPSTREAM_ERROR", "访问平台失败，请稍后重试", 502) from exc
    except ApiError:
        raise
    except Exception as exc:
        if _is_timeout(exc):
            raise ApiError("MEDIA_TIMEOUT", "解析超时，请稍后重试", 504) from exc
        raise ApiError("MEDIA_UPSTREAM_ERROR", "解析失败，请稍后重试", 502) from exc


def _is_timeout(exc: Exception) -> bool:
    return "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower()


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, int(settings.media_max_concurrency)))
    return _semaphore


async def parse_share_async(text: str) -> dict:
    semaphore = _get_semaphore()
    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=3)
    except asyncio.TimeoutError as exc:
        raise ApiError("MEDIA_BUSY", "当前解析任务较多，请稍后重试", 429) from exc
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, parse_share, text)
    finally:
        semaphore.release()
