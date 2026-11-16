# 个人工作台（Workbench / Nexus）

> 主仓库：<https://github.com/weiwen778/workbench.git>
> 历史仓库：<https://github.com/weiwen778/workbench_element>

单用户、自托管的个人工作台。把日常经营里散落的打卡、表格、看板、待办、笔记、文档处理和白板放进同一套界面，数据全部留在自己的机器或服务器上：文件解析、渲染、公式计算、导出都在浏览器完成，只有显式「保存」才写库。

- 前端：`web-react/`（React 18 + TypeScript + Vite 6 + MUI 6），旧 Element Plus 前端已移除，`web/` 只保留构建产物与静态资源。
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
| 文档工作台 | 三个页签：**PDF 编辑与处理**（合并/重排/旋转/批注/表单/页码/水印）、**工作簿**（Univer 表格内核，公式/样式/合并/冻结/数字格式）、**Markdown 文档**（CodeMirror 源编辑 + 预览，DOCX 导入导出） |
| 图片 / 格式 / 取色 / 二维码 | 纯前端 Canvas 处理（裁剪、调色、去底、拼图、压缩、ZIP 批量导出）；格式转换；对比度检查；二维码/条码 |
| 白板 | Excalidraw 场景、图片资源、自动保存、本地草稿、版本冲突、PNG 导出 |
| Agent 接入 | 令牌（只显示一次）、直接写入/先暂存两种模式、权限策略、操作日志与一键撤销 |
| 系统 | 任务中心、回收站（30 天）、操作记录、服务器监控、加密备份与恢复 |

> 「信息聚合 / 视频解析 / 宠物」三个模块及其归档代码已于 2026-11-16 彻底移除；数据库历史迁移保留，并新增删表迁移清理相关表。

## 文档工作台（本次结构升级）

三个页签的命名刻意区分了「文档」的三种含义，避免把 Markdown 当成 Word：

| 页签 | 真实形态 | 说明 |
| --- | --- | --- |
| PDF 编辑与处理 | PDF.js 渲染 + pdf-lib 改写 | 不改正文文字，只做页级操作与叠加层 |
| **工作簿** | **Univer 1.5**（`@univerjs/presets` + `@univerjs/preset-sheets-core`） | Excel 式网格、工具栏、公式栏；与侧栏「表格」（数据库表格）不是同一个东西 |
| **Markdown 文档** | CodeMirror 6 源编辑 + marked 安全预览 | **不是 Word 原生编辑，也不是富文本编辑器**；DOCX 走 Mammoth → Markdown 转换进来，导出是重新生成的新 DOCX |

### 工作簿的实现要点

- 编辑内核用 Univer 社区版，公式、样式、合并单元格、冻结窗格、数字格式、查找替换都由内核提供，不再维护项目内自写的公式引擎。
- **XLSX 读写走本地桥接**（`web-react/src/docs/sheet/xlsx-bridge.ts`）：Univer 官方 XLSX exchanger 属 Pro 版且需要服务端转换服务，离线工作台不采用，改用项目已有的 SheetJS 做双向转换。
  - 导入：单元格值、公式、合并区域、列宽、行高、数字格式（经 Facade `setNumberFormat` 回写）。
  - 导出：XLSX（全部工作表，保留数字格式）、CSV / TSV（当前工作表）、Univer 快照（无损）。
- 保存项目落两份附件：`*.xlsx`（交付/导出用）与 `*.univer.json`（无损快照）。重开优先用快照，快照缺失时回退解析 XLSX。
- 每次装载（导入或重开）都会分配新的 Univer `unitId`，否则会撞 `[UniverInstanceService]: cannot create a unit with the same unit id`。
- Univer 内部自建 React 根，与 StrictMode 的「挂载 → 清理 → 再挂载」会互相踩踏（表现为画布不挂载），因此实例创建被推迟到下一个宏任务并在清理时取消。

### 已知差异（工作簿）

| 项 | 现状 |
| --- | --- |
| 单元格样式 | SheetJS CE 不读写样式，XLSX 往返会丢字体/颜色/边框；用项目快照重开不丢 |
| 图表 / 透视表 / 数据验证 / 批注 / 宏 | 不导入、不导出；宏永不执行 |
| 大表 | 单文件 20 MB 上限，超过 20,000 行 / 500 列的部分截断并提示 |
| 首屏体积 | `univer` 单独成块：11,359 kB（gzip 2,737 kB），仅在首次打开「工作簿」页签时下载 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18.3、TypeScript 5.7、Vite 6、MUI 6、MUI X DataGrid / Charts 7、Univer 1.5、CodeMirror 6、Excalidraw 0.18、TanStack Query 5、Dexie 4、Comlink 4、framer-motion 14 |
| 后端 | Python 3.12、FastAPI、SQLAlchemy 2、Alembic、Pydantic v2、psycopg3 |
| 数据库 | SQLite（本地/测试）、PostgreSQL 16（生产） |
| 测试 | pytest（后端全量）、Playwright（浏览器端到端）、`tsc -b` 类型门槛 |

