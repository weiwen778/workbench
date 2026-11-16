# 个人工作台（Workbench / Nexus）

> 主仓库：<https://github.com/weiwen778/workbench.git>
> 历史仓库：<https://github.com/weiwen778/workbench_element>

单用户、自托管的个人工作台。把日常经营中的打卡、表格、看板、待办、笔记、文档处理和白板放进同一套界面，数据保存在自己的机器或服务器上。图片、PDF、表格、文档解析与公式计算尽量在浏览器完成，只有显式「保存 / 上传 / 提交」才写数据库。

- 前端：`web-react/`，React 18 + TypeScript + Vite 6 + MUI 6。
- 后端：`server/`，FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2。
- 数据库：本地/测试 SQLite；生产 PostgreSQL 16。
- 部署：Docker Compose（PostgreSQL + API + Nginx + 宿主机指标采集）或 bare-metal uvicorn。
- 目标运行环境：Python 3.12、Node.js 20+、Linux/WSL/macOS。

---

## 1. 当前交付状态（2026-11-16）

- 仓库历史已压缩为单一提交，当前分支 `main`；GitHub 远程若仍是旧历史，首次推送需要 `git push -f`。
- 后端全量 pytest 通过，前端 `tsc -b` 与 `npm run build` 通过。
- 已完成一轮安全审查并修复以下问题（详见第 10 节）：
  - Agent 令牌无法再通过暂存网关切到「仅管理员网页」接口；翻译凭据管理已从 Agent 可访问根路径移除。
  - 新建 Agent 令牌一律保存策略；审核模式不再静默丢弃模块/表格/操作/文件/外部限制。
  - 表格白名单的 `{{…}}` 查询参数绕过、未解析结果引用、撤销令牌仍可合并、改密码不吊销 Agent 令牌等问题已修复。
  - Excel 解压炸弹改为按「实际解压字节」限制；导入流程复用表格字段校验、选项校验、公式配置与逐行记录校验。
  - 导出文件被当附件后备份永久失败、NAT64 SSRF、恢复脚本路径穿越、`.dockerignore` 泄漏本地依赖等问题已修复。
  - 笔记历史恢复增加版本并发校验；审核模式不再触发看板 AI 外部调用。
  - 升级 `xlsx` 到 0.20.3（官方 CDN 包，修复已知原型污染/ReDoS）。
  - 增加安全响应头、上传请求体提前拒绝、退出登录清理本地文档草稿。

> 注意：默认部署仍是 HTTP，`WB_COOKIE_SECURE` 默认 false。对外网提供服务时必须在反向代理上启用 HTTPS，并把 `WB_COOKIE_SECURE=true`；详见第 7、10 节。

---

## 2. 功能一览

| 模块 | 能做什么 |
| --- | --- |
| 打卡 | 店铺/社媒项目、分类、日/周/月事项、历史快照、批量导入、完成率统计；周期结束自动锁定 |
| 表格 | MUI X DataGrid；列宽/列显示持久化、行高、斑马纹、固定操作列、内联编辑、筛选、排序、分页；公式/关联/汇总/透视；Excel 导入导出 |
| 看板 | 指标卡、柱状/折线/饼图、任务进度；统计列、分组、日期范围、下钻到源表格 |
| 待办 | 多清单、子任务、截止时间、完成区、回收站恢复、静默刷新 |
| 笔记 / 便利贴 / 网址 | 文件夹与标签、Markdown（CodeMirror + DOMPurify）、自动保存与版本历史、六色便签、分类导航 |
| 文档工作台 | 三个页签：PDF 编辑与处理、工作簿（Univer 表格内核）、Markdown 文档（DOCX 导入导出） |
| 图片 / 格式 / 取色 / 二维码 | 纯前端 Canvas 处理、格式转换、对比度检查、二维码/条码 |
| 白板 | Excalidraw 场景、图片资源、自动保存、本地草稿、版本冲突、PNG 导出 |
| Agent 接入 | 令牌（只显示一次）、直接写入/先暂存两种模式、细粒度权限策略、操作日志与一键撤销 |
| 运行日志 / 反馈 | 后端日志入库、级别/来源/关键字检索、导出与清理；GitHub Issue 反馈后端（前端入口按设计文档接入） |
| 系统 | 任务中心、回收站（30 天）、操作记录、服务器监控、加密备份与恢复 |

