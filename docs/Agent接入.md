# 工作台 Agent 接入

API 根地址：{{BASE_URL}}/api/v1/agent
请求头：Authorization: Bearer {{TOKEN}}
JSON 请求另加 Content-Type: application/json。无需网页登录或 Cookie。
令牌只能访问专用 Agent 接口，权限只覆盖授予的模块；不能删除数据、改表结构或账号设置。
令牌代表整个个人工作台，读取/写入权限覆盖该模块内所有清单或表格。
把令牌作为机密保存到环境变量，不要写入代码、聊天记录或 Git。
远程调用请优先使用 HTTPS；HTTP 无法加密传输令牌。

## 发现资源
GET /me：确认令牌名称、权限和有效期。
GET /todo-lists：读取待办清单，获取 list_id。
GET /todos?list_id=1：返回 pending、completed 和子任务。
GET /todos/123：读取单条待办（含 version）。
GET /tables：读取表格列表。
GET /tables/1：读取表格和 fields（列 key、类型、选项）。
GET /tables/1/records?page=1&page_size=50：分页读取记录（每页 20/50/100 条）。
GET /records/123：读取单条表格记录及 version。
所有路径都相对于上述 API 根地址。

## 待办
POST /todo-lists  body: {"name":"Agent 任务"}
POST /todos  body: {"list_id":1,"title":"整理完成的分析报告","note":"结果摘要或链接"}
可额外提供 parent_id、due_date（YYYY-MM-DD）、due_time（HH:MM）。
PATCH /todos/123  body: {"version":1,"note":"执行结果已更新"}
PUT /todos/123/completion  body: {"completed":true}
completed=false 恢复未完成；重复提交相同完成状态不会反转状态。
有子任务的父任务由子任务自动决定完成状态，不能直接完成父任务。

## 表格记录
先 GET /tables/1 获取列定义，使用真实 fields[].key，不要用显示列名当 key。
单选/多选使用 options[].id，勾选使用 true/false，日期使用 YYYY-MM-DD。
POST /tables/1/records  body: {"data":{"实际文本列key":"分析报告","实际状态列key":"实际选项id"}}
PATCH /records/123  body: {"version":1,"data":{"实际状态列key":"实际选项id"}}
PATCH 只修改提供的字段，未提供的字段保留；null 表示清空（必填列不能清空）。
创建返回 id、data、version；修改时必须带上刚读取的 version。
待办 PATCH 和表格 PATCH 若返回 409 VERSION_CONFLICT，应重新读取最新值，核对后再修改，不能盲目覆盖。

## 执行工作后的回写流程
1. 查询清单/表格，确认目标待办 ID 或记录 ID，不能凭名称猜测 ID。
2. 执行用户委托的工作，检查结果确实成功。
3. 将结果摘要、产物链接写入待办 note 或相应表格字段。
4. 成功后完成待办，或将表格状态更新为用户指定的选项。
5. 回读确认，并向用户报告修改的 ID 和结果。
请求超时后，创建操作不要直接重试，应先查询确认是否已经创建，避免重复数据。
401 表示令牌无效/过期/撤销；403 表示权限不足；422 表示参数或列值不合法。

## curl 示例
把 WORKBENCH_TOKEN 设置为令牌后执行（不要把占位符直接当作值）：
curl -H "Authorization: Bearer $WORKBENCH_TOKEN" "{{BASE_URL}}/api/v1/agent/todo-lists"
curl -X PUT -H "Authorization: Bearer $WORKBENCH_TOKEN" -H "Content-Type: application/json" \
  -d '{"completed":true}' "{{BASE_URL}}/api/v1/agent/todos/123/completion"

接口结构和参数文档：{{BASE_URL}}/api/docs（Agent 标签）。
