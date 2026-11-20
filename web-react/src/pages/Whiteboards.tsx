import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Chip, IconButton, InputAdornment, Menu, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import StaggerList, { StaggerItem } from '@/motion/components/StaggerList'
import LiftCard from '@/motion/components/LiftCard'
import { Brush, Edit, MoreFilled, Plus, Search } from '@/icons'
import { apiError } from '@/api/client'
import { useSession } from '@/session'
import { EmptyHint, LoadingBlock, ModuleToolbar, Page, PageBody } from '@/ui/common'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import {
  createWhiteboard, deleteWhiteboard, duplicateWhiteboard, listWhiteboards, renameWhiteboard,
  type WhiteboardSummary,
} from '@/whiteboard/api'
import { listDraftBoardIds, deleteDraft } from '@/whiteboard/db'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleString('zh-CN', sameYear
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function WhiteboardsPage() {
  const navigate = useNavigate()
  const session = useSession()
  const [boards, setBoards] = useState<WhiteboardSummary[]>([])
  const [drafts, setDrafts] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [boardMenu, setBoardMenu] = useState<{ el: HTMLElement; board: WhiteboardSummary } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, draftIds] = await Promise.all([
        listWhiteboards(),
        session.user ? listDraftBoardIds(session.user.id) : Promise.resolve([]),
      ])
      setBoards(list)
      setDrafts(new Set(draftIds))
    } catch (reason) {
      setError(apiError(reason).message)
    } finally {
      setLoading(false)
    }
  }, [session.user])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return boards
    return boards.filter((board) => board.title.toLowerCase().includes(keyword))
  }, [boards, query])

  const create = async () => {
    const name = await promptDialog({
      title: '新建白板',
      label: '白板名称',
      defaultValue: '未命名白板',
      maxLength: 120,
      confirmText: '创建',
    })
    if (!name) return
    try {
      const created = await createWhiteboard(name.trim())
      toast.success('白板已创建')
      navigate(`/whiteboards/${created.id}`)
    } catch (reason) {
      toast.error(apiError(reason).message)
    }
  }

  const rename = async (board: WhiteboardSummary) => {
    const name = await promptDialog({
      title: '重命名白板',
      label: '白板名称',
      defaultValue: board.title,
      maxLength: 120,
      confirmText: '保存',
    })
    if (!name || name.trim() === board.title) return
    setBusyId(board.id)
    try {
      const updated = await renameWhiteboard(board.id, name.trim())
      setBoards((prev) => prev
        .map((item) => item.id === board.id ? { ...item, title: updated.title, updated_at: updated.updated_at } : item)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)))
      toast.success('名称已更新')
    } catch (reason) {
      toast.error(apiError(reason).message)
    } finally {
      setBusyId(null)
    }
  }

  const duplicate = async (board: WhiteboardSummary) => {
    setBusyId(board.id)
    try {
      const copy = await duplicateWhiteboard(board.id)
      toast.success(`已复制为「${copy.title}」`)
      void load()
    } catch (reason) {
      toast.error(apiError(reason).message)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (board: WhiteboardSummary) => {
    const ok = await confirmDialog({
      title: '删除白板',
      message: `确定删除「${board.title}」吗？删除后无法恢复，已插入其他白板的图片不受影响。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    setBusyId(board.id)
    try {
      await deleteWhiteboard(board.id)
      if (session.user) await deleteDraft(session.user.id, board.id)
      setBoards((prev) => prev.filter((item) => item.id !== board.id))
      toast.success('白板已删除')
    } catch (reason) {
      toast.error(apiError(reason).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Page>
      <ModuleToolbar
        info={<Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{boards.length} 个 · 按最近编辑排序</Typography>}
        filters={(
          <TextField
            size="small" placeholder="搜索白板" value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ width: { xs: '100%', sm: 220 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 17 }} /></InputAdornment> }}
          />
        )}
        onRefresh={() => void load()}
        refreshLabel="刷新白板列表"
        refreshDisabled={loading}
        primary={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => void create()}>新建白板</Button>}
      />
      <PageBody>
        {loading ? <LoadingBlock text="正在加载白板…" /> : error ? (
          <EmptyHint action={<Button size="small" onClick={() => void load()}>重试</Button>}>{error}</EmptyHint>
        ) : filtered.length === 0 ? (
          <EmptyHint action={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => void create()}>新建白板</Button>}>
            {boards.length ? '没有匹配的白板' : '还没有白板。新建一个，开始画流程图、圈画截图或自由书写。'}
          </EmptyHint>
        ) : (
          <StaggerList className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gridAutoRows: 'max-content', gap: 1.5, alignContent: 'start', pt: 1, pb: 1 }}>
            {filtered.map((board) => (
              <StaggerItem key={board.id} sx={{ display: 'flex', minWidth: 0 }}>
              <LiftCard
                className="wb-card" variant="outlined"
                sx={{
                  flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  '&:hover': { borderColor: 'text.disabled', boxShadow: '0 4px 14px rgba(24,39,42,0.08)' },
                }}
              >
                <Box
                  role="button" tabIndex={0} aria-label={`打开白板 ${board.title}`}
                  onClick={() => navigate(`/whiteboards/${board.id}`)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/whiteboards/${board.id}`) } }}
                  sx={{ cursor: 'pointer', outline: 'none', '&:focus-visible': { boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}` } }}
                >
                  <Box className="wb-thumb" sx={{
                    height: 92, position: 'relative', overflow: 'hidden',
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? '#101719' : '#F6F8F6',
                    backgroundImage: (theme) => `radial-gradient(${theme.palette.mode === 'dark' ? '#263034' : '#DDE4DF'} 1px, transparent 1px)`,
                    backgroundSize: '18px 18px', borderBottom: 1, borderColor: 'divider',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Brush sx={{ fontSize: 30, color: 'text.disabled' }} />
                    <Chip
                      size="small" label={`${board.element_count} 个元素`} variant="outlined"
                      sx={{ position: 'absolute', right: 8, bottom: 8, bgcolor: 'background.paper', fontSize: 10.5, height: 22 }}
                    />
                    {drafts.has(board.id) ? (
                      <Chip size="small" color="warning" variant="outlined" label="本地草稿" sx={{ position: 'absolute', left: 8, bottom: 8, bgcolor: 'background.paper', fontSize: 10.5, height: 22 }} />
                    ) : null}
                  </Box>
                  <Box sx={{ px: 1.5, pt: 1.25 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={board.title}>{board.title}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.25 }}>更新于 {formatDate(board.updated_at)}</Typography>
                  </Box>
                </Box>
                <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.25} sx={{ px: 0.75, py: 0.5, mt: 0.5 }}>
                  <IconButton size="small" aria-label={`重命名 ${board.title}`} disabled={busyId === board.id} onClick={() => void rename(board)}><Edit sx={{ fontSize: 16 }} /></IconButton>
                  <Tooltip title="更多"><IconButton size="small" aria-label={`更多白板操作 ${board.title}`} disabled={busyId === board.id} onClick={(event) => setBoardMenu({ el: event.currentTarget, board })}><MoreFilled fontSize="small" /></IconButton></Tooltip>
                </Stack>
              </LiftCard>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </PageBody>
      <Menu anchorEl={boardMenu?.el || null} open={Boolean(boardMenu)} onClose={() => setBoardMenu(null)}>
        <MenuItem onClick={() => { const board = boardMenu?.board; setBoardMenu(null); if (board) void duplicate(board) }}>复制白板</MenuItem>
        <MenuItem divider sx={{ color: 'error.main' }} onClick={() => { const board = boardMenu?.board; setBoardMenu(null); if (board) void remove(board) }}>删除白板</MenuItem>
      </Menu>
    </Page>
  )
}