「信息聚合 / 视频解析 / 宠物」三个旧模块及其归档代码已于 2026-11-16 移除；数据库历史迁移保留，并新增删表迁移清理相关表。

---

## 3. 架构与请求边界

```text
浏览器
  ├─ React SPA（web-react/src）
  │    ├─ 页面 / 布局 / MUI 主题
  │    ├─ docs/：PDF、Univer 工作簿、Markdown 文档
  │    ├─ 本地计算：图片、表格、二维码、格式转换
  │    └─ storage/：Dexie / localStorage 草稿
  │
  └─ /api/v1/*  ──► FastAPI（server/app）
                       ├─ routers/：HTTP 路由、Pydantic 校验
                       ├─ services/：备份、任务、翻译、表达式、导入导出
                       ├─ agent_*：Agent 令牌、权限策略、暂存/直写、撤销
                       ├─ models.py：SQLAlchemy 模型
                       └─ migrations/：Alembic
                              │
                              ├─ PostgreSQL（生产）/ SQLite（本地测试）
                              └─ storage/：files、exports、whiteboards、agent-staging
```

关键边界：

- **浏览器本地处理**：图片、PDF、工作簿、文档、格式转换、二维码默认在浏览器解析/渲染/导出，未保存的文件不上传。
- **后端持久化**：只有显式保存、上传附件、保存白板、提交表单才写库。
- **外部来源**：翻译、网址元数据、看板 AI 等外部请求由后端发起，统一做 DNS/私网地址校验、重定向限制、超时、响应体上限和失败退避。
- **Agent**：Agent 令牌只能访问 `/api/v1/agent/*` 网关；直写模式立即执行并写撤销日志，审核模式先落暂存，用户网页确认后才合并。
- **管理员网页专属**：备份、恢复密钥、翻译凭据等接口只接受浏览器会话，不接受 Agent 令牌，也不接受 Agent 内部 ASGI 子请求。
- **迁移**：生产启动只执行 `alembic upgrade head`；生产不执行 `create_all`，避免「表建出来但列没加」的结构漂移。

---

## 4. 目录结构

```text
server/
  app/
    main.py             应用装配、CSRF、上传体限制、生产启动校验
    config.py           WB_* 环境变量
    models.py           SQLAlchemy 模型
    deps.py             会话 / 管理员 / Agent 执行上下文鉴权
    agent_policy.py     Agent 细粒度策略
    routers/            HTTP 路由
    services/           备份、任务、翻译、表达式、导入导出、SSRF 安全读取
    migrations/         Alembic 迁移
  tests/                pytest 用例（含安全回归）
  requirements.txt
web-react/
  src/
    pages/              路由页面
    layout/             侧栏、模块面板
    components/         共享组件（DataTable、MarkdownEditor、附件预览等）
    docs/               PDF / 工作簿 / Markdown 文档编辑器
    docs/sheet/         Univer 工作簿 + SheetJS 桥接
    motion/             动效 tokens 与过渡原语
    storage/            Dexie / localStorage 草稿
  scripts/              构建辅助（预压缩、PDF.js 资源复制）
web/
  dist/                 构建产物（Git 忽略，由后端托管）
  public/               PDF.js、白板字体、PDF 中文字体
e2e/                    Playwright 端到端脚本
scripts/                开发服务、模拟数据、报告生成
deploy/                 Nginx、备份、恢复脚本
docs/                   PRD、模块设计、审查与巡检记录
```

---

## 5. 本地运行

### 5.1 后端（bare-metal）

```bash
cd server
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# 编辑 .env：至少设置 WB_ADMIN_PASSWORD、WB_ENCRYPTION_KEY
# 生成 Fernet 主密钥：
# python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"

.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18080
```

打开 <http://127.0.0.1:18080>。健康检查：

```bash
curl -fsS http://127.0.0.1:18080/api/v1/health
```

项目也提供 WSL/Linux 启停脚本：

```bash
scripts/wb.sh install     # 建 venv、装依赖、构建前端
scripts/wb.sh start       # 启动 18080
scripts/wb.sh status
scripts/wb.sh logs
scripts/wb.sh restart
scripts/wb.sh stop
```

### 5.2 前端开发模式

