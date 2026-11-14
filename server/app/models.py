from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Index,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    """统一的 UTC 时间（naive 存库，输出时补 Z）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_key() -> str:
    return uuid.uuid4().hex


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


# ---------------------------------------------------------------- 账号与会话


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    theme: Mapped[str] = mapped_column(String(16), default="light", nullable=False)
    theme_color: Mapped[str] = mapped_column(String(16), default="#39776f", nullable=False)
    checkin_shop_label: Mapped[str] = mapped_column(String(40), default="店铺打卡", nullable=False)
    checkin_social_label: Mapped[str] = mapped_column(String(40), default="社媒打卡", nullable=False)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(64))


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), index=True)
    ip: Mapped[str | None] = mapped_column(String(64))
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AgentToken(Base):
    __tablename__ = "agent_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(20))
    scopes: Mapped[list] = mapped_column(JSON)
    write_mode: Mapped[str] = mapped_column(String(10), default='review')
    policy: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)


class AgentActivity(Base):
    __tablename__ = "agent_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_id: Mapped[int] = mapped_column(ForeignKey("agent_tokens.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Dashboard(Base, TimestampMixin):
    __tablename__ = "dashboards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    widgets: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)


# ---------------------------------------------------------------- 打卡


class WorkTarget(Base, TimestampMixin):
    __tablename__ = "work_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)  # shop | social
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(100))
    note: Mapped[str | None] = mapped_column(String(2000))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | archived
    version: Mapped[int] = mapped_column(Integer, default=1)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)
    # 恢复对象后从下一个对应周期开始生成（归档期间不补工作）
    generate_from: Mapped[date | None] = mapped_column(Date)


class ActivityInterval(Base):
    """对象活动区间，用于“归档期间不补工作、恢复从下一周期开始”。"""

    __tablename__ = "activity_intervals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("work_targets.id", ondelete="CASCADE"), index=True)
    start_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    end_at: Mapped[datetime | None] = mapped_column(DateTime)
    reason: Mapped[str | None] = mapped_column(String(255))


class CheckinGroup(Base, TimestampMixin):
    __tablename__ = "checkin_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CheckinRule(Base, TimestampMixin):
    __tablename__ = "checkin_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("work_targets.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("checkin_groups.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(5000))
    period: Mapped[str] = mapped_column(String(16), default="daily")  # daily | weekly | monthly
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # 修改周期的特殊变更：新周期从下一个对应周期生效
    pending_period: Mapped[str | None] = mapped_column(String(16))
    pending_effective_from: Mapped[date | None] = mapped_column(Date)


class CheckinRuleVersion(Base):
    """事项修改记录（版本历史），保存当时的标题/说明/分组/周期。"""

    __tablename__ = "checkin_rule_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("checkin_rules.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(5000))
    group_id: Mapped[int] = mapped_column(Integer)
    group_name: Mapped[str] = mapped_column(String(100))
    period: Mapped[str] = mapped_column(String(16))
    change_summary: Mapped[str | None] = mapped_column(String(500))
    effective_from: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime)


class CheckinInstance(Base, TimestampMixin):
    __tablename__ = "checkin_instances"
    __table_args__ = (UniqueConstraint("rule_id", "period_start", name="uq_rule_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("checkin_rules.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    target_name: Mapped[str] = mapped_column(String(100))
    group_id: Mapped[int] = mapped_column(Integer)
    group_name: Mapped[str] = mapped_column(String(100))
    period_type: Mapped[str] = mapped_column(String(16), index=True)
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_end: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(5000))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(String(2000))
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    lock_reason: Mapped[str | None] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)


# ---------------------------------------------------------------- 待办


class TodoList(Base, TimestampMixin):
    __tablename__ = "todo_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    sort_mode: Mapped[str] = mapped_column(String(16), default="auto")  # auto | manual


class Todo(Base, TimestampMixin):
    __tablename__ = "todos"
    __table_args__=(Index("ix_todos_list_parent_completed","list_id","parent_id","completed_at","sort_index","id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("todo_lists.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("todos.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    note: Mapped[str | None] = mapped_column(String(5000))
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    due_time: Mapped[time | None] = mapped_column(Time)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    sort_index: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)


# ---------------------------------------------------------------- 数据表


class DataTable(Base, TimestampMixin):
    __tablename__ = "data_tables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(String(2000))
    kind: Mapped[str] = mapped_column(String(16), default="physical", server_default="physical")
    virtual_config: Mapped[dict | None] = mapped_column(JSON)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


class DataField(Base):
    __tablename__ = "data_fields"
    __table_args__ = (UniqueConstraint("table_id", "name", name="uq_field_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("data_tables.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(32), default=new_key, nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    default_value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    options: Mapped[list | None] = mapped_column(JSON)
    config: Mapped[dict | None] = mapped_column(JSON)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DataRecord(Base):
    __tablename__ = "data_records"
    __table_args__ = (Index("ix_records_table_live_id", "table_id", "deleted_at", "id"), {"sqlite_autoincrement": True})

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("data_tables.id", ondelete="CASCADE"), index=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    deleted_snapshot: Mapped[dict | None] = mapped_column(JSON)


class FileObject(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    storage_key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="staged", index=True)  # staged | bound
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)


class FileRef(Base):
    """文件引用关系：活动数据 / 历史版本 / 回收站。仍有有效引用时不能物理删除。"""

    __tablename__ = "file_refs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    owner_type: Mapped[str] = mapped_column(String(32))  # record | note | note_revision | memo
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class DataTransferJob(Base):
    __tablename__ = "data_transfer_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # import | export
    table_id: Mapped[int | None] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(24), default="preview")
    payload: Mapped[dict | None] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    errors: Mapped[list | None] = mapped_column(JSON)
    file_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)


# ---------------------------------------------------------------- 笔记


class NoteFolder(Base):
    __tablename__ = "note_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class NoteTag(Base):
    __tablename__ = "note_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Note(Base, TimestampMixin):
    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_folder_live_updated", "folder_id", "deleted_at", "updated_at"),Index("ix_notes_live_updated","deleted_at","updated_at","id"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("note_folders.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


class NoteTagLink(Base):
    __tablename__ = "note_tag_links"
    __table_args__ = (UniqueConstraint("note_id", "tag_id", name="uq_note_tag"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("note_tags.id", ondelete="CASCADE"), index=True)


class NoteRevision(Base):
    __tablename__ = "note_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(String(32), default="manual")  # auto | manual | interval | restore
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ---------------------------------------------------------------- 便签


class MemoCategory(Base):
    __tablename__ = "memo_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)


class Memo(Base, TimestampMixin):
    __tablename__ = "memos"
    __table_args__=(Index("ix_memos_live_updated","deleted_at","updated_at","id"),Index("ix_memos_category_live_updated","category","deleted_at","updated_at","id"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(String(2000), nullable=False)
    category: Mapped[str | None] = mapped_column(String(80), index=True)
    color: Mapped[str] = mapped_column(String(16), default="default")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


# ---------------------------------------------------------------- 白板


class Whiteboard(Base, TimestampMixin):
    __tablename__ = "whiteboards"
    __table_args__ = (Index("ix_whiteboards_user_updated", "user_id", "updated_at", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="未命名白板", nullable=False)
    scene: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class WhiteboardAsset(Base):
    __tablename__ = "whiteboard_assets"

    # Excalidraw fileIds are content hashes, so the same screenshot can collide
    # across accounts. Assets are therefore keyed by (owner, fileId).
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    orphaned_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


# ---------------------------------------------------------------- 信息聚合


class FeedSnapshot(Base):
    """Shared cache/status for one public hot source."""

    __tablename__ = "feed_snapshots"

    source_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    entries: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    provider: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    provider_note: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    upstream_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(String(1000))
    error_code: Mapped[str | None] = mapped_column(String(64))
    etag: Mapped[str | None] = mapped_column(String(500))
    last_modified: Mapped[str | None] = mapped_column(String(500))
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)


class FeedSubscription(Base, TimestampMixin):
    """Per-user RSS/Atom subscription; deleted rows are retained for favourites."""

    __tablename__ = "feed_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "url_key", name="uq_feed_subscription_user_url"),
        Index("ix_feed_subscriptions_due", "enabled", "deleted_at", "next_attempt_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    url_key: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="订阅源", nullable=False)
    feed_kind: Mapped[str] = mapped_column(String(16), default="rss", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_key: Mapped[str | None] = mapped_column(String(40))
    etag: Mapped[str | None] = mapped_column(String(500))
    last_modified: Mapped[str | None] = mapped_column(String(500))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(String(1000))
    error_code: Mapped[str | None] = mapped_column(String(64))
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)


class FeedEntry(Base):
    """One item inside a subscription, with per-account read/favourite state."""

    __tablename__ = "feed_entries"
    __table_args__ = (
        UniqueConstraint("subscription_id", "entry_key", name="uq_feed_entry_subscription_key"),
        Index("ix_feed_entries_subscription_order", "subscription_id", "published_at", "discovered_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("feed_subscriptions.id", ondelete="CASCADE"), index=True
    )
    entry_key: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    language: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    link_kind: Mapped[str] = mapped_column(String(16), default="article", nullable=False)
    discussion_url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    discovered_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    favorite_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class FeedTranslation(Base):
    """Shared title-translation cache keyed by source text and target language."""

    __tablename__ = "feed_translations"
    __table_args__ = (
        UniqueConstraint("text_hash", "target_lang", name="uq_feed_translation_text_lang"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    text_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_lang: Mapped[str] = mapped_column(String(16), nullable=False)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    target_text: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    model: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


# ---------------------------------------------------------------- 文档工作台


class DocumentProject(Base, TimestampMixin):
    """A saved local-first PDF / spreadsheet / document editing project."""

    __tablename__ = "document_projects"
    __table_args__ = (
        Index("ix_document_projects_user_kind_updated", "user_id", "kind", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # pdf | sheet | document
    title: Mapped[str] = mapped_column(String(200), default="未命名项目", nullable=False)
    state: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


# ---------------------------------------------------------------- 翻译


class TranslationConnection(Base):
    __tablename__ = "translation_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    encrypted_config: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(100))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_test_message: Mapped[str | None] = mapped_column(String(500))
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class TranslationHistory(Base):
    __tablename__ = "translation_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    target_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_lang: Mapped[str] = mapped_column(String(16), default="auto")
    target_lang: Mapped[str] = mapped_column(String(16), default="en")
    provider: Mapped[str] = mapped_column(String(20), index=True)
    model: Mapped[str | None] = mapped_column(String(100))
    mode: Mapped[str] = mapped_column(String(32), default="faithful")
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ---------------------------------------------------------------- 回收站


class TranslationFavorite(Base):
    """收藏的译文快照，与历史记录互相独立：删历史不影响收藏。"""

    __tablename__ = "translation_favorites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    target_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_lang: Mapped[str] = mapped_column(String(16), default="auto")
    target_lang: Mapped[str] = mapped_column(String(16), default="en")
    provider: Mapped[str] = mapped_column(String(20), index=True)
    model: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class TrashEntry(Base):
    __tablename__ = "trash_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # table | record | note | memo
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(255))
    snapshot: Mapped[dict | None] = mapped_column(JSON)
    parent_id: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime)


class TableView(Base, TimestampMixin):
    __tablename__ = 'table_views'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey('data_tables.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20), default='grid')
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)

class TableChange(Base):
    __tablename__ = 'table_changes'
    __table_args__ = (UniqueConstraint('table_id','user_id','request_id',name='uq_table_change_request'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey('data_tables.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    request_id: Mapped[str] = mapped_column(String(64))
    digest: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(100))
    schema_version: Mapped[int] = mapped_column(Integer)
    changes: Mapped[list] = mapped_column(JSON)
    reverts_id: Mapped[int | None] = mapped_column(Integer)
    undone_by: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(100), default='用户')
    action: Mapped[str] = mapped_column(String(12), default='edit')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class TableWorkbook(Base, TimestampMixin):
    __tablename__ = 'table_workbooks'
    __table_args__ = (UniqueConstraint('table_id','user_id',name='uq_table_workbook_owner'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey('data_tables.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Bookmark(Base, TimestampMixin):
    __tablename__ = "bookmarks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    icon_url: Mapped[str] = mapped_column(String(2048), nullable=False, default="")
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")


class BookmarkCategory(Base):
    __tablename__ = "bookmark_categories"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)


class AgentChange(Base, TimestampMixin):
    __tablename__ = "agent_changes"
    __table_args__ = (UniqueConstraint('token_id', 'request_key', name='uq_agent_change_request'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    token_id: Mapped[int] = mapped_column(ForeignKey('agent_tokens.id', ondelete='CASCADE'), index=True)
    request_key: Mapped[str | None] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default='pending', index=True)
    operations_cipher: Mapped[str] = mapped_column(Text)
    payload_hash: Mapped[str] = mapped_column(String(64))
    fingerprints: Mapped[dict] = mapped_column(JSON, default=dict)
    preview: Mapped[list] = mapped_column(JSON, default=list)
    results: Mapped[list | None] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey('users.id'))
    error: Mapped[str | None] = mapped_column(String(1000))


class BackgroundJob(Base, TimestampMixin):
    __tablename__ = 'background_jobs'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(24),default='queued',index=True)
    progress: Mapped[int] = mapped_column(Integer,default=0)
    processed: Mapped[int] = mapped_column(Integer,default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean,default=False)
    request_key: Mapped[str | None] = mapped_column(String(128))
    payload: Mapped[dict] = mapped_column(JSON,default=dict)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(1000))
    __table_args__ = (UniqueConstraint('user_id','request_key',name='uq_job_request'),)


class OperationLog(Base):
    __tablename__ = 'operation_logs'
    id: Mapped[int] = mapped_column(Integer,primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'),index=True)
    actor: Mapped[str] = mapped_column(String(120))
    method: Mapped[str] = mapped_column(String(16))
    path: Mapped[str] = mapped_column(String(1000))
    status: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime,default=utcnow,index=True)

class AgentReviewNote(Base):
    __tablename__='agent_review_notes'
    change_id: Mapped[int] = mapped_column(ForeignKey('agent_changes.id',ondelete='CASCADE'),primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    note: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime,default=utcnow)


class AgentRun(Base, TimestampMixin):
    """A direct Agent write, with the exact inverse plan needed to undo it."""

    __tablename__ = 'agent_runs'
    __table_args__ = (UniqueConstraint('token_id', 'request_key', name='uq_agent_run_request'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    token_id: Mapped[int] = mapped_column(ForeignKey('agent_tokens.id', ondelete='CASCADE'), index=True)
    request_key: Mapped[str | None] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default='applied', index=True)
    undo_status: Mapped[str] = mapped_column(String(16), default='available', index=True)
    operations_cipher: Mapped[str] = mapped_column(Text)
    plan_cipher: Mapped[str] = mapped_column(Text)
    payload_hash: Mapped[str] = mapped_column(String(64))
    preview: Mapped[list] = mapped_column(JSON, default=list)
    results: Mapped[list | None] = mapped_column(JSON)
    operation_count: Mapped[int] = mapped_column(Integer, default=0)
    result_status: Mapped[int] = mapped_column(Integer, default=200)
    error: Mapped[str | None] = mapped_column(String(1000))
    undo_error: Mapped[str | None] = mapped_column(String(1000))
    undone_at: Mapped[datetime | None] = mapped_column(DateTime)
    undone_by: Mapped[int | None] = mapped_column(ForeignKey('users.id'))


class AiConnection(Base):
    __tablename__ = 'ai_connections'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    encrypted_config: Mapped[str | None] = mapped_column(Text)
    default_model: Mapped[str] = mapped_column(String(32), default='glm-4v-flash')
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AiExtraction(Base):
    __tablename__ = 'ai_extractions'
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    table_id: Mapped[int] = mapped_column(ForeignKey('data_tables.id'), index=True)
    schema_version: Mapped[int] = mapped_column(Integer)
    model: Mapped[str] = mapped_column(String(32))
    encrypted_result: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default='pending')
    record_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
