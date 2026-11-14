# 宠物模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作台里加入一只按真实时间衰减、可喂食/洗澡/玩耍/遛狗/睡觉/看医生的像素狗，独立 `/pet` 页面，后端权威、无永久死亡。

**Architecture:** 每个用户一行 `pets`，所有读取和动作都先按 `now - last_tick_at` 逐小时补算并写回；前端只负责展示和发动作，60 秒轮询一次，冷却倒计时用收到响应的本地时刻计算。

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic + SQLite/PostgreSQL；React 18 + TypeScript + MUI 6 + TanStack Query + Vite；Playwright e2e；Pillow 处理精灵图。

**Spec:** `docs/superpowers/specs/2026-11-14-pet-module-design.md`

## Global Constraints

- 所有接口在 `/api/v1` 下，路由使用 `APIRouter(tags=["pet"], dependencies=[Depends(get_current_user)])`；写接口依赖现有 CSRF 中间件。
- 数据库时间一律 naive UTC；payload 时间用 `iso_z()`；本地日期用 `today_local()` / `local_midnight_utc()`。
- 五项状态在数据库用 `Float` 存 0–100 的小数；payload 用 half-up 取整，不做逐 tick 取整。
- 一个用户最多一只宠物；`user_id` 唯一索引；不做多宠物、不做重新领养、不做永久死亡。
- 健康下限 `10`；单次补算最多 `90` 天；补算步长最多 `1` 小时，最后一步允许小数。
- 前端不新增依赖；图标从 `@/icons` 或 `@mui/icons-material` 取；素材必须是本地透明 PNG，不运行时拉第三方图片。
- UI 文案中文；冷却秒数由后端给，前端不读服务器时钟。
- 后端测试命令：`cd server && .venv/bin/python -m pytest tests/test_pet.py -v`。
- 前端检查：`cd web-react && npm run typecheck && npm run build`。
- E2E：`cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`（需先启动服务）。
- 每个任务结束提交一次，提交前只暂存该任务涉及的文件。

## Review Focus

1. **系统时钟回拨或同一时刻重复结算**：不能加状态、不能把 `last_tick_at` 往回写、不能抛异常。Task 2 用 `advance(T0 - 1h)` 固定。
2. **超过 90 天不打开**：补算要截断、循环不能失控、健康停在 10、宠物仍活着。Task 2 用 120 天跨度固定。
3. **整点/半小时间隔的浮点边界**：0.5 小时、恰好 8 小时出便便、恰好冷却结束时，SQLite 与 PostgreSQL 结果要一致。Task 2/3 用 `pytest.approx` 和边界时刻固定。
4. **同一天重复 GET（含 React StrictMode 双请求）**：每日奖励只能发一次，零食不能翻倍。Task 4 连续两次 GET 固定。
5. **375px 窄屏 + 睡觉/生病时的禁用动作**：不能横向溢出，不能把不可用动作静默发出去。Task 6/7 用 e2e 固定。

---

## File Structure

**后端**

- `server/app/models.py` — 新增 `Pet` 模型，放在 `Todo` 之后。
- `server/migrations/versions/20261114_b2c3d4e5f6a7_pets.py` — 新建 `pets` 表与唯一索引。
- `server/app/services/pet.py` — 纯规则：衰减、便便、生病、阶段、状态、payload、动作、每日奖励。
- `server/app/routers/pet.py` — `GET/POST/PATCH /pet`、`POST /pet/actions`。
- `server/app/main.py` — 注册 `pet.router`。
- `server/tests/test_pet.py` — 全部后端用例，按任务追加。

**前端**

- `web-react/src/pets/api.ts` — payload 类型与四个请求函数。
- `web-react/src/pets/usePet.ts` — TanStack Query hooks，统一更新缓存。
- `web-react/src/pets/NeedsPanel.tsx` — 五条状态条、零食数。
- `web-react/src/pets/ActionBar.tsx` — 动作按钮、禁用原因、冷却倒计时。
- `web-react/src/pets/PetSprite.tsx` — 精灵图帧状态机，尊重 reduced motion。
- `web-react/src/pets/PetRoom.tsx` — 房间、饭盆、便便、床、点击抚摸。
- `web-react/src/pets/assets/dog-sheet.png` — 4 列 × 6 行、每帧 64×64、透明。
- `web-react/src/pets/assets/dog-portrait.png` — 128×128 正视图、透明。
- `web-react/src/pets/assets/CREDITS.md` — 素材来源与处理方式。
- `web-react/src/pages/Pet.tsx` — 页面编排、领养/改名、每日奖励提示。
- `web-react/src/App.tsx` — 懒加载与 `/pet` 路由。
- `web-react/src/layout/app-nav.ts` — 新增 `life` 分组与「宠物」入口。
- `web-react/src/router/preload.ts` — `/pet` 预取。
- `e2e/pet.mjs` — 领养、改名、动作、冷却、移动端、reduced motion。

---

## Task 1: 宠物表与领养/读取/改名 API

**Files:**
- Modify: `server/app/models.py`（在 `Todo` 类之后追加 `Pet`）
- Create: `server/migrations/versions/20261114_b2c3d4e5f6a7_pets.py`
- Create: `server/app/services/pet.py`
- Create: `server/app/routers/pet.py`
- Modify: `server/app/main.py:139-164`（导入）与 `:189-195`（注册）
- Test: `server/tests/test_pet.py`

**Interfaces:**
- Consumes: `TimestampMixin`、`utcnow()`、`Base`、`get_db`、`get_current_user`、`ApiError`、`field_error`、`iso_z`。
- Produces:
  - `Pet`，字段与 spec 数据模型一致：`id, user_id, name, species, satiety, cleanliness, mood, energy, health, sleeping, sick_since, sleep_started_at, care_days, last_care_date, last_tick_at, last_fed_at, last_washed_at, last_played_at, last_walked_at, last_vet_at, last_treated_at, last_petted_at, poop_count, poop_progress, neglect_since, pet_bonus_hour, pet_bonus_total, treats, daily_bonus_date, version`。
  - `stage_for(care_days: int) -> tuple[str, str, int | None]`，返回 `(stage, stage_label, next_stage_in_days)`。
  - `status_for(pet: Pet) -> tuple[str, str]`，返回 `(status, status_label)`。
  - `pet_payload(pet: Pet, now: datetime) -> dict`，结构见 spec 的 `PetPayload`（`stats` 嵌套、`cooldowns` 七项、`version`、`updated_at`）。
  - `advance(pet: Pet, now: datetime) -> None`（本任务先写“只更新 `last_tick_at`”的桩，Task 2 替换）。
  - `claim_daily_bonus(db: Session, pet: Pet, now: datetime) -> dict | None`（本任务先返回 `None`，Task 4 替换）。
  - `round_stat(value: float) -> int`，正数 half-up：`int(math.floor(value + 0.5))`。
  - 路由：`GET /api/v1/pet`、`POST /api/v1/pet`（201）、`PATCH /api/v1/pet`。

- [ ] **Step 1: 写失败测试（模型 + 领养 + 读取 + 改名）**

在 `server/tests/test_pet.py` 写：

```python
from datetime import datetime, timedelta

import pytest

from app.models import Pet
from app.services.pet import pet_payload, stage_for, status_for

T0 = datetime(2026, 11, 14, 0, 0)


def _make_pet(db, **overrides):
    pet = Pet(user_id=1, name="旺财", last_tick_at=T0, **overrides)
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return pet


def test_get_pet_before_adoption_is_empty(auth):
    resp = auth.get("/api/v1/pet")
    assert resp.status_code == 200
    assert resp.json() == {"pet": None, "daily_bonus": None}


def test_adopt_returns_initial_payload(auth):
    resp = auth.post("/api/v1/pet", json={})
    assert resp.status_code == 201
    pet = resp.json()["pet"]
    assert pet["name"] == "旺财"
    assert pet["species"] == "dog"
    assert pet["stage"] == "puppy"
    assert pet["stage_label"] == "幼犬"
    assert pet["care_days"] == 0
    assert pet["next_stage_in_days"] == 7
    assert pet["status"] == "great"
    assert pet["status_label"] == "精神很好"
    assert pet["stats"] == {
        "satiety": 70, "cleanliness": 90, "mood": 80, "energy": 80, "health": 100,
    }
    assert pet["cooldowns"] == {
        "feed": 0, "treat": 0, "wash": 0, "play": 0, "walk": 0, "vet": 0, "pet": 0,
    }
    assert pet["treats"] == 0
    assert pet["poop_count"] == 0
    assert pet["sleeping"] is False
    assert pet["version"] == 1


def test_adopt_twice_returns_pet_exists(auth):
    assert auth.post("/api/v1/pet", json={}).status_code == 201
    resp = auth.post("/api/v1/pet", json={"name": "小黑"})
    assert resp.status_code == 409
    assert resp.json()["code"] == "PET_EXISTS"


def test_rename_and_reject_invalid_names(auth):
    auth.post("/api/v1/pet", json={})
    resp = auth.patch("/api/v1/pet", json={"name": "  豆豆  "})
    assert resp.status_code == 200
    assert resp.json()["pet"]["name"] == "豆豆"

    for bad in ("", "   ", "一" * 13):
        resp = auth.patch("/api/v1/pet", json={"name": bad})
        assert resp.status_code == 422
        assert resp.json()["code"] == "VALIDATION_ERROR"
        assert resp.json()["details"]["fields"]["name"]


def test_stage_and_status_boundaries():
    assert stage_for(0) == ("puppy", "幼犬", 7)
    assert stage_for(6) == ("puppy", "幼犬", 1)
    assert stage_for(7) == ("adult", "成年", 23)
    assert stage_for(29) == ("adult", "成年", 1)
    assert stage_for(30) == ("senior", "老年", None)

    pet = Pet(name="旺财", satiety=70, cleanliness=90, mood=80, energy=80, health=100)
    assert status_for(pet) == ("great", "精神很好")
    pet.sleeping = True
    assert status_for(pet) == ("sleeping", "睡觉中")
    pet.sleeping = False
    pet.sick_since = T0
    assert status_for(pet) == ("sick", "生病了")
    pet.sick_since = None
    pet.satiety = 20
    assert status_for(pet) == ("hungry", "饿坏了")


def test_payload_rounds_half_up(db):
    pet = _make_pet(db, satiety=68.5, cleanliness=89.2, mood=78.8, energy=78.5)
    payload = pet_payload(pet, T0)
    assert payload["stats"]["satiety"] == 69
    assert payload["stats"]["cleanliness"] == 89
    assert payload["stats"]["mood"] == 79
    assert payload["stats"]["energy"] == 79
    assert payload["updated_at"].endswith("Z")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v`