```bash
# 终端 1：后端热重载
cd server
.venv/bin/uvicorn app.main:app --reload --port 18080

# 终端 2：Vite 开发服务器（5174，/api 代理到 18080）
cd web-react
npm ci
npm run dev
```

### 5.3 前端生产构建

```bash
cd web-react
npm ci
npm run typecheck
npm run build      # 输出到 ../web/dist，并生成 Brotli/Gzip 预压缩文件
```

构建后由 FastAPI 静态托管 `web/dist`。`web-react/node_modules`、`web-react/dist`、`web/dist` 都不应提交。

> Univer 依赖必须保持 1.5.x 全套同版本。若国内镜像报 `ETARGET 404 @univerjs/rpc@1.5.0`，改用官方源：
> `npm install --registry=https://registry.npmjs.org`

---

## 6. Docker Compose 部署

```bash
cp .env.example .env
# 必填：WB_DB_PASSWORD、WB_ADMIN_PASSWORD、WB_ENCRYPTION_KEY
# 建议：WB_PUBLIC_BASE_URL、WB_COOKIE_SECURE、WB_BIND_ADDRESS
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

默认拓扑：

| 服务 | 说明 |
| --- | --- |
| `db` | PostgreSQL 16，数据卷 `wb_pgdata`，仅绑定 `127.0.0.1:${WB_DB_PORT:-5433}` |
| `api` | FastAPI，数据卷 `wb_storage` / `wb_backups`，仅绑定 `127.0.0.1:${WB_API_PORT:-8000}` |
| `web` | Nginx 托管 SPA 并反代 `/api/` 到 `api:8000`，默认对外 `${WB_BIND_ADDRESS:-0.0.0.0}:${WB_HTTP_PORT:-18743}` |
| `host-metrics` | 只读采集宿主机 CPU/内存/磁盘/网络，写入 `wb_metrics` 卷，再由 API 读取 |

API 容器启动命令：

```sh
alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
```

生产启动校验（`server/app/main.py`）：

- 必须设置 `WB_ENCRYPTION_KEY`。
- 管理员密码至少 12 位，不能是 `admin12345`、`请改成…`、`changeme` 等仓库/常见弱口令。
- 生产必须使用 PostgreSQL，不能是 SQLite。
- `WB_DB_PASSWORD`、`WB_ADMIN_PASSWORD`、`WB_ENCRYPTION_KEY` 在 compose 中用 `${...:?}` 强制，空值会直接拒绝启动。

### 6.1 对外网部署（强烈建议）

默认 compose 是 HTTP，仅适合本机/内网。对公网提供服务时：

1. 在宿主机或云负载均衡上终止 TLS（Nginx / Caddy / 云证书均可）。
2. `.env` 设置：
   ```dotenv
   WB_PUBLIC_BASE_URL=https://your-domain.example
   WB_COOKIE_SECURE=true
   WB_BIND_ADDRESS=127.0.0.1   # 只让本机反代访问 web 端口
   ```
3. 反代把 80/443 转到 `127.0.0.1:18743`，并保留 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`。
4. 云安全组只放行 80/443；不要暴露 8000、5433、18743 到公网。
5. 如果使用 `deploy/nginx.conf`，请确认 `server_name`、证书和 443 配置；仓库内 Nginx 只监听 80，TLS 需要在外层终止。

### 6.2 升级流程

```bash
git pull --ff-only
cd web-react && npm ci && npm run build
cd ..
docker compose build
docker compose up -d
docker compose exec -T api alembic upgrade head   # 若未由入口自动执行
curl -fsS http://127.0.0.1:${WB_HTTP_PORT:-18743}/api/v1/health
```

升级前先做一次备份（见第 9 节）。数据库迁移不可逆时，先在临时实例验证。

---

## 7. 配置

