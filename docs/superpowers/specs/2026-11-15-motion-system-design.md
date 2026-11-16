# 工作台动效系统设计（Motion System）

日期：2026-11-15
状态：待批准
取代：`docs/全局动效.md`（Vue 时代规范，其中"不等待退场动画""不给表格行/输入/画布加持续动效"两条限制在本文生效后作废）

## 1. 意图与为什么

现状：全站只有 3 处动效（页面淡入、侧栏 160ms 折叠、卡片 hover 变色），且都是布局级的。用户反馈"动画太单一"，目标是让不同组件有不同的动作，让工作台更有生命感，同时不破坏现有的克制、工具型气质。

## 2. 目标 / 非目标 / 反目标

**目标**
- 建立一套 motion tokens（时长、曲线、弹簧、位移），消除现有 150/160/180/220ms 四种时长与两套缓动混用的问题。
- 按"组件类型"分配动效（列表、卡片、抽屉、弹窗、表格行、数字、图表、勾选、加载、通知），种类足够多但手势一致。
- 挑 3 个高频模块做个性化：打卡、可视化、白板。
- 全部动效统一受"减少动态效果"控制。

**非目标**
- 不引入 lottie / gsap / anime.js 等新依赖；只用已有的 `framer-motion ^14.14.0` + MUI。
- 不改任何视觉样式（配色、字号、圆角、阴影值）。
- 不做滚动视差、3D 翻转、背景粒子、页面级持续动画。
- 不动后端、不动接口。

**反目标（做到这些就算失败）**
- 切页出现明显空白或卡顿（比现在更迟钝）。
- 大数据表格（>100 行或虚拟滚动）因行动画掉帧。
- 关闭系统"减少动态效果"后仍有位移/缩放。
- 动效变成"每个组件各写一套"，风格散掉。

## 3. 约束（来自现有代码）

| 约束 | 证据 |
|---|---|
| 全局 `MotionConfig` 已存在，duration 0.22 / ease `[0.22,1,0.36,1]` | `src/App.tsx:54` |
| 页面切换用 `AnimatePresence mode="wait"`，会等退场 | `src/layout/AppLayout.tsx:356-374` |
| 侧栏折叠是 CSS transition 160ms，无 `@keyframes` | `src/layout/AppRail.tsx:70,153-154,184` |
| 弹窗/抽屉全用 MUI 默认过渡，共 ~40 处 `Dialog`/`Drawer` | `src/ui/feedback.tsx:161`、`RecordDrawer.tsx:109` 等 |
| 图表用 `@mui/x-charts` 的 Bar/Line/Pie | `src/components/DashboardChart.tsx:7,69,85,97` |
| 已有全站 reduced-motion 兜底 | `src/styles/layout.css:9-17` |
| 构建链 `tsc -b && vite build`，有 `typecheck` 脚本 | `web-react/package.json:6-11` |
| 已有动效 e2e `e2e/global-motion.mjs`，含"减少动态效果"用例 | `docs/全局动效.md` |

**关键风险**：`mode="wait"` 会先播完 0.18s 退场再进场。加了方向性滑动后，切页会变成 0.36s 的明显停顿。P0 必须先改成进出重叠（`mode="popLayout"` 或双绝对定位层）。

## 4. 方案

已选：**A 统一语言 + 分类动效**（用户在两条路线中选择 A）。
掉选：B 每模块一套独立动效人格 —— 需写 6~8 套独立原语，风格易散、维护翻倍，仅在 3 个模块局部采用。

## 5. 设计

### 5.1 Tokens

```ts
duration: { instant: 90, fast: 140, base: 180, slow: 240, slower: 320 }
ease:     { out: [0.22, 1, 0.36, 1], inOut: [0.4, 0, 0.2, 1], in: [0.4, 0, 1, 1] }
spring:   { gentle: { stiffness: 260, damping: 28 }, snappy: { stiffness: 420, damping: 32 }, bouncy: { stiffness: 520, damping: 22 } }
distance: { xs: 4, sm: 8, md: 16, lg: 24 }
```

沿用现有 `[0.22,1,0.36,1]`，保证已有动画手感不突变；`base: 180` 覆盖原 160/180 两档。

### 5.2 分类原语（按组件类型，不按页面）

