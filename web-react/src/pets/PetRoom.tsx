import { Box, ButtonBase, Typography } from '@mui/material'
import type { PetAction, PetPayload } from './api'
import PetSprite, { type SpriteState } from './PetSprite'
import portraitUrl from './assets/dog-portrait.png'

function stateFor(pet: PetPayload, busyAction: PetAction | null): SpriteState {
  if (pet.sleeping) return 'sleep'
  if (pet.status === 'sick') return 'sick'
  if (busyAction === 'feed' || busyAction === 'treat') return 'eat'
  if (busyAction === 'walk' || busyAction === 'play') return 'walk'
  if (['hungry', 'tired', 'dirty', 'sad'].includes(pet.status)) return 'sad'
  return 'idle'
}

export default function PetRoom({
  pet, busy, busyAction, reduced, onPet,
}: {
  pet: PetPayload
  busy: boolean
  busyAction: PetAction | null
  reduced: boolean
  onPet: () => void
}) {
  return (
    <Box
      data-pet-room
      sx={{
        position: 'relative', minHeight: { xs: 260, md: 360 }, borderRadius: 2, overflow: 'hidden',
        border: 1, borderColor: 'divider',
        background: 'linear-gradient(180deg, #DCEBF5 0%, #EAF3F7 62%, #D9C7A8 62%, #C9B28C 100%)',
      }}
    >
      <Box sx={{ position: 'absolute', left: 18, top: 18, width: 92, height: 70, borderRadius: 1, bgcolor: '#F7FBFF', border: 3, borderColor: '#8B6B4A' }}>
        <Box sx={{ position: 'absolute', inset: '8px 8px 0', background: 'linear-gradient(180deg, #BFE3F5 0 55%, #A8D6A0 55% 100%)' }} />
      </Box>
      <Box sx={{ position: 'absolute', right: 24, bottom: 36, width: 108, height: 34, borderRadius: 2, bgcolor: '#B98A5E', border: 3, borderColor: '#7A5334' }} />
      <Box sx={{ position: 'absolute', right: 38, bottom: 66, width: 80, height: 26, borderRadius: 2, bgcolor: '#D9B08A' }} />

      <Box sx={{ position: 'absolute', left: '50%', bottom: '16%', width: { xs: 150, md: 210, lg: 260 }, transform: 'translateX(-50%)' }}>
        <ButtonBase
          aria-label={`抚摸${pet.name}`}
          disabled={busy || pet.sleeping}
          onClick={onPet}
          sx={{ display: 'block', width: '100%', borderRadius: 2, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 4 } }}
        >
          <PetSprite state={stateFor(pet, busyAction)} stage={pet.stage} reduced={reduced} />
        </ButtonBase>
      </Box>

      {pet.poop_count > 0 ? (
        <Box sx={{ position: 'absolute', left: 26, bottom: 22, display: 'flex', gap: 0.75 }} role="img" aria-label={`${pet.poop_count} 堆便便`}>
          {Array.from({ length: pet.poop_count }).map((_, i) => (
            <Box key={i} sx={{ width: 14, height: 9, borderRadius: '50% 50% 40% 40%', bgcolor: '#6B4A2E', boxShadow: '0 2px 0 #4A3320' }} />
          ))}
        </Box>
      ) : null}

      <Box sx={{ position: 'absolute', right: 12, top: 12, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="img" src={portraitUrl} alt="" sx={{ width: 36, height: 36, imageRendering: 'pixelated' }} />
        <Typography variant="caption" sx={{ bgcolor: 'rgba(255,255,255,0.72)', px: 1, py: 0.25, borderRadius: 1 }}>
          {pet.status_label}
        </Typography>
      </Box>
    </Box>
  )
}