配置全部来自 `WB_` 前缀环境变量，模板见 `.env.example`（Compose）与 `server/.env.example`（bare-metal 开发）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WB_ENV` | `dev` | `dev` / `test` / `production`；生产启用维护任务与严格校验 |
| `WB_DATABASE_URL` | `sqlite:///./data/workbench.db` | SQLAlchemy 连接串；生产必须 PostgreSQL |
| `WB_DB_HOST` / `WB_DB_PORT` | — | Compose 内使用 `db` / `5432` |
| `WB_DB_NAME` / `WB_DB_USER` / `WB_DB_PASSWORD` | — | 生产必填；密码不要写进仓库 |
| `WB_ADMIN_USERNAME` / `WB_ADMIN_PASSWORD` | `admin` / `admin12345` | 首次启动创建唯一管理员；生产密码≥12 位且非弱口令 |
| `WB_ENCRYPTION_KEY` | — | Fernet 主密钥，加密翻译/AI 凭据；丢失后旧凭据不可解 |
| `WB_STORAGE_DIR` | `./data/storage` | 附件、导出、白板资源、Agent 暂存目录 |
| `WB_BACKUP_DIR` | `../.backups` | 应用内加密备份目录，必须与附件目录分离 |
| `WB_BACKUP_ENABLED` / `WB_BACKUP_INTERVAL_HOURS` / `WB_BACKUP_KEEP` | `true` / `24` / `7` | 自动备份开关、间隔、保留份数 |
| `WB_PUBLIC_BASE_URL` | 空 | 生成附件下载/导出链接的公开地址；HTTPS 部署必填 |
| `WB_COOKIE_SECURE` | `false` | HTTPS 时必须 `true`；否则会话 Cookie 会明文传输 |
| `WB_MAX_UPLOAD_BYTES` | `20000000` | 单文件上限（字节）；Nginx 同步 `25m` |
| `WB_STAGED_TTL_HOURS` | `24` | 暂存文件/导入导出任务有效期 |
| `WB_TRASH_DAYS` | `30` | 回收站保留天数 |
| `WB_TIMEZONE` | `Asia/Shanghai` | 后端周期/每日规则使用的时区 |
| `WB_LOGIN_MAX_FAILURES` / `WB_LOGIN_LOCK_SECONDS` | `5` / `300` | 单 IP 登录失败锁定；不启用全局账号锁，避免锁死唯一管理员 |
| `WB_LOG_LEVEL` / `WB_LOG_RETENTION_DAYS` | `INFO` / `30` | 运行日志最低级别与保留天数 |
| `WB_LOG_QUEUE_SIZE` / `WB_LOG_CLIENT_PER_MINUTE` / `WB_LOG_EXPORT_LIMIT` | `5000` / `30` / `20000` | 日志写队列、浏览器上报限流、导出上限 |
| `WB_FEEDBACK_TIMEOUT_SECONDS` | `10` | GitHub Issue 反馈请求超时 |
| `WB_ALLOW_INSECURE_UPSTREAM` | `false` | 仅测试允许翻译服务指向本机 HTTP |
| `WB_HOST_METRICS_FILE` | — | Compose 中为 `/metrics/current.json` |
| `WB_FORWARDED_ALLOW_IPS` / `FORWARDED_ALLOW_IPS` | — | 只信任反代容器固定 IP 的 `X-Forwarded-*` |

安全相关默认值：

- 生产拒绝 SQLite、缺失主密钥、弱/占位管理员密码。
- 上传端点有大小、扩展名、内容类型与归属校验；Excel 额外做实际解压字节限制。
- 外部 HTTP 读取拒绝私网、回环、链路本地、NAT64/6to4/Teredo/IPv4-mapped 等地址。
- 备份归档必须通过 GCM 认证和 tar 成员校验后才解压。

---

## 8. 测试与验收

### 8.1 后端全量

```bash
cd server
.venv/bin/python -m pytest -q
```

- 必须在 `server/` 目录下执行，`app` 才能被导入。
- 测试会重建独立测试库；`WB_TEST_DATABASE_URL` 必须以 `workbench_element_test` 开头，**切勿指向业务库**。
- 安全回归集中在 `server/tests/test_security_regressions.py`：
  - Agent 不能暂存翻译凭据；
  - 新建审核令牌保存 policy，操作范围生效；
  - 表格白名单不能通过 `{{…}}` 查询参数绕过；
  - 撤销令牌后待审核变更不可合并；
  - 改密码吊销 Agent 令牌；
  - NAT64/过渡地址被 SSRF 校验拒绝；
  - ZIP 伪造声明大小被实际解压字节检查拒绝；
  - 生产弱口令校验。

### 8.2 前端

```bash
cd web-react
npm run typecheck
npm run build
```

`npm run build` 会执行 `tsc -b`、Vite 构建和预压缩；构建后检查 `web/dist/index.html` 存在。