## 架构与边界

```text
web-react/src/pages/        路由页面与业务编排
web-react/src/components/   共享组件（DataTable、MarkdownEditor、附件预览等）
web-react/src/docs/         PDF / 工作簿 / Markdown 文档编辑器
web-react/src/docs/sheet/   WorkbookEditor（Univer）+ xlsx-bridge（SheetJS 桥接）
web-react/src/motion/       动效 tokens、原语与页面/骨架屏过渡
server/app/routers/         FastAPI 路由、鉴权、请求校验
server/app/services/        业务服务（备份、任务、翻译等）
server/app/models.py        SQLAlchemy 模型
server/migrations/          Alembic 迁移
web/                        构建产物与静态资源（无 Vue 源码）
```

- **浏览器本地处理**：图片、PDF、表格、文档、格式转换、二维码在浏览器完成解析/渲染/导出，未保存的文件不上传。
- **后端持久化**：只有显式「保存项目/上传附件/保存白板/提交表单」才写库；`/api/v1/files` 校验登录、大小、扩展名与引用归属。文档项目状态上限 5 MB（`MAX_STATE_BYTES`），附件上限 20 MB。
- **外部来源**：翻译等外部请求一律由后端发起，做 DNS/私网地址校验、重定向限制、超时、响应体上限和失败退避；翻译凭据用 Fernet 加密。
- **迁移**：生产启动只用 `alembic upgrade head`；**生产不执行 `create_all`**，避免「表被建出来但列没加」的结构漂移。
- **构建分块**：`vite.config.ts` 按 `@univerjs` / `pdfjs-dist` / `codemirror` / `echarts` 拆独立 chunk，Univer 与 PDF 只在对应页签加载。

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

> Univer 依赖需要 1.5.0 全套同版本；若 `npm install` 报 `ETARGET 404 @univerjs/rpc@1.5.0`（国内镜像同步滞后），改用官方源安装：
> `npm install --registry=https://registry.npmjs.org`

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

## 测试与验收

### 后端

```bash
cd server
.venv/bin/python -m pytest -q                # 全量
.venv/bin/python -m pytest tests/test_document_projects.py -v
```

PostgreSQL 回归可设 `WB_TEST_DATABASE_URL`；测试库名必须以 `workbench_element_test` 开头，用例会重建表，切勿指向业务库。

### 前端

```bash
cd web-react
npm run typecheck           # tsc -b，改动后必须过
npm run build               # 产物 + Brotli/Gzip 预压缩
```

当前构建基线（2026-11-15，含 Univer）：154 个资源，原始 27.6 MB → Brotli 7.0 MB，耗时约 3m50s。

| 资源 | 原始 | gzip |
| --- | --- | --- |
| `univer-*.js` | 11,359 kB | 2,737 kB |
| `PdfEditor-*.js` | 1,339 kB | 570 kB |
| `subset-shared.chunk` | 1,824 kB | 737 kB |
| `xlsx-*.js` | 424 kB | 142 kB |
| `DocEditor-*.js` | 119 kB | 40 kB |

### 浏览器端到端（需先启动服务）

```bash
cd e2e
npm ci
export WB_BASE=http://127.0.0.1:18080
export WB_E2E_PASSWORD='你的管理员密码'

node react-full.mjs        # 搜索/任务中心/表格库/AI 填表/看板/翻译设置/Agent/图片编辑器/移动端弹窗
node react-smoke-crud.mjs  # 待办与便利贴增删闭环
node react-flows.mjs       # 打卡勾选与历史、Excel 导入向导、回收站恢复
node document-workbook.mjs # 工作簿导入、项目重开、数字格式及当前工作表导出
node agent-direct.mjs      # Agent 直接写入、操作记录、撤销
node agent-staging.mjs     # Agent 暂存、人工通过与驳回
```

说明：

- `WB_BASE` 指向临时实例（如 `http://127.0.0.1:18090` + 独立 SQLite）可避免污染真实数据。
- `react-flows.mjs` 会自建「回收站流程验证」便利贴并在结束前彻底删除，保持库内原状。
- `workbook-hotkeys.mjs`、`workbook-all-hotkeys.mjs`、`table-workbook-recovery.mjs` 针对**旧 `.univer-host` 表格工作簿**（`/data/:id` 里的「自由工作簿」，端口 18747），与 `/docs` 的新工作簿编辑器不是同一套 DOM，尚未随本次改造重写。
- `ui-smoke.mjs` 等早期脚本使用 Element Plus 选择器（30 处 `el-*`），仅作历史参考，不再维护。
- 文档工作台新工作簿的手工验收路径：导入含合并表头与公式的 XLSX → 网格内改值 → 保存项目（应生成 `*.xlsx` + `*.univer.json` 两个附件）→ 从「项目」重开 → 导出 XLSX，用 SheetJS 复核工作表名、单元格值与 `D2=B2*C2` 这类公式。

