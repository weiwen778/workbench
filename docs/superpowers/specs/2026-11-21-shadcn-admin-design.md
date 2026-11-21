# 界面重构：shadcn-admin 风格 · 设计

日期：2026-11-21
状态：已完成
参考：`https://shadcn-admin.netlify.app/tasks`

## 为什么改

前两轮在「收口」和「复古账本」之间摇摆：深墨绿侧栏 + 衬线标题 + 黄铜被用户否决。用户给出 shadcn-admin 的 Tasks 页面作为明确参考：白底、近黑主色、Inter、Lucide、内容区 30px 标题、12px 圆角表格、无竖线、筛选 pill、黑色主按钮。

## 目标

- 外壳和页面都变成 shadcn-admin 的浅色中性系统，不再使用深绿/衬线/黄铜。
- 页面标题从顶栏移到内容区，形成「大标题 + 描述 + 右侧操作」。
- 表格页按参考图重做：白色圆角卡片、无竖线、圆形 checkbox、排序图标、行末 `...` 菜单、shadcn 分页。
- 看板页变成中性图表（黑线、灰柱），指标卡不再使用 40px 数字。
- 保留现有业务、路由、权限、点击/键盘行为；触屏和暗色模式继续可用。

## 设计

### 色彩

浅色：画布 `#FAFAFA`、内容 `#FFFFFF`、边框 `#E4E4E7`、主文字 `#09090B`、次文字 `#71717A`、hover `#F4F4F5`、主色 `#18181B`。
暗色：画布 `#09090B`、内容 `#0C0C0E`、边框 `#27272A`、主文字 `#FAFAFA`、次文字 `#A1A1AA`、主色 `#FAFAFA`。
成功/警告/错误只用于语义状态，不做装饰。

### 字体

Inter Variable + Noto Sans SC 回退；正文 14/1.5；页面标题 30/700；区块 18/600；表格 13.5；元信息 12.5。数字用 `tabular-nums`，不再使用 IBM Plex Mono 作为主界面字体。

### 布局

- 侧栏 264px（窄 72px）：白底、右侧 1px 边框、黑色品牌方块 + `Nexus` + 副标题；分区「工作台 / 更多」；激活项 `#F4F4F5` 圆角 8；底部设置和用户卡片。
- 顶栏 56px：左侧面板切换 + 240px 搜索（`Ctrl K`）；右侧任务、反馈、主题、设置、头像。
- 页面内容：24–32px 内边距；`PageHeader` 30px 标题 + 14px 描述 + 右侧操作；下面才是筛选行和内容。
- 表格/卡片：12px 圆角、1px 边框、无阴影；浮层才用阴影。
- 控件 36px 高、8px 圆角；按钮黑色实心或白底描边。

### 图标

Lucide，1.75px 线稿，16/18/20px。导航：CalendarCheck、Table2、ListChecks、BookOpenText、StickyNote、ChartLine、Files、Link2、Languages、Image、ArrowLeftRight、Palette、QrCode、Paintbrush。

### 页面

- **表格详情**：页头「表格名 + 行数/范围」+ 导入/添加一行；筛选/排序/视图 pill；白色表格；圆形 checkbox；排序图标；行末 `...` 菜单；shadcn 分页。
- **打卡**：页头「打卡/项目名 + 今日进度」+ 历史/管理；今日/本周/本月分段；项目/状态/日期；灰底分组 + 行；StickyNote 备注图标。
- **便利贴**：页头 + 新建；搜索/视图/列；浅色纸面（Tailwind 50）+ 彩色圆点；14.5/600 标题；操作 hover 出现。
- **看板**：页头 + 全部看板/AI 生成/添加图表；统计时间；指标卡 28px；黑色折线、灰色柱、浅网格。
- **笔记/待办/表格列表/设置/登录**：同一套页头、按钮、表格/卡片和控件。

## 验证

