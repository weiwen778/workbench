# 个人工作台（Workbench / Nexus）

> 仓库：<https://github.com/weiwen778/workbench_element>

单用户、自托管的个人工作台。把日常经营里散落的打卡、表格、看板、待办、笔记、信息聚合和文档处理放进同一套界面，数据全部留在自己的机器或服务器上。

- 前端：`web-react/`（React 18 + TypeScript + Vite + MUI 6），旧 Element Plus 前端已移除，`web/` 只保留构建产物与静态资源。
- 后端：`server/`（FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2）。
- 数据库：本地/测试可用 SQLite，生产使用 PostgreSQL 16。
- 部署：Docker Compose（PostgreSQL + API + Nginx），也支持 bare-metal 直接跑 uvicorn。

## 功能

| 模块 | 能做什么 |
| --- | --- |
| 打卡 | 店铺/社媒项目、分类、日/周/月事项、历史快照、批量导入、完成率统计；周期结束自动锁定 |
| 表格 | MUI X DataGrid；列宽/列显示持久化、行高、斑马纹、固定操作列、内联编辑、筛选、排序、分页；公式/关联/汇总/透视；Excel 导入导出 |
| 看板 | 指标卡、柱状/折线/饼图、任务进度；统计列、分组、日期范围、下钻到源表格 |
| 待办 | 多清单、子任务、截止时间、完成区、回收站恢复、静默刷新 |
| 笔记 / 便利贴 / 网址 | 文件夹与标签、Markdown（CodeMirror + DOMPurify）、自动保存与版本历史、六色便签、分类导航 |
| 信息聚合 | 公开热榜、RSS/Atom 订阅、未读/收藏、标题翻译、日历看板（RunSignup 赛事 + 阿里/1688 规则 + 常用入口） |
| 文档工作台 | PDF 阅读/整理/批注/水印；XLSX/XLS/ODS/CSV/TSV/JSON 表格；DOCX/TXT/Markdown/HTML 编辑与导出 |
| 图片 / 格式 / 取色 / 二维码 | 纯前端 Canvas 处理（裁剪、调色、去底、拼图、压缩、ZIP 批量导出）；格式转换；对比度检查；二维码/条码 |
| 白板 | Excalidraw 场景、图片资源、自动保存、本地草稿、版本冲突、PNG 导出 |
| 视频解析 | 抖音、小红书、快手分享文本解析，标题/封面/视频/图集/音频；代理下载；Cookie 按平台配置 |
| 宠物 | 像素狗陪伴：五项状态按真实时间衰减、便便、睡觉、生病、九个照顾动作与冷却、每日打卡/待办奖励 |
| Agent 接入 | 令牌（只显示一次）、直接写入/先暂存两种模式、权限策略、操作日志与一键撤销 |
| 系统 | 任务中心、回收站（30 天）、操作记录、服务器监控、加密备份与恢复 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18.3、TypeScript 5.7、Vite 6、MUI 6、MUI X DataGrid / Charts 7、CodeMirror 6、Excalidraw 0.18、TanStack Query 5、Dexie 4、Comlink 4 |
| 后端 | Python 3.12、FastAPI、SQLAlchemy 2、Alembic、Pydantic v2、psycopg3 |
| 数据库 | SQLite（本地/测试）、PostgreSQL 16（生产） |
| 测试 | pytest（后端全量）、Playwright（浏览器端到端） |

## 架构与边界

```text
web-react/src/pages/        路由页面与业务编排
web-react/src/components/   共享组件（DataTable、MarkdownEditor、附件预览等）
web-react/src/feeds/        信息聚合前端
web-react/src/pets/         宠物前端（房间、精灵、状态面板、动作栏）
web-react/src/docs/         PDF / 工作簿 / 文档编辑器
server/app/routers/         FastAPI 路由、鉴权、请求校验
server/app/services/        业务服务（信息聚合、备份、任务、翻译、媒体解析）
server/app/models.py        SQLAlchemy 模型
server/migrations/          Alembic 迁移
web/                        构建产物与静态资源（无 Vue 源码）
```

