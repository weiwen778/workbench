# Agent 全业务暂存与直接写入

## 两种写入模式

- `review`（默认，兼容旧令牌）：所有 POST/PUT/PATCH/DELETE 默认返回 202 pending，正式数据只在用户合并时提交。仅图表计算预览为无写入的直接 POST。
- `direct`（接管模式）：用户明确选择后，写入在业务事务内立即执行，并同时写入 `AgentRun` 操作日志。单条写入返回原业务结果和 `X-Agent-Run-Id`；批量 `/changes` 返回 `{run_id,status:"applied",results}`。

### 直接写入与撤销

- `AgentRun` 保存加密的原始操作、撤销计划、脱敏前后预览、结果、幂等键、操作数、撤销状态和撤销人。
- 撤销计划按操作生成：新建 → 删除新建资源；修改 → 只恢复 Agent 实际改过的字段，并在撤销时读取当前 version；删除 → 从回收站恢复；待办完成/取消/移动 → 反向动作。字段级恢复会保留用户之后改动的其他字段。
- 撤销只接受网页登录，拒绝 Bearer。执行前先做全量预检：只对 Agent 改过的字段检查冲突，用户改了无关字段不算冲突；Agent 改过的字段又被用户改过、回收站已过期等返回 409，不覆盖用户的新修改；全部检查通过后按相反顺序在同一个 `AgentSession` 中执行，最后一次提交。
- 直接写入的幂等键按令牌唯一；同一键相同内容返回原来的 run，不同内容 409。
- 策略字段：`write_mode`、`modules`、`tables`、`operations`、`allow_schema`、`allow_files`、`allow_external`、`allow_irreversible`、`max_operations`、`daily_runs`。设置页提供观察者/助理/接管者/自定义预设；`tables` 白名单只限制写操作，读取仍由模块权限控制。旧令牌没有 `policy` 时保持原有 scope 行为。
- 新建/修改/删除的 undo 支持表格记录、表格、字段（新建/修改）、表格视图（新建/修改/删除，删除会重建）、待办、待办清单、笔记、便利贴、书签、看板（删除会重建）；表格记录批量删除会逐条从回收站恢复。字段删除、待办排序、打卡/工作目标等暂标记为不可自动撤销，UI 会通过 `undoable=false`/`undo_reason` 明确提示。

新增表迁移：`server/migrations/versions/20261114_a1b2c3d4e5f6_agent_direct_runs.py`（`agent_tokens.write_mode/policy` 与 `agent_runs`）。`20261114_f9a0b1c2d3e4_file_owner.py` 已用 SQLite `batch_alter_table` 兼容全新 SQLite 数据库；当前 Alembic 单 head 为 `a1b2c3d4e5f6`。

## 页面

设置 → Agent 接入 → Agent 操作记录：直接写入的每次请求、前后差异、可撤销状态和撤销按钮。Agent 暂存区继续承载 review 模式：待审核 / 已合并 / 已拒绝，查看前后内容、重新预览、合并、拒绝。合并和拒绝都要求网页登录、CSRF 和当前草稿 version，拒绝附带 Bearer 的审批请求。令牌只能查看自己提交的草稿和 run，不能管理令牌、账号密码、审核草稿或撤销。

## 服务端

- `/api/v1/agent/capabilities` 发现业务路径，`/api/v1/agent/{业务路径}` 复用原有业务校验和处理逻辑。
- `AgentSession.commit()` 在预览及批内处理时仅 flush，预览结束 rollback。合并协调器最后一次提交数据库事务。
- `AgentChange` 保存加密操作、脱敏前后预览、相关模块指纹、版本及结果。幂等键按令牌唯一。
- 合并锁定草稿与相关数据，复核指纹。模块中其他数据变化也可能触发保守冲突；不提供强制覆盖。
- 纯数据库批次最多 100 操作，支持 `{{ref.id}}` 等批内引用。预览可能消耗 PostgreSQL 序列，正式 ID 只能读取合并结果。
- 文件、导入导出、外部服务、永久清理单独暂存，预览不执行副作用，批准后才执行。数据库事务无法补偿已发生的文件或远程系统副作用，因此禁止与其他操作混批，不自动重试。
- 上传在 `storage/agent-staging` 保留，合并/拒绝清理；二进制导出结果在 `storage/agent-results` 保存，下载仍需用户会话或原令牌鉴权。
- 草稿审核状态独立保存；撤销令牌会停止该令牌后续请求，已有草稿仍可由用户审核。

新增表迁移：`server/migrations/versions/20261103_e1f2a3b4c5d6_agent_changes.py`。现有本地启动入口使用 `Base.metadata.create_all()` 幂等建表。部署需要有效 `WB_ENCRYPTION_KEY`，否则暂存加密不可用。

## 验证

后端：`cd server && .venv/bin/pytest -q`。
专项：`tests/test_agent_staging.py`、`tests/test_agent_access.py`、`tests/test_table_workspaces.py`。
UI：`cd e2e && node agent-direct.mjs`（或 `npm run agent:direct`）覆盖创建接管 Agent、直接写入、操作记录、详情和撤销。需在 18999 端口启动独立测试服务与一次性 SQLite 数据库，不要指向正式数据运行。旧 `e2e/agent-access.mjs`、`e2e/agent-staging.mjs` 是历史脚本，标签已过时。

给 Agent 的接入说明见 `docs/Agent接入.md`；网页复制和 `/agent/guide` 使用同一份服务端说明。