## 目录结构

```text
server/
  app/                 FastAPI 应用（routers / services / models）
  migrations/          Alembic 迁移
  tests/               pytest 用例
web-react/
  src/                 React + MUI 前端源码
    docs/sheet/        WorkbookEditor.tsx（Univer）、xlsx-bridge.ts、SheetEditor.tsx（旧 DataGrid 版，保留可回退）
    motion/            动效 tokens、页面过渡、骨架屏等原语
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
- 业务表格统一使用 `web-react/src/ui/common.tsx` 的 `DataTable`（内部 MUI X DataGrid，中文语言包）。
- **文档工作台的「工作簿」是明确例外**：需要单元格级编辑、公式栏、样式与冻结，用 Univer 而非 DataGrid；旧 DataGrid 版 `SheetEditor.tsx` 仅作回退保留，页签已不加载。
- 页面按路由懒加载；`/docs` 的 PDF / 工作簿 / Markdown 文档再按页签懒加载，Univer 内核只在首次点开「工作簿」时加载。
- 动效统一走 `web-react/src/motion/tokens.ts` 的时长与缓动令牌，配合 `useMotionSafe` 尊重「减少动态效果」偏好；页面切换用 `PageTransition`，加载占位用 `SkeletonPulse`。
- Univer 主题跟随 MUI 明暗模式（暗色用 `darkBlueTheme`）。
- 服务端状态用 TanStack Query；`@/api/client` 负责 CSRF、凭证与 401。
- 浏览器本地可恢复副本放 Dexie（`nexus-workbench`），旧 `localStorage` 草稿首次读取时迁移。
- 表格汇总/透视等 CPU 计算通过 Comlink 进 Web Worker，支持取消、超时与过期结果隔离。
- 列宽/列显示按表格存浏览器；跨设备同步需另接账号视图配置。
- 时间相关规则（周期起止、每日奖励）一律由后端按本地时区裁定，前端不自行用浏览器时钟判断。

## 代码审查与已知限制

- 审查记录：[代码审查报告-2026-11-15](docs/代码审查报告-2026-11-15.md)（Standards / Spec 双轴 + 复核结论 + 仿真结果）。
- 已修复：生产 `create_all` 导致的结构漂移、附件归属校验空实现、附件解绑不回收、日历 62 天 off-by-one、前后端双时钟。
- 已修复（2026-11-15 全模块巡检，见 [UI与功能巡检-2026-11-15](docs/UI与功能巡检-2026-11-15.md)）：反代信任边界收紧为 `FORWARDED_ALLOW_IPS`（compose 指向 web 容器固定 IP，`Dockerfile` 不再用 `--forwarded-allow-ips='*'`）；看板/表格卡片在窄屏被内容撑破、翻译页收藏面板横向溢出、文档页签 320px 截断、网址回退图标取到「【」、打卡周期把次日当成结束日展示。
- 已知未改：`/checkins` 列表 GET 内做周期补齐并写库（读接口带写事务）；`maintenance.py` 清理失败日志缺 `exc_info`。
- 工作簿：XLSX 往返丢单元格样式、图表/透视/宏不迁移、大表截断（见上文「已知差异」）。

## 备份与恢复

加密备份、恢复演练与保留策略见 [备份与恢复](docs/备份与恢复.md) 与 `deploy/`。备份包含数据库与附件存储卷，恢复前先停 API 容器。

## 文档索引

- [文档工作台](docs/文档工作台.md)：三页签的选型、能力矩阵、验收项与已知限制（含 Univer 工作簿细节）
- [个人工作台 PRD v2.1](docs/个人工作台_PRD_v2.1.md)（Element Plus 时代基线，功能语义仍可参考）
- 模块：[白板](docs/白板.md)、[数据可视化](docs/数据可视化.md)、[Agent 接入](docs/Agent接入.md)
- 工程：[代码审查报告-2026-11-15](docs/代码审查报告-2026-11-15.md)、[UI 与功能巡检-2026-11-15](docs/UI与功能巡检-2026-11-15.md)、[开源组件选型与前端计算架构建议](docs/开源组件选型与前端计算架构建议.md)、[全局动效](docs/全局动效.md)、[备份与恢复](docs/备份与恢复.md)
- 验收脚本：`e2e/audit-*.mjs`（全页面巡检 / 窄屏暗色弹窗 / 主流程闭环），用法见巡检报告第 1 节。

## 提交约定

- 提交信息用中文，格式 `type(scope): 摘要`，正文列要点；`type` 取 `feat` / `fix` / `refactor` / `docs` / `perf` / `test` / `chore`。
- 改动后先 `npm run typecheck` 与 `npm run build`，再跑相关 e2e；不提交 `node_modules`、`web/dist`、`.env`、`storage/` 与本地产物。
- 推送前确认 `git status` 只剩预期文件。
