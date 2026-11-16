import { useReducedMotion } from 'framer-motion'
import { useMotionSpeed } from './speed'

/**
 * true = 允许播放动效。
 * 两种情况下返回 false：系统开启「减少动态效果」，或用户把设置里的动效速度调成「关闭」。
 * 所有原语都据此降级为即时呈现。
 */
export function useMotionSafe(): boolean {
  const reduce = useReducedMotion()
  const speed = useMotionSpeed()
  return !reduce && speed !== 'off'
}