Expected: FAIL，`ImportError: cannot import name 'Pet'` 或 `app.services.pet` 不存在。

- [ ] **Step 3: 加 `Pet` 模型与迁移**

在 `server/app/models.py` 顶部 SQLAlchemy 导入里加入 `Float`。在 `Todo` 类之后加：

```python
class Pet(Base, TimestampMixin):
    __tablename__ = "pets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    name: Mapped[str] = mapped_column(String(40), default="旺财", nullable=False)
    species: Mapped[str] = mapped_column(String(16), default="dog", nullable=False)
    satiety: Mapped[float] = mapped_column(Float, default=70.0, nullable=False)
    cleanliness: Mapped[float] = mapped_column(Float, default=90.0, nullable=False)
    mood: Mapped[float] = mapped_column(Float, default=80.0, nullable=False)
    energy: Mapped[float] = mapped_column(Float, default=80.0, nullable=False)
    health: Mapped[float] = mapped_column(Float, default=100.0, nullable=False)
    sleeping: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sick_since: Mapped[datetime | None] = mapped_column(DateTime)
    sleep_started_at: Mapped[datetime | None] = mapped_column(DateTime)
    care_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_care_date: Mapped[date | None] = mapped_column(Date)
    last_tick_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_fed_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_washed_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_played_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_walked_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_vet_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_treated_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_petted_at: Mapped[datetime | None] = mapped_column(DateTime)
    poop_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    poop_progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    neglect_since: Mapped[datetime | None] = mapped_column(DateTime)
    pet_bonus_hour: Mapped[datetime | None] = mapped_column(DateTime)
    pet_bonus_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    treats: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    daily_bonus_date: Mapped[date | None] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
```

新建 `server/migrations/versions/20261114_b2c3d4e5f6a7_pets.py`：

```python
"""Pets: one persistent virtual pet per user."""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(40), nullable=False, server_default='旺财'),
        sa.Column('species', sa.String(16), nullable=False, server_default='dog'),
        sa.Column('satiety', sa.Float(), nullable=False, server_default='70'),
        sa.Column('cleanliness', sa.Float(), nullable=False, server_default='90'),
        sa.Column('mood', sa.Float(), nullable=False, server_default='80'),
        sa.Column('energy', sa.Float(), nullable=False, server_default='80'),
        sa.Column('health', sa.Float(), nullable=False, server_default='100'),
        sa.Column('sleeping', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('sick_since', sa.DateTime()),
        sa.Column('sleep_started_at', sa.DateTime()),
        sa.Column('care_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_care_date', sa.Date()),
        sa.Column('last_tick_at', sa.DateTime(), nullable=False),
        sa.Column('last_fed_at', sa.DateTime()),
        sa.Column('last_washed_at', sa.DateTime()),
        sa.Column('last_played_at', sa.DateTime()),
        sa.Column('last_walked_at', sa.DateTime()),
        sa.Column('last_vet_at', sa.DateTime()),
        sa.Column('last_treated_at', sa.DateTime()),
        sa.Column('last_petted_at', sa.DateTime()),
        sa.Column('poop_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('poop_progress', sa.Float(), nullable=False, server_default='0'),
        sa.Column('neglect_since', sa.DateTime()),
        sa.Column('pet_bonus_hour', sa.DateTime()),
        sa.Column('pet_bonus_total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('treats', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('daily_bonus_date', sa.Date()),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_pets_user_id', 'pets', ['user_id'], unique=True)


def downgrade():
    op.drop_index('ix_pets_user_id', table_name='pets')
    op.drop_table('pets')
```

- [ ] **Step 4: 写服务骨架**

新建 `server/app/services/pet.py`：

```python
from __future__ import annotations

import math
from datetime import datetime

from sqlalchemy.orm import Session

from ..models import Pet
from ..utils import iso_z

STAT_KEYS = ("satiety", "cleanliness", "mood", "energy")


def round_stat(value: float) -> int:
    return int(math.floor(max(0.0, value) + 0.5))


def stage_for(care_days: int) -> tuple[str, str, int | None]:
    if care_days < 7:
        return "puppy", "幼犬", 7 - care_days
    if care_days < 30:
        return "adult", "成年", 30 - care_days
    return "senior", "老年", None


def status_for(pet: Pet) -> tuple[str, str]:
    if pet.sleeping:
        return "sleeping", "睡觉中"
    if pet.sick_since is not None:
        return "sick", "生病了"
    if pet.satiety <= 20:
        return "hungry", "饿坏了"
    if pet.energy <= 20:
        return "tired", "困得不行"
    if pet.cleanliness <= 20:
        return "dirty", "脏兮兮"
    if pet.mood <= 20:
        return "sad", "不开心"
    if min(pet.satiety, pet.cleanliness, pet.mood, pet.energy) >= 70:
        return "great", "精神很好"
    return "ok", "还不错"


def advance(pet: Pet, now: datetime) -> None:
    """Task 2 替换为真实补算；Task 1 只保证读取不重复计时。"""
    if now > pet.last_tick_at:
        pet.last_tick_at = now


def claim_daily_bonus(db: Session, pet: Pet, now: datetime) -> dict | None:
    """Task 4 实现。"""
    return None


def pet_payload(pet: Pet, now: datetime) -> dict:
    stage, stage_label, next_stage_in_days = stage_for(pet.care_days)
    status, status_label = status_for(pet)
    return {
        "id": pet.id,
        "name": pet.name,
        "species": pet.species,
        "stage": stage,
        "stage_label": stage_label,
        "care_days": pet.care_days,
        "stats": {key: round_stat(getattr(pet, key)) for key in STAT_KEYS + ("health",)},
        "status": status,
        "status_label": status_label,
        "sleeping": pet.sleeping,
        "poop_count": pet.poop_count,
        "treats": pet.treats,
        "cooldowns": {
            "feed": 0, "treat": 0, "wash": 0, "play": 0, "walk": 0, "vet": 0, "pet": 0,
        },
        "next_stage_in_days": next_stage_in_days,
        "version": pet.version,
        "updated_at": iso_z(pet.updated_at),
    }
```

- [ ] **Step 5: 写路由并注册**

新建 `server/app/routers/pet.py`：

```python
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError, field_error
from ..models import Pet, User, utcnow
from ..security import get_current_user
from ..services.pet import advance, claim_daily_bonus, pet_payload

router = APIRouter(tags=["pet"], dependencies=[Depends(get_current_user)])


class PetCreate(BaseModel):
    name: str | None = None


class PetRename(BaseModel):
    name: str


def _clean_name(value: str, default: str | None = None) -> str:
    name = value.strip()
    if not name and default is not None:
        return default
    if not 1 <= len(name) <= 12:
        raise field_error("name", "名字需要 1–12 个字")
    return name


def _owned(db: Session, user: User) -> Pet:
    pet = db.scalar(select(Pet).where(Pet.user_id == user.id))
    if pet is None:
        raise ApiError("PET_NOT_FOUND", "还没有领养宠物", 404)
    return pet


@router.get("/pet")
def get_pet(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = utcnow()
    pet = db.scalar(select(Pet).where(Pet.user_id == user.id))
    if pet is None:
        return {"pet": None, "daily_bonus": None}
    advance(pet, now)
    bonus = claim_daily_bonus(db, pet, now)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now), "daily_bonus": bonus}


@router.post("/pet", status_code=201)
def adopt(body: PetCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.scalar(select(Pet.id).where(Pet.user_id == user.id)) is not None:
        raise ApiError("PET_EXISTS", "已经领养过了", 409)
    name = _clean_name(body.name, default="旺财") if body.name is not None else "旺财"
    now = utcnow()
    pet = Pet(user_id=user.id, name=name, last_tick_at=now)
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now)}


@router.patch("/pet")
def rename(body: PetRename, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pet = _owned(db, user)
    now = utcnow()
    advance(pet, now)
    pet.name = _clean_name(body.name)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now)}
```

在 `server/app/main.py` 的 `.routers import (...)` 里加 `pet`（按字母序放在 `notes` 前后均可），并在 `app.include_router(memos.router, prefix=api)` 之后加：

```python
    app.include_router(pet.router, prefix=api)
```

- [ ] **Step 6: 跑测试与迁移检查**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v`
Expected: 6 passed。

Run: `cd server && WB_DATABASE_URL=sqlite:////tmp/wb_pet_migration.db .venv/bin/alembic upgrade head`
Expected: 输出包含 `Running upgrade a1b2c3d4e5f6 -> b2c3d4e5f6a7`，无异常。然后删除 `/tmp/wb_pet_migration.db`。

- [ ] **Step 7: 提交**

```bash
git add server/app/models.py server/migrations/versions/20261114_b2c3d4e5f6a7_pets.py \
  server/app/services/pet.py server/app/routers/pet.py server/app/main.py server/tests/test_pet.py
git commit -m "feat(pet): add pet persistence and adoption API"
```

---

## Task 2: 按真实时间补算衰减、便便、生病

**Files:**
- Modify: `server/app/services/pet.py`（替换 `advance` 桩）
- Test: `server/tests/test_pet.py`（追加）

**Interfaces:**
- Consumes: Task 1 的 `Pet`、`STAT_KEYS`、`status_for`；`now` 为 naive UTC。
- Produces: `advance(pet, now)` 就地修改状态；`pet.last_tick_at = now`。常量：
  - `AWAY_DECAY = {"satiety": 1.5, "cleanliness": 0.8, "mood": 1.2, "energy": 1.5}`
  - `SLEEP_ENERGY_GAIN = 12.0`
  - `NEGLECT_AFTER_HOURS = 12.0`
  - `HEALTH_LOSS_PER_DAY = 20.0`
  - `HEALTH_REGEN_PER_DAY = 8.0`
  - `HEALTH_FLOOR = 10.0`
  - `MAX_CATCHUP_DAYS = 90`

- [ ] **Step 1: 写失败测试（衰减、便便、睡觉、生病、时钟回拨）**

追加到 `server/tests/test_pet.py`：

