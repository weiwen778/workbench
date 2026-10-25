"""翻译凭据加解密。主密钥来自部署配置 WB_ENCRYPTION_KEY。"""

from __future__ import annotations

import json

from ..config import settings
from ..errors import ApiError


def _fernet():
    if not settings.encryption_key:
        raise ApiError(
            "CREDENTIAL_KEY_MISSING",
            "服务端尚未配置翻译凭据主密钥（WB_ENCRYPTION_KEY），暂时无法保存或读取服务设置",
            503,
            {"hint": "在部署环境的 .env 中设置 WB_ENCRYPTION_KEY，然后重启 API 容器"},
        )
    from cryptography.fernet import Fernet

    try:
        return Fernet(settings.encryption_key.encode())
    except Exception:
        raise ApiError(
            "CREDENTIAL_KEY_INVALID",
            "服务端翻译凭据主密钥格式不正确，请检查 WB_ENCRYPTION_KEY",
            503,
            {"hint": "主密钥必须是 Fernet 密钥（44 位 URL-safe base64）"},
        )


def encrypt_config(config: dict) -> str:
    f = _fernet()
    payload = json.dumps(config, ensure_ascii=False).encode()
    return f.encrypt(payload).decode()


def decrypt_config(token: str | None) -> dict:
    if not token:
        return {}
    f = _fernet()
    try:
        return json.loads(f.decrypt(token.encode()).decode())
    except Exception:
        raise ApiError(
            "CREDENTIAL_DECRYPT_FAILED",
            "无法解密已保存的翻译凭据，主密钥可能已更换；请重新填写服务设置",
            503,
        )


def mask(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 6:
        return "*" * len(value)
    return value[:4] + "****" + value[-2:]
