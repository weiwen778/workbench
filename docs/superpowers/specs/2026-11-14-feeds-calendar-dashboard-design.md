# 信息聚合·日历与数据栏设计

日期：2026-11-14

状态：已批准（2026-11-14）

## 背景

用户对 `/feeds` 的第三页签“常用信息源”不满意：它只是 6 个静态入口，数据要一个个点开；用户要的是直接看到内容，并且明确提出：

> 日历里只放赛事 + 节日
> 订阅文章、平台规则更新放到数据栏
> 先默认全部国家后面不行再单独处理
> 这里不要全部整合到 1 页

用户手绘的布局是一页 **5 个区块**，不是 5 个页面：

```
┌───────────────────────────────┬───────────────────┐
│                               │                   │
│          日历（大）            │    数据 1（大）    │
│      赛事 + 美国节日           │    订阅文章        │
│                               │                   │
├───────────────┬───────────────┼───────────────────┤
│    数据 2      │    数据 3      │     数据 4（宽）   │
│  Alibaba 规则  │  1688 规则     │  其他平台入口/动态  │
└───────────────┴───────────────┴───────────────────┘
```

本次把“常用信息源”页签改造成这个“日历 + 数据栏”页面；热榜、我的订阅保持现有页面不改。三个页签仍然存在，但日历不再和热榜挤在同一屏。

旧设计 `2026-11-14-feeds-common-data-cards-design.md` 的“6 个数据卡片”方向已被本设计取代；其中的 Alibaba、1688、RunSignup、节日调研结论继续复用。

## 目标

- 日历页左上大区块是月历，只显示 RunSignup 赛事和美国节日；赛事默认覆盖**全部国家**。
- 右上大区块显示订阅文章，默认最新 30 条，未读优先，点标题打开原文。
- 左下、中下分别显示 Alibaba 国际站规则、1688 规则的最新 10 条。
- 右下宽区块显示 TEMU、Pinterest、RunSignup 官网等入口，以及“刷新全部”。
- 每个数据区块独立显示更新时间、状态和刷新按钮；失败保留上次成功数据。
- 复用现有热榜/订阅的快照、锁、退避、SSRF 基础设施，不另造一套。

## 非目标

- 不做 5 个独立页面；本次是一页 5 个区块。
- 不抓 TEMU 登录后的公告/活动，不保存用户 Cookie。
- 不为 Pinterest 增加代理；服务器到 `pinterest.com` 仍然超时，只保留入口并标注原因。
- 不做全文阅读器；订阅文章点标题跳原站。
- 不修改热榜和订阅页已有的截断/分页逻辑。
- 不在日历里放热榜、订阅文章、平台规则；它们属于数据栏。

## 页面结构

- 顶部仍是三个页签：`热榜`、`我的订阅`、`日历`（由“常用信息源”改名）。
- 日历页使用 5 区块网格；窄屏按“日历 → 数据1 → 数据2 → 数据3 → 数据4”纵向堆叠。
- 不把热榜的三列和日历放进同一屏；热榜页保持现状。

## 数据源

### RunSignup 全球赛事

- RunSignup 的搜索页一次只能查一个国家：`GET https://runsignup.com/Races?country={ISO2}&start_date={today}&end_date={today+90d}`。
- 实测 `country=US` 不带州时只返回同一日期的推广位，必须按州查询：`GET ...?country=US&state={US_STATE}&start_date=...`。因此 US 展开成 50 州 + DC 共 51 次查询；其他国家仍按国家查询。
- 默认国家集合为 **ISO 3166-1 alpha-2 全量列表**，与 RunSignup 表单的 country 选项一致；用配置 `feed_runsignup_countries` 覆盖，默认 `all`。用户明确要求先默认全部国家，后续不够用再单独处理。
- 全量约 250 个国家/地区 + 51 个美国州，用 `ThreadPoolExecutor` 并发，默认 8 个 worker，单请求 12s 超时、2MB 上限。首轮同步可能持续数分钟，页面先显示已有数据 + “同步中”，完成后自动刷新。
- US 的成功州结果合并后替换美国旧条目；失败州只记日志并只把 US 计一次失败。只有当全部 51 个州都失败时才保留美国旧条目。其他国家按国家独立成功/失败。
- 解析服务端渲染 HTML：每条是 `a.rsuTileGrid__item--findRace`，内部依次是标题（`.fs-md-2`）、日期（`Sat 11/14/26`）、地点（`Avalon, CA`）、距离（`3.1 Miles`）。
- 页面顶部可能混入早于 `start_date` 的推广位；解析后按日期过滤，只保留 `today <= date <= today+90d`。
- 每个国家最多取搜索页返回的前 30 条；合并所有国家后按日期升序。
- 日期按赛事当地日期处理，只存 `date`（`YYYY-MM-DD`），不做时区换算，避免跨时区显示成前一天。
- 条目字段：`date`、`title`、`url`、`country`、`city`、`distance`。`country` 用于按国家合并和失败保留。
- 合并策略：
  - 某国成功：用新结果替换该国旧条目；成功但 0 条表示该国确实没有未来 90 天赛事，清空该国旧条目。
  - 某国失败：保留该国上一次成功条目，不因单国失败丢掉整月数据。
  - 全部国家失败：整源按失败记录，保留旧快照。
  - 部分国家失败：整源仍算成功，日志记录失败国家数；v1 不单独做“部分失败”状态，避免增加状态机。