```python
from app.services.pet import advance


def test_one_hour_of_decay(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=1))
    assert pet.satiety == pytest.approx(68.5)
    assert pet.cleanliness == pytest.approx(89.2)
    assert pet.mood == pytest.approx(78.8)
    assert pet.energy == pytest.approx(78.5)
    assert pet.health == pytest.approx(100)
    assert pet.poop_count == 0


def test_half_hour_is_fractional(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(minutes=30))
    assert pet.satiety == pytest.approx(69.25)
    assert pet.cleanliness == pytest.approx(89.6)
    assert pet.mood == pytest.approx(79.4)
    assert pet.energy == pytest.approx(79.25)


def test_24h_makes_three_poops_and_drops_needs(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=24))
    assert pet.poop_count == 3
    assert pet.poop_progress == pytest.approx(8)
    assert pet.satiety == pytest.approx(34)
    assert pet.cleanliness == pytest.approx(61.2)
    assert pet.mood == pytest.approx(44)
    assert pet.energy == pytest.approx(44)
    assert pet.health == pytest.approx(100)


def test_72h_is_collapsed_but_not_sick(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=72))
    assert pet.satiety == pytest.approx(0)
    assert pet.cleanliness == pytest.approx(0)
    assert pet.mood == pytest.approx(0)
    assert pet.energy == pytest.approx(0)
    assert pet.health == pytest.approx(100 - (72 - 53) * 20 / 24, abs=1e-4)
    assert pet.sick_since is None


def test_101h_enters_sick(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(hours=101))
    assert pet.health == pytest.approx(60, abs=1e-4)
    assert pet.sick_since is not None
    assert status_for(pet) == ("sick", "生病了")


def test_90_days_keeps_health_floor_and_life(db):
    pet = _make_pet(db)
    advance(pet, T0 + timedelta(days=120))
    assert pet.health == pytest.approx(10)
    assert pet.sick_since is not None
    assert pet.last_tick_at == T0 + timedelta(days=120)


def test_sleeping_recovers_energy_and_halves_decay(db):
    pet = _make_pet(db, energy=20, sleeping=True, sleep_started_at=T0)
    advance(pet, T0 + timedelta(hours=1))
    assert pet.energy == pytest.approx(32)
    assert pet.satiety == pytest.approx(69.25)
    assert pet.cleanliness == pytest.approx(89.6)
    assert pet.mood == pytest.approx(79.4)
    assert pet.poop_count == 0
    assert pet.sleeping is True


def test_sleep_auto_wakes_at_100(db):
    pet = _make_pet(db, energy=99, sleeping=True, sleep_started_at=T0)
    advance(pet, T0 + timedelta(hours=1))
    assert pet.sleeping is False
    assert pet.energy == pytest.approx(98.625)


def test_clock_backwards_is_noop(db):
    pet = _make_pet(db, satiety=42)
    advance(pet, T0 - timedelta(hours=1))
    assert pet.satiety == pytest.approx(42)
    assert pet.last_tick_at == T0


def test_three_poops_stop_progress(db):
    pet = _make_pet(db, poop_count=3, poop_progress=8)
    advance(pet, T0 + timedelta(hours=8))
    assert pet.poop_count == 3
    assert pet.poop_progress == pytest.approx(8)


def test_health_regenerates_when_all_needs_are_above_40(db):
    pet = _make_pet(
        db, health=65, satiety=80, cleanliness=80, mood=80, energy=80,
        neglect_since=None,
    )
    advance(pet, T0 + timedelta(hours=24))
    assert pet.health == pytest.approx(73)


def test_sick_clears_at_75(db):
    pet = _make_pet(
        db, health=74, satiety=80, cleanliness=80, mood=80, energy=80,
        sick_since=T0, neglect_since=None,
    )
    advance(pet, T0 + timedelta(hours=4))
    assert pet.health == pytest.approx(75.3333, abs=1e-4)
    assert pet.sick_since is None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v -k "decay or poop or sick or sleep or clock or health"`
Expected: FAIL，衰减值仍是 70/90/80/80。

- [ ] **Step 3: 实现 `advance`**

把 `advance` 替换为：

```python
from datetime import timedelta

AWAY_DECAY = {"satiety": 1.5, "cleanliness": 0.8, "mood": 1.2, "energy": 1.5}
SLEEP_ENERGY_GAIN = 12.0
NEGLECT_AFTER_HOURS = 12.0
HEALTH_LOSS_PER_DAY = 20.0
HEALTH_REGEN_PER_DAY = 8.0
HEALTH_FLOOR = 10.0
MAX_CATCHUP_DAYS = 90


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _decay_awake(pet: Pet, hours: float) -> None:
    poop_mult = 1 + 0.5 * pet.poop_count
    mood_mult = (1 + 0.25 * pet.poop_count) * (1.5 if pet.sick_since is not None else 1)
    energy_mult = 1.25 if pet.sick_since is not None else 1
    pet.satiety = _clamp(pet.satiety - AWAY_DECAY["satiety"] * hours)
    pet.cleanliness = _clamp(pet.cleanliness - AWAY_DECAY["cleanliness"] * poop_mult * hours)
    pet.mood = _clamp(pet.mood - AWAY_DECAY["mood"] * mood_mult * hours)
    pet.energy = _clamp(pet.energy - AWAY_DECAY["energy"] * energy_mult * hours)
    if pet.poop_count >= 3:
        pet.poop_progress = 8.0
        return
    pet.poop_progress += hours
    while pet.poop_progress >= 8 and pet.poop_count < 3:
        pet.poop_progress -= 8
        pet.poop_count += 1
    if pet.poop_count >= 3:
        pet.poop_progress = 8.0


def _decay_sleeping(pet: Pet, hours: float) -> None:
    pet.energy = _clamp(pet.energy + SLEEP_ENERGY_GAIN * hours)
    pet.satiety = _clamp(pet.satiety - AWAY_DECAY["satiety"] * 0.5 * hours)
    pet.cleanliness = _clamp(pet.cleanliness - AWAY_DECAY["cleanliness"] * 0.5 * hours)
    pet.mood = _clamp(pet.mood - AWAY_DECAY["mood"] * 0.5 * hours)


def _settle_health_and_sick(pet: Pet, cursor_start: datetime, cursor_end: datetime) -> None:
    core = (pet.satiety, pet.cleanliness, pet.mood, pet.energy)
    core_min = min(core)
    if core_min < 10:
        if pet.neglect_since is None:
            pet.neglect_since = cursor_end
    else:
        pet.neglect_since = None

    if pet.neglect_since is not None:
        age_start = max(0.0, (cursor_start - pet.neglect_since).total_seconds() / 3600)
        age_end = max(0.0, (cursor_end - pet.neglect_since).total_seconds() / 3600)
        decay_hours = max(0.0, age_end - max(age_start, NEGLECT_AFTER_HOURS))
        pet.health = _clamp(pet.health - HEALTH_LOSS_PER_DAY / 24 * decay_hours, HEALTH_FLOOR)
    elif core_min >= 40:
        pet.health = _clamp(pet.health + HEALTH_REGEN_PER_DAY / 24 * (cursor_end - cursor_start).total_seconds() / 3600)

    if pet.sick_since is None and pet.health <= 60 + 1e-9:
        pet.sick_since = cursor_end
    elif pet.sick_since is not None and pet.health >= 75 - 1e-9:
        pet.sick_since = None


def advance(pet: Pet, now: datetime) -> None:
    if now <= pet.last_tick_at:
        return
    remaining_hours = (now - pet.last_tick_at).total_seconds() / 3600
    remaining_hours = min(remaining_hours, MAX_CATCHUP_DAYS * 24)
    cursor = pet.last_tick_at

    while remaining_hours > 1e-9:
        step = min(remaining_hours, 1.0)
        step_start = cursor
        step_end = cursor + timedelta(hours=step)

        if pet.sleeping:
            to_full = max(0.0, (100 - pet.energy) / SLEEP_ENERGY_GAIN)
            sleep_h = min(step, to_full)
            if sleep_h > 0:
                _decay_sleeping(pet, sleep_h)
            awake_h = step - sleep_h
            if awake_h > 1e-9:
                pet.sleeping = False
                pet.sleep_started_at = None
                _decay_awake(pet, awake_h)
        else:
            _decay_awake(pet, step)

        _settle_health_and_sick(pet, step_start, step_end)
        cursor = step_end
        remaining_hours -= step

    pet.last_tick_at = now
```

`_settle_health_and_sick` 里 `elif core_min >= 40` 的恢复条件使用步末核心值；这是本模块的固定口径。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v`
Expected: Task 1 + Task 2 全部通过。

- [ ] **Step 5: 提交**

```bash
git add server/app/services/pet.py server/tests/test_pet.py
git commit -m "feat(pet): simulate needs decay by elapsed time"
```

---

## Task 3: 动作、冷却、照顾天数与抚摸上限

**Files:**
- Modify: `server/app/services/pet.py`
- Modify: `server/app/routers/pet.py`
- Test: `server/tests/test_pet.py`

**Interfaces:**
- Consumes: Task 2 的 `advance`、`pet_payload`、`status_for`。
- Produces:
  - `ACTION_COOLDOWNS = {"feed": 1800, "treat": 3600, "wash": 7200, "play": 1200, "walk": 14400, "vet": 28800, "pet": 5}`
  - `CARE_ACTIONS = {"feed", "treat", "wash", "play", "walk", "vet"}`
  - `apply_action(pet: Pet, action: str, now: datetime) -> tuple[str, str]`，返回 `(event, message)`；错误用 `ApiError`。
  - `pet_payload` 的 `cooldowns` 改为真实剩余秒数。
  - `POST /api/v1/pet/actions`，body `{action}`，返回 `{pet, event, message}`。

- [ ] **Step 1: 写失败测试（动作效果、冷却、限制、照顾天数）**

追加：

```python
from datetime import timezone
from app.errors import ApiError
from app.services.pet import apply_action
from app.utils import LOCAL_TZ


