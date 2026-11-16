import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, CircularProgress, Dialog, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem,
  Pagination, Select, Stack, TextField, Typography,
} from '@mui/material'
import { Search } from '@/icons'
import { apiError, http } from '@/api/client'

const kinds: Record<string, string> = {
  todos: '待办', notes: '笔记', memos: '便利贴', bookmarks: '书签', tables: '表格', records: '表格记录',
}

/** 全局搜索弹窗：顶栏搜索框或 Ctrl / ⌘ + K 打开。 */
export default function GlobalSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)

  useEffect(() => {
    if (!open) return
    setKeyword(''); setKind('all'); setPage(1); setItems([]); setTotal(0); setHasMore(false); setFailure('')
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [open])

  const load = useCallback(async () => {
    const query = keyword.trim()
    if (!query) { setItems([]); setTotal(0); setHasMore(false); setLoading(false); return }
    const current = ++sequence.current
    setLoading(true); setFailure('')
    try {
      const { data } = await http.get('/search', { params: { page, q: query, kind } })
      if (current !== sequence.current) return
      setItems(data.items || [])
      setTotal(data.total || 0)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      if (current === sequence.current) setFailure(apiError(error).message)
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [keyword, kind, page])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => { void load() }, 280)
    return () => window.clearTimeout(timer)
  }, [open, load])

  const go = (url: string) => {
    onClose()
    navigate(url)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" slotProps={{ paper: { sx: { maxHeight: '78vh' } } }}>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600, pb: 1 }}>统一搜索</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
          <TextField
            inputRef={inputRef}
            fullWidth
            label="搜索内容"
            placeholder="搜索待办、笔记、便利贴、书签和表格"
            value={keyword}
            onChange={(event) => { setKeyword(event.target.value); setPage(1) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && items[0]?.url) { event.preventDefault(); go(items[0].url) }
            }}
            InputProps={{ startAdornment: <Search sx={{ fontSize: 18, mr: 0.75, color: 'text.secondary' }} /> }}
          />
          <FormControl sx={{ width: { xs: '100%', sm: 170 }, flexShrink: 0 }}>
            <InputLabel shrink>内容类型</InputLabel>
            <Select label="内容类型" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1) }}>
              <MenuItem value="all">全部内容</MenuItem>
              {Object.entries(kinds).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>

        <Typography sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }}>
          {keyword.trim()
            ? <>{kind === 'all' ? '全部搜索每类最多展示 20 条' : '搜索结果'} · {kind === 'all' ? '当前展示' : '共'} {total} 项{hasMore ? '，更多结果请按类型查看' : ''}</>
            : '输入关键词搜索。'}
        </Typography>

        {failure ? <Typography sx={{ fontSize: 12.5, color: 'error.main' }}>{failure}</Typography> : null}

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', borderTop: 1, borderColor: 'divider' }}>
          {loading && !items.length ? (
            <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="center" sx={{ py: 6, color: 'text.secondary' }}>
              <CircularProgress size={16} /><Typography sx={{ fontSize: 13 }}>正在搜索…</Typography>
            </Stack>
          ) : null}
          {!loading && !items.length ? (
            <Typography sx={{ py: 6, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>
              {keyword.trim() ? '没有找到匹配内容' : '输入关键词开始搜索'}
            </Typography>
          ) : null}
          {items.map((item) => (
            <Box
              key={`${item.kind}-${item.id}`}
              role="button"
              tabIndex={0}
              onClick={() => go(item.url)}
              onKeyDown={(event) => { if (event.key === 'Enter') go(item.url) }}
              sx={{
                display: 'block', width: '100%', borderBottom: 1, borderColor: 'divider',
                py: 1.35, px: 0.75, cursor: 'pointer', borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 11, border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.6, color: 'text.secondary', flexShrink: 0 }}>
                  {kinds[item.kind] || item.kind}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 500 }} noWrap>{item.title}</Typography>
              </Stack>
              <Typography sx={{ mt: 0.75, color: 'text.secondary', fontSize: 12.5, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', overflowWrap: 'anywhere' }}>
                {item.excerpt || '无摘要'}
              </Typography>
            </Box>
          ))}
        </Box>

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexShrink: 0 }}>
          <Typography variant="caption" color="text.disabled">Enter 打开第一条结果 · Esc 关闭</Typography>
          {kind !== 'all' && total > 20 ? (
            <Pagination
              size="small"
              count={Math.max(1, Math.ceil(total / 20))}
              page={Math.min(page, Math.max(1, Math.ceil(total / 20)))}
              onChange={(_, value) => setPage(value)}
              showFirstButton
              showLastButton
            />
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
