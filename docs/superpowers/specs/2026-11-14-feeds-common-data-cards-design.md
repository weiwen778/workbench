# 信息聚合·常用信息源数据化设计

> 已废止：用户随后要求改为“日历 + 数据栏”的一页 5 区块布局，见 `2026-11-14-feeds-calendar-dashboard-design.md`。本文保留数据源调研结论。

日期：2026-11-14
状态：待批准

## 背景

`/feeds?tab=sources` 现在是一个静态入口目录：6 个卡片只有标题、说明和“打开网站”，页面还明确写着“常用信息源只提供官方入口……需要登录的页面在浏览器中打开”。用户的原话是：

> 这里的数据也要我一个个打开来看，不是直接展示出来给我看的，那我都点开了，我还需要你干嘛呢？

这不是抓取或渲染 bug，而是产品定位问题：它叫“信息聚合”，但没有替用户聚合任何信息。本次把公开可取的源改成卡片内直接展示条目；取不到的源明确标注原因，保留入口。

## 目标

- Alibaba 国际站规则中心、1688 规则中心、RunSignup 加州赛事、美国节日四个源，在卡片内直接显示最近 5–10 条（标题 + 时间/分类/地点），点条目进原文。
- 每个数据卡片显示更新时间、刷新状态和手动刷新按钮；失败时保留上次成功数据。
- 抓取、缓存、退避、SSRF 校验复用现有热榜/订阅的基础设施，不另造一套。
- RunSignup 用“加州 + 未来 30 天”作为默认范围；不展示默认首页那批同日期、已过期的推广位。

## 非目标

- 不抓 TEMU 卖家中心登录后的公告、半托管和活动数据；不保存用户 Cookie。
- 不为 Pinterest 增加代理；服务器当前到 `pinterest.com` 全部超时，卡片保留入口并标注“服务器不可达”。
- 不做全文阅读器，不抓文章正文。
- 不在本次修改热榜和订阅页的截断/分页问题；那是独立项目，另开设计。

## 约束

- 出站请求统一走 `server/app/services/public_http.py`：只连已校验 IP、12s 超时、2MB 上限、每次重定向重新校验。
- `fetch_public` 支持自定义 headers，可以带 `Cookie`；但现在的 `_read_headers` 用 dict 存响应头，重复的 `Set-Cookie` 只会留下最后一个。1688 的 token 握手需要同时拿到 `_m_h5_tk`（签名用）和 `_m_h5_tk_enc`，因此要给 `PublicResponse` 增加 `set_cookies: list[str]`（用 `response.headers.get_all("Set-Cookie")` 读取）并补单测。这是本次唯一需要改 `public_http` 的地方。
- 1688 mtop 接口无官方文档，需要先取 `_m_h5_tk`，再按 `md5(token&t&appKey&data)` 签名；平台改版会失效，必须能降级。
- `timeanddate.com` 对服务器和浏览器都返回 Cloudflare 403，不能抓；美国节日改为本地计算。
- RunSignup 公开赛事页 `GET /Races?state=CA&start_date={today}&end_date={today+30d}` 服务端渲染，可直接解析；页面有 `X-Frame-Options: SAMEORIGIN`，不能 iframe。默认首页 `/Races` 的网格是推广位，不能作为数据源；带 `state`+日期参数后才是真实赛事列表。
- 前端 React + MUI，后端 FastAPI + SQLAlchemy；测试用 pytest。

## 方案

### A. 服务端 adapter 聚合公开数据（已选）

每个源一个 adapter：请求、解析、归一化、缓存。公开数据直接进卡片；登录源和不可达源保留入口并显示原因。

- 改动集中在后端 adapter + 一个前端面板，风险可控。
- 4 个源里 3 个可抓、1 个本地算；当天能看到效果。

### B. 服务端无头浏览器

能渲染 JS 页面、绕过部分 DOM 变化，但需要常驻 Chromium，内存和维护成本高；Pinterest 仍然需要代理，TEMU 仍然需要登录。不适合当前这个轻量工作台。

### C. 浏览器扩展 / 凭据托管

用用户自己的登录态抓 TEMU 卖家后台，覆盖最全；但涉及账号安全、Cookie 存储和平台条款，应该单独立项，不混进这次。