def _local_noon(day_offset=0):
    local = datetime(2026, 11, 14, 12, 0, tzinfo=LOCAL_TZ) + timedelta(days=day_offset)
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def test_feed_caps_and_sets_cooldown(auth):
    pet = auth.post("/api/v1/pet", json={}).json()["pet"]
    resp = auth.post("/api/v1/pet/actions", json={"action": "feed"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["event"] == "fed"
    assert body["pet"]["stats"]["satiety"] == 100
    assert 1790 <= body["pet"]["cooldowns"]["feed"] <= 1800

    second = auth.post("/api/v1/pet/actions", json={"action": "feed"})
    assert second.status_code == 409
    assert second.json()["code"] == "PET_COOLDOWN"
    assert second.json()["details"]["remaining_seconds"] > 0


def test_feed_rejects_when_too_full(db):
    pet = _make_pet(db, satiety=95)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "feed", T0)
    assert exc.value.code == "PET_TOO_FULL"


def test_treat_consumes_snack_and_needs_one(db):
    pet = _make_pet(db, treats=0)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "treat", T0)
    assert exc.value.code == "PET_NO_TREAT"

    pet.treats = 1
    event, _ = apply_action(pet, "treat", T0)
    assert event == "treated"
    assert pet.treats == 0
    assert pet.satiety == pytest.approx(85)
    assert pet.mood == pytest.approx(88)


def test_wash_clears_poop_and_costs_energy(db):
    pet = _make_pet(db, cleanliness=40, energy=80, poop_count=3, poop_progress=8)
    event, _ = apply_action(pet, "wash", T0)
    assert event == "washed"
    assert pet.cleanliness == pytest.approx(90)
    assert pet.energy == pytest.approx(75)
    assert pet.poop_count == 0
    assert pet.poop_progress == 0


def test_play_requires_energy(db):
    pet = _make_pet(db, energy=19)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "play", T0)
    assert exc.value.code == "PET_TOO_TIRED"

    pet.energy = 20
    event, _ = apply_action(pet, "play", T0)
    assert event == "played"
    assert pet.mood == pytest.approx(100)
    assert pet.energy == pytest.approx(12)


def test_play_blocks_sick_but_not_recovering_band(db):
    pet = _make_pet(db, energy=80, sick_since=T0 - timedelta(hours=1))
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "play", T0)
    assert exc.value.code == "PET_SICK"

    pet.sick_since = None
    pet.health = 70
    pet.last_played_at = None
    assert apply_action(pet, "play", T0)[0] == "played"


def test_walk_is_daytime_only_and_costs_needs(db):
    night = datetime(2026, 11, 14, 22, 0, tzinfo=LOCAL_TZ).astimezone(timezone.utc).replace(tzinfo=None)
    pet = _make_pet(db, energy=80, satiety=80, mood=50, last_tick_at=night)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "walk", night)
    assert exc.value.code == "PET_DAYTIME_ONLY"

    noon = _local_noon()
    pet.last_tick_at = noon
    pet.last_walked_at = None
    event, _ = apply_action(pet, "walk", noon)
    assert event == "walked"
    assert pet.mood == pytest.approx(75)
    assert pet.satiety == pytest.approx(74)
    assert pet.energy == pytest.approx(68)


def test_vet_heals_only_when_needed(db):
    pet = _make_pet(db, health=50, sick_since=T0 - timedelta(days=1))
    event, _ = apply_action(pet, "vet", T0)
    assert event == "vetted"
    assert pet.health == pytest.approx(70)
    assert pet.sick_since is not None

    pet.health = 90
    pet.last_vet_at = None
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "vet", T0)
    assert exc.value.code == "PET_NOT_SICK"


def test_sleep_blocks_other_actions_until_wake(db):
    pet = _make_pet(db)
    assert apply_action(pet, "sleep", T0)[0] == "slept"
    assert pet.sleeping is True
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "feed", T0)
    assert exc.value.code == "PET_SLEEPING"
    assert apply_action(pet, "wake", T0)[0] == "woke"
    assert pet.sleeping is False
    assert apply_action(pet, "feed", T0)[0] == "fed"


def test_care_days_increment_once_per_local_day(db):
    pet = _make_pet(db)
    assert pet.care_days == 0
    apply_action(pet, "feed", T0)
    assert pet.care_days == 1
    apply_action(pet, "wash", T0 + timedelta(hours=2))
    assert pet.care_days == 1
    apply_action(pet, "feed", T0 + timedelta(days=1))
    assert pet.care_days == 2


def test_pet_cap_and_no_care(db):
    pet = _make_pet(db, mood=0)
    now = T0
    for _ in range(5):
        event, _ = apply_action(pet, "pet", now)
        assert event == "petted"
        now += timedelta(seconds=5)
    assert pet.mood == pytest.approx(15)
    assert pet.care_days == 0
    assert pet.pet_bonus_total == 15

    with pytest.raises(ApiError) as exc:
        apply_action(pet, "pet", now)
    assert exc.value.code == "PET_PET_LIMIT"
    assert exc.value.details["retry_after_seconds"] > 0


def test_exact_cooldown_boundary_allows_action(db):
    pet = _make_pet(db)
    apply_action(pet, "feed", T0)
    with pytest.raises(ApiError) as exc:
        apply_action(pet, "feed", T0 + timedelta(seconds=1799))
    assert exc.value.details["remaining_seconds"] == 1
    assert apply_action(pet, "feed", T0 + timedelta(seconds=1800))[0] == "fed"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v -k "feed or treat or wash or play or walk or vet or sleep or care or pet_cap or cooldown"`
Expected: FAIL，`apply_action` 不存在。

- [ ] **Step 3: 实现动作与冷却**

在 `server/app/services/pet.py` 增加：

```python
from datetime import timezone
from ..errors import ApiError
from ..utils import local_midnight_utc, utc_to_local

ACTION_COOLDOWNS = {
    "feed": 1800, "treat": 3600, "wash": 7200, "play": 1200,
    "walk": 14400, "vet": 28800, "pet": 5,
}
CARE_ACTIONS = {"feed", "treat", "wash", "play", "walk", "vet"}
COOLDOWN_FIELDS = {
    "feed": "last_fed_at", "treat": "last_treated_at", "wash": "last_washed_at",
    "play": "last_played_at", "walk": "last_walked_at", "vet": "last_vet_at",
    "pet": "last_petted_at",
}


def _remaining(last: datetime | None, now: datetime, seconds: int) -> int:
    if last is None:
        return 0
    return max(0, int(math.ceil(seconds - max(0.0, (now - last).total_seconds()))))


def _hour_bucket(now: datetime) -> datetime:
    local = utc_to_local(now)
    bucket = local.replace(minute=0, second=0, microsecond=0)
    return bucket.astimezone(timezone.utc).replace(tzinfo=None)


def _seconds_to_next_hour(now: datetime) -> int:
    local = utc_to_local(now)
    next_hour = local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return max(0, int(math.ceil((next_hour - local).total_seconds())))


def _cooldowns(pet: Pet, now: datetime) -> dict[str, int]:
    result: dict[str, int] = {}
    for action, seconds in ACTION_COOLDOWNS.items():
        result[action] = _remaining(getattr(pet, COOLDOWN_FIELDS[action]), now, seconds)
    if pet.pet_bonus_total >= 15 and pet.pet_bonus_hour == _hour_bucket(now):
        result["pet"] = max(result["pet"], _seconds_to_next_hour(now))
    return result


def _mark_care(pet: Pet, now: datetime) -> None:
    day = utc_to_local(now).date()
    if pet.last_care_date != day:
        pet.last_care_date = day
        pet.care_days += 1


def apply_action(pet: Pet, action: str, now: datetime) -> tuple[str, str]:
    if action not in {"feed", "treat", "wash", "play", "walk", "sleep", "wake", "vet", "pet"}:
        raise ApiError("VALIDATION_ERROR", "未知的宠物动作", 422)
    advance(pet, now)
    if pet.sleeping and action != "wake":
        raise ApiError("PET_SLEEPING", "它正在睡觉，先叫醒它", 409)

    if action == "sleep":
        if not pet.sleeping:
            pet.sleeping = True
            pet.sleep_started_at = now
        return "slept", "睡着了"
    if action == "wake":
        pet.sleeping = False
        pet.sleep_started_at = None
        return "woke", "醒来了"

    if action in ACTION_COOLDOWNS:
        remaining = _remaining(getattr(pet, COOLDOWN_FIELDS[action]), now, ACTION_COOLDOWNS[action])
        if action == "pet" and pet.pet_bonus_total >= 15 and pet.pet_bonus_hour == _hour_bucket(now):
            remaining = max(remaining, _seconds_to_next_hour(now))
        if remaining > 0:
            if action == "pet" and pet.pet_bonus_total >= 15 and pet.pet_bonus_hour == _hour_bucket(now):
                raise ApiError("PET_PET_LIMIT", "这个小时摸够啦，让它歇会儿", 409,
                               {"retry_after_seconds": remaining})
            raise ApiError("PET_COOLDOWN", "还在冷却中", 409,
                           {"action": action, "remaining_seconds": remaining})

    if action == "feed":
        if pet.satiety >= 95:
            raise ApiError("PET_TOO_FULL", "它已经吃饱了", 409)
        pet.satiety = _clamp(pet.satiety + 40)
        event, message = "fed", "吃饱啦，饱腹 +40"
    elif action == "treat":
        if pet.treats <= 0:
            raise ApiError("PET_NO_TREAT", "没有零食了", 409)
        pet.treats -= 1
        pet.satiety = _clamp(pet.satiety + 15)
        pet.mood = _clamp(pet.mood + 8)
        event, message = "treated", "零食真好吃，心情 +8"
    elif action == "wash":
        pet.cleanliness = _clamp(pet.cleanliness + 50)
        pet.energy = _clamp(pet.energy - 5)
        pet.poop_count = 0
        pet.poop_progress = 0
        event, message = "washed", "洗得干干净净"
    elif action == "play":
        if pet.sick_since is not None:
            raise ApiError("PET_SICK", "生病了，先看医生吧", 409)
        if pet.energy < 20:
            raise ApiError("PET_TOO_TIRED", "太累了，先睡一觉", 409)
        pet.mood = _clamp(pet.mood + 20)
        pet.energy = _clamp(pet.energy - 8)
        event, message = "played", "玩得很开心，心情 +20"
    elif action == "walk":
        if pet.sick_since is not None:
            raise ApiError("PET_SICK", "生病了，先看医生吧", 409)
        if pet.energy < 25:
            raise ApiError("PET_TOO_TIRED", "太累了，走不动", 409)
        if not 7 <= utc_to_local(now).hour < 22:
            raise ApiError("PET_DAYTIME_ONLY", "太晚了，明天再散步吧", 409)
        pet.mood = _clamp(pet.mood + 25)
        pet.satiety = _clamp(pet.satiety - 6)
        pet.energy = _clamp(pet.energy - 12)
        event, message = "walked", "散步回来了，心情 +25"
    elif action == "vet":
        if pet.health >= 85:
            raise ApiError("PET_NOT_SICK", "它很健康，不需要看医生", 409)
        pet.health = _clamp(pet.health + 20)
        event, message = "vetted", "看过医生，健康 +20"
    elif action == "pet":
        bucket = _hour_bucket(now)
        if pet.pet_bonus_hour != bucket:
            pet.pet_bonus_hour = bucket
            pet.pet_bonus_total = 0
        gain = min(3, 15 - pet.pet_bonus_total)
        pet.mood = _clamp(pet.mood + gain)
        pet.pet_bonus_total += gain
        event, message = "petted", "它蹭了蹭你的手，心情 +3"

    setattr(pet, COOLDOWN_FIELDS[action], now)
    if action in CARE_ACTIONS:
        _mark_care(pet, now)
    return event, message
