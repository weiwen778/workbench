# 个人工作台（Workbench v2.1）

> 仓库：<https://github.com/weiwen778/workbench_element>

单用户的店铺／社媒工作台：打卡、待办、数据表、笔记、便签、翻译、回收站。

- 前端：Vue 3 + TypeScript + Element Plus 2.14（Vite 构建）
- 后端：FastAPI + SQLAlchemy 2 + Alembic
- 数据库：开发/测试用 SQLite，生产用 PostgreSQL
- 部署：Docker Compose（PostgreSQL + API + Nginx）

需求基线：`docs/个人工作台_PRD_v2.1.md`（PRD v2.1，Element Plus 版）
最新发布检查：`docs/发布检查-2026-10-26.md`。交付报告、验收对照及待办清单保留为上一轮记录，状态以最新发布检查为准。

## Agent 自动回写

在「设置 → Agent 接入」为每个 Agent 创建独立令牌，选择待办/表格的读取或写入权限和有效期，再复制接入说明。令牌只显示一次，保存在 Agent 的环境变量或机密配置中；可随时撤销，设置页可查看最近成功的写入操作。

Agent 使用 `Authorization: Bearer <令牌>` 调用 `/api/v1/agent`，无需账号密码或网页登录。支持新增待办、回写结果、完成/恢复待办，以及读取表格、添加记录、修改字段。修改记录时使用版本检查和字段合并，避免覆盖他人的修改。权限覆盖所选模块的全部数据；不提供删除数据、修改表结构或账号设置的能力。

详细步骤和请求示例：[Agent 接入说明](docs/Agent接入.md)。交互接口文档：`/api/docs`（Agent 标签）。远程使用请配置 HTTPS 或通过 SSH 隧道连接，避免在公网 HTTP 中传输令牌。

## 快速开始（WSL / Linux）

```bash
cd /home/weiwen/workbench

# 1. 后端依赖（首次）
cd server
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env          # 本地开发：SQLite，按需填 WB_ENCRYPTION_KEY

# 2. 前端依赖（首次）
cd ../web && npm ci && npm run build

# 3. 启动（前端取 web/dist，API 同源 18080）
cd ../server && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 18080
```

也可以直接用辅助脚本：

```bash
scripts/dev-server.sh start     # 启动
scripts/dev-server.sh stop      # 停止
scripts/dev-server.sh reset     # 清空开发库与附件后重启
```

首次启动会用 `WB_ADMIN_USERNAME` / `WB_ADMIN_PASSWORD` 创建唯一管理员（本机默认 `admin` / `admin12345`，生产必须改）。

## 开发模式

```bash
# 终端 1
cd server && .venv/bin/uvicorn app.main:app --reload --port 18080
# 终端 2
cd web && npm run dev    # http://127.0.0.1:5173，已代理 /api 到 18080
```

## 测试

```bash
# 后端 116 项；测试库与开发库隔离
cd server && .venv/bin/python -m pytest -q

# 前端类型与构建
cd web && npm run typecheck && npm run build

# 浏览器端真实操作冒烟（需先启动服务；会向开发库写入演示数据）
cd e2e && npm install && node ui-smoke.mjs
# 截图输出到 docs/screenshots/
```

重新生成可阅读的交付报告：

```bash
python3 scripts/gen-report.py    # 生成 docs/交付报告.html
```

PostgreSQL 回归可设置 `WB_TEST_DATABASE_URL`。为防止误删业务库，测试仅接受回环地址且数据库名以 `workbench_element_test` 开头；用例会重建该测试库的表，切勿指定业务数据库。

## 生产部署

```bash
cp .env.example .env
# 必改：WB_DB_PASSWORD、WB_ADMIN_USERNAME、WB_ADMIN_PASSWORD、WB_ENCRYPTION_KEY、WB_PUBLIC_BASE_URL
python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"   # 生成主密钥
docker compose up -d --build
```

- Web 对外 `${WB_HTTP_PORT:-18743}`，容器内监听 80；
- API 与数据库只绑定 `127.0.0.1`，不对公网开放；
- 数据卷：`wb_pgdata`（数据库）、`wb_storage`（附件）；
- API 容器启动前执行 `alembic upgrade head`；
- Nginx 用 `resolver` + 变量 `proxy_pass`，API 容器重建后无需重启 Web。

生产启动会拒绝缺失的主密钥、默认管理员密码和 SQLite 数据库。管理员环境变量只在空库首次启动时创建账号，之后改环境变量不会覆盖已有账号。密码和翻译密钥只保存在服务器私有 `.env`，不提交 Git。

同机试运行时可设置 `WB_BIND_ADDRESS=127.0.0.1`、`WB_HTTP_PORT=18744`、`WB_API_PORT=18081`、`WB_DB_PORT=55434`，避开已有服务。正式入口使用 18743；只开放 Web 端口。

国内服务器下载 Python 依赖较慢时，可运行 `docker compose build --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple api`，随后再启动 Compose。

备份：`bash deploy/backup.sh /私有备份目录`（数据库 + 附件 + 配置）。备份期间短暂停止 API 保持数据和附件一致，退出时自动恢复运行。恢复：`bash deploy/restore.sh /完整备份目录`，按提示输入数据库名；恢复会替换当前数据库及附件，应先在隔离环境演练。主密钥必须与备份保持一致。备份包含敏感配置，禁止上传到 Git。

生产 API 每小时清理到期回收站、导入导出任务及无引用暂存文件。有效引用附件保留。PDF 使用本地 PDF.js 阅读器，支持分页、缩放与适宽，worker、字体和 CMap 随构建部署，无需第三方 CDN。

## 目录结构

```
server/app            FastAPI 应用
  routers/            接口层（auth / checkins / todos / tables / transfers / files / notes / memos / translate / trash）
  services/           业务服务（周期、实例、字段校验、动态查询、翻译适配、加密、回收站）
  models.py           SQLAlchemy 模型
server/migrations     Alembic 迁移
server/tests          pytest（116 项）
web/src               Vue 3 前端（views 11 页、components 3 个复用组件、styles/theme.css）
e2e                   Playwright 冒烟脚本
deploy                Nginx 配置、备份与恢复脚本
docs                  PRD、交付报告、验收对照、待办、截图
scripts               开发服务脚本、报告生成脚本
```

## 设计约定（改样式前先读）

`web/src/styles/theme.css` 分五段：`--wb-*` 设计变量 → `--el-*` 映射 → 全局基础 → 少量组件补丁 → 暗色只覆盖 `--wb-*`。
引入顺序固定为 `element-plus/dist/index.css` → `theme-chalk/dark/css-vars.css` → `theme.css`（最后）。
优先改变量，其次组件选择器，scoped 内用 `:deep()`，`!important` 视为错误信号。
