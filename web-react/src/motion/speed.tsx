import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { applyMotionScale } from './tokens'

export type MotionSpeed = 'off' | 'slow' | 'normal' | 'fast'

/** 倍率：off 直接关掉，slow 放慢 1.8 倍，fast 收紧到 0.65 倍。 */
export const MOTION_SCALE: Record<MotionSpeed, number> = {
  off: 0,
  slow: 1.8,
  normal: 1,
  fast: 0.65,
}

export const MOTION_SPEED_OPTIONS: { value: MotionSpeed; label: string; hint: string }[] = [
  { value: 'off', label: '关闭', hint: '不动画，即时生效。画面抖动时用这个。' },
  { value: 'slow', label: '舒缓', hint: '放慢到 1.8 倍，动作更看得清。' },
  { value: 'normal', label: '标准', hint: '默认节奏。' },
  { value: 'fast', label: '轻快', hint: '收紧到 0.65 倍，更利落。' },
]

export const MOTION_SPEED_KEY = 'wb_motion_speed'
export const MOTION_SPEED_EVENT = 'wb-motion-speed'

export function readMotionSpeed(): MotionSpeed {
  if (typeof window === 'undefined') return 'normal'
  const stored = window.localStorage.getItem(MOTION_SPEED_KEY)
  return stored === 'off' || stored === 'slow' || stored === 'fast' || stored === 'normal' ? stored : 'normal'
}

export function writeMotionSpeed(value: MotionSpeed) {
  window.localStorage.setItem(MOTION_SPEED_KEY, value)
  applyMotionScale(MOTION_SCALE[value])
  document.documentElement.dataset.motion = value
  window.dispatchEvent(new Event(MOTION_SPEED_EVENT))
}

const MotionSpeedContext = createContext<MotionSpeed>('normal')

export function useMotionSpeed(): MotionSpeed {
  return useContext(MotionSpeedContext)
}

/** 模块加载时先对上存档值，避免首帧用错倍率。 */
applyMotionScale(MOTION_SCALE[readMotionSpeed()])

export function MotionSpeedProvider({ children }: { children: ReactNode }) {
  const [speed, setSpeed] = useState<MotionSpeed>(readMotionSpeed)

  useEffect(() => {
    const sync = () => {
      const next = readMotionSpeed()
      applyMotionScale(MOTION_SCALE[next])
      document.documentElement.dataset.motion = next
      setSpeed(next)
    }
    sync()
    window.addEventListener(MOTION_SPEED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(MOTION_SPEED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return <MotionSpeedContext.Provider value={speed}>{children}</MotionSpeedContext.Provider>
}
