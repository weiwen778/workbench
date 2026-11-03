GUIDE = r'''# 工作台 Agent 接入

API 根地址：{{BASE_URL}}/api/v1/agent
请求头：Authorization: Bearer {{TOKEN}}
JSON 请求另加 Content-Type: application/json。无需网页登录或 Cookie。
令牌应存入环境变量，不能写进代码、聊天记录或 Git。远程调用使用 HTTPS。

## 权限与正式数据

新建令牌默认拥有 all:read（全部业务读取）和 all:stage（全部业务变更暂存）。
覆盖打卡、社媒账号、待办、表格和字段、工作簿、视图、笔记、便利贴、书签、看板、翻译、文件、导入导出、回收站和个人偏好。
账号登录/密码、令牌管理和暂存审批由用户操作，不提供 Agent 自我授权或自行合并的接口。
旧版模块令牌仍支持原有模块；写操作同样先暂存。有效旧令牌可由部署管理员按用户授权升级到全部业务权限。

读取立即返回正式数据；创建、修改、删除返回 HTTP 202，状态 pending，只代表已暂存。
**不要将 202 宣称为已写入、已创建或已完成，也不要用浏览器绕过暂存直接修改正式数据。**
用户在「设置 → Agent 接入 → Agent 暂存区」查看修改前后、合并或拒绝。
只有状态 applied 才表示已合并；新建 ID 以 results 为准，预览 ID 是临时值。
Agent 可以查询自己令牌提交的暂存，不能审批。

## 发现完整接口

GET /me：确认权限、有效期、write_mode=staged、requires_user_merge=true。
GET /capabilities：列出当前版本全部业务路径和方法。
普通网页业务接口 /api/v1/notes 对应 Agent 接口 /api/v1/agent/notes，其余业务相同。
请求参数和资源结构见 {{BASE_URL}}/api/docs 中各业务标签；路径前加入 /agent 即可。
GET /changes：最近 100 份本令牌暂存的摘要。
GET /changes/123：查看预览、状态和正式合并结果。

例：GET /tables、GET /tables/1、GET /tables/1/records?page=1&page_size=100。
GET /todos/123、GET /records/123 返回 version；GET /memos、/notes、/dashboards、/work-targets 等读取对应业务。
读取分页请遵循接口 page/page_size，不能假定第一页包含全部数据。
POST /dashboards/preview 只计算图表预览，直接返回结果；其他写方法均暂存。

## 单项暂存

POST /todo-lists body: {"name":"Agent 任务"}
POST /todos body: {"list_id":1,"title":"整理报告","note":"执行结果摘要"}
PATCH /todos/123 body: {"version":1,"note":"更新摘要"}
PUT /todos/123/completion body: {"completed":true}（false 恢复未完成）
DELETE /todos/123：暂存删除，合并前待办仍然存在。
POST /tables/1/records body: {"data":{"实际字段key":"内容"}}
PATCH /records/123 body: {"version":1,"data":{"实际字段key":"更新内容"}}
表格 PATCH 只更新提供的字段；null 清空；PUT 遵循原业务整体更新约定。
修改待办和表格记录必须提供刚读取的 version，其他有版本的资源也应遵循原接口约定。
表格使用 fields[].key，单选/多选使用 options[].id，日期 YYYY-MM-DD，勾选 true/false。
可添加 Idempotency-Key 请求头；超时重试相同键和内容会返回同一份暂存，内容变化需新键。

## 有依赖的批量变更

POST /changes 最多包含 100 项纯数据库操作，同份暂存会一起合并；任意一步失败，数据库变更全部回滚。
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

文件上传、导入导出、翻译调用、书签网页元信息抓取、永久清理等单独提交一份暂存。
暂存阶段不会调用外部服务或执行正式文件变更，页面会显示「合并时执行」。
上传 multipart/form-data（file 字段），二进制内容仅放入暂存目录；拒绝会清理。
它们不支持与其他操作组成同份批次，文件/外部系统副作用不能像数据库事务一样回滚。
合并后的二进制导出结果可用 results[].agent_download_url 携带当前令牌下载；普通导出任务用对应 Agent 下载接口。

## 冲突、错误与正确回报

提交后相关模块数据若被改变，合并返回 409，不会强行覆盖。
用户可重新预览并核对；旧 version 已失效时需 Agent 读取最新数据、核对后重新提交，不能盲目覆盖。
单份暂存最多 20 MB，文件上限以服务配置为准，每人最多 2000 份待审核暂存。
401 令牌无效/过期/撤销；403 权限不足或保留接口；404 接口/资源不存在；409 版本/数据/幂等冲突；422 参数错误。
执行结果应回报「已提交暂存 #编号，等待你在设置里合并」。轮询到 applied 后再回读正式数据并报告成功。
用户拒绝后，不应自动重新提交或通过网页登录执行同一修改。
## 搜索与后台任务

GET /search?q=关键词 跨模块搜索，全部模式每类最多 20 条，total_is_exact=false；选择 kind=notes/memos/todos/bookmarks/tables/records 可分页并获取精确 total。表格记录搜索原始值，不匹配内部字段 UUID。
GET /tasks 和 /tasks/{id} 查看本人后台任务。导出可 POST /tables/{id}/export-tasks，导入确认可 POST /imports/{id}/confirm-tasks；它们仍先生成暂存。用户合并只表示任务已入队，必须再查询任务到 completed，才可报告导入/导出成功。任务取消、重试也先暂存。备份、恢复密钥和账号审批接口不向 Agent 开放。

用户拆分批次后，原暂存状态为 split，related_change_ids 列出子暂存。split 不代表任何操作已执行；应分别查询各子暂存的最终状态，不能将原请求视为全部成功。
'''