### 8.3 浏览器端到端（需先启动服务）

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

- 建议用临时实例（独立端口 + 独立 SQLite）跑 e2e，避免污染真实数据。
- `workbook-hotkeys.mjs`、`workbook-all-hotkeys.mjs`、`table-workbook-recovery.mjs` 针对旧 `.univer-host` 表格工作簿，尚未随新文档工作台重写。
- `ui-smoke.mjs` 等早期脚本使用 Element Plus 选择器，仅作历史参考。

---

## 9. 数据、备份与恢复

### 9.1 存储布局

```text
$WB_STORAGE_DIR/
  files/            用户上传附件（uuid 文件名）
  exports/          表格导出文件（export_ 前缀）
  whiteboards/      白板图片资源
  agent-staging/    Agent 暂存上传
  agent-results/    Agent 合并产生的二进制结果
  document-projects/文档项目附件（xlsx / univer.json 等）
```

文件元数据在 `files` 表；附件引用在 `file_refs`。导出文件的 `storage_key` 固定以 `export_` 开头，备份快照据此映射到 `exports/`，不再依赖 `data_transfer_jobs` 是否仍存在。

### 9.2 应用内加密备份

- 入口：系统设置 → 备份 / 任务中心；API 为 `/api/v1/backups*`（仅管理员网页会话）。
- 格式：`.wbbackup`，AES-GCM 加密，内含数据库快照、附件归档、清单与恢复所需环境变量。
- 恢复密钥 `recovery.key` 与备份归档分属不同卷/目录；**必须把 `recovery.key` 单独离线保存**，否则备份无法解密。
- 备份卷 `wb_backups` 与附件卷 `wb_storage` 分离；不要把两者放在同一可被攻破的位置。

### 9.3 运维级备份（deploy/backup.sh）

```bash
bash deploy/backup.sh /path/to/backup-root
```

产物：

```text
workbench-YYYYmmdd-HHMMSS/
  database.dump      pg_dump -Fc
  storage.tar.gz     整个附件卷
  env.keys           需要单独保管的变量名清单（不含值）
  README.txt         恢复说明
```

**从 2026-11-16 起不再复制 `.env`**。数据库密码、管理员密码和 `WB_ENCRYPTION_KEY` 必须放在密码管理器/独立密钥库；备份目录本身仍应视为敏感资产并加密传输、限制访问。

### 9.4 恢复（deploy/restore.sh）

```bash
bash deploy/restore.sh /path/to/workbench-YYYYmmdd-HHMMSS
```

脚本会：

1. 要求输入数据库名确认。
2. 在 `$BACKUP/pre-restore-*` 下自动备份当前数据库和附件卷。
3. 校验 `storage.tar.gz`：拒绝绝对路径、`..`、符号链接、硬链接、设备文件。
4. 停止 API，清空并重建 `public` schema，`pg_restore --single-transaction`。
5. 解压附件，启动 API；失败时 trap 会尝试重新启动 API。
6. 恢复后必须使用原来的 `WB_ENCRYPTION_KEY` 启动，否则翻译/AI 凭据无法解密。

---

## 10. 安全审查与已修复问题（2026-11-16）

本轮审查覆盖鉴权、文件/网络、导入导出、备份恢复、前端与部署。以下为已落地修复：

