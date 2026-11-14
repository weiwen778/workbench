# 个人工作台（Workbench）

> 仓库：<https://github.com/weiwen778/workbench>

单用户、自托管的个人工作台：打卡、数据可视化、表格、待办、笔记、便利贴、网址导航、翻译、图片处理、Agent 接入、备份与恢复。

当前主线是 `web-react/` 中的 **React + MUI** 前端；旧 Element Plus 源码已移除，`web/` 只保留后端托管的构建产物和静态资源。后端与数据模型保持兼容。

## 功能

- **打卡**：店铺/社媒项目、分类、日/周/月事项、历史快照、批量导入、完成情况统计。
- **数据可视化**：多个看板；指标卡、柱状图、折线图、饼图、任务进度；支持统计列、分组、日期范围、下钻到源表格和 AI 生成图表。
- **表格**：MUI X DataGrid；列宽/列显示持久化、水平/垂直居中、行高、斑马纹、列间分隔线、固定操作列、内联编辑、排序、筛选、选择、分页、公式/关联/汇总/透视、Excel 导入导出。
- **待办**：清单、子任务、截止日期、完成/取消、静默刷新、回收站恢复。
- **笔记 / 便利贴 / 网址**：文件夹与标签、分类导航、搜索、Markdown 笔记、卡片/列表视图。
- **翻译**：多翻译服务、快捷键、历史记录、收藏、语言交换、本地偏好设置。
- **信息聚合**：公开热榜、RSS/Atom 订阅、未读/收藏、标题翻译、缓存与失败退避；外部请求由后端按来源白名单/SSRF 校验发起，浏览器不直接抓取。
- **文档工作台**：PDF 阅读/整理/批注/表单/页码水印/永久删密；XLSX/XLS/XLSB/ODS/CSV/TSV/JSON 表格；DOCX/TXT/Markdown/HTML 文档编辑与导出。文件处理在浏览器完成，保存项目时才上传附件。
- **图片处理**：纯前端 Canvas 处理；裁剪、旋转、缩放、调色、去底、水印标注、拼图、切图、格式转换、压缩与 ZIP 批量导出；可把结果作为图片插入白板（保存白板时上传）。
- **格式转换 / 取色 / 二维码**：本地图片、PDF、CSV/XLSX 转换；颜色对比与可读性检查；二维码/条形码生成与识别。
- **白板**：Excalidraw 场景、图片资源、自动保存、本地草稿、版本冲突、PNG 导出、从图片/笔记/表格插入内容。
- **宠物**：单只像素狗；五项状态按真实时间衰减（关掉网页也继续），每天照顾 1–2 分钟即可维持，约 3 天明显变差、约 4 天生病、健康最低 10 不会死亡；喂食/零食/洗澡/玩耍/遛狗/睡觉/看医生/抚摸，冷却由后端返回；每天第一次打开且有当天完成打卡或待办时心情 +6、零食 +1。
- **Agent 接入**：直接写入或先暂存两种模式、精细权限策略、操作日志与一键撤销、变更暂存审核、活动审计。
- **系统**：任务中心、回收站、操作记录、服务器监控、加密备份与恢复。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18.3、TypeScript 5.7、Vite 6、MUI 6、MUI X DataGrid / Charts 7、CodeMirror 6、Excalidraw 0.18、TanStack Query 5、Dexie 4、Comlink 4 |
| 后端 | Python 3.12、FastAPI、SQLAlchemy 2、Alembic、Pydantic v2 |
| 数据库 | 本地/测试支持 SQLite；生产使用 PostgreSQL 16（Compose 内置） |
| 部署 | Docker Compose（PostgreSQL + API + Nginx） |
| 测试 | pytest、Playwright |

### 模块入口

| 模块 | 入口 |
| --- | --- |
| 打卡 / 待办 / 笔记 / 便利贴 | `/checkins`、`/todos`、`/notes`、`/memos` |
| 数据表格与看板 | `/data`、`/visualizations` |
| 信息聚合 | `/feeds` |
| 文档工作台 | `/docs`（PDF / 表格 / 文档三个页签） |
| 图片 / 格式转换 / 取色 / 二维码 | `/images`、`/convert`、`/color`、`/codes` |
| 白板 | `/whiteboards` |
| 网址 / 翻译 | `/bookmarks`、`/translate` |
| 宠物 | `/pet`（生活 → 宠物） |
| 系统设置 / 回收站 / 任务中心 | `/settings`、`/settings/trash`、`/settings` 内任务中心 |

## 架构与边界