- `cd web-react && npm run typecheck`：PASS。
- `cd web-react && npm run build`：PASS。
- `e2e/ui-refinement.mjs`：PASS（无页头大标题、表格常显行操作、便利贴 hover、手机筛选）。
- `e2e/memo-card-hover.mjs`：PASS。
- `e2e/module-toolbar.mjs`：PASS（筛选/刷新/更多/主操作统一在模块操作栏）。
- `e2e/react-ui-consistency.mjs`：PASS（`data-nav-section` 区分工作台/更多，固定项语义保持）。
- 截图：`.run/shadcn-3/`（桌面亮色表格、便利贴、表格列表、笔记、待办、看板/看板详情、设置，暗色表格/看板，手机打卡）与 `.run/shadcn-final/`（登录、侧栏、暗色看板）。
- 本地管理员密码不是测试默认值，e2e 通过一次性本地会话执行并清理；提交脚本仍走正常登录 + `WB_E2E_PASSWORD`。
- 未提交 git；`web-react/src/layout/ModuleTabs.tsx` 仍保留为未使用的旧组件，下一轮可删除。
- 窄侧栏居中修正（2026-11-21）：导航项外层宽度从 100% 改为 40px；品牌、导航图标、设置、头像中心统一在 35.5px。测量截图 `.run/center-check.png`。
- 按用户要求移除侧栏底部的「设置」项、用户卡片和分隔线（2026-11-21）；顶栏的设置和头像保留。截图 `.run/sidebar-final-light.png`、`.run/settings-after-remove-light.png`。
- 按用户要求移除品牌右侧的工作区切换箭头（2026-11-21）。生产包 `18080` 已确认侧栏不含「设置/admin」旧底栏；浏览器如仍显示旧版，需要 Ctrl+Shift+R。
- 二级侧栏改为最多 4 项 + 「更多」菜单（2026-11-21）：当前项如果排在第 4 项之后，则显示前 3 项 + 当前项，保证当前表格/项目始终可见；剩余项收进「更多 N」菜单。截图 `.run/subnav-limited.png`、`.run/subnav-more-menu.png`。
- 二级侧栏「更多」改为原地展开（2026-11-21）：默认 4 项 + 「更多 N」，点击后展开全部并显示「收起」，不再用浮层菜单；切换一级模块时重置为收起，新的模块会关闭上一个展开的二级栏，点击无二级栏的模块也会关闭。实测依次打开表格/待办/笔记/看板时 DOM 中始终只有一个「xx二级导航」。截图 `.run/subnav-collapsed.png`、`.run/subnav-expanded.png`。
- 表格详情页去掉页头标题（表格名 + 行数说明），把「导入 / 添加一行」并入操作栏主操作位；内容区四周与行间距改为 10px。实测内容起点 `x = 82`（72px 侧栏 + 10px），无横向溢出，手机 390px 下操作栏换行但页面不溢出。截图 `.run/table-density.png`、`.run/table-mobile.png`。
- 去掉设置页各分类标题旁的「返回」按钮（2026-11-21）：设置页有两个返回入口（通用返回按钮和侧栏收起），用户只需要侧栏导航；保留设置目录顶部的「收起设置目录」箭头。截图 `.run/settings-no-back.png`。
- 修复统一操作栏主操作位多个按钮紧贴的问题（2026-11-21）：`ModuleToolbar` 的 primary 插槽改为 `inline-flex` + 6px gap，表格详情页「导入 / 添加一行」间距为 6px。截图 `.run/table-toolbar-gap-full.png`。
- 修复表格行操作「…」按钮不居中（2026-11-21）：`__actions` 列单元格改为 flex 居中。实测按钮中心与单元格中心水平 1394/1393、垂直 195/195。截图 `.run/action-right.png`。
- 表格列宽默认按表头文字自适应（2026-11-21）：为 `Column` 增加 `minWidth`，默认宽度按「字段名 + 排序图标 + 静态标记 + 内边距」计算；已手动保存的列宽也会被抬到该最小宽度。实测 `净销售额/转化率/运营分摊成本/经营利润/利润率/投产比` 均不再截断，页面无横向溢出。截图 `.run/table-headers-full.png`。
- 侧栏品牌由「N」方印改为站点 logo（`/favicon.svg`，与浏览器标签页一致，2026-11-21）；宽窄两种侧栏均按 32px 显示。截图 `.run/brand-logo-wide.png`、`.run/brand-logo-narrow.png`。
- 全局移除页面大标题（2026-11-21）：打卡、表格、待办、笔记、便利贴、看板、设置都去掉 `PageHeader` 标题与说明；原页头操作统一并入模块操作栏的主操作位，看板详情并入「统计时间」工具行。设置页保留左侧「设置」目录与各分类标题。实测 8 个路由 `[data-page-title]` 均为 0、页面无横向溢出，手机 390px 同样无溢出。截图 `.run/dashboard-no-title.png`、`.run/settings-no-title.png`、`.run/no-title-checkins.png`、`.run/no-title-todos.png`、`.run/no-title-notes.png`、`.run/no-title-memos.png`、`.run/no-title-data.png`。
- 翻译历史/收藏条目改为「译文在上、原文在下」，去掉翻译引擎和时间（2026-11-21）；历史保留「自动检测 → 英语」语言方向，收藏不再显示元信息。截图 `.run/translate-history.png`。
- 翻译台输入区改为整块可点击（textarea 撑满面板，点击空白也聚焦）；主翻译台高度固定为桌面 320px、手机每栏 260px，收藏/历史区获得更多空间。实测桌面 textarea 高 228px、点击底部空白后焦点在 textarea；手机无横向溢出。截图 `.run/translate-desktop-final.png`、`.run/translate-mobile-final.png`。
- 笔记阅读区改为「灰色画布 + 白色文档卡片」（2026-11-21）：阅读区背景 `background.default`，正文卡片 `background.paper` + 1px 边框 + 12px 圆角 + 轻阴影，深浅色主题都生效。截图 `.run/notes-card-light.png`、`.run/notes-card-dark.png`、`.run/notes-card-content.png`。
- 翻译原文输入框的占位提示字号与输入字号统一（2026-11-21）：去掉占位符固定 15px，改为继承 textarea 的自适应字号。实测空态与输入态 textarea / placeholder 均为 28px。截图 `.run/translate-placeholder-font.png`。
- 翻译页「收藏 / 历史」之间加入可左右拖动的分隔条（2026-11-21）：默认收藏 320px，拖动范围 240–560px，支持键盘左右键每次 16px、双击恢复 320px，宽度写入 `localStorage` 后刷新保持；窄屏隐藏分隔条并上下堆叠。实测拖动 320→420/560、左拖到 240、刷新后仍为保存值。截图 `.run/translate-split-handle.png`。
- 截图流程曾把账号主题切到深色，已通过 UI 切回浅色并保存。
- 设置页改为两栏独立滚动（2026-11-21）：`AppLayout` 对 `/settings` 不再使用页面滚动；设置页外层 `height: 100%; overflow: hidden`，左栏自滚、右栏 `main` 自滚。实测右栏 `scrollTop=400` 时左栏 `top` 仍为 57px，页面 `doc` 滚动高度为 0；截图 `.run/settings-scroll.png`。
