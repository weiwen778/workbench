import { motion } from 'framer-motion'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import { EASE_OUT } from '../tokens'
import { useMotionSafe } from '../useMotionSafe'

/**
 * 勾选框的选中图标：挂载瞬间轻轻弹一下。
 * 直接塞进 MUI Checkbox 的 checkedIcon，不改变任何交互与无障碍行为。
 */
export default function PopCheckedIcon() {
  const reduce = !useMotionSafe()

  return (
    <motion.span
      style={{ display: 'inline-flex', lineHeight: 0 }}
      initial={reduce ? false : { scale: 0.75 }}
      animate={reduce ? undefined : { scale: [0.75, 1.16, 1] }}
      transition={{ duration: 0.22, ease: EASE_OUT, times: [0, 0.5, 1] }}
    >
      <CheckBoxIcon fontSize="small" />
    </motion.span>
  )
}
