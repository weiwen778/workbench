import type { Variants } from 'framer-motion'
import { DISTANCE, DURATION, EASE_OUT, GUARD, STAGGER } from './tokens'

/** 列表容器：逐个入场，超过封顶项数改为整块淡入。 */
export function listVariants(count: number, animated: boolean): Variants {
  const stagger = animated && count <= GUARD.maxStaggerItems
  return {
    hidden: {},
    show: {
      transition: {
        staggerChildren: stagger ? STAGGER.step : 0,
        delayChildren: stagger ? STAGGER.step : 0,
      },
    },
  }
}

/** 列表子项。animated 为 false 时只有纯淡入，没有位移。 */
export function itemVariants(animated: boolean): Variants {
  return {
    hidden: { opacity: 0, y: animated ? DISTANCE.sm : 0 },
    show: {
      opacity: 1,
      y: 0,
      transition: animated ? { duration: DURATION.base, ease: EASE_OUT } : { duration: 0 },
    },
  }
}

/** 纯淡入，用于不想要位移的大块内容。 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
}

/** 盖章入场：轻微放大 + 回正角度，用于打卡目标卡。 */
export function stampVariants(animated: boolean): Variants {
  return {
    hidden: animated ? { opacity: 0, scale: 1.06, rotate: -6 } : { opacity: 0 },
    show: {
      opacity: 1,
      scale: 1,
      rotate: 0,
      transition: animated ? { duration: DURATION.slow, ease: EASE_OUT } : { duration: 0 },
    },
  }
}
