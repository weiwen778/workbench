# Agent 全业务暂存

令牌开放全部业务读取与暂存；所有 POST/PUT/PATCH/DELETE 默认返回 202 pending，正式数据只在用户合并时提交。仅图表计算预览为无写入的直接 POST。

## 页面

设置 → Agent 接入 → Agent 暂存区：待审核 / 已合并 / 已拒绝，查看前后内容、重新预览、合并、拒绝。合并和拒绝都要求网页登录、CSRF 和当前草稿 version，拒绝附带 Bearer 的审批请求。令牌只能查看自己提交的草稿，不能管理令牌、账号密码或审核草稿。

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
UI：`e2e/agent-staging.mjs` 使用 18182 端口的独立测试服务及测试账号，覆盖设置预览、人工合并、拒绝、默认权限及手机尺寸；不要指向正式数据运行该测试。

给 Agent 的接入说明见 `docs/Agent接入.md`；网页复制和 `/agent/guide` 使用同一份服务端说明。