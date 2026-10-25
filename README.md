# 个人工作台（Workbench v2.1）

> 仓库：<https://github.com/weiwen778/workbench_element>

单用户的店铺／社媒工作台：打卡、待办、数据表、笔记、便签、翻译、回收站。

- 前端：Vue 3 + TypeScript + Element Plus 2.14（Vite 构建）
- 后端：FastAPI + SQLAlchemy 2 + Alembic
- 数据库：开发/测试用 SQLite，生产用 PostgreSQL
- 部署：Docker Compose（PostgreSQL + API + Nginx）

需求基线：`docs/个人工作台_PRD_v2.1.md`（PRD v2.1，Element Plus 版）
本轮状态：`docs/交付报告.md`｜逐条验收：`docs/验收对照.md`｜遗留与待办：`docs/待办清单.md`

## 快速开始（WSL / Linux）

```bash
cd /home/weiwen/workbench

# 1. 后端依赖（首次）
cd server
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env          # 本地开发：SQLite，按需填 WB_ENCRYPTION_KEY

# 2. 前端依赖（首次）
cd ../web && npm install && npm run build

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
# 后端 105 项
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

## 生产部署

```bash
cp .env.example .env
# 必改：WB_DB_PASSWORD、WB_ADMIN_PASSWORD、WB_ENCRYPTION_KEY、WB_PUBLIC_BASE_URL
python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"   # 生成主密钥
docker compose up -d --build
```

- Web 对外 `${WB_HTTP_PORT:-18743}`，容器内监听 80；
- API 与数据库只绑定 `127.0.0.1`，不对公网开放；
- 数据卷：`wb_pgdata`（数据库）、`wb_storage`（附件）；
- API 容器启动前执行 `alembic upgrade head`；
- Nginx 用 `resolver` + 变量 `proxy_pass`，API 容器重建后无需重启 Web。

备份：`deploy/backup.sh`（数据库 + 附件 + 配置），恢复步骤写在备份目录的 `README.txt`。

## 目录结构

```
server/app            FastAPI 应用
  routers/            接口层（auth / checkins / todos / tables / transfers / files / notes / memos / translate / trash）
  services/           业务服务（周期、实例、字段校验、动态查询、翻译适配、加密、回收站）
  models.py           SQLAlchemy 模型
server/migrations     Alembic 迁移
server/tests          pytest（105 项）
web/src               Vue 3 前端（views 11 页、components 3 个复用组件、styles/theme.css）
e2e                   Playwright 冒烟脚本
deploy                Nginx 配置、备份脚本
docs                  PRD、交付报告、验收对照、待办、截图
scripts               开发服务脚本、报告生成脚本
```

## 设计约定（改样式前先读）

`web/src/styles/theme.css` 分五段：`--wb-*` 设计变量 → `--el-*` 映射 → 全局基础 → 少量组件补丁 → 暗色只覆盖 `--wb-*`。
引入顺序固定为 `element-plus/dist/index.css` → `theme-chalk/dark/css-vars.css` → `theme.css`（最后）。
优先改变量，其次组件选择器，scoped 内用 `:deep()`，`!important` 视为错误信号。
