import type { ComponentType } from 'react'
import { motion, type MotionProps } from 'framer-motion'
import { Paper, type PaperProps } from '@mui/material'
import { DURATION, EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

/**
 * motion.create(Paper) 让卡片仍是 Paper 本身，不额外包一层 div，
 * 网格/flex 布局不会因为多一层包裹而错位。
 */
type SafePaperProps = Omit<
  PaperProps,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd'
> &
  Omit<MotionProps, 'children'>

const MotionPaper = motion.create(Paper) as unknown as ComponentType<SafePaperProps>

export interface LiftCardProps extends SafePaperProps {
  /** 上浮距离，px。 */
  lift?: number
}

/** 可点卡片：hover 上浮 + 边框/阴影过渡。不做 scale，避免文字发虚。 */
export default function LiftCard({ lift = 2, sx, enabled = true, ...rest }: LiftCardProps & { enabled?: boolean }) {
  const safe = useMotionSafe()
  const animated = safe && enabled

  return (
    <MotionPaper
      {...rest}
      // 只做 hover 位移：同时挂 whileTap 时按下与抬起的 y 会互相追，指针停在卡片边缘会来回抖
      whileHover={animated ? { y: -lift } : undefined}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      sx={[
        {
          transition: `border-color ${DURATION.fast}s ease, box-shadow ${DURATION.fast}s ease`,
          // 上浮时把卡片提到独立合成层：文字只栅格化一次，否则每帧重采样会发虚发颤
          '&:hover': { willChange: 'transform' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  )
}