```text
web-react/src/pages/       路由页面与业务编排
web-react/src/components/  共享组件（DataTable、MarkdownEditor、附件预览等）
web-react/src/convert/     浏览器内图片/PDF/表格转换
web-react/src/docs/        PDF / 工作簿 / 文档编辑器与项目保存
web-react/src/feeds/       信息聚合前端
web-react/src/whiteboard/  白板 API、草稿、场景工具
server/app/routers/        FastAPI 路由、鉴权、请求校验
server/app/services/       业务服务（备份、任务、翻译、信息聚合、查询）
server/app/models.py       SQLAlchemy 模型
server/migrations/         Alembic 迁移
web/                       构建产物与静态资源（无 Vue 源码）
```

- 浏览器本地处理：图片、PDF、表格、文档、格式转换、二维码/条码在浏览器完成解析/渲染/导出；未保存的文件不上传。
- 后端持久化：只有显式“保存项目/上传附件/保存白板/提交表单”才写入 Nexus；`/api/v1/files` 有登录、大小、扩展名和引用归属校验。
- 外部来源：信息聚合只由后端访问公开 HTTP(S) 来源，执行 DNS/私网地址校验、重定向上限、超时、响应体上限和失败退避；翻译服务凭据使用 Fernet 加密，地址变更需重新填写密钥。
- 生产迁移：容器启动执行 `alembic upgrade head`；本地首次启动可自动建表，但推荐显式迁移。

## 快速开始

### 本地运行（WSL / Linux / macOS）

```bash
git clone https://github.com/weiwen778/workbench.git
cd workbench

# 1. 后端依赖
cd server
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# 编辑 .env：至少修改 WB_ADMIN_PASSWORD，并生成 WB_ENCRYPTION_KEY
# 生成密钥：
# python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"

# 2. 前端依赖与构建
cd ../web-react
npm ci
npm run build          # 产物输出到 ../web/dist

# 3. 启动（API 同源托管前端）
cd ../server
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18080
```

打开 <http://127.0.0.1:18080>。首次启动会自动建表，并用 `WB_ADMIN_USERNAME` / `WB_ADMIN_PASSWORD` 创建唯一管理员。已有数据库升级请先执行：

```bash
cd server
.venv/bin/alembic upgrade head
```

### 配置与静态资源

- 配置全部来自 `WB_` 前缀环境变量，模板见 `.env.example` 与 `server/.env.example`。
- 生产必须设置 `WB_ENV=production`、`WB_ENCRYPTION_KEY`、强管理员密码和 PostgreSQL；生产启动会拒绝默认密码、缺失主密钥和 SQLite。
- 信息聚合默认开启自动调度，可用 `WB_FEED_ENABLED=false` 关闭出站请求；来源地址、超时、大小和重试见 `.env.example`。
- PDF.js 的 `cmaps`、`standard_fonts`、`wasm` 由 `web-react/scripts/precompress.mjs` 从已锁定依赖复制到 `web/dist/pdfjs/6.4.299`；开发服务器的 `/pdfjs/` 来自 `web/public/pdfjs`。
- 白板字体/语言资源位于 `web/public/excalidraw-assets`，PDF 中文字体子集位于 `web/public/fonts`。
- 构建产物输出到 `web/dist`，同时生成 `.br` / `.gz` 预压缩文件；后端按 `Accept-Encoding` 返回，内容哈希资源长期缓存，HTML 不缓存。

本地辅助脚本：

```bash
scripts/dev-server.sh start     # 启动
scripts/dev-server.sh stop      # 停止
scripts/dev-server.sh status    # 状态
scripts/dev-server.sh reset     # 清空开发库与附件后重启
```

### Docker Compose

```bash
cp .env.example .env
# 必改：WB_DB_PASSWORD、WB_ADMIN_USERNAME、WB_ADMIN_PASSWORD、
#       WB_ENCRYPTION_KEY、WB_PUBLIC_BASE_URL
docker compose up -d --build
```

- Web 默认对外 `${WB_HTTP_PORT:-18743}`，容器内监听 80。
- API 与数据库只绑定 `127.0.0.1`，不对公网开放。
- 数据卷：`wb_pgdata`（数据库）、`wb_storage`（附件）。
- API 启动前执行 `alembic upgrade head`。
- 生产环境会拒绝默认管理员密码、缺失主密钥和 SQLite 数据库。

生产部署、备份与恢复细节见 [备份与恢复](docs/备份与恢复.md) 和 `deploy/`。

## 模拟数据

`scripts/demo_year.py` 可以生成一套**带明确标识、可删除**的一年使用数据，覆盖表格、看板、打卡、待办、笔记、便利贴、网址、翻译记录和 Agent 活动。

