import { AnimatePresence, motion } from 'framer-motion'
import { Alert } from '@mui/material'
import { DURATION, EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

export type ToastType = 'success' | 'error' | 'warning' | 'info'
export interface ToastItem {
  id: number
  type: ToastType
  text: string
}

export interface ToastStackProps {
  items: ToastItem[]
  onDismiss: (id: number) => void
}

/** 通知：从上方滑入，多条按 layout 自动位移堆叠。 */
export default function ToastStack({ items, onDismiss }: ToastStackProps) {
  const reduce = !useMotionSafe()

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        left: 0,
        right: 0,
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            // 不用 layout 动画：它会每帧测量整摞通知的高度，多条并发时容易掉帧
            
            initial={reduce ? false : { opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : DURATION.base, ease: EASE_OUT }}
            style={{ pointerEvents: 'auto' }}
          >
            <Alert severity={item.type} variant="filled" onClose={() => onDismiss(item.id)} sx={{ minWidth: 280 }}>
              {item.text}
            </Alert>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