结论：选 A。

## 设计

### 数据存储

复用 `feed_snapshots` 表，`source_id` 使用 `common:<key>` 命名空间，例如 `common:alibaba-rules`。`entries` 存归一化后的条目 JSON；`last_success_at`、`last_error`、`error_code`、`consecutive_failures`、`next_attempt_at`、`locked_until`、`etag` 直接复用。

理由：这张表已经有刷新锁、退避、状态和 JSON 快照，新增一张同构表只会复制逻辑。

### 条目结构

```json
{
  "title": "关于《1688平台服务商流量分发规则》变更的公告",
  "url": "https://rule.1688.com/?type=detail&ruleId=20010941&cId=3044#/rule/detail?ruleId=20010941&cId=3044",
  "published_at": "2026-09-28T17:56:08+08:00",
  "badge": "更新公示",
  "summary": ""
}
```

- `title`、`url` 必填；`published_at` 可空；`badge` 用于分类/地点/距离；`summary` 只在源提供时填。

### Adapter 清单

新增 `server/app/services/common_sources.py`，用 registry 管理：

```python
COMMON_ADAPTERS = {
    "alibaba-rules": {"fetch": fetch_alibaba_rules, "interval": 3600},
    "1688-rules": {"fetch": fetch_1688_rules, "interval": 3600},
    "runsignup": {"fetch": fetch_runsignup_races, "interval": 21600},
    "us-holidays": {"fetch": compute_us_holidays, "interval": 86400},
}
```

**Alibaba 国际站规则中心**

- `GET https://rulechannel.alibaba.com/rulechannel/newrule/rule/latest?terminal=PC&pageIndex=1&pageSize=10&language=zh_CN`
- 用 `/latest`，不要用 `/list`：`/list` 不按时间排序（实测首条 2022、末条 2026-11-13）；`/latest` 返回的 10 条按 `modifiedTime` 倒序，首条 2026-11-06。
- 实测带 `language=zh_CN` 返回中文标题（如“禁止向欧盟和英国销售食品仿制品规则的公告”），因此不需要额外翻译。
- 返回 `model[]`，取 `ruleTitle`、`ruleId`、`modifiedTime`（epoch 毫秒，转 ISO）、`category.categoryName`。
- 详情链接：`https://rule.alibaba.com/rule/detail/{ruleId}.htm`。
- 无需登录、无需签名。

**1688 规则中心**

- 先 `GET https://h5api.m.taobao.com/h5/mtop.alibaba.rulechannel.newrule.rule.list/1.0/?jsv=2.7.5&appKey=12574478`，从 `Set-Cookie` 取 `_m_h5_tk`（格式 `xxx_xxx`，签名只用下划线前的 token）。
- 再请求同一接口，参数：`jsv=2.7.5&appKey=12574478&t={ms}&sign={md5(token&t&appKey&data)}&data={json}`，其中 `json` 必须包含：
  `{"pageIndex":1,"pageSize":10,"lastCategoryId":null,"parentCategoryId":null,"identityCode":"4","terminal":"PC","buCode":333}`。
- 实测这组参数返回 SUCCESS 和真实规则；缺 `identityCode` 会报 `FAIL_SYS_BIZPARAM_MISSED`，缺其他字段可能 `total:0`。参数原样写进代码和 fixture，不要“简化”。
- 取 `ruleTitle`、`ruleId`、`modifiedTime`、`lastCategoryName`、`lastCategoryId`。
- 详情链接：`https://rule.1688.com/?type=detail&ruleId={ruleId}&cId={lastCategoryId}#/rule/detail?ruleId={ruleId}&cId={lastCategoryId}`。
- 签名逻辑独立成函数并加测试；请求失败、风控、`total:0` 都按失败处理，卡片降级为“打开官网”，不影响其他源。

**RunSignup 加州赛事**