```

把 `pet_payload` 的 `cooldowns` 改成 `_cooldowns(pet, now)`。注意 `_cooldowns` 里生成器写法可读性差时，改成显式循环：

```python
result = {}
for action, seconds in ACTION_COOLDOWNS.items():
    result[action] = _remaining(getattr(pet, COOLDOWN_FIELDS[action]), now, seconds)
```

- [ ] **Step 4: 在路由加 action 接口**

在 `server/app/routers/pet.py` 增加：

```python
from typing import Literal
from ..models import utcnow
from ..services.pet import apply_action


class PetAction(BaseModel):
    action: Literal["feed", "treat", "wash", "play", "walk", "sleep", "wake", "vet", "pet"]


@router.post("/pet/actions")
def act(body: PetAction, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    pet = _owned(db, user)
    now = utcnow()
    event, message = apply_action(pet, body.action, now)
    db.commit()
    db.refresh(pet)
    return {"pet": pet_payload(pet, now), "event": event, "message": message}
```

- [ ] **Step 5: 跑测试**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v`
Expected: 全部通过。动作测试里 `feed` 后 `satiety` 受 `_make_pet` 的 `now` 影响时，用直接服务测试；API 测试在领养后立刻发动作。

- [ ] **Step 6: 提交**

```bash
git add server/app/services/pet.py server/app/routers/pet.py server/tests/test_pet.py
git commit -m "feat(pet): add care actions, cooldowns and care days"
```

---

## Task 4: 每日打卡/待办奖励

**Files:**
- Modify: `server/app/services/pet.py`（替换 `claim_daily_bonus`）
- Test: `server/tests/test_pet.py`

**Interfaces:**
- Consumes: `CheckinInstance`、`Todo`、`local_midnight_utc`、`utc_to_local`。
- Produces: `claim_daily_bonus(db, pet, now) -> dict | None`，返回 `{"mood": 6, "treats": 1, "source": "checkin" | "todo", "date": "YYYY-MM-DD"}`，只发一次。

- [ ] **Step 1: 写失败测试**

追加：

```python
from datetime import date
from app.models import CheckinGroup, CheckinInstance, CheckinRule, Todo, TodoList, WorkTarget
from app.services.pet import claim_daily_bonus


def _completed_todo(db, when):
    row = TodoList(name="默认")
    db.add(row)
    db.flush()
    db.add(Todo(list_id=row.id, title="完成的事", completed_at=when))
    db.commit()


def _completed_checkin(db, when):
    target = WorkTarget(kind="shop", name="测试店")
    group = CheckinGroup(name="默认分组")
    db.add_all([target, group])
    db.flush()
    rule = CheckinRule(target_id=target.id, group_id=group.id, title="每日打卡")
    db.add(rule)
    db.flush()
    db.add(CheckinInstance(
        rule_id=rule.id, target_id=target.id, target_name=target.name,
        group_id=group.id, group_name=group.name, period_type="daily",
        period_start=when.date(), period_end=when.date(),
        title=rule.title, completed_at=when,
    ))
    db.commit()


def test_daily_bonus_none_without_completed_work(db):
    pet = _make_pet(db)
    assert claim_daily_bonus(db, pet, T0) is None
    assert pet.daily_bonus_date is None


def test_daily_bonus_once_from_checkin(db):
    pet = _make_pet(db)
    _completed_checkin(db, T0)
    bonus = claim_daily_bonus(db, pet, T0)
    assert bonus == {"mood": 6, "treats": 1, "source": "checkin", "date": "2026-11-14"}
    assert pet.mood == pytest.approx(86)
    assert pet.treats == 1
    assert claim_daily_bonus(db, pet, T0) is None
    assert pet.mood == pytest.approx(86)
    assert pet.treats == 1


def test_daily_bonus_from_todo_and_yesterday_does_not_count(db):
    pet = _make_pet(db)
    _completed_todo(db, T0 - timedelta(hours=12))
    assert claim_daily_bonus(db, pet, T0) is None

    _completed_todo(db, T0)
    bonus = claim_daily_bonus(db, pet, T0)
    assert bonus["source"] == "todo"


def test_daily_bonus_treat_cap(db):
    pet = _make_pet(db, treats=5)
    _completed_todo(db, T0)
    bonus = claim_daily_bonus(db, pet, T0)
    assert bonus["treats"] == 1
    assert pet.treats == 5


def test_get_pet_claims_bonus_once(auth, db):
    auth.post("/api/v1/pet", json={})
    _completed_todo(db, datetime.utcnow())
    first = auth.get("/api/v1/pet").json()
    assert first["daily_bonus"]["source"] == "todo"
    assert first["pet"]["stats"]["mood"] == 86
    second = auth.get("/api/v1/pet").json()
    assert second["daily_bonus"] is None
    assert second["pet"]["stats"]["mood"] <= 86
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v -k "daily_bonus"`
Expected: FAIL，`claim_daily_bonus` 返回 `None`。

- [ ] **Step 3: 实现**

替换 `claim_daily_bonus`：

```python
from sqlalchemy import select
from ..models import CheckinInstance, Todo


def claim_daily_bonus(db: Session, pet: Pet, now: datetime) -> dict | None:
    day = utc_to_local(now).date()
    if pet.daily_bonus_date == day:
        return None
    start = local_midnight_utc(day)
    end = local_midnight_utc(day + timedelta(days=1))
    has_checkin = db.scalar(
        select(CheckinInstance.id)
        .where(CheckinInstance.completed_at >= start, CheckinInstance.completed_at < end)
        .limit(1)
    ) is not None
    has_todo = db.scalar(
        select(Todo.id)
        .where(Todo.completed_at >= start, Todo.completed_at < end)
        .limit(1)
    ) is not None
    if not (has_checkin or has_todo):
        return None
    pet.daily_bonus_date = day
    pet.mood = _clamp(pet.mood + 6)
    pet.treats = min(5, pet.treats + 1)
    return {
        "mood": 6,
        "treats": 1,
        "source": "checkin" if has_checkin else "todo",
        "date": day.isoformat(),
    }
```

- [ ] **Step 4: 跑测试**

Run: `cd server && .venv/bin/python -m pytest tests/test_pet.py -v`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add server/app/services/pet.py server/tests/test_pet.py
git commit -m "feat(pet): grant daily bonus from completed work"
```

---

## Task 5: 前端数据层、领养/改名页面、路由与导航

**Files:**
- Create: `web-react/src/pets/api.ts`
- Create: `web-react/src/pets/usePet.ts`
- Create: `web-react/src/pages/Pet.tsx`
- Modify: `web-react/src/App.tsx:12-31`（懒加载）与 `:64-92`（路由）
- Modify: `web-react/src/layout/app-nav.ts:20-53`
- Modify: `web-react/src/router/preload.ts:3-19`
- Test: `e2e/pet.mjs`

**Interfaces:**
- Consumes: `http`、`apiError`、`toast`、`Page`、`PageBody`、`PageToolbar`、`EmptyHint`、`LoadingBlock`。
- Produces:
  - `PetPayload`、`PetEnvelope`、`DailyBonus`、`PetActionResponse` 类型。
  - `fetchPet(): Promise<PetEnvelope>`、`adoptPet(name?: string): Promise<{pet: PetPayload}>`、`renamePet(name: string): Promise<{pet: PetPayload}>`、`runPetAction(action: PetAction): Promise<PetActionResponse>`。
  - `usePetQuery()`、`useAdoptPet()`、`useRenamePet()`、`usePetAction()`。
  - `/pet` 页面可领养、改名、刷新后保持。

- [ ] **Step 1: 写失败的 e2e**

新建 `e2e/pet.mjs`：

```js
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import fs from 'node:fs'

fs.mkdirSync('../.run/pet-e2e', { recursive: true })
const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(process.env.WB_E2E_PASSWORD || 'admin12345')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/checkins/shops')

  const before = await context.request.get(base + '/api/v1/pet')
  const hadPet = Boolean((await before.json()).pet)

  await page.goto(base + '/pet')
  if (!hadPet) {
    await page.getByRole('heading', { name: '领养一只狗' }).waitFor()
    await page.getByLabel('给狗狗起个名字').fill('测试旺财')
    await page.getByRole('button', { name: '领养', exact: true }).click()
  }
  await page.locator('h5').first().waitFor()

  await page.getByRole('button', { name: '改名', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '给狗狗改名' })
  await dialog.getByLabel('名字').fill('豆豆')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '豆豆' }).waitFor()

  await page.reload()
  await page.getByRole('heading', { name: '豆豆' }).waitFor()
  await page.screenshot({ path: '../.run/pet-e2e/shell.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: pet adoption, rename, reload and navigation shell.')
} catch (error) {
  await page.screenshot({ path: '../.run/pet-e2e/failure.png' })
  throw error
} finally {
  await browser.close()
}
```

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: FAIL，`/pet` 404 或找不到「领养一只狗」。若本地已有宠物，先删除测试库再跑。

- [ ] **Step 2: 写类型与请求**

新建 `web-react/src/pets/api.ts`：

```ts
import { http } from '@/api/client'

