# 归档模块（deprecated）

本目录存放**已从主程序摘除、但保留源码备查**的功能模块。这里的代码不参与构建、不注册路由、不出现在导航里，也不会被打包进前端产物。

归档时间：2026-11-15
原因：侧栏「全部功能」中移除「信息聚合 / 视频解析 / 宠物」三个入口，相关前后端代码整体挪出主代码树，保证运行期零引用。

## 已归档内容

| 模块 | 前端 | 后端 | 测试 |
| --- | --- | --- | --- |
| 信息聚合 | `web-react/src/pages/Feeds.tsx`、`web-react/src/feeds/`（热榜、订阅、日历看板、公共源面板） | `routers/feeds.py`、`services/feed_service.py`、`feed_catalog.py`、`feed_translation.py`、`common_sources.py` | `test_feeds.py`、`test_common_sources.py` |
| 视频解析 | `web-react/src/pages/Media.tsx` | `routers/media.py`、`services/media.py`、`services/media_transport.py`、`services/media_parser/`（60+ 站点解析器） | `test_media.py` |
| 宠物 | `web-react/src/pages/Pet.tsx`、`web-react/src/pets/`（房间、精灵、状态面板、动作栏、领养卡片、素材） | `routers/pet.py`、`services/pet.py` | `test_pet.py` |
| 端到端脚本 | `e2e/pet.mjs`、`e2e/feeds-calendar.mjs` | — | — |

## 仍然保留在主代码树的部分

这些内容**故意没有挪走**，因为它们是共享基础设施或数据库契约：

1. **数据库模型**：`server/app/models.py` 中的 `FeedSnapshot`、`FeedSubscription`、`Pet` 等表定义保留，历史数据与迁移不受影响。删除模型会让 `alembic` 与既有库对不上。
2. **迁移文件**：`server/migrations/versions/` 下的相关迁移保留，回滚/重建库仍可复现历史结构。
3. **配置项**：`server/app/config.py` 中 `feed_*`、`media_*` 设置保留（无引用时不生效），恢复模块时无需重新加配置。
4. **新增的运维表**：`agent_runs`、`pets` 等已在生产库中，不做破坏性变更。

## 摘除时改动的运行期引用

| 位置 | 改动 |
| --- | --- |
| `web-react/src/App.tsx` | 移除 `/feeds`、`/media`、`/pet` 三条路由与三个懒加载入口 |
| `web-react/src/router/preload.ts` | 移除三个预加载条目 |
| `web-react/src/layout/app-nav.ts` | 移除三个导航项、「生活」分组、`feeds` 默认固定项、`MAX_PINNED` 上限与相关图标导入 |
| `server/app/main.py` | 移除 `feeds` / `media` / `pet` 路由注册、信息聚合调度任务、`apply_cookie_env()` 调用 |
| `web-react/src/layout/NavPanels.tsx`、`pages/settings/NavigationSection.tsx` | 固定项改为数量不限，去掉「已满」禁用态与 `MAX_PINNED` 文案 |

## 恢复步骤

```bash
# 1. 把源码搬回原位
cd <repo>
git mv deprecated/web-react/src/feeds      web-react/src/feeds
git mv deprecated/web-react/src/pets       web-react/src/pets
git mv deprecated/web-react/src/pages/Feeds.tsx web-react/src/pages/Feeds.tsx
git mv deprecated/web-react/src/pages/Media.tsx web-react/src/pages/Media.tsx
git mv deprecated/web-react/src/pages/Pet.tsx   web-react/src/pages/Pet.tsx
git mv deprecated/server/app/routers/feeds.py   server/app/routers/feeds.py
git mv deprecated/server/app/routers/media.py   server/app/routers/media.py
git mv deprecated/server/app/routers/pet.py     server/app/routers/pet.py
git mv deprecated/server/app/services/feed_service.py    server/app/services/feed_service.py
# ……其余 services / tests / e2e 文件同理

# 2. 重新加回引用
#    App.tsx 路由与懒加载、router/preload.ts、layout/app-nav.ts 导航项、
#    main.py 的 include_router 与 feed_service.refresh_loop 调度、apply_cookie_env()

# 3. 校验
cd server && .venv/bin/python -m pytest tests/test_pet.py tests/test_feeds.py -q
cd ../web-react && npm run typecheck && npm run build
```

## 注意

- 归档代码不参与 `npm run build` 与 `pytest`，改动它不会影响线上行为，但也不会被验证。
- 若确认不再需要，可整体删除本目录；数据库表建议保留（有历史数据），或在确认无数据后单独写迁移清理。