- 默认页 `/Races` 是推广位：27 个卡片同一日期 `Sun 11/1/26`，多数 Virtual Event 且已过期，不能直接用。
- 数据卡用带筛选参数的搜索页：`GET https://runsignup.com/Races?state=CA&start_date={today}&end_date={today+30d}`。实测返回真实加州赛事（Sacramento、Long Beach、Avalon、Fremont、San Diego 等），日期从 11/14 起分布。
- 服务端渲染的 HTML 里，每条是 `a.rsuTileGrid__item--findRace`，内部依次是标题（`.fs-md-2`）、日期（`Sat 11/14/26`）、地点（`Avalon, CA`）、距离标签（`3.1 Miles` 等）。用 BeautifulSoup 解析。
- 页面顶部仍可能混入 1–2 条开始日期早于 `start_date` 的推广位（如 `Sun 11/1/26`）；解析后按日期过滤掉 `< today` 和 `> today+30d` 的条目，再按日期升序取前 10。
- 条目 `title` 用赛事名，`published_at` 用比赛日期（当天 00:00 本地时区），`badge` 用 `城市, CA`，`summary` 用距离拼接（如 `3.1 Miles / 6.2 Miles`）。
- 详情链接用赛事页 URL，去掉 `utm_source` 等跟踪参数。
- 默认范围固定为加州 + 未来 30 天；不在 UI 里做筛选器，后续要其他州再加配置。

**美国节日**

- 不抓 `timeanddate`，在本地按规则计算未来 12 个月的 11 个美国联邦假日，取最近 10 条。
- v1 只做联邦假日，不做“常见 observance”（来源和范围都没有权威口径，容易做成拍脑袋列表）。
- observed 日期只作为该条目的显示日期，不额外生成第二行；例如独立日 7 月 4 日是周六时，条目显示 7 月 3 日（observed），标题仍为“独立日”。
- 条目链接指向 `timeanddate` 对应节日页，仅作为“查看详情”入口。
- 固定规则：元旦、马丁·路德·金日、总统日、阵亡将士纪念日、六月节、独立日、劳动节、哥伦布日、退伍军人节、感恩节、圣诞节。

### 刷新与状态

- `refresh_common_source(key)` 对齐 `refresh_hot_source`：`_claim_snapshot` 加锁 → fetch → `_record_hot_success` / `_record_hot_failure`。
- `refresh_due_common()` 在 `refresh_loop` 里按各自的 `next_attempt_at` 巡检；间隔 1h / 1h / 24h。
- 手动刷新 `POST /feeds/common/{key}/refresh` 用 BackgroundTasks 触发，并真正加最小区间：读取 `last_attempt_at`，距上次不足 60 秒直接返回 `{"queued": false, "reason": "cooldown"}`，不重复打源。现有热榜只有进程内 `_reserve` 去重，没有这个冷却，不能写成“沿用”。
- **成功但 0 条按失败处理**：解析成功但 `entries == []` 时，调用失败记录（`error_code="EMPTY_PAYLOAD"`、`last_error="来源返回空数据"`），保留上次成功快照，状态 `stale`；不要用 `_record_hot_success` 把 `entries` 覆盖成 `[]`。节日计算天然不会为空，这条主要保护 Alibaba/1688 接口改版。
- 失败保留上次成功快照，状态变为 `stale`；没有历史数据时状态为 `error`。
- 不做标题翻译：Alibaba 用 `language=zh_CN`，1688 本身中文，节日是本地中文；RunSignup 赛事名保留英文（赛事名属于专有名词，机翻容易失真），只把日期/城市/距离用中文展示。若以后要翻，复用 `feed_translation`。

### API

`GET /feeds/common` 在现有 `groups` 基础上，为每个 item 增加：

```json
{
  "key": "alibaba-rules",
  "title": "阿里国际站规则中心",
  "platform": "Alibaba.com",
  "url": "https://rulechannel.alibaba.com/icbu",
  "note": "商品发布、交易履约、活动规则与平台公告。",
  "data_kind": "rules",
  "status": "ok",
  "entries": [],
  "last_success_at": "2026-11-14T12:00:00Z",
  "last_error": ""
}
```

- `status`：`idle | refreshing | ok | stale | error`，直接复用 `_source_status`；0 条按失败处理，所以不会出现“成功但空”的 `empty` 状态。
- `entries` 最多返回 10 条；前端默认展示 5 条，可展开。
- 备注文案改为：“公开数据自动刷新；需要登录的入口在浏览器打开。”

