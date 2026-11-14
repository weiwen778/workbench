import { useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import { apiError } from '@/api/client'
import { EmptyHint, LoadingBlock, Page, PageBody, PageToolbar } from '@/ui/common'
import { toast } from '@/ui/feedback'
import AdoptCard from '@/pets/AdoptCard'
import ActionBar from '@/pets/ActionBar'
import NeedsPanel from '@/pets/NeedsPanel'
import { usePetAction, usePetQuery, useRenamePet } from '@/pets/usePet'

export default function PetPage() {
  const { data, dataUpdatedAt, isLoading, isError, refetch } = usePetQuery()
  const rename = useRenamePet()
  const action = usePetAction()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const bonusShown = useRef('')

  useEffect(() => {
    const bonus = data?.daily_bonus
    if (bonus && bonusShown.current !== bonus.date) {
      bonusShown.current = bonus.date
      toast.success(`今天完成过${bonus.source === 'checkin' ? '打卡' : '待办'}，心情 +${bonus.mood}，获得 ${bonus.treats} 份零食`)
    }
  }, [data?.daily_bonus])

  if (isLoading) return <Page><LoadingBlock text="正在找狗狗…" /></Page>
  if (isError) return <Page><EmptyHint action={<Button onClick={() => void refetch()}>重试</Button>}>狗狗走丢了，稍后再试</EmptyHint></Page>

  const pet = data?.pet
  if (!pet) {
    return (
      <Page>
        <PageBody>
          <AdoptCard />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageToolbar>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{pet.name}</Typography>
        <Typography variant="body2" color="text.secondary">{pet.stage_label} · {pet.status_label}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => { setRenameValue(pet.name); setRenameOpen(true) }}>改名</Button>
      </PageToolbar>
      <PageBody>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 320px' }, gap: 2, flex: 1, minHeight: 0 }}>
          <Box sx={{ minWidth: 0, minHeight: 320, borderRadius: 2, bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}>
            <Typography color="text.secondary">狗狗的房间</Typography>
          </Box>
          <Box sx={{ minWidth: 0, borderRadius: 2, border: 1, borderColor: 'divider', p: 2 }}>
            <NeedsPanel pet={pet} />
            <Box sx={{ mt: 2 }}>
              <ActionBar
                pet={pet}
                syncedAt={dataUpdatedAt}
                pending={action.isPending ? action.variables ?? null : null}
                onAction={(next) => action.mutate(next, {
                  onSuccess: (result) => toast.success(result.message),
                  onError: (error) => toast.error(apiError(error).message),
                })}
              />
            </Box>
          </Box>
        </Box>
      </PageBody>
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} aria-labelledby="rename-pet-title">
        <DialogTitle id="rename-pet-title">给狗狗改名</DialogTitle>
        <DialogContent>
          <TextField autoFocus label="名字" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} inputProps={{ maxLength: 12 }} fullWidth sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>取消</Button>
          <Button
            variant="contained" disabled={rename.isPending}
            onClick={() => rename.mutate(renameValue, {
              onSuccess: () => { setRenameOpen(false); toast.success('改名成功') },
              onError: (error) => toast.error(apiError(error).message),
            })}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}
