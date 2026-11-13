# 个人工作台（Workbench）

> 仓库：<https://github.com/weiwen778/workbench>

单用户、自托管的个人工作台：打卡、数据可视化、表格、待办、笔记、便利贴、网址导航、翻译、图片处理、Agent 接入、备份与恢复。

当前主线是 `web-react/` 中的 **React + MUI** 前端；旧 Element Plus 版源码保留在 `web/src/`，仅用于对照和回滚。后端与数据模型保持兼容。

## 功能

- **打卡**：店铺/社媒项目、分类、日/周/月事项、历史快照、批量导入、完成情况统计。
- **数据可视化**：多个看板；指标卡、柱状图、折线图、饼图、任务进度；支持统计列、分组、日期范围、下钻到源表格和 AI 生成图表。
- **表格**：MUI X DataGrid；列宽/列显示持久化、水平/垂直居中、行高、斑马纹、列间分隔线、固定操作列、内联编辑、排序、筛选、选择、分页、公式/关联/汇总/透视、Excel 导入导出。
- **待办**：清单、子任务、截止日期、完成/取消、静默刷新、回收站恢复。
- **笔记 / 便利贴 / 网址**：文件夹与标签、分类导航、搜索、Markdown 笔记、卡片/列表视图。
- **翻译**：多翻译服务、快捷键、历史记录、收藏、语言交换、本地偏好设置。
- **图片处理**：纯前端 Canvas 处理；裁剪、旋转、缩放、调色、去底、水印标注、拼图、切图、格式转换、压缩与 ZIP 批量导出，图片不上传。
- **Agent 接入**：访问令牌、权限范围、变更暂存区、审核合并、活动审计。
- **系统**：任务中心、回收站、操作记录、服务器监控、加密备份与恢复。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite、MUI 6、MUI X DataGrid / Charts 7 |
| 后端 | FastAPI、SQLAlchemy 2、Alembic、Pydantic v2 |
| 数据库 | 本地/测试支持 SQLite；生产使用 PostgreSQL |
| 部署 | Docker Compose（PostgreSQL + API + Nginx） |
| 测试 | pytest、Playwright |

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

打开 <http://127.0.0.1:18080>。首次启动会自动建表，并用 `WB_ADMIN_USERNAME` / `WB_ADMIN_PASSWORD` 创建唯一管理员。

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

# 前端类型与构建
cd web-react && npm run typecheck && npm run build

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

截图默认输出到 `.run/react-smoke/`。旧的 Element Plus E2E 脚本仍保留在 `e2e/`，使用独立测试库和 18746/18747 端口，避免影响开发数据。

PostgreSQL 回归可设置 `WB_TEST_DATABASE_URL`。测试只接受回环地址，数据库名必须以 `workbench_element_test` 开头；用例会重建该测试库的表，切勿指向业务数据库。

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
  src/                 旧 Vue 3 + Element Plus 前端（仅对照）
  dist/                前端构建产物（Git 忽略，由后端托管）
  public/              静态资源
e2e/                   Playwright 端到端测试与 fixtures
scripts/               开发服务、模拟数据、报告生成
deploy/                Nginx 配置、备份与恢复脚本
docs/                  PRD、设计说明、交付与验收记录
```

## 设计约定

- 视觉统一使用 MUI 主题与 `sx`：`web-react/src/app/theme.ts` 只保留明暗模式和品牌色。
- 表格统一走 `web-react/src/ui/common.tsx` 的 `DataTable`，内部是 MUI X DataGrid，已启用中文语言包。
- 列宽与列显示按表格保存在浏览器 `localStorage`；跨设备同步需要另接账号视图配置。
- 图片处理全部在浏览器本地完成；ZIP 使用 `fflate`；笔记使用 CodeMirror。
- DataGrid 的列宽、行高、固定操作列、对齐方式、隐藏列和排序都在通用组件内处理，页面不要重复实现。

## 文档

- [数据可视化](docs/数据可视化.md)
- [表格增强](docs/表格增强.md)
- [Agent 接入](docs/Agent接入.md) / [Agent 暂存设计](docs/Agent暂存设计.md)
- [备份与恢复](docs/备份与恢复.md)
- [图片处理](docs/图片处理.md)
- [设置与页面层级](docs/设置与页面层级.md)
- [可靠性与性能改进](docs/可靠性与性能改进.md)

## 安全

- 不要提交 `server/.env`、`.run/`、`storage/`、`data/`、备份文件和恢复密钥；这些已在 `.gitignore` 中忽略。
- 生产环境必须使用随机的 `WB_ENCRYPTION_KEY`、强管理员密码和 PostgreSQL。
- 翻译服务凭据使用 Fernet 加密保存；接口返回时只显示掩码。
- 备份包含敏感配置，必须与恢复密钥分开存放在安全位置。

## 许可证

本项目未附开源许可证，默认保留所有权利。
