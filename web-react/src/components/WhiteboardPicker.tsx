import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment,
  List, ListItemButton, ListItemText, Stack, TextField, Typography,
} from '@mui/material'
import { Plus, Search } from '@/icons'
import { apiError } from '@/api/client'
import { toast } from '@/ui/feedback'
import { createWhiteboard, listWhiteboards, type WhiteboardSummary } from '@/whiteboard/api'
import { stageInsert, type InsertItem } from '@/whiteboard/insert'

interface Props {
  open: boolean
  items: InsertItem[] | null
  sourceLabel: string
  onClose: () => void
}

const dateLabel = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function WhiteboardPicker({ open, items, sourceLabel, onClose }: Props) {
  const navigate = useNavigate()
  const [boards, setBoards] = useState<WhiteboardSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setBoards(await listWhiteboards()) }
    catch (reason) { setError(apiError(reason).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setNewTitle('')
    void load()
  }, [open, load])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return boards
    return boards.filter((board) => board.title.toLowerCase().includes(keyword))
  }, [boards, query])

  const insertInto = (boardId: number, title: string) => {
    if (!items?.length || busy) return
    const token = stageInsert(items)
    toast.success(`正在插入到「${title}」`)
    onClose()
    navigate(`/whiteboards/${boardId}?insert=${token}`)
  }

  const createAndInsert = async () => {
    if (!items?.length || busy) return
    setBusy(true)
    try {
      const created = await createWhiteboard(newTitle.trim() || '未命名白板')
      insertInto(created.id, created.title)
    } catch (reason) {
      toast.error(apiError(reason).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>插入到白板</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
          将{sourceLabel}副本插入目标白板；插入后进入白板编辑，保存时写入服务器。
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ mb: 1 }}>
          <TextField
            size="small" fullWidth placeholder="搜索白板" value={query}
            onChange={(event) => setQuery(event.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 17 }} /></InputAdornment> }}
          />
          <Button size="small" startIcon={<Plus fontSize="small" />} onClick={() => void load()} disabled={loading}>刷新</Button>
        </Stack>
        <Box sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2, color: 'text.secondary' }}>
              <CircularProgress size={16} /><Typography sx={{ fontSize: 12 }}>正在加载白板…</Typography>
            </Stack>
          ) : error ? (
            <Typography sx={{ p: 2, fontSize: 12.5, color: 'error.main' }}>{error}</Typography>
          ) : filtered.length === 0 ? (
            <Typography sx={{ p: 2, fontSize: 12.5, color: 'text.secondary' }}>{boards.length ? '没有匹配的白板' : '还没有白板，可在下方新建并插入'}</Typography>
          ) : (
            <List dense disablePadding>
              {filtered.map((board) => (
                <ListItemButton key={board.id} onClick={() => insertInto(board.id, board.title)} disabled={busy}>
                  <ListItemText
                    primary={board.title}
                    secondary={`${board.element_count} 个元素 · 更新于 ${dateLabel(board.updated_at)}`}
                    primaryTypographyProps={{ fontSize: 13, fontWeight: 600, noWrap: true }}
                    secondaryTypographyProps={{ fontSize: 11.5, noWrap: true }}
                  />
                  <Typography sx={{ fontSize: 12, color: 'primary.main', ml: 1, flexShrink: 0 }}>插入</Typography>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ mt: 1.25 }}>
          <TextField
            size="small" fullWidth label="新建白板名称" placeholder="未命名白板"
            value={newTitle} onChange={(event) => setNewTitle(event.target.value)}
            inputProps={{ maxLength: 120 }}
            onKeyDown={(event) => { if (event.key === 'Enter') void createAndInsert() }}
          />
          <Button size="small" variant="contained" disabled={busy} onClick={() => void createAndInsert()} sx={{ flexShrink: 0 }}>
            新建并插入
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose}>取消</Button>
      </DialogActions>
    </Dialog>
  )
}
