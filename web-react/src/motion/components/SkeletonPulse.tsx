import { Box, Skeleton, Stack, Typography } from '@mui/material'

export interface SkeletonPulseProps {
  text?: string
  /** 页面级等待：除呼吸块外再给几行骨架，读起来像「内容正在到位」。 */
  lines?: number
}

/**
 * 加载占位：呼吸方块 + 骨架行 + 文案。
 * 只在真的还没拿到内容时出现（首屏、懒加载 chunk），不做成切页过渡——
 * 切页过渡会在页面间插入空白帧，那才是「闪」的来源。
 */
export default function SkeletonPulse({ text = '正在加载…', lines = 3 }: SkeletonPulseProps) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', py: 6 }}>
      <Stack alignItems="center" spacing={1.75} sx={{ width: '100%', maxWidth: 360 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '10px',
            bgcolor: 'action.selected',
            animation: 'wb-breathe 1.6s ease-in-out infinite',
          }}
        />
        {lines > 0 ? (
          <Stack spacing={1} sx={{ width: '100%' }}>
            <Skeleton variant="text" width="42%" height={20} sx={{ mx: 'auto' }} />
            <Skeleton variant="text" width="88%" />
            <Skeleton variant="text" width="72%" />
            {lines > 3 ? <Skeleton variant="text" width="80%" /> : null}
          </Stack>
        ) : null}
        <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>{text}</Typography>
      </Stack>
    </Box>
  )
}
