import type { Easing, Transition } from 'framer-motion'

/**
 * 全局倍率，来自设置页的「动效速度」。
 * 用 getter 暴露时长，组件读 DURATION.xxx 时会即时拿到当前倍率下的值，
 * 不必逐个组件改写成函数调用。
 */
let motionScale = 1

export function applyMotionScale(scale: number) {
  motionScale = Number.isFinite(scale) && scale >= 0 ? scale : 1
}

export function currentMotionScale() {
  return motionScale
}

const d = (base: number) => base * motionScale

/** 动效时长（秒）。base 覆盖旧的 160/180 两档，避免手感突变。 */
export const DURATION = {
  get instant() { return d(0.09) },
  get fast() { return d(0.14) },
  get base() { return d(0.18) },
  get slow() { return d(0.24) },
  get slower() { return d(0.32) },
}

/** 缓动曲线。out 沿用 React 版既有曲线。 */
export const EASE_OUT: Easing = [0.22, 1, 0.36, 1]
export const EASE_IN_OUT: Easing = [0.4, 0, 0.2, 1]
export const EASE_IN: Easing = [0.4, 0, 1, 1]

/** 弹簧预设。gentle 用于抽屉/面板，snappy 用于拖拽重排，bouncy 用于勾选反馈。 */
export const SPRING = {
  gentle: { type: 'spring', stiffness: 260, damping: 28 } as Transition,
  snappy: { type: 'spring', stiffness: 420, damping: 32 } as Transition,
  bouncy: { type: 'spring', stiffness: 520, damping: 22 } as Transition,
} as const

/** 位移距离（px）。 */
export const DISTANCE = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const

/** 全局兜底过渡，替换 App.tsx 里写死的 0.22。 */
export function defaultTransition(): Transition {
  return { duration: DURATION.base, ease: EASE_OUT }
}

/** 进场 180ms，退场 140ms——关闭总比打开快。 */
export function exitTransition(): Transition {
  return { duration: DURATION.fast, ease: EASE_IN }
}

/** 列表逐个入场的间隔与封顶项数。 */
export const STAGGER = {
  get step() { return 0.02 * motionScale },
  max: 12,
}

/** 性能护栏阈值。 */
export const GUARD = { maxStaggerItems: 12, maxAnimatedRows: 100 } as const