- 详情链接用赛事页 URL，去掉 `utm_source` 等跟踪参数。
- 配置：`feed_runsignup_countries=all`、`feed_runsignup_concurrency=8`、`feed_runsignup_interval_seconds=21600`、`feed_runsignup_window_days=90`。

### 美国节日

- 不抓 `timeanddate`（Cloudflare 403），在本地按规则计算。
- v1 只做 11 个美国联邦假日：元旦、马丁·路德·金日、总统日、阵亡将士纪念日、六月节、独立日、劳动节、哥伦布日、退伍军人节、感恩节、圣诞节。
- observed 日期只作为显示日期，一条记录；例如独立日 7 月 4 日是周六时显示 7 月 3 日，标题仍是“独立日”。
- 节日按请求的日期范围实时计算，不落快照；链接指向 `timeanddate` 对应节日页，仅作为详情入口。
- 节日条目字段：`date`、`title`、`url`、`kind="holiday"`；赛事 `kind="race"`。

### Alibaba 国际站规则

- `GET https://rulechannel.alibaba.com/rulechannel/newrule/rule/latest?terminal=PC&pageIndex=1&pageSize=10&language=zh_CN`
- 用 `/latest`，不要用 `/list`：`/list` 不按时间排序（实测首条 2022、末条 2026-11-13）；`/latest` 按 `modifiedTime` 倒序，首条 2026-11-06。
- 带 `language=zh_CN` 返回中文标题，不需要额外翻译。
- 取 `ruleTitle`、`ruleId`、`modifiedTime`（epoch 毫秒，转 ISO）、`category.categoryName`。
- 详情链接：`https://rule.alibaba.com/rule/detail/{ruleId}.htm`。
- 无需登录、无需签名。

### 1688 规则

- 先 `GET https://h5api.m.taobao.com/h5/mtop.alibaba.rulechannel.newrule.rule.list/1.0/?jsv=2.7.5&appKey=12574478`，从 `Set-Cookie` 同时取 `_m_h5_tk`（格式 `xxx_xxx`，签名只用下划线前的 token）和 `_m_h5_tk_enc`；第二次请求必须带这两个 Cookie。
- 再请求同一接口，参数：`jsv=2.7.5&appKey=12574478&t={ms}&sign={md5(token&t&appKey&data)}&data={json}`，其中 `json` 必须包含：
  `{"pageIndex":1,"pageSize":10,"lastCategoryId":null,"parentCategoryId":null,"identityCode":"4","terminal":"PC","buCode":333}`。
- 实测这组参数返回 SUCCESS 和真实规则；缺 `identityCode` 会报 `FAIL_SYS_BIZPARAM_MISSED`，缺其他字段可能 `total:0`。参数原样写进代码和 fixture，不要“简化”。
- 取 `ruleTitle`、`ruleId`、`modifiedTime`、`lastCategoryName`、`lastCategoryId`。
- 详情链接：`https://rule.1688.com/?type=detail&ruleId={ruleId}&cId={lastCategoryId}#/rule/detail?ruleId={ruleId}&cId={lastCategoryId}`。
- 签名逻辑独立成函数并加测试；请求失败、风控、`total:0` 都按失败处理，卡片降级为“打开官网”，不影响其他源。

### 订阅文章

- 直接复用 `feed_entries` 和 `GET /feeds/entries`，不新增抓取。
- 数据 1 取最新 30 条，按 `coalesce(published_at, discovered_at) desc`；未读条目前面加小圆点。
- 每条显示来源订阅名、标题、相对时间；点标题打开原文；“查看全部”跳到“我的订阅”页签。
- 不做翻译；需要翻译时沿用现有订阅页的翻译按钮。

### 其他平台入口（数据 4）

- TEMU 卖家中心：标注“需登录”，只保留“打开网站”。
- Pinterest Trends：标注“服务器不可达”，只保留“打开网站”；用户浏览器能打开时仍可用。
- RunSignup 官网：打开赛事搜索页。
- 底部放“刷新全部”：触发赛事、Alibaba、1688 和订阅刷新。

## 存储

复用 `feed_snapshots`，`source_id` 使用 `common:<key>`：

