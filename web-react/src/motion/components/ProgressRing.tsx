import { motion } from 'framer-motion'
import { EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

export interface ProgressRingProps {
  /** 0 ~ 1。 */
  value: number
  size?: number
  stroke?: number
  color?: string
  /** 无障碍标签，默认按百分比生成。 */
  label?: string
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 环形进度：周长位移过渡，数值变化时平滑填充。 */
export default function ProgressRing({ value, size = 40, stroke = 4, color = 'currentColor', label }: ProgressRingProps) {
  const reduce = !useMotionSafe()
  const ratio = clamp(value)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `进度 ${Math.round(ratio * 100)}%`}
      style={{ display: 'block' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.14}
        strokeWidth={stroke}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        initial={false}
        animate={{ strokeDashoffset: circumference * (1 - ratio) }}
        transition={{ duration: reduce ? 0 : 0.5, ease: EASE_OUT }}
      />
    </svg>
  )
}
