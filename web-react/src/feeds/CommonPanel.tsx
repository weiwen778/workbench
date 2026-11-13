import { useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { ExternalLink } from '@/icons'
import { apiError } from '@/api/client'
import { EmptyHint, LoadingBlock } from '@/ui/common'
import { getCommonSources, type CommonGroup } from '@/feeds/api'

export default function CommonPanel() {
  const [groups, setGroups] = useState<CommonGroup[]>([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const result = await getCommonSources()
      setGroups(result.groups)
      setNote(result.note)
      setError('')
    } catch (reason) {
      setError(apiError(reason).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  if (loading) return <LoadingBlock text="正在读取常用信息源…" />
  if (error) return <EmptyHint action={<Button size="small" onClick={() => void load()}>重试</Button>}>{error}</EmptyHint>

  return (
    <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.25, md: 1.5 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {note ? <Alert severity="info" variant="outlined" sx={{ py: 0.25, fontSize: 12 }}>{note}</Alert> : null}
      {groups.map((group) => (
        <Box key={group.key} component="section">
          <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 0.25 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 650 }}>{group.label}</Typography>
            <Chip size="small" variant="outlined" label="官方入口 · 不自动刷新" sx={{ height: 20, fontSize: 10 }} />
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 1 }}>{group.description}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            {group.items.map((item) => (
              <Paper key={item.key} variant="outlined" sx={{ p: 1.4, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography sx={{ fontSize: 13.5, fontWeight: 650, flex: 1 }}>{item.title}</Typography>
                  <Chip size="small" variant="outlined" label={item.platform} sx={{ height: 20, fontSize: 10 }} />
                </Stack>
                <Typography sx={{ fontSize: 11.8, color: 'text.secondary', lineHeight: 1.6 }}>{item.note}</Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Button
                    size="small" variant="outlined" endIcon={<ExternalLink fontSize="small" />}
                    href={item.url} target="_blank" rel="noopener noreferrer"
                  >
                    打开网站
                  </Button>
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