- `common:runsignup`：全球赛事合并后的条目 JSON；每条带 `country`。
- `common:alibaba-rules`：Alibaba 最新 10 条。
- `common:1688-rules`：1688 最新 10 条。
- 美国节日不落库，按日期范围实时计算。

`last_success_at`、`last_error`、`error_code`、`consecutive_failures`、`next_attempt_at`、`locked_until`、`etag` 直接复用。不新增表、不改数据库结构。

## API

### `GET /feeds/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`

返回日期范围内的赛事和节日：

```json
{
  "start": "2026-11-01",
  "end": "2026-12-15",
  "events": [
    {
      "kind": "race",
      "date": "2026-11-14",
      "title": "Turkey Trot 5K",
      "url": "https://runsignup.com/Race/...",
      "country": "US",
      "city": "Avalon, CA",
      "distance": "3.1 Miles"
    },
    {
      "kind": "holiday",
      "date": "2026-11-26",
      "title": "感恩节",
      "url": "https://www.timeanddate.com/holidays/us/thanksgiving-day"
    }
  ],
  "status": "ok",
  "last_success_at": "2026-11-14T12:00:00Z",
  "last_error": ""
}
```

- 范围最大 62 天，覆盖月历的 6 周网格；超出返回 422。
- `events` 按日期、kind、title 排序。
- 日历页请求当前显示的 42 天范围；切换月份时重新请求。
- 赛事快照只覆盖未来 90 天；范围超出时只返回节日，并给 `race_window_exceeded: true`。

### `GET /feeds/data-panels`

返回数据 1–4 所需的聚合数据：

```json
{
  "subscriptions": {
    "items": [],
    "total": 561,
    "unread": 561
  },
  "rules": [
    {"key": "alibaba-rules", "title": "阿里国际站规则中心", "status": "ok", "entries": [], "last_success_at": "...", "last_error": ""},
    {"key": "1688-rules", "title": "1688 规则中心", "status": "ok", "entries": [], "last_success_at": "...", "last_error": ""}
  ],
  "links": [
    {"key": "temu", "title": "TEMU 卖家中心", "url": "https://seller.kuajingmaihuo.com/", "badge": "需登录"},
    {"key": "pinterest", "title": "Pinterest Trends", "url": "https://trends.pinterest.com/", "badge": "服务器不可达"},
    {"key": "runsignup", "title": "RunSignup 赛事", "url": "https://runsignup.com/Races", "badge": ""}
  ]
}
```

- `subscriptions.items` 最新 30 条，字段复用 `/feeds/entries`。
- `rules[].entries` 最多 10 条，字段为 `title`、`url`、`published_at`、`badge`、`summary`。
- `status` 复用 `_source_status`：`idle | refreshing | ok | stale | error`。

### `POST /feeds/common/{key}/refresh`

- `key`：`runsignup`、`alibaba-rules`、`1688-rules`。
- 202 返回 `{"queued": true}`；未知 key 404。
- 60 秒冷却：读取 `last_attempt_at`，不足 60 秒返回 `{"queued": false, "reason": "cooldown"}`。
- 用 BackgroundTasks 执行，不阻塞请求。

### 复用接口

- `GET /feeds/entries?limit=30`：数据 1。
- `POST /feeds/subscriptions/refresh`：刷新订阅文章。
- `POST /feeds/common/runsignup/refresh`：刷新全球赛事。

## 刷新与状态

- `refresh_common_source(key)` 对齐 `refresh_hot_source`：`_claim_snapshot` 加锁 → fetch → `_record_hot_success` / `_record_hot_failure`。
- `refresh_due_common()` 进 `refresh_loop`，按 `next_attempt_at` 巡检；间隔：RunSignup 6h、Alibaba 1h、1688 1h。
- **成功但 0 条按失败处理**：解析成功但 `entries == []` 时记录失败（`error_code="EMPTY_PAYLOAD"`、`last_error="来源返回空数据"`），保留上次成功快照，状态 `stale`；不要用 `_record_hot_success` 把 `entries` 覆盖成 `[]`。RunSignup 全量 0 条才按失败；单国 0 条只清空该国。
- 失败保留上次成功快照，状态变 `stale`；没有历史数据时状态 `error`。
- 手动刷新 60 秒最小区间；现有热榜只有进程内 `_reserve` 去重，没有这个冷却，不能写成“沿用”。
- 不做标题翻译：Alibaba 用 `language=zh_CN`，1688 本身中文，节日是本地中文；RunSignup 赛事名保留英文（专有名词），只把日期/城市/距离用中文展示。

## 前端

新增 `web-react/src/feeds/CalendarDashboard.tsx`，由 `Feeds.tsx` 的“日历”页签渲染：