| # | 严重度 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | 高 | Agent 暂存网关可通过内部 ASGI 子请求调用「仅管理员网页」的翻译凭据接口 | `get_admin_user` / `review_user` 同时检查 `agent_runtime.execution`；`translation-connections` 从 Agent 根路径移除 |
| 2 | 高 | 审核模式创建令牌时前端删除 policy，后端存 `None`，所有细粒度限制失效 | 前端保留 policy；后端新建令牌始终落默认/提交策略；旧令牌 `None` 仍走兼容分支 |
| 3 | 高 | 表格白名单可用 `{{x}}` 查询参数绕过 | 策略不再因路径含 `{{` 跳过；合并/直写 resolve 后仍有 `{{` 直接 422 |
| 4 | 高 | Excel 只信任 ZIP 声明大小，可解压炸弹 OOM | 新增 `archive_safety.py`，流式统计实际解压字节，并校验声明大小与实际一致 |
| 5 | 高 | 导出文件绑定为附件后，清理任务删除导出 job 会导致备份永久 `BACKUP_ATTACHMENT_MISSING` | 备份快照按 `storage_key` 的 `export_` 前缀映射 `exports/`，不再依赖 job 行 |
| 6 | 高 | `.env.example` 的占位管理员密码长度足够，可通过生产校验 | 示例留空；生产校验拒绝占位符/常见弱口令且要求 ≥12 位 |
| 7 | 高 | 审核模式预览会真实调用看板 AI；直写模式可绕过 `allow_external` | `/dashboards/ai` 归入 deferred 与 external，必须显式允许外部服务 |
| 8 | 高 | 导入流程绕过字段类型/选项/公式/必填校验，可造畸形 schema 或 500 | 复用 `FieldIn`/`_check_field_payload`/`configure`/`validate_record`；mapping 索引做范围校验 |
| 9 | 高 | 笔记历史恢复无并发版本校验，覆盖他端修改 | 恢复接口要求 `version`，`with_for_update` + 409；前端传当前版本 |
| 10 | 中 | 撤销/过期令牌的待审核变更仍可合并 | 合并显式拒绝撤销/过期令牌；撤销时把 pending 变更标记 rejected |
| 11 | 中 | 改密码只吊销网页会话，不吊销 Agent 令牌 | 改密码同时撤销该用户全部 `AgentToken` |
| 12 | 中 | `purge-expired` 被归为 update，只有 create/update 权限也能永久清除回收站 | 归为 delete；并要求 `allow_irreversible` |
| 13 | 中 | NAT64 / IPv4-mapped / 6to4 / Teredo 可绕过 `is_global` SSRF 校验 | 统一 `is_public_ip`，显式拒绝过渡/翻译地址 |
| 14 | 中 | 恢复脚本以 root 解压未校验 tar，且先 DROP 再恢复 | 恢复前自动备份；拒绝绝对路径/`..`/链接/设备文件；失败 trap 重启 API |
| 15 | 中 | `.dockerignore` 漏 `web-react/node_modules`，构建上下文覆盖容器依赖 | 补齐 node_modules、dist、tsbuildinfo、`.backups`、`.restore-drill` 等 |
| 16 | 中 | 退出登录不清浏览器本地文档草稿 | `logout()` 调用 `clearDocumentDraft(userId)` |
| 17 | 中 | Nginx 无安全响应头 | 增加 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` |
| 18 | 中 | `xlsx@0.18.5` 已知 CVE | 升级到官方 CDN `xlsx-0.20.3.tgz`，并通过 typecheck/build |
| 19 | 中 | 上传大小在 multipart 落盘后才检查 | 增加 `Content-Length` 中间件提前 413；Nginx 继续作为外层上限 |
| 20 | 中 | 运维备份把 `.env` 与数据库/附件放在同一目录 | `deploy/backup.sh` 不再复制 `.env`，只输出变量名清单 |
| 21 | 低 | 登录全局账号锁可被匿名请求用来锁死唯一管理员 | 只保留单 IP 锁，移除全局账号硬锁 |

仍属加固建议、未在代码中强制：

- 对外网必须启用 TLS + `WB_COOKIE_SECURE=true`；默认 HTTP 只适合本机/内网。
- `host-metrics` 仍以只读方式挂载宿主机 `/`（用于磁盘/主机名指标），并启用 host network/PID；如可接受指标缺失，可收窄为只挂 `/proc` 和必要的磁盘路径。
- API/Web 容器仍以默认用户运行，未做 `USER`/`cap_drop` 全面收紧；生产建议配合只读根文件系统、`no-new-privileges` 和最小权限运行。
- Nginx 尚未设置 CSP（Univer/PDF.js 的 worker/blob 需要逐项验证）；当前依赖 DOMPurify 与后端协议校验作为 XSS 主防线。
- 上传仍以 `Content-Length` 提前拒绝为主，chunked 请求的硬上限依赖反代。

---

## 11. Agent 接入

入口文档：[docs/Agent接入.md](docs/Agent接入.md)。核心规则：

- 令牌只在创建时显示一次，服务端只存 `sha256` 哈希和 16 字符前缀。
- 两种写模式：
  - `direct`：立即执行，写 `agent_runs` 撤销日志；不可撤销操作默认拒绝。
  - `review`：先写 `agent_changes` 暂存，用户在网页预览、合并或驳回；合并前会重新校验指纹与版本。
- 策略字段：
  - `modules`：允许的模块（空表示不限制）。
  - `tables`：允许的表格 ID（空表示不限制）。
  - `operations`：`create` / `update` / `delete`。
  - `allow_schema`：建表、改列、改视图、导入新列。
  - `allow_files`：上传、导入、导出。
  - `allow_external`：翻译、网址元数据、看板 AI。
  - `allow_irreversible`：文件、导入导出、永久清理等不可撤销操作。
  - `max_operations` / `daily_runs`：单批与每日上限。
- 新建令牌即使不传 policy 也会保存默认策略；审核模式不再存在「无策略即全放行」的新令牌。
- 撤销令牌会同时把该令牌的 pending 暂存标记为 rejected；合并时也会拒绝已撤销/过期令牌。
- Agent 不能访问：`/auth/*`、`/backups*`、`/translation-connections*`、`/agent-changes*` 审批接口，以及其他仅管理员网页接口。
- 结果引用只支持 `{{opRef.field}}` 形式，且只解析一次；合并/直写时路径中仍有 `{{` 会直接拒绝。

---

## 11.5 运行日志与问题反馈（后端）

设计文档：[日志中心与问题反馈设计](docs/superpowers/specs/2026-11-16-日志中心与问题反馈-design.md)。

- `AppLog` 通过有界队列异步写库，队列满时丢弃并计数，不阻塞业务请求。
- 管理员接口：`GET /api/v1/logs`、`/logs/summary`、`/logs/{id}`、`DELETE /logs`、`GET /logs/export`。
- 浏览器上报：`POST /api/v1/logs/client`（登录用户，按用户限流）。
- 反馈配置与提交：`GET/PUT /api/v1/feedback/config`、`POST /api/v1/feedback/config/test`、`POST /api/v1/feedback`、`GET /api/v1/feedback`、`POST /api/v1/feedback/{id}/retry`。
- GitHub PAT 使用现有 Fernet 主密钥加密，接口只返回掩码；仓库名正则校验，禁止路径穿越。
- 迁移：`20261116_d4e5f6a7b8c9_add_logs_and_feedback.py`（`down_revision = c3d4e5f6a7b8`）。
- 当前状态：后端与测试已完成；设置页「运行日志」、顶栏反馈弹窗等前端入口尚未接入，接入时按设计文档实现，不要绕过后端脱敏与管理员鉴权。

---

## 12. 设计约定（给下一个 Agent）

- 视觉统一走 MUI 主题与 `sx`；品牌色与明暗模式集中在 `web-react/src/app/theme.ts`。
- 业务表格统一使用 `web-react/src/ui/common.tsx` 的 `DataTable`（MUI X DataGrid，中文语言包）。
- **文档工作台的「工作簿」是明确例外**：需要单元格级编辑、公式栏、样式与冻结，用 Univer 而非 DataGrid；旧 DataGrid 版 `SheetEditor.tsx` 仅作回退保留。
- 页面按路由懒加载；`/docs` 的 PDF / 工作簿 / Markdown 文档再按页签懒加载，Univer 内核只在首次点开「工作簿」时加载。
- 动效统一走 `web-react/src/motion/tokens.ts` 的时长与缓动令牌，配合 `useMotionSafe` 尊重「减少动态效果」偏好。
- 浏览器本地副本放 Dexie（`nexus-workbench`）；退出登录会清理当前用户的文档草稿。
- 服务端状态目前由页面内的显式请求/本地状态管理，不再依赖 TanStack Query（该依赖已移除）。
- 时间相关规则（周期起止、每日规则）由后端按 `WB_TIMEZONE` 裁定；前端个别看板日期选择仍使用浏览器时钟 + `Asia/Shanghai`，属于已知限制。
- 所有用户输入渲染到 HTML 的路径必须经过 DOMPurify；新增渲染路径要补安全测试。
- 文件路径中的 `storage_key` 只能由服务端生成；不要接受客户端路径。

---

## 13. 已知限制与技术债

- 看板 `last7/last30` 的日期区间仍由前端浏览器时钟计算（硬编码 `Asia/Shanghai`），未完全服从后端时区。
- `/checkins` 列表 GET 内会补齐周期并写库（读接口带写事务）；高并发下需评估。
- `maintenance.py` 部分清理失败日志缺 `exc_info`。
- 工作簿 XLSX 往返会丢单元格样式；图表/透视/数据验证/批注/宏不迁移；大表按行/列截断。
- 容器默认 root、`host-metrics` 挂载宿主机 `/`、默认 HTTP 等部署加固项未强制，需按第 6.1 节配置。
- 未设置 CSP；若后续引入新的 HTML 注入路径，必须重新评估。
- `web-react/src/pages/Dashboard.tsx`、`AppRail.tsx` 等仍有少量硬编码动效/颜色，未全部收敛到 tokens。
- 运行日志/问题反馈只有后端与测试，设置页和顶栏入口尚未接入。
- e2e 中旧 `.univer-host` 脚本尚未重写。

---

## 14. 常见问题

**启动报 `Production requires an administrator password...`**
生产密码必须 ≥12 位，且不能是 `.env.example` 占位符、`admin12345`、`changeme` 等。修改 `WB_ADMIN_PASSWORD` 后重启。

**启动报数据库连不上**
检查 `WB_DB_HOST`/`WB_DB_PASSWORD`；Compose 内主机名是 `db`，不是 `127.0.0.1`。先 `docker compose logs db`。

**登录后立刻 401 / Cookie 不保存**
HTTPS 部署必须 `WB_COOKIE_SECURE=true`；HTTP 部署必须为 `false`。同时确认 `WB_PUBLIC_BASE_URL` 与访问地址一致。

**Agent 返回 403 `AGENT_POLICY_*`**
检查令牌的 modules/tables/operations/allow_schema/allow_files/allow_external/allow_irreversible。新建令牌不再有「无策略全放行」。

**导入 Excel 报 `WORKBOOK_TOO_LARGE` 或 `INVALID_WORKBOOK`**
文件实际解压后超过 64 MB / 单文件 16 MB（工作簿导入 32 MB）会被拒绝；伪造 ZIP 声明大小也会被识别。请拆分文件或删除样式/空行。

**备份报 `BACKUP_ATTACHMENT_MISSING`**
数据库中的附件路径在存储目录不存在。检查 `storage/files`、`storage/exports`、白板资源是否被手工移动；修复后再备份。

**恢复后翻译/AI 凭据不可用**
恢复时必须使用原来的 `WB_ENCRYPTION_KEY`。丢失主密钥后旧密文无法解密，只能重新填写凭据。

**前端构建报 Univer 版本 404**
使用官方 npm 源重装；所有 `@univerjs/*` 必须同版本 1.5.x。

---

## 15. 文档索引

- [文档工作台](docs/文档工作台.md)：三页签选型、能力矩阵、验收项与已知限制（含 Univer 工作簿）。
- [个人工作台 PRD v2.1](docs/个人工作台_PRD_v2.1.md)：功能语义基线。
- 模块：[白板](docs/白板.md)、[数据可视化](docs/数据可视化.md)、[Agent 接入](docs/Agent接入.md)。
- 工程：[代码审查报告-2026-11-15](docs/代码审查报告-2026-11-15.md)、[UI 与功能巡检-2026-11-15](docs/UI与功能巡检-2026-11-15.md)、[开源组件选型与前端计算架构建议](docs/开源组件选型与前端计算架构建议.md)、[全局动效](docs/全局动效.md)、[备份与恢复](docs/备份与恢复.md)。
- 语义约定：[弹窗布局约定](docs/弹窗布局约定.md)、[设置与页面层级](docs/设置与页面层级.md)。

---

## 16. 提交约定

- 提交信息用中文，格式 `type(scope): 摘要`，正文列要点；`type` 取 `feat` / `fix` / `refactor` / `docs` / `perf` / `test` / `chore`。
- 改动后至少执行：
  ```bash
  cd server && .venv/bin/python -m pytest -q
  cd ../web-react && npm run typecheck && npm run build
  ```
- 不提交 `node_modules`、`web/dist`、`.env`、`server/.env`、`storage/`、`.backups`、本地草稿与密钥。
- 推送前确认 `git status` 只有预期文件；若远程仍是旧历史，使用 `git push -f origin main` 前先确认没有需要保留的远程提交。
- 生产部署前先备份；恢复演练在隔离实例完成后再操作真实数据。
