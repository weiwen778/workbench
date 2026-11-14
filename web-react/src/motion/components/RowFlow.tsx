import type { ComponentProps } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, GUARD } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

/** framer 的 onAnimationStart / onDrag 与 DOM 同名事件类型冲突，这里剔除后透传。 */
type TrProps = Omit<
  ComponentProps<'tr'>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd'
>

export interface RowFlowProps extends TrProps {
  /** 当前表格总行数，超过阈值自动关闭，避免大表掉帧。 */
  rowCount: number
  index?: number
  enabled?: boolean
}

/**
 * 表格行：新增时淡入下滑，删除时淡出。
 * 不动画 height——tr 的高度过渡在多数浏览器里会抖动。
 */
export default function RowFlow({ rowCount, index = 0, enabled = true, children, ...rest }: RowFlowProps) {
  const safe = useMotionSafe()
  const animated = safe && enabled && rowCount <= GUARD.maxAnimatedRows

  return (
    <motion.tr
      {...rest}
      initial={animated ? { opacity: 0, y: -5 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={animated ? { opacity: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } } : { opacity: 0 }}
      transition={{ duration: animated ? DURATION.base : 0, ease: EASE_OUT, delay: animated ? Math.min(index, 8) * 0.01 : 0 }}
    >
      {children}
    </motion.tr>
  )
}
