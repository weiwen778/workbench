import type { ReactNode } from 'react'
import { Dialog, type DialogProps } from '@mui/material'
import { useMotionSafe } from '../useMotionSafe'

export interface PopDialogProps extends DialogProps {
  children: ReactNode
}

/**
 * 弹窗：进场由 layout.css 的 wb-pop-in 关键帧完成（96% → 100% 缩放 + 淡入），
 * 退场交给 MUI 自己的 Fade，只调短时长——关闭总比打开快。
 * 不接管 MUI 的 Transition 组件，因此焦点陷阱、Escape、遮罩点击都保持原状。
 */
export default function PopDialog({ children, className, sx, ...rest }: PopDialogProps) {
  const safe = useMotionSafe()

  return (
    <Dialog
      {...rest}
      className={['wb-dialog-pop', className].filter(Boolean).join(' ')}
      transitionDuration={safe ? { enter: 180, exit: 120 } : { enter: 0, exit: 0 }}
      sx={sx}
    >
      {children}
    </Dialog>
  )
}
