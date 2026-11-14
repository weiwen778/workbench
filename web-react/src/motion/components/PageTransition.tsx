import type { CSSProperties, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * 路由切换不留动画。
 *
 * 为什么不做淡入：旧页面瞬间移除、新页面从 opacity 0 淡入，中间那 150-200ms
 * 露出来的是背景色——观感就是「闪一下」。做成双层交叉淡入又会叠出重影。
 * 工具型界面里，切页就该是即时的；动感交给页面内部的列表、卡片和数字。
 *
 * 真正的等待（懒加载 chunk 还没下载完）由 AppLayout 的 Suspense fallback 承担。
 */
export interface PageTransitionProps {
  children: ReactNode
  /** 沿用 AppLayout 原有的高度策略。 */
  style?: CSSProperties
  /** 保留参数以兼容调用处，窄屏与宽屏行为一致。 */
  narrow?: boolean
}

export default function PageTransition({ children, style }: PageTransitionProps) {
  const location = useLocation()

  return (
    <div key={location.key} style={{ position: 'relative', ...style }}>
      {children}
    </div>
  )
}
