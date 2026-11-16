import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { stampVariants } from '../presets'
import { useMotionSafe } from '../useMotionSafe'

export interface StampCardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/** 打卡目标卡入场：轻微放大 + 回正角度，像盖章落下。 */
export default function StampCard({ children, className, style }: StampCardProps) {
  const animated = useMotionSafe()

  return (
    <motion.div variants={stampVariants(animated)} className={className} style={{ transformOrigin: '50% 60%', ...style }}>
      {children}
    </motion.div>
  )
}