- 顶部：月份导航（上月/下月/今天）、同步状态、刷新按钮。
- 左上：`CalendarGrid` 月历，7 列；每个日期格显示日期数字和最多 2 个条目 chip：
  - 赛事 chip：`US · Turkey Trot 5K`，截断；
  - 节日 chip：不同底色，显示节日名；
  - 超过 2 个显示 `+N`，点击打开当天详情抽屉。
- 右上：数据 1 订阅文章列表，未读圆点、来源、相对时间；底部“查看全部”。
- 左下：数据 2 Alibaba 规则，标题 + 修改时间；底部“打开规则中心”。
- 中下：数据 3 1688 规则，同上；失败时显示旧数据 + “更新失败”。
- 右下：数据 4 入口卡片（TEMU/Pinterest/RunSignup）+ “刷新全部”。
- 空态/错误态：无历史数据时显示原因和“重试”；有历史数据但刷新失败时保留旧数据并标 `stale`。
- 所有面板独立 loading，不阻塞整页。

数据请求用现有 react-query（热榜页已在用）；日历和数据栏各自 query key，刷新后 invalidate。

## 测试

- `server/tests/test_common_sources.py`：
  - Alibaba `/latest` fixture：断言取 `ruleTitle`、`modifiedTime` 毫秒转 ISO、详情 URL、中文标题。
  - 1688 mtop fixture + 签名单测（固定 token/t/data，断言 md5）；fixture 的 `data` 必须包含 `identityCode`、`buCode` 等完整字段。
  - 1688 `Set-Cookie` 两条时 `set_cookies` 能同时拿到 `_m_h5_tk` 和 `_m_h5_tk_enc`。
  - RunSignup HTML fixture：解析标题/日期/城市/距离；过滤早于 `start_date` 的推广位；按日期升序。
  - RunSignup 全球抓取：US 展开成 51 个州查询并聚合；一个国家失败时保留旧条目，另一个国家成功时替换；单国 0 条清空该国。
  - 1688 签名：固定 token/timestamp/data，断言 md5 结果。
  - 美国节日：固定日期断言（含 observed 落在 7 月 3 日），只输出 11 个联邦假日。
- `server/tests/test_feeds.py` 增补：
  - `GET /feeds/calendar` 返回赛事 + 节日、范围校验、超出 90 天时 `race_window_exceeded`。
  - `GET /feeds/data-panels` 返回订阅、两个规则源、入口链接。
  - `POST /feeds/common/{key}/refresh` 未知 key、成功入队、60 秒内重复请求 cooldown。
  - 成功解析 0 条时保留旧 entries、状态 `stale`。
- 前端不新增 E2E；复用 `/feeds` 页面手工验收。

## 配置与回滚

- `feed_common_enabled`（默认 true）：关闭后日历只显示节日，数据栏只显示入口。
- `feed_runsignup_countries`（默认 `all`）：可改成 `US,CA,GB` 等子集，用于规避限流。
- 单源失败只影响该区块；日志记录 `source=common:<key>`、状态、耗时、失败国家数。
- 不改数据库结构，回滚无需迁移。

## 风险

- **全量国家请求量大**：约 250 次/轮，6h 一轮；可能被 RunSignup 限流或首轮耗时数分钟。用 8 并发、12s 超时、失败保留旧数据；配置可随时收窄国家集合。这是用户明确选择“先默认全部国家”的代价。
- 1688 mtop 签名/风控变化：适配层隔离，失败降级为入口；测试覆盖签名，不覆盖线上风控。
- Alibaba 接口无公开文档：同上。
- RunSignup DOM 结构变化：用 `rsuTileGrid__item--findRace` 和内部 div 顺序解析，fixture 覆盖；解析失败降级为入口。
- 日期时区：赛事日期只存 `YYYY-MM-DD`，不做 UTC 转换；节日同样按日期处理，避免跨时区偏移。
- 90 天窗口之外没有赛事数据：日历继续显示节日，并提示“赛事数据只同步未来 90 天”。

## 已做的决定（可改）

- 一页 5 区块：日历（大）、数据 1（订阅文章）、数据 2（Alibaba）、数据 3（1688）、数据 4（其他入口）。
- 日历只放赛事 + 节日；订阅文章和规则更新不进日历。
- RunSignup 默认全部国家，90 天窗口，6h 刷新；部分国家失败保留旧数据。
- 节日只做 11 个美国联邦假日，observed 只作为显示日期。
- 成功但 0 条按失败处理，保留旧快照。
- 手动刷新加 60 秒最小区间。
- 不自动翻译标题。
- TEMU/Pinterest 只保留入口，不抓登录态/不加代理。

## 待确认

- 数据 2/3/4 的分配是否就是“Alibaba / 1688 / 其他入口”；如果用户想让数据 4 也放某类数据，需要调整。
- 日历页签是否直接替换“常用信息源”，还是新增第四个页签。