- **浏览器本地处理**：图片、PDF、表格、文档、格式转换、二维码在浏览器完成解析/渲染/导出，未保存的文件不上传。
- **后端持久化**：只有显式「保存项目/上传附件/保存白板/提交表单」才写库；`/api/v1/files` 校验登录、大小、扩展名与引用归属。
- **外部来源**：信息聚合与视频解析的请求一律由后端发起，做 DNS/私网地址校验、重定向限制、超时、响应体上限和失败退避；翻译凭据用 Fernet 加密。
- **迁移**：生产启动只用 `alembic upgrade head`；**生产不执行 `create_all`**，避免「表被建出来但列没加」的结构漂移（历史事故见 `docs/宠物模块.md` 部署记录）。

## 快速开始

### 本地运行（WSL / Linux / macOS）

```bash
cd server
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# 编辑 .env：至少修改 WB_ADMIN_PASSWORD，并生成 WB_ENCRYPTION_KEY
# python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"

cd ../web-react
npm ci
npm run build            # 产物输出到 ../web/dist

cd ../server
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18080
```

打开 <http://127.0.0.1:18080>。已有数据库先执行迁移：

```bash
cd server && .venv/bin/alembic upgrade head
```

### 开发模式

```bash
# 终端 1：后端热重载
cd server && .venv/bin/uvicorn app.main:app --reload --port 18080

# 终端 2：前端开发服务器（http://127.0.0.1:5174，/api 代理到 18080）
cd web-react && npm run dev
```

### Docker Compose

```bash
cp .env.example .env
# 必改：WB_DB_PASSWORD、WB_ADMIN_USERNAME、WB_ADMIN_PASSWORD、WB_ENCRYPTION_KEY、WB_PUBLIC_BASE_URL
docker compose up -d --build
```

- Web 默认对外 `${WB_HTTP_PORT:-18743}`，容器内监听 80。
- API 与数据库只绑定 `127.0.0.1`；数据卷 `wb_pgdata`、`wb_storage`。
- API 启动前执行 `alembic upgrade head`；生产会拒绝默认管理员密码、缺失主密钥和 SQLite。

## 配置

配置全部来自 `WB_` 前缀环境变量，模板见 `.env.example` 与 `server/.env.example`。常用项：

| 变量 | 说明 |
| --- | --- |
| `WB_ENV` | `dev` / `test` / `production`；生产启用维护任务并拒绝弱配置 |
| `WB_DATABASE_URL` | SQLAlchemy 连接串；生产必须是 PostgreSQL |
| `WB_ADMIN_USERNAME` / `WB_ADMIN_PASSWORD` | 首次启动创建的唯一管理员 |
| `WB_ENCRYPTION_KEY` | Fernet 主密钥，翻译凭据与备份加密；丢失后旧凭据不可解 |
| `WB_STORAGE_DIR` | 附件存储目录 |
| `WB_FEED_ENABLED` / `WB_FEED_COMMON_ENABLED` | 信息聚合总开关 / 公共源（日历、规则）开关 |
| `WB_FEED_RUNSIGNUP_INTERVAL_SECONDS` / `WB_FEED_RUNSIGNUP_COOLDOWN_SECONDS` / `WB_FEED_RUNSIGNUP_WINDOW_DAYS` | 赛事刷新间隔（默认 6 小时）、手动刷新冷却（默认 600 秒）、抓取窗口（默认 90 天） |
| `WB_MEDIA_ENABLED` / `WB_MEDIA_PLATFORMS` | 视频解析开关与平台列表 |

## 测试与验收

### 后端

```bash
cd server
.venv/bin/python -m pytest -q                # 全量
.venv/bin/python -m pytest tests/test_pet.py -v
.venv/bin/python -m pytest tests/test_feeds.py -v
```

PostgreSQL 回归可设 `WB_TEST_DATABASE_URL`；测试库名必须以 `workbench_element_test` 开头，用例会重建表，切勿指向业务库。

### 前端

```bash
cd web-react
npm run typecheck
npm run build      # 产物 + Brotli/Gzip 预压缩
```

### 浏览器端到端（需先启动服务）

```bash
cd e2e
npm ci
export WB_BASE=http://127.0.0.1:18080
export WB_E2E_PASSWORD='你的管理员密码'

node react-full.mjs        # 搜索/任务中心/表格库/AI 填表/看板/翻译设置/Agent/图片编辑器/移动端弹窗
node react-smoke-crud.mjs  # 待办与便利贴增删闭环
node react-flows.mjs       # 打卡勾选与历史、Excel 导入向导、回收站恢复
node feeds-calendar.mjs    # 信息聚合 5 区块、抓取时间、90 天窗口提示、刷新
node pet.mjs               # 领养/改名/冷却/睡觉/抚摸/375px/reduced motion
```