export type PetStage = 'puppy' | 'adult' | 'senior'
export type PetStatus = 'sleeping' | 'sick' | 'hungry' | 'tired' | 'dirty' | 'sad' | 'great' | 'ok'
export type PetAction = 'feed' | 'treat' | 'wash' | 'play' | 'walk' | 'sleep' | 'wake' | 'vet' | 'pet'

export interface PetPayload {
  id: number
  name: string
  species: 'dog'
  stage: PetStage
  stage_label: string
  care_days: number
  stats: { satiety: number; cleanliness: number; mood: number; energy: number; health: number }
  status: PetStatus
  status_label: string
  sleeping: boolean
  poop_count: number
  treats: number
  cooldowns: Record<'feed' | 'treat' | 'wash' | 'play' | 'walk' | 'vet' | 'pet', number>
  next_stage_in_days: number | null
  version: number
  updated_at: string
}

export interface DailyBonus {
  mood: number
  treats: number
  source: 'checkin' | 'todo'
  date: string
}

export interface PetEnvelope {
  pet: PetPayload | null
  daily_bonus: DailyBonus | null
}

export interface PetActionResponse {
  pet: PetPayload
  event: 'fed' | 'treated' | 'washed' | 'played' | 'walked' | 'slept' | 'woke' | 'vetted' | 'petted'
  message: string
}

export async function fetchPet(): Promise<PetEnvelope> {
  return (await http.get('/pet')).data
}

export async function adoptPet(name?: string): Promise<{ pet: PetPayload }> {
  return (await http.post('/pet', { name: name?.trim() || undefined })).data
}

export async function renamePet(name: string): Promise<{ pet: PetPayload }> {
  return (await http.patch('/pet', { name })).data
}

export async function runPetAction(action: PetAction): Promise<PetActionResponse> {
  return (await http.post('/pet/actions', { action })).data
}
```

- [ ] **Step 3: 写查询 hooks**

新建 `web-react/src/pets/usePet.ts`：

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adoptPet, fetchPet, renamePet, runPetAction,
  type PetAction, type PetEnvelope, type PetPayload,
} from './api'

export const PET_KEY = ['pet'] as const

export function usePetQuery() {
  return useQuery({
    queryKey: PET_KEY,
    queryFn: fetchPet,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useAdoptPet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name?: string) => adoptPet(name),
    onSuccess: (data) => qc.setQueryData<PetEnvelope>(PET_KEY, { pet: data.pet, daily_bonus: null }),
  })
}

export function useRenamePet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => renamePet(name),
    onSuccess: (data) => qc.setQueryData<PetEnvelope>(PET_KEY, (prev) => ({ pet: data.pet, daily_bonus: prev?.daily_bonus ?? null })),
  })
}

export function usePetAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: PetAction) => runPetAction(action),
    onSuccess: (data) => qc.setQueryData<PetEnvelope>(PET_KEY, { pet: data.pet, daily_bonus: null }),
    onError: () => { void qc.invalidateQueries({ queryKey: PET_KEY }) },
  })
}
```

- [ ] **Step 4: 写页面壳**

新建 `web-react/src/pages/Pet.tsx`，本任务先有领养/改名和占位区域：

```tsx
import { useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { apiError } from '@/api/client'
import { EmptyHint, LoadingBlock, Page, PageBody, PageToolbar } from '@/ui/common'
import { toast } from '@/ui/feedback'
import { useAdoptPet, usePetQuery, useRenamePet } from '@/pets/usePet'

export default function PetPage() {
  const { data, isLoading, isError, refetch } = usePetQuery()
  const adopt = useAdoptPet()
  const rename = useRenamePet()
  const [name, setName] = useState('旺财')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const bonusShown = useRef('')

  useEffect(() => {
    const bonus = data?.daily_bonus
    if (bonus && bonusShown.current !== bonus.date) {
      bonusShown.current = bonus.date
      toast.success(`今天完成过${bonus.source === 'checkin' ? '打卡' : '待办'}，心情 +${bonus.mood}，获得 ${bonus.treats} 份零食`)
    }
  }, [data?.daily_bonus])

  if (isLoading) return <Page><LoadingBlock text="正在找狗狗…" /></Page>
  if (isError) return <Page><EmptyHint action={<Button onClick={() => void refetch()}>重试</Button>}>狗狗走丢了，稍后再试</EmptyHint></Page>

  const pet = data?.pet
  if (!pet) {
    return (
      <Page>
        <PageBody>
          <Box sx={{ maxWidth: 460, mx: 'auto', my: 6, textAlign: 'center' }}>
            <Typography variant="h5" sx={{ mb: 1 }}>领养一只狗</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              它会按真实时间饿、困、变脏。每天照顾一两分钟就够，不会永久死亡。
            </Typography>
            <TextField label="给狗狗起个名字" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 12 }} fullWidth />
            <Button
              variant="contained" sx={{ mt: 2 }} disabled={adopt.isPending}
              onClick={() => adopt.mutate(name, {
                onError: (error) => toast.error(apiError(error).message),
                onSuccess: () => toast.success('领养成功'),
              })}
            >
              领养
            </Button>
          </Box>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageToolbar>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{pet.name}</Typography>
        <Typography variant="body2" color="text.secondary">{pet.stage_label} · {pet.status_label}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => { setRenameValue(pet.name); setRenameOpen(true) }}>改名</Button>
      </PageToolbar>
      <PageBody>
        <Box sx={{ flex: 1, minHeight: 320, borderRadius: 2, bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}>
          <Typography color="text.secondary">房间和状态面板即将出现</Typography>
        </Box>
      </PageBody>
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} aria-labelledby="rename-pet-title">
        <DialogTitle id="rename-pet-title">给狗狗改名</DialogTitle>
        <DialogContent>
          <TextField autoFocus label="名字" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} inputProps={{ maxLength: 12 }} fullWidth sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>取消</Button>
          <Button
            variant="contained" disabled={rename.isPending}
            onClick={() => rename.mutate(renameValue, {
              onSuccess: () => { setRenameOpen(false); toast.success('改名成功') },
              onError: (error) => toast.error(apiError(error).message),
            })}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}
```

- [ ] **Step 5: 接路由、导航、预取**

`web-react/src/App.tsx` 顶部加：

```tsx
const PetPage = lazy(() => import('@/pages/Pet'))
```

受保护路由内加：

```tsx
<Route path="/pet" element={<PetPage />} />
```

`web-react/src/layout/app-nav.ts`：

```ts
export type AppNavGroup = 'work' | 'content' | 'info' | 'tools' | 'life'

export const APP_NAV_GROUPS: Array<{ key: AppNavGroup; label: string }> = [
  { key: 'work', label: '工作' },
  { key: 'content', label: '内容' },
  { key: 'info', label: '信息' },
  { key: 'tools', label: '工具' },
  { key: 'life', label: '生活' },
]
```

在 `APP_NAV_ITEMS` 末尾加：

```ts
{ key: 'pet', label: '宠物', path: '/pet', icon: Pets, group: 'life' },
```

并在顶部图标导入里加 `Pets`。

`web-react/src/router/preload.ts` 的 `loaders` 加：

```ts
['/pet', () => import('@/pages/Pet')],
```

- [ ] **Step 6: 类型、构建、e2e**

Run: `cd web-react && npm run typecheck && npm run build`
Expected: 无 TypeScript 错误，构建成功。

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add web-react/src/pets/api.ts web-react/src/pets/usePet.ts web-react/src/pages/Pet.tsx \
  web-react/src/App.tsx web-react/src/layout/app-nav.ts web-react/src/router/preload.ts e2e/pet.mjs
git commit -m "feat(pet): add pet page shell, adoption and navigation"
```

---

## Task 6: 状态面板、动作栏与冷却倒计时

**Files:**
- Create: `web-react/src/pets/NeedsPanel.tsx`
- Create: `web-react/src/pets/ActionBar.tsx`
- Modify: `web-react/src/pages/Pet.tsx`
- Modify: `e2e/pet.mjs`

**Interfaces:**
- Consumes: `PetPayload`、`PetAction`、`usePetAction`、`toast`、`apiError`。
- Produces:
  - `NeedsPanel({ pet }: { pet: PetPayload })`
  - `ActionBar({ pet, syncedAt, pending, onAction }: { pet: PetPayload; syncedAt: number; pending: PetAction | null; onAction: (action: PetAction) => void })`
  - 动作按钮的 accessible name 包含中文动作名；冷却时显示 `mm:ss`。

- [ ] **Step 1: 扩展 e2e（先失败）**

在 `e2e/pet.mjs` 的改名断言之后加：

```js
  // 状态面板和动作
  await page.getByText('饱腹', { exact: true }).waitFor()
  const feed = page.getByRole('button', { name: /喂食/ })
  const feedResponse = page.waitForResponse((r) => r.url().endsWith('/api/v1/pet/actions') && r.request().method() === 'POST')
  await feed.click()
  assert.equal((await feedResponse).status(), 200)
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('喂食'))
    return el?.hasAttribute('disabled')
  })

  await page.getByRole('button', { name: /睡觉/ }).click()
  await page.getByText('睡觉中', { exact: true }).waitFor()
  assert.ok(await feed.isDisabled())
  await page.getByRole('button', { name: /叫醒/ }).click()
  await page.getByText('睡觉中', { exact: true }).waitFor({ state: 'hidden' })

  const petButton = page.getByRole('button', { name: '抚摸', exact: true })
  const petResponse = page.waitForResponse((r) => r.url().endsWith('/api/v1/pet/actions'))
  await petButton.click()
  await petResponse
  await page.screenshot({ path: '../.run/pet-e2e/actions.png' })
```

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: FAIL，找不到「饱腹」或「喂食」。

- [ ] **Step 2: 写 NeedsPanel**

新建 `web-react/src/pets/NeedsPanel.tsx`：

```tsx
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { PetPayload } from './api'

const ROWS: Array<{ key: keyof PetPayload['stats']; label: string; color: string }> = [
  { key: 'satiety', label: '饱腹', color: '#E0A33A' },
  { key: 'cleanliness', label: '清洁', color: '#4FA3D9' },
  { key: 'mood', label: '心情', color: '#E06A8B' },
  { key: 'energy', label: '精力', color: '#6BBF8A' },
  { key: 'health', label: '健康', color: '#C95B5B' },
]