```bash
cd server

# 生成（默认截至 2026-10-31；可传 --as-of YYYY-MM-DD）
.venv/bin/python ../scripts/demo_year.py seed

# 查看状态和清理标记
.venv/bin/python ../scripts/demo_year.py status

# 删除这一批数据（使用 status 输出中的 marker）
.venv/bin/python ../scripts/demo_year.py remove --confirm DEMO-YEAR-20261031
```

注意：

- 数据写入第一个管理员账号，所有对象带 `【模拟】` 前缀或 `DEMO-YEAR-*` 标识。
- 不会调用外部 API，不会覆盖原有数据。
- 导入前建议先备份数据库；脚本清单保存在 `.run/demo-year/manifest.json`（Git 忽略）。
- 旧的 `scripts/demo_year_bookmarks.py` 仅用于给已存在的模拟数据集补充网址；新执行 `seed` 已包含网址。

## 开发

```bash
# 终端 1：后端热重载
cd server && .venv/bin/uvicorn app.main:app --reload --port 18080

# 终端 2：前端开发服务器
cd web-react && npm run dev    # http://127.0.0.1:5174，/api 代理到 18080
```

常用命令：

```bash
cd web-react
npm run typecheck     # TypeScript
npm run build         # 生产构建 + Brotli/Gzip 预压缩
```

## 测试

```bash
# 后端测试（使用隔离测试库）
cd server && .venv/bin/python -m pytest -q

# 宠物单测
cd server && .venv/bin/python -m pytest tests/test_pet.py -v

# 前端类型与构建
cd web-react && npm run typecheck && npm run build

# 宠物浏览器端完整流程（需先启动服务）
cd e2e && WB_BASE=http://127.0.0.1:18080 node pet.mjs

# 浏览器端完整流程（需先启动服务）
cd e2e
npm ci
WB_E2E_PASSWORD='你的管理员密码' node react-smoke.mjs
WB_E2E_PASSWORD='你的管理员密码' node react-smoke-crud.mjs
WB_E2E_PASSWORD='你的管理员密码' node react-redesign.mjs
WB_E2E_PASSWORD='你的管理员密码' node react-full.mjs
```

React E2E 脚本默认连接 `http://127.0.0.1:18080`，默认管理员 `admin`。可通过环境变量覆盖：

```bash
WB_BASE=http://127.0.0.1:18080
WB_E2E_PASSWORD=...
WB_OUTPUT=../.run/react-smoke
```

截图默认输出到 `.run/react-smoke/`。`e2e/` 中早期 Element Plus 脚本仅作历史参考，Vue 源码已移除，不再维护；React 入口以 `react-*.mjs` 和 `route-performance.mjs` 为准。

PostgreSQL 回归可设置 `WB_TEST_DATABASE_URL`。测试只接受回环地址，数据库名必须以 `workbench_element_test` 开头；用例会重建该测试库的表，切勿指向业务数据库。

## 性能复现

构建产物测量：

```bash
cd web-react
npm run build
# 关注最后一行 Precompressed ... 与各 chunk 的 gzip 体积
```

浏览器冷路由测量（需已启动服务、可丢弃的测试账号；脚本会禁用浏览器缓存并取 3 次中位数）：

```bash
cd e2e
WB_BASE=http://127.0.0.1:18080 \
WB_ADMIN_USERNAME=admin WB_ADMIN_PASSWORD='测试密码' \
node route-performance.mjs
```

结果写入 `.run/route-performance.json`。本机 WSL + Chromium 1194、1440×900、生产构建、缓存禁用、1.6 秒稳定等待下，本轮把 `/docs` 的三个编辑器按页签懒加载：`/docs` 冷加载从 1256 KB / 1137 KB JS 降到 892 KB / 774 KB JS，最大长任务 74 ms → 56 ms；直接打开表格页签为 556 KB / 439 KB JS，文档页签为 634 KB / 516 KB JS。该数据是本机单次环境样本，不代表公网或低端设备；不要用它宣称绝对性能。

## 目录结构

```text
server/
  app/                 FastAPI 应用（routers / services / models）
  migrations/          Alembic 迁移
  tests/               pytest
web-react/
  src/                 React + MUI 前端源码
  scripts/             构建辅助（预压缩等）
  Dockerfile           前端镜像构建
web/
  dist/                前端构建产物（Git 忽略，由后端托管）
  public/              静态资源（PDF.js、白板字体、PDF 中文字体）
e2e/                   Playwright 端到端测试与 fixtures
scripts/               开发服务、模拟数据、报告生成
deploy/                Nginx 配置、备份与恢复脚本
docs/                  PRD、设计说明、交付与验收记录
```

