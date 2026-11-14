import { Children, createContext, useContext, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import Box, { type BoxProps } from '@mui/material/Box'
import { motion, type MotionProps } from 'framer-motion'
import { itemVariants, listVariants } from '../presets'
import { useMotionSafe } from '../useMotionSafe'

/** MUI Box 与 framer 的同名 DOM 事件类型不同，剔除后取交集。 */
type SafeBoxProps = Omit<BoxProps, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd'> &
  Omit<MotionProps, 'children'>

const MotionBox = motion.create(Box) as unknown as ComponentType<SafeBoxProps>

/**
 * 子项共享容器的动效开关：容器判定一次，子项不再各自判断系统偏好。
 * 默认 true，单独使用 StaggerItem 时保持可动。
 */
const StaggerContext = createContext(true)

export interface StaggerListProps extends SafeBoxProps {
  children: ReactNode
  /** 关掉后整块即时呈现，用于超长列表。 */
  enabled?: boolean
}

/** 列表逐个入场；超过 12 项自动退化为整块淡入。 */
export default function StaggerList({ children, enabled = true, ...rest }: StaggerListProps) {
  const safe = useMotionSafe()
  const count = Children.count(children)
  // 只在首次呈现时播一次；之后筛选、刷新导致的重渲染一律即时出现，
  // 否则每敲一个搜索词，卡片就集体淡入一次，看起来像闪屏。
  const played = useRef(false)
  useEffect(() => {
    const timer = window.setTimeout(() => { played.current = true }, 400)
    return () => window.clearTimeout(timer)
  }, [])
  const animated = safe && enabled && !played.current

  return (
    <StaggerContext.Provider value={animated}>
      <MotionBox variants={listVariants(count, animated)} initial="hidden" animate="show" {...rest}>
        {children}
      </MotionBox>
    </StaggerContext.Provider>
  )
}

export interface StaggerItemProps extends SafeBoxProps {
  children: ReactNode
}

/** 列表子项，必须放在 StaggerList 内才有效果。 */
export function StaggerItem({ children, ...rest }: StaggerItemProps) {
  const animated = useContext(StaggerContext)
  return (
    <MotionBox variants={itemVariants(animated)} {...rest}>
      {children}
    </MotionBox>
  )
}