export default function NeedsPanel({ pet }: { pet: PetPayload }) {
  return (
    <Stack spacing={1.1}>
      {ROWS.map((row) => {
        const value = pet.stats[row.key]
        return (
          <Box key={row.key}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
              <Typography variant="caption" color="text.secondary">{row.label}</Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
            </Stack>
            <LinearProgress
              variant="determinate" value={value}
              aria-label={`${row.label} ${value}`}
              sx={{
                height: 7, borderRadius: 4, bgcolor: 'action.hover',
                '& .MuiLinearProgress-bar': { bgcolor: value <= 20 ? 'error.main' : row.color, borderRadius: 4 },
              }}
            />
          </Box>
        )
      })}
      <Typography variant="caption" color="text.secondary">零食 × {pet.treats}</Typography>
    </Stack>
  )
}
```

- [ ] **Step 3: 写 ActionBar**

新建 `web-react/src/pets/ActionBar.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Button, Stack, Tooltip, Typography } from '@mui/material'
import type { PetAction, PetPayload } from './api'

const ACTIONS: Array<{ action: PetAction; label: string }> = [
  { action: 'feed', label: '喂食' },
  { action: 'treat', label: '零食' },
  { action: 'wash', label: '洗澡' },
  { action: 'play', label: '玩耍' },
  { action: 'walk', label: '遛狗' },
  { action: 'vet', label: '看医生' },
]

function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function ActionBar({
  pet, syncedAt, pending, onAction,
}: {
  pet: PetPayload
  syncedAt: number
  pending: PetAction | null
  onAction: (action: PetAction) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - syncedAt) / 1000))
  const hour = new Date().getHours()

  const reasons = useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {}
    if (pet.sleeping) result.all = '睡觉时只能叫醒'
    if (pet.stats.satiety >= 95) result.feed = '它已经吃饱了'
    if (pet.treats <= 0) result.treat = '没有零食了'
    if (pet.status === 'sick') { result.play = '生病了，先看医生'; result.walk = '生病了，先看医生' }
    if (pet.stats.energy < 20) result.play = '精力不足 20'
    if (pet.stats.energy < 25) result.walk = '精力不足 25'
    if (pet.stats.health >= 85) result.vet = '它很健康'
    if (hour < 7 || hour >= 22) result.walk = '只有 07:00–22:00 能遛狗'
    return result
  }, [pet, hour])

  const cooling = (action: keyof PetPayload['cooldowns']) =>
    Math.max(0, pet.cooldowns[action] - elapsed)

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        {ACTIONS.map(({ action, label }) => {
          const left = cooling(action as keyof PetPayload['cooldowns'])
          const reason = pet.sleeping ? '睡觉时只能叫醒' : reasons[action]
          const disabled = pending !== null || left > 0 || Boolean(reason)
          return (
            <Tooltip key={action} title={reason || (left > 0 ? `冷却中，${clock(left)}` : '')}>
              <span>
                <Button size="small" variant="outlined" disabled={disabled} onClick={() => onAction(action)}>
                  {left > 0 ? `${label} ${clock(left)}` : label}
                </Button>
              </span>
            </Tooltip>
          )
        })}
        <Button
          size="small" variant="outlined" disabled={pending !== null}
          onClick={() => onAction(pet.sleeping ? 'wake' : 'sleep')}
        >
          {pet.sleeping ? '叫醒' : '睡觉'}
        </Button>
        <Button
          size="small" variant="contained"
          disabled={pending !== null || pet.sleeping || cooling('pet') > 0}
          onClick={() => onAction('pet')}
        >
          {cooling('pet') > 0 ? `抚摸 ${clock(cooling('pet'))}` : '抚摸'}
        </Button>
      </Stack>
      {pet.sleeping ? <Typography variant="caption" color="text.secondary">它睡着了，叫醒后才能做别的。</Typography> : null}
    </Stack>
  )
}
```

- [ ] **Step 4: 接进页面**

在 `Pet.tsx` 里引入 `NeedsPanel`、`ActionBar`、`usePetAction`，把占位 `Box` 换成两栏：

```tsx
const { data, dataUpdatedAt, isLoading, isError, refetch } = usePetQuery()
const action = usePetAction()

