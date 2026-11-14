from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
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
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    db_pool_timeout: float = Field(default=5, gt=0, le=60)
    request_queue_timeout: float = Field(default=10, gt=0, le=120)

    @property
    def request_concurrency(self) -> int:
        # Reserve connections for readiness and retention work. Never admit more
        # sync dependencies than can acquire a connection without tying up threads.
        return min(32, max(1, self.db_pool_size + self.db_max_overflow - 2))


    # 翻译凭据加密主密钥（Fernet key）。缺失时禁止保存/读取/测试受保护凭据。
    encryption_key: str | None = None

    backup_dir: Path = Path('../.backups')
    backup_enabled: bool = True
    backup_interval_hours: int = Field(default=24,ge=1,le=720)
    backup_keep: int = Field(default=7,ge=1,le=365)

    host_metrics_file: Path | None = None

    timezone: str = "Asia/Shanghai"

    public_base_url: str = ""
    cookie_secure: bool = False
    cookie_name: str = "wb_session"
    csrf_cookie_name: str = "wb_csrf"

    max_upload_bytes: int = 20_000_000
    staged_ttl_hours: int = 24
    whiteboard_asset_grace_hours: int = Field(default=24, ge=1, le=720)
    trash_days: int = 30
    maintenance_interval_seconds: int = 3600

    login_max_failures: int = 5
    login_lock_seconds: int = 300
    login_attempt_retention_days: int = Field(default=7, ge=1, le=90)

    # 仅测试环境使用：允许翻译服务指向 http:// 本机地址
    allow_insecure_upstream: bool = False

    # 信息聚合：公开热榜与 RSS/Atom。刷新由 Nexus 进程内的轻量调度器负责。
    feed_enabled: bool = True
    feed_dailyhot_base_url: str = "https://api-hot.imsyy.top"
    feed_google_trends_url: str = "https://trends.google.com/trending/rss?geo=US"
    feed_hot_interval_seconds: int = Field(default=900, ge=60, le=86400)
    feed_rss_interval_seconds: int = Field(default=1800, ge=60, le=86400)
    feed_scheduler_interval_seconds: int = Field(default=60, ge=10, le=3600)
    feed_timeout_seconds: float = Field(default=12.0, gt=1, le=60)
    feed_max_bytes: int = Field(default=2_000_000, ge=100_000, le=20_000_000)
    feed_max_redirects: int = Field(default=5, ge=0, le=10)
    feed_retry_max_seconds: int = Field(default=3600, ge=60, le=86400)
    feed_max_subscriptions: int = Field(default=50, ge=1, le=500)
    feed_max_entries: int = Field(default=500, ge=50, le=5000)
    feed_translation_batch: int = Field(default=20, ge=1, le=50)
    feed_translation_concurrency: int = Field(default=3, ge=1, le=8)

    # 视频解析（内嵌 media-parser，仅启用需要的平台）
    media_enabled: bool = True
    media_platforms: str = "douyin,xhs,kuaishou"
    media_timeout_seconds: float = Field(default=60.0, gt=1, le=120)
    media_max_concurrency: int = Field(default=2, ge=1, le=8)
    media_max_download_bytes: int = Field(default=300_000_000, ge=1_000_000, le=2_000_000_000)
    media_download_ttl_seconds: int = Field(default=7200, ge=60, le=86400)
    media_douyin_cookie: str | None = None
    media_xhs_cookie: str | None = None
    media_kuaishou_cookie: str | None = None

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
