import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

export interface CheckPopProps {
  checked: boolean
  size?: number
  /** 与所在行的文字颜色保持一致。 */
  color?: string
}

/** 勾选反馈：勾线描出 + 一次轻微弹跳。 */
export default function CheckPop({ checked, size = 18, color = 'currentColor' }: CheckPopProps) {
  const reduce = !useMotionSafe()

  return (
    <motion.span
      aria-hidden
      style={{ display: 'inline-flex', lineHeight: 0 }}
      animate={checked && !reduce ? { scale: [1, 1.18, 1] } : { scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT, times: [0, 0.45, 1] }}
    >
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
        <motion.path
          d="M4 9.4 L7.4 12.8 L14 5.8"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : DURATION.slow, ease: EASE_OUT }}
        />
      </svg>
    </motion.span>
  )
}
