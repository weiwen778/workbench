import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, DISTANCE } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

export interface ChartFrameProps {
  children: ReactNode
  style?: CSSProperties
  className?: string
  /** 重新拉取数据时递增，触发一次重绘。 */
  refreshKey?: number
}

/** 图表容器：数据到达时轻微上浮淡入，配合 x-charts 自身的绘制动画。 */
export default function ChartFrame({ children, style, className, refreshKey = 0 }: ChartFrameProps) {
  const reduce = !useMotionSafe()

  return (
    <motion.div
      key={refreshKey}
      className={className}
      initial={reduce ? false : { opacity: 0, y: DISTANCE.xs }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : DURATION.slow, ease: EASE_OUT }}
      style={style}
    >
      {children}
    </motion.div>
  )
}

/** 给 @mui/x-charts 用：系统减少动态效果时跳过柱状生长/折线描绘。 */
export function useChartSkipAnimation() {
  const reduce = !useMotionSafe()
  return Boolean(reduce)
}
