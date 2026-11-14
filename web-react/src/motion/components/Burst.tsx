import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

export interface BurstProps {
  /** 每次变化触发一次，通常传完成次数或时间戳。 */
  trigger: number
  size?: number
  color?: string
}

const ANGLES = [-62, 0, 62]

/** 完成瞬间的极简粒子：3 个点向外散开即消散，不引第三方库。 */
export default function Burst({ trigger, size = 44, color = 'currentColor' }: BurstProps) {
  const reduce = !useMotionSafe()
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!trigger || reduce) return
    setPlaying(true)
    const timer = window.setTimeout(() => setPlaying(false), 420)
    return () => window.clearTimeout(timer)
  }, [trigger, reduce])

  if (reduce) return null

  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 0,
        height: 0,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {playing
          ? ANGLES.map((angle) => (
              <motion.span
                key={angle}
                initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
                animate={{
                  x: Math.cos((angle * Math.PI) / 180) * (size / 2.6),
                  y: Math.sin((angle * Math.PI) / 180) * (size / 2.6) - size / 6,
                  opacity: 0,
                  scale: 0.4,
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.36, ease: EASE_OUT }}
                style={{
                  position: 'absolute',
                  width: 5,
                  height: 5,
                  marginLeft: -2.5,
                  marginTop: -2.5,
                  borderRadius: '50%',
                  background: color,
                }}
              />
            ))
          : null}
      </AnimatePresence>
    </span>
  )
}
