import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

export interface CountUpProps {
  value: number
  /** 秒。 */
  duration?: number
  /** 自定义格式化，默认取整并加千分位。 */
  format?: (value: number) => string
  /** 首次挂载是否从 0 滚起。断言真实数值的场景可关掉。 */
  animateOnMount?: boolean
}

function defaultFormat(value: number) {
  return Math.round(value).toLocaleString('en-US')
}

/** 指标数字滚动。数值变化时从当前值过渡到新值。 */
export default function CountUp({ value, duration = 0.4, format, animateOnMount = true }: CountUpProps) {
  const reduce = !useMotionSafe()
  const start = reduce || !animateOnMount ? value : 0
  const [display, setDisplay] = useState(start)
  const current = useRef(start)
  const mounted = useRef(false)

  useEffect(() => {
    if (reduce) {
      current.current = value
      setDisplay(value)
      return
    }
    const from = mounted.current ? current.current : animateOnMount ? 0 : value
    mounted.current = true
    if (from === value) {
      current.current = value
      setDisplay(value)
      return
    }
    const controls = animate(from, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        current.current = latest
        setDisplay(latest)
      },
      onComplete: () => {
        current.current = value
        setDisplay(value)
      },
    })
    return () => controls.stop()
  }, [value, reduce, duration, animateOnMount])

  return <span>{(format ?? defaultFormat)(display)}</span>
}