说明：

- `WB_BASE` 指向临时实例（如 `http://127.0.0.1:18090` + 独立 SQLite）可避免污染真实数据。
- `react-flows.mjs` 会自建「回收站流程验证」便利贴并在结束前彻底删除，保持库内原状。
- `ui-smoke.mjs` 等早期脚本使用 Element Plus 选择器（30 处 `el-*`），仅作历史参考，不再维护。

## 目录结构

```text
server/
  app/                 FastAPI 应用（routers / services / models）
  migrations/          Alembic 迁移
  tests/               pytest 用例
web-react/
  src/                 React + MUI 前端源码
  scripts/             构建辅助（预压缩、PDF.js 资源复制）
web/
  dist/                构建产物（Git 忽略，由后端托管）
  public/              PDF.js、白板字体、PDF 中文字体
e2e/                   Playwright 端到端脚本与 fixtures
scripts/               开发服务、模拟数据、报告生成
deploy/                Nginx 配置、备份与恢复脚本
docs/                  PRD、设计说明、交付与审查记录
```

## 设计约定

- 视觉统一走 MUI 主题与 `sx`；品牌色与明暗模式集中在 `web-react/src/app/theme.ts`。
- 表格统一使用 `web-react/src/ui/common.tsx` 的 `DataTable`（内部 MUI X DataGrid，中文语言包）；文档工作台的虚拟工作簿需单元格级编辑与公式栏，直接用 DataGrid 属明确例外。
- 页面按路由懒加载；`/docs` 的 PDF / 表格 / 文档编辑器再按页签懒加载。
- 服务端状态用 TanStack Query；`@/api/client` 负责 CSRF、凭证与 401。
- 浏览器本地可恢复副本放 Dexie（`nexus-workbench`），旧 `localStorage` 草稿首次读取时迁移。
- 表格汇总/透视等 CPU 计算通过 Comlink 进 Web Worker，支持取消、超时与过期结果隔离。
- 列宽/列显示按表格存浏览器；跨设备同步需另接账号视图配置。
- 时间相关规则（周期起止、遛狗时段、每日奖励）一律由后端按本地时区裁定，前端不自行用浏览器时钟判断。

## 代码审查与已知限制

- 审查记录：[代码审查报告-2026-11-15](docs/代码审查报告-2026-11-15.md)（Standards / Spec 双轴 + 复核结论 + 仿真结果）。
- 已修复：生产 `create_all` 导致的结构漂移、附件归属校验空实现、附件解绑不回收、日历 62 天 off-by-one、遛狗前后端双时钟、宠物成长进度未展示。
- 已知未改：`/checkins` 列表 GET 内做周期补齐并写库（读接口带写事务）；`Dockerfile` 的 `--forwarded-allow-ips='*'` 在反代部署下可伪造来源 IP；`maintenance.py` 清理失败日志缺 `exc_info`。
- 环境限制：Google Trends 与 Pinterest Trends 在当前网络不可达；TEMU 需登录态；`tech` 平台规则接口无公开文档，平台改版可能失效。

## 备份与恢复

加密备份、恢复演练与保留策略见 [备份与恢复](docs/备份与恢复.md) 与 `deploy/`。备份包含数据库与附件存储卷，恢复前先停 API 容器。

## 文档索引

- [个人工作台 PRD v2.1](docs/个人工作台_PRD_v2.1.md)（Element Plus 时代基线，功能语义仍可参考）
- [验收对照 A01–A86](docs/验收对照.md)
- 模块：[信息聚合](docs/信息聚合.md)、[信息聚合-日历看板](docs/信息聚合-日历看板.md)、[宠物模块](docs/宠物模块.md)、[文档工作台](docs/文档工作台.md)、[白板](docs/白板.md)、[数据可视化](docs/数据可视化.md)、[Agent 接入](docs/Agent接入.md)
- 工程：[代码审查报告-2026-11-15](docs/代码审查报告-2026-11-15.md)、[开源组件选型与前端计算架构建议](docs/开源组件选型与前端计算架构建议.md)、[备份与恢复](docs/备份与恢复.md)