| 原语 | 用于 | 动作 | 时长 |
|---|---|---|---|
| `PageTransition` | 所有页面切换 | 按路由层级定方向：进子页从右滑 16px、回上级从左滑 16px、同级淡入；进出重叠 | 180 in / 140 out |
| `StaggerList` | 卡片网格、列表 | 子项依次 fade + y 8→0，间隔 20ms，**最多 12 项**，超出整体淡入 | 180 |
| `LiftCard` | 可点卡片 | hover 上浮 2px + 阴影 opacity 过渡（不做 scale，避免文字模糊） | 140 |
| `SpringDrawer` | 右侧抽屉 | spring gentle 滑入，遮罩渐深 | spring |
| `PopDialog` | 弹窗 | scale 0.96→1 + fade，关闭更快 | 180 in / 120 out |
| `RowFlow` | 表格行增删 | 新增 height 0→auto + fade，删除塌陷；`layout` 收拢 | 180 |
| `CountUp` | 指标数字 | 从 0 滚到终值，保留小数/千分位/前后缀 | 400 |
| `ChartDraw` | 柱/线/饼 | 柱从 0 生长，线从左侧描出，饼顺时针展开 | 500 |
| `CheckPop` | 勾选框完成 | 勾 path 描边 + 轻微弹跳 | 220 |
| `SkeletonPulse` | 首屏加载 | 骨架屏呼吸，替代空白 + 转圈 | 循环 |
| `ToastStack` | 通知 | 右上滑入，多条堆叠位移 | 180 |
| `RailTick` | 侧栏选中 | 指示条 `layoutId` 滑动，图标上移 1px | 160 |

### 5.3 三个模块的个性化

- **打卡**：目标卡"盖章"入场（scale 1.06→1 + rotate -6°→0）；进度环 `stroke-dashoffset` 动画；完成瞬间 3 个极简粒子（纯 div + transform，不引库）。
- **可视化**：卡片拖拽重排走 spring `layout`；图表逐系列 draw-in（series 间 delay 80ms）；指标数字用 `CountUp`。
- **白板**：工具按钮按压缩放 0.94；右侧面板 spring 滑出；缩略图 hover 微倾斜 1°。

### 5.4 护栏

1. 所有原语内部走 `useMotionSafe()`：系统减少动态效果时返回 `duration: 0`、无 transform、无 delay。
2. `StaggerList` 上限 12 项；`RowFlow` 仅在行数 ≤100 且非虚拟滚动的表格启用。
3. 不动画 `filter: blur`；阴影改为伪元素 opacity 过渡。
4. 每个原语都是独立组件，业务页面只做接入，不写内联 variants。
5. 保留 `layout.css` 的全局 reduced-motion 兜底不删。

## 6. 改动清单

**新增**（`web-react/src/motion/`）
- `tokens.ts`、`presets.ts`、`useMotionSafe.ts`、`index.ts`
- `components/PageTransition.tsx`、`StaggerList.tsx`、`LiftCard.tsx`、`SpringDrawer.tsx`、`PopDialog.tsx`、`RowFlow.tsx`、`CountUp.tsx`、`CheckPop.tsx`、`SkeletonPulse.tsx`、`ToastStack.tsx`

**修改**
- `src/App.tsx` — MotionConfig 改为引用 tokens
- `src/layout/AppLayout.tsx` — 内联 motion.div 换成 `PageTransition`，**修掉 `mode="wait"`**
- `src/layout/AppRail.tsx` — 指示条 `layoutId` + 图标微动
- `src/ui/feedback.tsx` — Dialog → `PopDialog`，Snackbar → `ToastStack`
- `src/ui/LoadingScreen.tsx` — 换 `SkeletonPulse`
- `src/components/RecordDrawer.tsx`、`FieldManager.tsx`、`CategoryManager.tsx`、`NavPanels.tsx` — 抽屉换 `SpringDrawer`
- `src/pages/Checkin.tsx`、`Dashboard.tsx`、`DashboardChart.tsx`、`Todos.tsx`、`Tables.tsx`、`TableView.tsx`、`Memos.tsx`、`Notes.tsx`、`Bookmarks.tsx`、`Whiteboards.tsx` — 接入对应原语
- `docs/全局动效.md` — 重写为新规范，标注旧限制作废

## 7. 分阶段

| 阶段 | 内容 | 可验收点 |
|---|---|---|
| P0 基建 | tokens / presets / useMotionSafe / PageTransition + 修 `mode="wait"` | 切页比现在更顺，无明显空白；typecheck 通过 |
| P1 通用原语 | 列表 + 卡片 + 抽屉 + 弹窗 + 加载 + 通知接入 | 全站手感统一，无一处突兀 |
| P2 模块个性化 | 打卡 / 可视化 / 白板 | 三个模块有明显记忆点 |
| P3 收尾 | 重写 `docs/全局动效.md`、补 e2e 动效用例 | 文档与实现一致 |

## 8. 验收标准

- `npm run typecheck`、`npm run build` 通过。
- `e2e/global-motion.mjs` 仍然通过（尤其"减少动态效果"用例）。
- 手动核对：系统开启减少动态效果后，全站无位移、无缩放、无延迟。
- 手动核对：切页无肉眼可见的空白停顿。
- 手动核对：100 行以上表格滚动不掉帧。

## 9. 留给实现者的决定

- `PageTransition` 的方向判定规则（按 path 层级还是路由 meta）——建议按 path 段数比较，简单可测。
- `ChartDraw` 是用 x-charts 内置动画还是自绘入场 —— 建议先用内置 `skipAnimation`，不够再自绘。
- 是否给移动端单独降级（窄屏只保留淡入）—— 建议降级。