`POST /feeds/common/{key}/refresh` 返回 `202 {"queued": true}`；未知 key 返回 404。

### 前端

`web-react/src/feeds/CommonPanel.tsx` 改为数据卡片：

- 卡片头部：标题、平台 chip、状态 chip（已更新 / 更新中 / 更新失败 / 需登录 / 不可达）、相对更新时间、刷新图标。
- 卡片正文：条目列表，每行标题 + 时间/分类；点击在新标签打开原文。
- 卡片底部：“查看全部”打开源站首页；“刷新”触发单源刷新。
- TEMU：`data_kind: "link"`，显示“需登录”chip，保留“打开网站”。
- Pinterest：`data_kind: "link"`，显示“服务器不可达”chip，保留“打开网站”；用户浏览器能打开时仍可用。
- RunSignup：`data_kind: "events"`，显示“加州 · 未来 30 天”说明，条目显示赛事名、日期、城市、距离。
- 空态：有历史数据但刷新失败时显示旧数据 + “更新失败”chip；无历史数据时显示原因和“重试”。

### 测试

- `server/tests/test_common_sources.py`：
  - Alibaba `/latest` JSON fixture：断言取 `ruleTitle`、`modifiedTime` 毫秒转 ISO、详情 URL、中文标题。
  - 1688 mtop fixture + 签名函数单测（固定 token/t/data，断言 md5）；fixture 的 `data` 必须包含 `identityCode`、`buCode` 等完整字段，防止以后被“简化”坏。
  - 1688 `Set-Cookie` 两条时 `set_cookies` 能同时拿到 `_m_h5_tk` 和 `_m_h5_tk_enc`。
  - RunSignup HTML fixture：解析标题/日期/城市/距离；断言过滤掉早于 `start_date` 的推广位，且最多 10 条、按日期升序。
  - 美国节日计算：固定日期断言（含 observed 落在 7 月 3 日的情况），并断言只输出 11 个联邦假日。
- `server/tests/test_feeds.py` 增补：
  - `GET /feeds/common` 返回 entries/status。
  - `POST /feeds/common/{key}/refresh` 未知 key、成功入队、60 秒内重复请求返回 cooldown。
  - 成功解析 0 条时保留旧 entries、状态变 `stale`。
- 前端不新增 E2E；复用现有 `/feeds` 页面手工验收。

### 配置与回滚

- 新增 `feed_common_enabled`（默认 true）；关闭后只显示入口，不拉数据。
- 单源失败只影响该卡片；日志记录 `source=common:<key>`、状态、耗时。
- 不改数据库结构，回滚无需迁移。

## 风险

- 1688 mtop 签名/风控变化：适配层隔离，失败降级为入口；测试覆盖签名，不覆盖线上风控。
- Alibaba 接口无公开文档：同上。
- RunSignup DOM 结构变化：用 `rsuTileGrid__item--findRace` 和内部 div 顺序解析，fixture 覆盖；解析失败降级为入口。推广位过滤依赖“日期早于 start_date”这一条，若页面结构大改，宁可显示空并降级，也不要展示过期赛事。
- 抓取频率：1h/1h/6h/24h，避免对源站造成压力。

## 已做的决定（可改）

- RunSignup 做数据卡，固定“加州 + 未来 30 天”，解析搜索页并过滤推广位；不做前端筛选器。
- Alibaba 用 `/latest` + `language=zh_CN`，只取最新 10 条，不做分类页签。
- 1688 用实测通过的完整 mtop 参数，只取最新 10 条；失败/空数据降级为入口。
- 节日只做 11 个美国联邦假日，observed 只作为显示日期，不做常见 observance。
- 成功但 0 条按失败处理，保留旧快照。
- 手动刷新加 60 秒最小区间。
- 不自动翻译标题。
- TEMU 忽略登录态数据，只保留“打开官网”；Pinterest 保留入口，不加代理。

## 确认结果

- RunSignup：做数据卡，默认“加州 + 未来 30 天”。
- TEMU：忽略登录后的公告/活动，只保留入口。
- 无剩余待确认项。
