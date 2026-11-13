import { Box, CircularProgress } from '@mui/material'

export default function LoadingScreen({ text = '正在加载…' }: { text?: string }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 13 }}>
        <CircularProgress size={18} /> {text}
      </Box>
    </Box>
  )
}
