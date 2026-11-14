import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { PetPayload } from './api'

const ROWS: Array<{ key: keyof PetPayload['stats']; label: string; color: string }> = [
  { key: 'satiety', label: '饱腹', color: '#E0A33A' },
  { key: 'cleanliness', label: '清洁', color: '#4FA3D9' },
  { key: 'mood', label: '心情', color: '#E06A8B' },
  { key: 'energy', label: '精力', color: '#6BBF8A' },
  { key: 'health', label: '健康', color: '#C95B5B' },
]

export default function NeedsPanel({ pet }: { pet: PetPayload }) {
  return (
    <Stack spacing={1.1}>
      {ROWS.map((row) => {
        const value = pet.stats[row.key]
        return (
          <Box key={row.key}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
              <Typography variant="caption" color="text.secondary">{row.label}</Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
            </Stack>
            <LinearProgress
              variant="determinate" value={value}
              aria-label={`${row.label} ${value}`}
              sx={{
                height: 7, borderRadius: 4, bgcolor: 'action.hover',
                '& .MuiLinearProgress-bar': { bgcolor: value <= 20 ? 'error.main' : row.color, borderRadius: 4 },
              }}
            />
          </Box>
        )
      })}
      <Typography variant="caption" color="text.secondary">零食 × {pet.treats}</Typography>
    </Stack>
  )
}