## 设计约定

- 视觉统一使用 MUI 主题与 `sx`：`web-react/src/app/theme.ts` 只保留明暗模式和品牌色。
- 表格统一走 `web-react/src/ui/common.tsx` 的 `DataTable`，内部是 MUI X DataGrid，已启用中文语言包。文档工作台的虚拟工作簿需要单元格级编辑和公式栏，直接使用 DataGrid，是明确例外。
- 工作台页面按路由懒加载；`/docs` 的 PDF / 表格 / 文档编辑器再按页签懒加载，避免打开 PDF 时加载表格和文档依赖。
- 服务端状态（请求、缓存、失效、重试）使用 TanStack Query；`@/api/client` 仍负责 CSRF、凭证与 401，页面可以逐页迁移，不必同时改写。
- 浏览器本地可恢复副本统一放在 Dexie 数据库 `nexus-workbench`（当前为文档草稿，按账号隔离并带 schema 版本）；旧 `localStorage` 草稿会在首次读取时迁移，配额或 IndexedDB 不可用时回退到 `localStorage`。
- 表格汇总/透视等 CPU 计算通过 Comlink 进入 Web Worker，支持取消、超时和过期结果隔离，不阻塞主线程滚动与输入。
- 侧栏顺序在账号菜单「调整侧栏顺序」中自定义，按账号保存在浏览器；窗口较矮时自动压缩图标行并隐藏文字标签，避免侧栏出现滚动。
- 列宽与列显示按表格保存在浏览器 `localStorage`；跨设备同步需要另接账号视图配置。
- 图片处理全部在浏览器本地完成；ZIP 使用 `fflate`；笔记使用 CodeMirror。
- DataGrid 的列宽、行高、固定操作列、对齐方式、隐藏列和排序都在通用组件内处理，页面不要重复实现。

## 文档

- [数据可视化](docs/数据可视化.md)
- [表格增强](docs/表格增强.md)
- [Agent 接入](docs/Agent接入.md) / [Agent 暂存设计](docs/Agent暂存设计.md)
- [备份与恢复](docs/备份与恢复.md)
- [图片处理](docs/图片处理.md)
- [格式转换](docs/格式转换.md)
- [文档工作台](docs/文档工作台.md)
- [取色与二维码工具](docs/取色与二维码工具.md)
- [白板](docs/白板.md)
- [宠物模块](docs/宠物模块.md)
- [信息聚合](docs/信息聚合.md)
- [设置与页面层级](docs/设置与页面层级.md)
- [可靠性与性能改进](docs/可靠性与性能改进.md)

## 已确认的限制

- 单用户/单管理员部署；多账号隔离覆盖文档项目、白板、文件上传者和用户数据，但回收站、笔记/表格等历史模块没有独立账号字段。
- 单文件上传上限默认 20 MB；PDF 本地预览允许更大文件，但保存项目受上传上限约束。
- 文档工作台 DOCX 走 Mammoth → Markdown，页眉页脚、分页、复杂表格、修订记录会丢失；PDF 删密会栅格化该页；PDF 表单只在单一来源、原页序且无删密页时保留交互。详见 [文档工作台](docs/文档工作台.md)。
- 信息聚合的公开来源可用性取决于第三方；关闭 `WB_FEED_ENABLED` 后不再自动或手动发起刷新，但已缓存内容仍可阅读。
- 浏览器本地草稿（IndexedDB / `localStorage` 回退）只用于恢复未保存内容，不承诺跨设备或清理浏览器数据后仍可找回；正式备份仍以服务端为准。
- TanStack Query 当前只接入了信息聚合热榜页；其余页面仍在用原有手写请求状态，可按页面逐步迁移。
- 汇总与透视仍会先读取整张表的快照再交给 Worker；超大表的分片、上限和取消策略仍待后续阶段完善。
- 翻译服务的自定义地址必须是 HTTPS（测试环境仅允许回环地址），修改地址必须重新填写密钥。
- 主要验证浏览器为 Chromium；Safari/Firefox、真实 Word/Excel/Acrobat 仍需在目标环境补验。

## 安全

- 不要提交 `server/.env`、`.run/`、`storage/`、`data/`、备份文件和恢复密钥；这些已在 `.gitignore` 中忽略。
- 生产环境必须使用随机的 `WB_ENCRYPTION_KEY`、强管理员密码和 PostgreSQL。
- 翻译服务凭据使用 Fernet 加密保存；接口返回时只显示掩码。
- 备份包含敏感配置，必须与恢复密钥分开存放在安全位置。

## 许可证

本项目未附开源许可证，默认保留所有权利。
