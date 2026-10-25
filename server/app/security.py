from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from .config import settings

_ITERATIONS = 210_000


def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256，格式 pbkdf2_sha256$迭代$盐$摘要。"""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations)
        )
        return hmac.compare_digest(calc.hex(), digest)
    except (ValueError, AttributeError):
        return False


def new_session_token() -> tuple[str, str]:
    """返回 (明文 token, 入库哈希)。明文只出现在 Cookie。"""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry(now: datetime) -> datetime:
    """固定 30 天有效期，从登录时刻计时，不续期。"""
    return now + timedelta(days=settings.session_days)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)
