GUIDE = r'''# 工作台 Agent 接入

API 根地址：{{BASE_URL}}/api/v1/agent
请求头：Authorization: Bearer {{TOKEN}}
JSON 请求另加 Content-Type: application/json。无需网页登录或 Cookie。
令牌应存入环境变量，不能写进代码、聊天记录或 Git。远程调用使用 HTTPS。

## 权限与写入模式

令牌有两种写入模式，由用户在设置中分配：
- `review`（默认，兼容旧令牌）：读取立即返回正式数据；创建、修改、删除返回 HTTP 202，状态 pending，只代表已暂存，等待用户合并。
- `direct`（接管模式）：写入立即执行并提交；单条写入直接返回原业务结果（201/200），响应头 `X-Agent-Run-Id` 是本次操作编号；批量 `/changes` 返回 `{run_id,status:"applied",results:[...],undo_status:"available"}`。

`direct` 模式仍会逐条检查权限策略：可限制模块、指定表格、create/update/delete、是否允许改表结构、文件导入导出、外部服务。越权返回 403，错误码以 `AGENT_POLICY_` 开头。
设置页提供四个预设：观察者（只读）、助理（先审核，可新增/修改）、接管者（直接写入，可新增/修改/删除和改表结构，默认禁止文件与外部服务）、自定义。预设只是快速填充，仍可逐项调整。表格白名单只限制写操作；读取仍由模块权限控制，避免 Agent 无法列出表格。
文件、导入导出、翻译、网页元信息抓取、永久清理等不可逆操作在 direct 模式下默认拒绝（409 IRREVERSIBLE_OPERATION）；用户可在策略中显式允许，但这类操作标记为不可自动撤销。

用户可以在「设置 → Agent 接入 → Agent 操作记录」查看每次写入的前后差异并一键撤销；撤销由用户执行，Agent 不能自行撤销。
Agent 可以 GET /runs 查看自己令牌最近 100 次直接写入，GET /runs/{id} 查看详情。
更新类撤销只恢复 Agent 实际改过的字段，并读取撤销时的最新 version；用户之后改动的其他字段会保留。只有 Agent 改过的字段又被用户改过时才返回 409，不会覆盖用户的新修改。新建类撤销会删除 Agent 新建的资源；删除类撤销优先从回收站恢复，书签/看板/视图会重新创建（ID 可能变化）。批量删除记录会逐条从回收站恢复。
当前支持自动撤销：表格记录、表格、字段（新建/修改）、表格视图（新建/修改/删除）、待办及清单、笔记、便利贴、书签、看板（含删除后重建）、表格记录批量删除。字段删除、待办排序、打卡/工作目标等暂不支持，会在操作详情里标记原因。

新建令牌默认拥有 all:read（全部业务读取）和 all:stage（全部业务变更）；旧版模块令牌仍支持原有模块。
账号登录/密码、令牌管理和暂存审批/撤销由用户操作，不提供 Agent 自我授权接口。

**review 模式不要将 202 宣称为已写入。** direct 模式成功后才可报告已写入，并附上 run_id。
用户在「设置 → Agent 接入 → Agent 暂存区」审核 review 模式的变更；在「Agent 操作记录」撤销 direct 模式的写入。

## 发现完整接口

GET /me：确认权限、有效期、write_mode（review/direct）、policy 和 requires_user_merge。
GET /capabilities：列出当前版本全部业务路径和方法、策略和批量接口。
普通网页业务接口 /api/v1/notes 对应 Agent 接口 /api/v1/agent/notes，其余业务相同。
请求参数和资源结构见 {{BASE_URL}}/api/docs 中各业务标签；路径前加入 /agent 即可。
GET /changes：最近 100 份本令牌暂存的摘要。
GET /runs：最近 100 次直接写入；GET /runs/123：查看预览、状态和结果。
GET /changes/123：查看 review 模式的预览、状态和正式合并结果。

例：GET /tables、GET /tables/1、GET /tables/1/records?page=1&page_size=100。
GET /todos/123、GET /records/123 返回 version；GET /memos、/notes、/dashboards、/work-targets 等读取对应业务。
读取分页请遵循接口 page/page_size，不能假定第一页包含全部数据。
POST /dashboards/preview 只计算图表预览，直接返回结果；review 模式下其他写方法均暂存，direct 模式下直接执行。

## 单项写入

review 模式下以下请求返回 202 暂存；direct 模式下直接执行并返回业务结果（带 X-Agent-Run-Id）。

POST /todo-lists body: {"name":"Agent 任务"}
POST /todos body: {"list_id":1,"title":"整理报告","note":"执行结果摘要"}
PATCH /todos/123 body: {"version":1,"note":"更新摘要"}
PUT /todos/123/completion body: {"completed":true}（false 恢复未完成）
DELETE /todos/123：review 模式暂存删除，合并前待办仍然存在；direct 模式立即删除并进回收站，可由用户撤销。
POST /tables/1/records body: {"data":{"实际字段key":"内容"}}
PATCH /records/123 body: {"version":1,"data":{"实际字段key":"更新内容"}}
表格 PATCH 只更新提供的字段；null 清空；PUT 遵循原业务整体更新约定。
修改待办和表格记录必须提供刚读取的 version，其他有版本的资源也应遵循原接口约定。
表格使用 fields[].key，单选/多选使用 options[].id，日期 YYYY-MM-DD，勾选 true/false。
可添加 Idempotency-Key 请求头；超时重试相同键和内容会返回同一份暂存或同一个 run，内容变化需新键。

## 有依赖的批量变更

`review` 模式 POST /changes 返回 202 并生成一份待审核暂存；`direct` 模式直接在一个事务内执行并返回 200。
最多包含 100 项纯数据库操作，同批会一起提交；任意一步失败，数据库变更全部回滚。
请求示例：
```json
{
  "title":"创建销售表并写入首条记录",
  "request_key":"sales-setup-001",
  "operations":[
    {"ref":"table","method":"POST","path":"/tables","body":{"name":"销售记录","fields":[{"name":"金额","type":"number"}]}},
    {"ref":"record","method":"POST","path":"/tables/{{table.id}}/records","body":{"data":{"{{table.fields.0.key}}":"123.45"}}}
  ]
}
```
ref 可引用之前操作的响应属性和数组位置；整项引用保留原类型，嵌入路径时转换成字符串。
批内可按顺序修改已有对象，后续 version 应引用上一步结果。
不同暂存之间应等待前一份合并后再引用其正式 ID。

## 文件及外部服务

文件上传、导入导出、翻译调用、书签网页元信息抓取、永久清理等属于不可逆操作。
review 模式会单独暂存，暂存阶段不会调用外部服务或执行正式文件变更，页面会显示「合并时执行」。
direct 模式默认拒绝这些操作（409 IRREVERSIBLE_OPERATION）；除非用户明确允许，否则应拆成 review 模式的单份暂存。
上传 multipart/form-data（file 字段），二进制内容仅放入暂存目录；拒绝会清理。
它们不支持与其他操作组成同份批次，文件/外部系统副作用不能像数据库事务一样回滚。
合并后的二进制导出结果可用 results[].agent_download_url 携带当前令牌下载；普通导出任务用对应 Agent 下载接口。

## 冲突、错误与正确回报

review 模式提交后相关模块数据若被改变，合并返回 409，不会强行覆盖。
direct 模式在事务提交前检查 version，冲突同样返回 409，不会部分写入。
用户可重新预览并核对；旧 version 已失效时需 Agent 读取最新数据、核对后重新提交，不能盲目覆盖。
单次请求最多 20 MB，单次最多 100 个操作；文件上限以服务配置为准，每人最多 2000 份待审核暂存。
401 令牌无效/过期/撤销；403 权限不足、策略限制或保留接口；404 接口/资源不存在；409 版本/数据/幂等/不可撤销冲突；422 参数错误。
review 模式执行结果应回报「已提交暂存 #编号，等待你在设置里合并」；轮询到 applied 后再回读正式数据并报告成功。
direct 模式执行结果应回报「已写入，操作编号 #run_id」；如需撤销，请用户在设置中操作，Agent 不应自行回滚。
用户拒绝或撤销后，不应自动重新提交或通过网页登录执行同一修改。
## 搜索与后台任务

GET /search?q=关键词 跨模块搜索，全部模式每类最多 20 条，total_is_exact=false；选择 kind=notes/memos/todos/bookmarks/tables/records 可分页并获取精确 total。表格记录搜索原始值，不匹配内部字段 UUID。
GET /tasks 和 /tasks/{id} 查看本人后台任务。导出可 POST /tables/{id}/export-tasks，导入确认可 POST /imports/{id}/confirm-tasks；它们仍先生成暂存。用户合并只表示任务已入队，必须再查询任务到 completed，才可报告导入/导出成功。任务取消、重试也先暂存。备份、恢复密钥和账号审批接口不向 Agent 开放。

用户拆分批次后，原暂存状态为 split，related_change_ids 列出子暂存。split 不代表任何操作已执行；应分别查询各子暂存的最终状态，不能将原请求视为全部成功。
'''