<PageBody>
  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 320px' }, gap: 2, flex: 1, minHeight: 0 }}>
    <Box sx={{ minWidth: 0, minHeight: 320, borderRadius: 2, bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}>
      <Typography color="text.secondary">狗狗的房间</Typography>
    </Box>
    <Box sx={{ minWidth: 0, borderRadius: 2, border: 1, borderColor: 'divider', p: 2 }}>
      <NeedsPanel pet={pet} />
      <Box sx={{ mt: 2 }}>
        <ActionBar
          pet={pet}
          syncedAt={dataUpdatedAt}
          pending={action.isPending ? action.variables ?? null : null}
          onAction={(next) => action.mutate(next, {
            onSuccess: (result) => toast.success(result.message),
            onError: (error) => toast.error(apiError(error).message),
          })}
        />
      </Box>
    </Box>
  </Box>
</PageBody>
```

`dataUpdatedAt` 是 TanStack Query 收到本次 payload 的本地毫秒时间，冷却倒计时必须用它，不能用 `Date.now()`。

- [ ] **Step 5: 类型、构建、e2e**

Run: `cd web-react && npm run typecheck && npm run build`
Expected: 通过。

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: PASS，包含喂食冷却、睡觉/叫醒、抚摸。

- [ ] **Step 6: 提交**

```bash
git add web-react/src/pets/NeedsPanel.tsx web-react/src/pets/ActionBar.tsx \
  web-react/src/pages/Pet.tsx e2e/pet.mjs
git commit -m "feat(pet): add needs panel and action bar"
```

---

## Task 7: 像素狗素材、房间、动画与移动端

**Files:**
- Create: `web-react/src/pets/assets/dog-sheet.png`
- Create: `web-react/src/pets/assets/dog-portrait.png`
- Create: `web-react/src/pets/assets/CREDITS.md`
- Create: `web-react/src/pets/PetSprite.tsx`
- Create: `web-react/src/pets/PetRoom.tsx`
- Modify: `web-react/src/pages/Pet.tsx`
- Modify: `e2e/pet.mjs`

**Interfaces:**
- Consumes: `PetPayload`、MUI `useMediaQuery` / `useTheme`。
- Produces:
  - `PetSprite({ state, stage, reduced, className }: { state: SpriteState; stage: PetPayload['stage']; reduced: boolean; className?: string })`
  - `SpriteState = 'idle' | 'walk' | 'eat' | 'sleep' | 'sad' | 'sick'`
  - `PetRoom({ pet, busy, onPet }: { pet: PetPayload; busy: boolean; onPet: () => void })`
  - 素材契约：`dog-sheet.png` 为 `256×384` RGBA，4 列 × 6 行，行顺序 `idle, walk, eat, sleep, sad, sick`；`dog-portrait.png` 为 `128×128` RGBA。

- [ ] **Step 1: 扩展 e2e（先失败）**

在 `e2e/pet.mjs` 末尾、`assert.deepEqual(errors, [])` 之前加：

```js
  const sprite = page.locator('[data-pet-sprite]')
  await sprite.waitFor()
  assert.ok(await page.locator('[data-pet-room]').count())
  await page.screenshot({ path: '../.run/pet-e2e/room.png' })

  await page.setViewportSize({ width: 375, height: 844 })
  await page.reload()
  await page.locator('[data-pet-room]').waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await page.screenshot({ path: '../.run/pet-e2e/mobile.png' })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await page.locator('[data-pet-sprite]').waitFor()
  const firstFrame = await page.locator('[data-pet-sprite]').getAttribute('data-frame')
  await page.waitForTimeout(700)
  assert.equal(await page.locator('[data-pet-sprite]').getAttribute('data-frame'), firstFrame)
```

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: FAIL，找不到 `[data-pet-sprite]`。

- [ ] **Step 2: 生成并校验素材**

用用户提供的三视图作为形象基准：奶油金幼犬、垂耳、深棕描边、红色项圈、浅蓝背景仅作参考。生成 4×6 精灵表和一个正面头像。若图像生成结果帧间不一致，退化为：`dog-sheet.png` 只保证 idle/walk 行可用，其余行复用 idle 帧，动画状态用 CSS 位移/旋转/滤镜表达；在 `CREDITS.md` 记录退化原因。

处理要求：

- 背景从四角 flood fill 成透明，保留狗身上的浅色高光。
- 每帧 64×64，按最近邻缩放，禁用平滑。
- 行顺序固定，不能改 `PetSprite` 的行号。
- 头像 128×128，正视图。

校验命令：

```bash
cd /home/weiwen/workbench_element
server/.venv/bin/python - <<'PY'
from PIL import Image
sheet = Image.open('web-react/src/pets/assets/dog-sheet.png')
assert sheet.size == (256, 384), sheet.size
assert sheet.mode == 'RGBA', sheet.mode
assert sheet.getchannel('A').getextrema()[0] == 0
portrait = Image.open('web-react/src/pets/assets/dog-portrait.png')
assert portrait.size == (128, 128), portrait.size
assert portrait.mode == 'RGBA', portrait.mode
print('pet assets ok')
PY
```

Expected: `pet assets ok`。

`CREDITS.md` 写清：素材来源（用户提供的参考图 / 生成后处理）、处理脚本或步骤、许可证（自用素材）。

- [ ] **Step 3: 写 PetSprite**

新建 `web-react/src/pets/PetSprite.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import sheetUrl from './assets/dog-sheet.png'
import type { PetPayload } from './api'

export type SpriteState = 'idle' | 'walk' | 'eat' | 'sleep' | 'sad' | 'sick'

const ROWS: Record<SpriteState, number> = { idle: 0, walk: 1, eat: 2, sleep: 3, sad: 4, sick: 5 }
const FPS: Record<SpriteState, number> = { idle: 2, walk: 6, eat: 4, sleep: 2, sad: 2, sick: 2 }

export default function PetSprite({
  state, stage, reduced, className,
}: {
  state: SpriteState
  stage: PetPayload['stage']
  reduced: boolean
  className?: string
}) {
  const [frame, setFrame] = useState(0)
  const row = ROWS[state]
  const fps = FPS[state]

  useEffect(() => {
    setFrame(0)
    if (reduced) return
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % 4), Math.round(1000 / fps))
    return () => window.clearInterval(timer)
  }, [state, reduced, fps])

  return (
    <Box
      component="span"
      className={className}
      data-pet-sprite
      data-frame={reduced ? 0 : frame}
      sx={{
        display: 'block',
        width: '100%',
        aspectRatio: '1 / 1',
        backgroundImage: `url(${sheetUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '400% 600%',
        backgroundPosition: `${(reduced ? 0 : frame) * -33.3333}% ${row * -20}%`,
        imageRendering: 'pixelated',
        transform: stage === 'puppy' ? 'scale(0.85)' : 'scale(1)',
        filter: stage === 'senior' ? 'saturate(0.65)' : 'none',
        transformOrigin: '50% 100%',
      }}
    />
  )
}
```

`backgroundPosition` 的百分比与 4×6 网格配合：x 为 `frame * -100%`（4 帧，背景宽 400% 时每帧 100%），y 为 `row * -20%`（6 行，背景高 600% 时每行 20%）。在浏览器里核对第一帧和最后一帧不串行。

- [ ] **Step 4: 写 PetRoom**

新建 `web-react/src/pets/PetRoom.tsx`：

```tsx
import { Box, ButtonBase, Typography } from '@mui/material'
import type { PetAction, PetPayload } from './api'
import PetSprite, { type SpriteState } from './PetSprite'
import portraitUrl from './assets/dog-portrait.png'

function stateFor(pet: PetPayload, busyAction: PetAction | null): SpriteState {
  if (pet.sleeping) return 'sleep'
  if (pet.status === 'sick') return 'sick'
  if (busyAction === 'feed' || busyAction === 'treat') return 'eat'
  if (busyAction === 'walk' || busyAction === 'play') return 'walk'
  if (['hungry', 'tired', 'dirty', 'sad'].includes(pet.status)) return 'sad'
  return 'idle'
}

export default function PetRoom({
  pet, busy, busyAction, reduced, onPet,
}: {
  pet: PetPayload
  busy: boolean
  busyAction: PetAction | null
  reduced: boolean
  onPet: () => void
}) {
  return (
    <Box
      data-pet-room
      sx={{
        position: 'relative', minHeight: { xs: 260, md: 360 }, borderRadius: 2, overflow: 'hidden',
        border: 1, borderColor: 'divider',
        background: 'linear-gradient(180deg, #DCEBF5 0%, #EAF3F7 62%, #D9C7A8 62%, #C9B28C 100%)',
      }}
    >
      <Box sx={{ position: 'absolute', left: 18, top: 18, width: 92, height: 70, borderRadius: 1, bgcolor: '#F7FBFF', border: 3, borderColor: '#8B6B4A' }}>
        <Box sx={{ position: 'absolute', inset: '8px 8px 0', background: 'linear-gradient(180deg, #BFE3F5 0 55%, #A8D6A0 55% 100%)' }} />
      </Box>
      <Box sx={{ position: 'absolute', right: 24, bottom: 36, width: 108, height: 34, borderRadius: 2, bgcolor: '#B98A5E', border: 3, borderColor: '#7A5334' }} />
      <Box sx={{ position: 'absolute', right: 38, bottom: 66, width: 80, height: 26, borderRadius: 2, bgcolor: '#D9B08A' }} />

      <Box sx={{ position: 'absolute', left: '50%', bottom: '16%', width: { xs: 150, md: 210 }, transform: 'translateX(-50%)' }}>
        <ButtonBase
          aria-label={`抚摸${pet.name}`}
          disabled={busy || pet.sleeping}
          onClick={onPet}
          sx={{ display: 'block', width: '100%', borderRadius: 2, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 4 } }}
        >
          <PetSprite state={stateFor(pet, busyAction)} stage={pet.stage} reduced={reduced} />
        </ButtonBase>
      </Box>

      {pet.poop_count > 0 ? (
        <Box sx={{ position: 'absolute', left: 26, bottom: 22, display: 'flex', gap: 0.75 }} role="img" aria-label={`${pet.poop_count} 堆便便`}>
          {Array.from({ length: pet.poop_count }).map((_, i) => (
            <Box key={i} sx={{ width: 14, height: 9, borderRadius: '50% 50% 40% 40%', bgcolor: '#6B4A2E', boxShadow: '0 2px 0 #4A3320' }} />
          ))}
        </Box>
      ) : null}

      <Box sx={{ position: 'absolute', right: 12, top: 12, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="img" src={portraitUrl} alt="" sx={{ width: 36, height: 36, imageRendering: 'pixelated' }} />
        <Typography variant="caption" sx={{ bgcolor: 'rgba(255,255,255,0.72)', px: 1, py: 0.25, borderRadius: 1 }}>
          {pet.status_label}
        </Typography>
      </Box>
    </Box>
  )
}
```

`PetSprite` 的 `reduced` 由 `PetRoom` 传入；把 `reduced` 加到 `PetRoom` props：

```tsx
export default function PetRoom({ pet, busy, reduced, onPet }: { pet: PetPayload; busy: boolean; reduced: boolean; onPet: () => void })
```

并把 `<PetSprite ... reduced={reduced} />`。这样父页面可以用 `useMediaQuery('(prefers-reduced-motion: reduce)')` 统一控制。

- [ ] **Step 5: 接进页面并加动作动画**

在 `Pet.tsx` 中：

```tsx
import { useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '@mui/material'
import PetRoom from '@/pets/PetRoom'
import { usePetAction } from '@/pets/usePet'
import type { PetAction } from '@/pets/api'

const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
const action = usePetAction()
const [recent, setRecent] = useState<PetAction | null>(null)
const recentTimer = useRef<number | null>(null)

useEffect(() => () => {
  if (recentTimer.current) window.clearTimeout(recentTimer.current)
}, [])

const runAction = (next: PetAction) => action.mutate(next, {
  onSuccess: (result) => {
    toast.success(result.message)
    setRecent(next)
    if (recentTimer.current) window.clearTimeout(recentTimer.current)
    recentTimer.current = window.setTimeout(() => setRecent(null), 1400)
  },
  onError: (error) => toast.error(apiError(error).message),
})
const busyAction = action.isPending ? action.variables ?? null : recent
```

把房间占位替换为：

```tsx
<PetRoom
  pet={pet}
  busy={action.isPending}
  busyAction={busyAction}
  reduced={reduced}
  onPet={() => runAction('pet')}
/>
```

`ActionBar` 的 `onAction` 改用同一个 `runAction`；抚摸按钮和点狗都走 `pet` 动作。`ActionBar` 的 pending 也改为 `action.isPending ? action.variables ?? null : null`。

移动端布局：外层的 `gridTemplateColumns` 已经是 `xs: '1fr'`，房间在上、面板在下；在 `PageBody` 加 `overflow: 'auto'`，避免 375px 高度不够时内容被裁掉。

- [ ] **Step 6: 类型、构建、e2e**

Run: `cd web-react && npm run typecheck && npm run build`
Expected: 通过；`dog-sheet.png` 被打包为 asset。

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: PASS，桌面和 375px 截图都生成，`data-frame` 在 reduced motion 下不变化。

- [ ] **Step 7: 提交**

```bash
git add web-react/src/pets/assets web-react/src/pets/PetSprite.tsx web-react/src/pets/PetRoom.tsx \
  web-react/src/pages/Pet.tsx e2e/pet.mjs
git commit -m "feat(pet): add pixel dog room and animations"
```

---

## Task 8: 文档与全量验证

**Files:**
- Modify: `README.md`（模块列表与测试说明）
- Test: 全量后端 + 前端 + e2e

**Interfaces:**
- Consumes: 前七个任务。
- Produces: 可回归的运行说明；无新增运行时接口。

- [ ] **Step 1: 写文档**

在 `README.md` 的功能列表中加入宠物模块，说明：

- 入口 `/pet`，导航「生活 → 宠物」。
- 五项状态按真实时间衰减，关掉网页也会继续；每天照顾 1–2 分钟可维持。
- 约 3 天明显变差，约 4 天生病，健康最低 10，不会死亡。
- 喂食、零食、洗澡、玩耍、遛狗、睡觉、看医生、抚摸；冷却由后端返回。
- 每天第一次打开时，若当天有完成打卡或待办，心情 +6、零食 +1（每天一次）。
- 数据在 `pets` 表，随现有整库备份一起备份；`user_id` 唯一，单用户部署。
- 测试命令：`cd server && .venv/bin/python -m pytest tests/test_pet.py -v`；`cd e2e && WB_BASE=... node pet.mjs`。

- [ ] **Step 2: 全量后端测试**

Run: `cd server && .venv/bin/python -m pytest -q`
Expected: 全部通过；若已有历史失败，记录失败项并确认与宠物模块无关后再继续。

- [ ] **Step 3: 前端类型与构建**

Run: `cd web-react && npm run typecheck && npm run build`
Expected: 通过。

- [ ] **Step 4: e2e 回归**

Run: `cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs`
Expected: PASS。

- [ ] **Step 5: 检查 diff 与生成物**

Run: `cd /home/weiwen/workbench_element && git status --short && git diff --stat`
Expected: 只包含本模块文件与文档；没有 `.run/`、`node_modules/`、临时数据库被暂存。

- [ ] **Step 6: 提交**

```bash
git add README.md
git commit -m "docs(pet): document pet module and verification"
```

---

## Self-Review

- **Spec coverage:** 领养/改名（Task 1、5）、五项衰减（Task 2）、动作/冷却/照顾天数（Task 3）、便便上限与洗澡清空（Task 2、3）、生病滞回与健康下限（Task 2、3）、成长阶段（Task 1、7）、每日打卡/待办奖励（Task 4、6）、页面/房间/精灵/移动端/无障碍（Task 5-7）、文档（Task 8）。
- **Type consistency:** 后端 `stats` 嵌套、`status`/`status_label`、`cooldowns` 七项与前端 `PetPayload` 一致；`runPetAction` 返回 `PetActionResponse`；`advance` 与 `apply_action` 都接收 naive UTC `now`。
- **Review Focus tests:** 时钟回拨（Task 2 `test_clock_backwards_is_noop`）、90 天（Task 2 `test_90_days_keeps_health_floor_and_life`）、边界（Task 2 `test_half_hour_is_fractional`、Task 3 `test_exact_cooldown_boundary_allows_action`）、重复 GET（Task 4 `test_get_pet_claims_bonus_once`）、375px 与睡觉禁用（Task 6 e2e、Task 7 e2e）。
