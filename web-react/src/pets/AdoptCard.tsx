import { useState } from 'react'
import { Box, Button, TextField, Typography } from '@mui/material'
import { apiError } from '@/api/client'
import { toast } from '@/ui/feedback'
import { useAdoptPet } from '@/pets/usePet'

export default function AdoptCard() {
  const adopt = useAdoptPet()
  const [name, setName] = useState('旺财')

  return (
    <Box sx={{ maxWidth: 460, mx: 'auto', my: 6, textAlign: 'center' }}>
      <Typography variant="h5" sx={{ mb: 1 }}>领养一只狗</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        它会按真实时间饿、困、变脏。每天照顾一两分钟就够，不会永久死亡。
      </Typography>
      <TextField label="给狗狗起个名字" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 12 }} fullWidth />
      <Button
        variant="contained" sx={{ mt: 2 }} disabled={adopt.isPending}
        onClick={() => adopt.mutate(name, {
          onError: (error) => toast.error(apiError(error).message),
          onSuccess: () => toast.success('领养成功'),
        })}
      >
        领养
      </Button>
    </Box>
  )
}
