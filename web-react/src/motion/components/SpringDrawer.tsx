import type { ReactNode } from 'react'
import { Drawer, type DrawerProps } from '@mui/material'
import { useMotionSafe } from '../useMotionSafe'

/** Slide 只接受字符串缓动，这里与 tokens 的 out 曲线保持一致。 */
const CSS_EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const CSS_EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

export interface SpringDrawerProps extends DrawerProps {
  children: ReactNode
}

/**
 * 抽屉：拉长进场、缩短退场的曲线，读起来像弹簧收放。
 * 仍走 MUI 自己的 Slide，焦点、Escape、遮罩行为完全不变。
 */
export default function SpringDrawer({ children, SlideProps, ...rest }: SpringDrawerProps) {
  const safe = useMotionSafe()

  return (
    <Drawer
      {...rest}
      SlideProps={{
        easing: { enter: CSS_EASE_OUT, exit: CSS_EASE_IN },
        timeout: safe ? { enter: 220, exit: 160 } : { enter: 0, exit: 0 },
        ...SlideProps,
      }}
    >
      {children}
    </Drawer>
  )
}
