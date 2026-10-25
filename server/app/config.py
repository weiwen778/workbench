from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置。全部来自环境变量，前缀 WB_。"""

    model_config = SettingsConfigDict(env_prefix="WB_", env_file=".env", extra="ignore")

    app_name: str = "个人工作台"
    env: str = "dev"

    database_url: str = "sqlite:///./data/workbench.db"
    storage_dir: Path = Path("./data/storage")

    admin_username: str = "admin"
    admin_password: str = "admin12345"
    session_days: int = 30

    # 翻译凭据加密主密钥（Fernet key）。缺失时禁止保存/读取/测试受保护凭据。
    encryption_key: str | None = None

    timezone: str = "Asia/Shanghai"
    public_base_url: str = ""
    cookie_secure: bool = False
    cookie_name: str = "wb_session"
    csrf_cookie_name: str = "wb_csrf"

    max_upload_bytes: int = 20_000_000
    staged_ttl_hours: int = 24
    trash_days: int = 30

    login_max_failures: int = 5
    login_lock_seconds: int = 300

    # 仅测试环境使用：允许翻译服务指向 http:// 本机地址
    allow_insecure_upstream: bool = False

    max_bytes_baidu: int = 6000
    max_chars_youdao: int = 5000
    max_chars_deepseek: int = 4000

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
