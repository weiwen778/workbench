import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemButton, ListItemText, MenuItem, Select,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, useTheme,
} from '@mui/material'
import { Divider } from '@mui/material'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CopyDocument, Delete, DragIndicator, Edit, Plus, Refresh, Search, Brush } from '@/icons'
import GridView from '@mui/icons-material/GridView'
import ViewList from '@mui/icons-material/ViewList'
import { apiError, copyText, http } from '@/api/client'
import { EmptyHint, Page, PageBody, PageToolbar } from '@/ui/common'
import { confirmDialog, toast } from '@/ui/feedback'
import CategoryManager from '@/components/CategoryManager'
import MemoContent from '@/components/MemoContent'
import WhiteboardPicker from '@/components/WhiteboardPicker'
import type { InsertItem } from '@/whiteboard/insert'
import { memoFilter, memoTitle } from '@/memo-navigation'

const MEMO_COLORS = [
  { value: 'default', label: '默认' },
  { value: 'yellow', label: '米黄' },
  { value: 'green', label: '浅绿' },
  { value: 'blue', label: '浅蓝' },
  { value: 'pink', label: '浅粉' },
  { value: 'purple', label: '浅紫' },
]

type MemoDragState = {
  attributes: Record<string, any>
  listeners: Record<string, any> | undefined
  setActivatorNodeRef: (node: HTMLElement | null) => void
}

const MemoDragContext = createContext<MemoDragState | null>(null)

function MemoDragHandle({ label }: { label: string }) {
  const drag = useContext(MemoDragContext)
  if (!drag) return null
  return (
    <Box
      ref={drag.setActivatorNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      aria-label={`拖动排序：${label}`}
      title="拖动排序"
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 22, height: 22, borderRadius: 0.75, color: 'text.disabled', cursor: 'grab',
        touchAction: 'none', '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
        '&:active': { cursor: 'grabbing' },
      }}
    >
      <DragIndicator sx={{ fontSize: 17 }} />
    </Box>
  )
}

function SortableMemo({ id, disabled, children }: { id: number; disabled?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: Boolean(disabled) })
  return (
    <MemoDragContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
      <Box
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          zIndex: isDragging ? 3 : undefined,
          position: 'relative',
          opacity: isDragging ? 0.65 : 1,
        }}
      >
        {children}
      </Box>
    </MemoDragContext.Provider>
  )
}

export default function MemosPage() {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const memoBg = (color: string) => {
    if (color === 'default') return theme.palette.background.paper
    if (dark) {
      const map: Record<string, string> = {
        yellow: 'rgba(214,165,74,0.10)', green: 'rgba(105,176,141,0.10)',
        blue: 'rgba(90,160,200,0.10)', pink: 'rgba(224,112,150,0.10)', purple: 'rgba(170,120,210,0.10)',
      }
      return map[color] || theme.palette.background.paper
    }
    const map: Record<string, string> = {
      yellow: '#FDF9EC', green: '#F3F8F4', blue: '#F2F7FA', pink: '#FBF4F7', purple: '#F7F3FA',
    }
    return map[color] || theme.palette.background.paper
  }
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const memoFocus = searchParams.get('focus')
  const selection = memoFilter(location.search)
  const category = selection.uncategorized ? '__uncategorized__' : selection.category

  const [memos, setMemos] = useState<any[]>([])
  const [ordering, setOrdering] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [memoPage, setMemoPage] = useState(1)
  const [memoTotal, setMemoTotal] = useState(0)
  const [columns, setColumns] = useState(() => Math.min(8, Math.max(0, Number(localStorage.getItem('wb_memo_columns')) || 0)))
  const [view, setViewState] = useState<'cards' | 'list'>(() => localStorage.getItem('wb_memo_view') === 'list' ? 'list' : 'cards')
  const setView = (next: 'cards' | 'list') => { setViewState(next); localStorage.setItem('wb_memo_view', next) }
  const [viewing, setViewing] = useState<any | null>(null)
  const [wbOpen, setWbOpen] = useState(false)
  const [wbItems, setWbItems] = useState<InsertItem[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', category: '', color: 'default' })
  const searchTimer = useRef<number | null>(null)
  const memoRequest = useRef(0)
  const keywordRef = useRef(keyword)
  keywordRef.current = keyword
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const formatDate = (value: string) => value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : ''
  const memoAccent = (color: string) => ({ yellow: '#C9A25B', green: '#4F9D7A', blue: '#5A9CC8', pink: '#D06A8C', purple: '#9A78C8' } as Record<string, string>)[color] || '#9AA7A9'

  const load = useCallback(async () => {
    const request = ++memoRequest.current
    setLoading(true)
    try {
      const reqParams: Record<string, any> = { page: memoPage, page_size: 50 }
      if (category) reqParams.category = category
      if (keywordRef.current.trim()) reqParams.q = keywordRef.current.trim()
      const [{ data }, { data: cats }] = await Promise.all([
        http.get('/memos', { params: reqParams }),
        http.get('/memos/categories'),
      ])
      if (request !== memoRequest.current) return
      setMemoPage(data.page); setMemoTotal(data.total); setMemos(data.items); setCategories(cats)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }, [memoPage, category])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (memoFocus) {
      void http.get(`/memos/${Number(memoFocus)}`).then(({ data }) => openEdit(data)).catch((error) => toast.error(apiError(error).message))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoFocus])

  const onSearch = (value: string) => {
    keywordRef.current = value
    setKeyword(value); setMemoPage(1)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => void load(), 300)
  }

  const rememberColumns = (value: number) => {
    setColumns(value)
    localStorage.setItem('wb_memo_columns', String(value))
  }

  const onMemoDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (ordering || !over || active.id === over.id) return
    const from = memos.findIndex((memo) => memo.id === active.id)
    const to = memos.findIndex((memo) => memo.id === over.id)
    if (from < 0 || to < 0) return
    const previous = memos
    const reordered = arrayMove(memos, from, to)
    setMemos(reordered)
    setOrdering(true)
    try {
      await http.put('/memos/order', { ids: reordered.map((memo) => memo.id) })
    } catch (error) {
      setMemos(previous)
      toast.error(apiError(error).message)
    } finally {
      setOrdering(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ title: '', content: '', category: selection.category, color: 'default' })
    setDialogOpen(true)
  }

  const openEdit = (memo: any) => {
    setEditing(memo)
    setForm({ title: memo.title, content: memo.content, category: memo.category || '', color: memo.color || 'default' })
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.content.trim()) { toast.warning('正文不能为空'); return }
    setSaving(true)
    try {
      if (editing) {
        await http.patch(`/memos/${editing.id}`, {
          title: form.title, content: form.content, category: form.category || '', color: form.color, version: editing.version,
        })
      } else {
        await http.post('/memos', { title: form.title || null, content: form.content, category: form.category || null, color: form.color })
      }
      setDialogOpen(false)
      toast.success('已保存')
      await load()
      window.dispatchEvent(new Event('wb:memos-changed'))
    } catch (error) { toast.error(apiError(error).message) }
    finally { setSaving(false) }
  }

  const remove = async (memo: any) => {
    const ok = await confirmDialog({ title: '删除便利贴', danger: true, confirmText: '删除', message: '删除这张便利贴？回收站保留 30 天。' })
    if (!ok) return
    try { await http.delete(`/memos/${memo.id}`); await load(); window.dispatchEvent(new Event('wb:memos-changed')) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const copyContent = async (memo: any) => {
    if (!memo) return
    const ok = await copyText(memo.content)
    if (ok) toast.success('已复制正文')
    else toast.warning('浏览器不让自动复制，请打开便利贴后手动选中复制')
  }

  const sendToBoard = (memo: any) => {
    if (!memo) return
    const title = (memo.display_title || '').trim()
    const content = String(memo.content || '')
    setWbItems([{
      kind: 'text',
      title: title && title !== '无标题便利贴' ? title : undefined,
      text: content,
      color: theme.palette.mode === 'dark' ? '#f2f4f3' : '#1e2426',
    }])
    setWbOpen(true)
  }

  return (
    <Page sx={{ p: 1.5, gap: 1 }}>
      <PageToolbar sx={{ rowGap: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small" placeholder="搜索标题或正文" value={keyword} onChange={(event) => onSearch(event.target.value)}
            InputProps={{ startAdornment: <Search sx={{ fontSize: 17, mr: 0.5, color: 'text.secondary' }} /> }}
            sx={{ width: 220 }}
          />
          <Typography variant="caption" color="text.secondary">{memoTotal} 张便利贴</Typography>
        </Stack>
        <div className="spacer" />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, value) => value && setView(value)}>
            <ToggleButton value="cards" aria-label="卡片视图"><GridView sx={{ fontSize: 17 }} /></ToggleButton>
            <ToggleButton value="list" aria-label="列表视图"><ViewList sx={{ fontSize: 17 }} /></ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        {view === 'cards' ? (
          <>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>每行</Typography>
              <Select size="small" value={columns} onChange={(event) => rememberColumns(Number(event.target.value))} sx={{ width: 92, fontSize: 12 }} inputProps={{ 'aria-label': '便利贴每行列数' }}>
                <MenuItem value={0}>自动</MenuItem>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <MenuItem key={n} value={n}>{n} 列</MenuItem>)}
              </Select>
            </Stack>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
          </>
        ) : null}
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <CategoryManager resource="memos" onChanged={load} />
          <Button size="small" startIcon={<Refresh fontSize="small" />} onClick={() => void load()}>刷新</Button>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={openCreate}>新建便利贴</Button>
      </PageToolbar>

      <PageBody>
        <Box className="scroll-area memo-board" sx={{ bgcolor: 'background.default', p: 0 }}>
          {!memos.length && !loading ? (
            view === 'cards' ? (
              <EmptyHint action={<Button size="small" variant="contained" onClick={openCreate}>写一张便利贴</Button>}>
                {keyword ? '没有匹配的便利贴' : '还没有便利贴'}
              </EmptyHint>
            ) : (
              <List sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', py: 0, maxWidth: 720 }}>
                <ListItem disablePadding>
                  <ListItemButton onClick={openCreate} sx={{ gap: 1.25, px: 1.75, py: 1.25 }}>
                    <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, bgcolor: '#9AA7A9', flexShrink: 0 }} />
                    <ListItemText primary={keyword ? '没有匹配的便利贴' : '还没有便利贴'} secondary="写一张便利贴，记录临时信息。" primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 11.5 }} sx={{ my: 0 }} />
                    <Typography sx={{ fontSize: 12, color: 'primary.main', flexShrink: 0 }}>开始 →</Typography>
                  </ListItemButton>
                </ListItem>
              </List>
            )
          ) : null}
          {memoTotal > 50 ? (
            <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 2 }}>
              <Button size="small" disabled={memoPage <= 1} onClick={() => setMemoPage(memoPage - 1)}>上一页</Button>
              <Typography sx={{ fontSize: 12, alignSelf: 'center' }}>{memoPage} / {Math.ceil(memoTotal / 50)}</Typography>
              <Button size="small" disabled={memoPage >= Math.ceil(memoTotal / 50)} onClick={() => setMemoPage(memoPage + 1)}>下一页</Button>
            </Stack>
          ) : null}
          {view === 'cards' ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onMemoDragEnd(event)}>
              <SortableContext items={memos.map((memo) => memo.id)} strategy={rectSortingStrategy}>
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 1.5, gridAutoRows: 230, alignContent: 'start',
                }}>
                  {memos.map((memo) => (
                    <SortableMemo key={memo.id} id={memo.id} disabled={loading || ordering}>
                      <Card variant="outlined" sx={{
                        height: 230, display: 'flex', flexDirection: 'column', p: 1.5,
                        bgcolor: memoBg(memo.color),
                        borderColor: 'divider',
                        boxShadow: '0 1px 2px rgba(24,39,42,0.03)',
                        transition: 'border-color .15s, box-shadow .15s',
                        '&:hover': { borderColor: 'text.disabled', boxShadow: '0 4px 12px rgba(24,39,42,0.06)' },
                      }}>
                        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 1.5, minWidth: 0 }}>
                          <MemoDragHandle label={memo.display_title} />
                          <Box component="button" onClick={() => setViewing(memo)} sx={{
                            display: 'block', flex: 1, minWidth: 0, border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer',
                            font: 'inherit', fontSize: 16, fontWeight: 600, textAlign: 'left', color: 'text.primary',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{memo.display_title}</Box>
                        </Stack>
                        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                          <MemoContent content={memo.content} onExpand={() => setViewing(memo)} />
                        </Box>
                        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" spacing={1.5} sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography component="time" variant="caption" color="text.secondary" sx={{ display: 'block' }}>更新于 {formatDate(memo.updated_at)}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>{memo.display_category}</Typography>
                          </Box>
                          <Stack direction="row" spacing={0.25}>
                            <IconButton size="small" title="添加到白板" aria-label="添加到白板" onClick={() => sendToBoard(memo)}><Brush fontSize="small" /></IconButton>
                            <IconButton size="small" title="复制正文" aria-label="复制正文" onClick={() => void copyContent(memo)}><CopyDocument fontSize="small" /></IconButton>
                            <IconButton size="small" title="编辑" aria-label="编辑便利贴" onClick={() => openEdit(memo)}><Edit fontSize="small" /></IconButton>
                            <IconButton size="small" title="删除" aria-label="删除便利贴" onClick={() => void remove(memo)}><Delete fontSize="small" /></IconButton>
                          </Stack>
                        </Stack>
                      </Card>
                      </SortableMemo>
                  ))}
                </Box>
              </SortableContext>
            </DndContext>
          ) : (
            <List sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', py: 0 }}>
              {memos.map((memo) => (
                <ListItem key={memo.id} divider disablePadding sx={{ '&:last-child': { borderBottom: 0 } }}>
                  <ListItemButton onClick={() => setViewing(memo)} sx={{ gap: 1.25, px: 1.75, py: 1.25, alignItems: 'center' }}>
                    <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, bgcolor: memoAccent(memo.color), flexShrink: 0 }} />
                    <ListItemText
                      primary={memo.display_title}
                      secondary={(memo.content || '').replace(/\s+/g, ' ')}
                      primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600, noWrap: true }}
                      secondaryTypographyProps={{ fontSize: 11.5, noWrap: true }}
                      sx={{ minWidth: 0, my: 0 }}
                    />
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexShrink: 0 }}>
                      <Typography component="span" sx={{ fontSize: 11.5, color: 'text.secondary' }}>{memo.display_category}</Typography>
                      <Typography component="span" sx={{ fontSize: 11.5, color: 'text.disabled' }}>{formatDate(memo.updated_at)}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }} onClick={(event) => event.stopPropagation()}>
                      <IconButton size="small" title="添加到白板" aria-label="添加到白板" onClick={() => sendToBoard(memo)}><Brush fontSize="small" /></IconButton>
                      <IconButton size="small" title="复制正文" aria-label="复制正文" onClick={() => void copyContent(memo)}><CopyDocument fontSize="small" /></IconButton>
                      <IconButton size="small" title="编辑" aria-label="编辑便利贴" onClick={() => openEdit(memo)}><Edit fontSize="small" /></IconButton>
                      <IconButton size="small" title="删除" aria-label="删除便利贴" onClick={() => void remove(memo)}><Delete fontSize="small" /></IconButton>
                    </Stack>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </PageBody>

      <Dialog open={Boolean(viewing)} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{viewing?.display_title}</DialogTitle>
        <DialogContent><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 15.5, lineHeight: 1.8 }}>{viewing?.content}</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" startIcon={<Brush fontSize="small" />} onClick={() => { sendToBoard(viewing); setViewing(null) }}>添加到白板</Button>
          <Button size="small" onClick={() => void copyContent(viewing)}>复制正文</Button>
          <Button size="small" variant="contained" onClick={() => { if (viewing) openEdit(viewing); setViewing(null) }}>编辑</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{editing ? '编辑便利贴' : '新建便利贴'}</DialogTitle>
        <DialogContent sx={{ pt: 2.5 }}>
          <TextField fullWidth label="标题（可选）" value={form.title} inputProps={{ maxLength: 200 }} placeholder="不填则显示为无标题便利贴" onChange={(event) => setForm({ ...form, title: event.target.value })} sx={{ mb: 1.5 }} />
          <TextField
            fullWidth multiline minRows={3} maxRows={16} label="正文" required value={form.content} inputProps={{ maxLength: 2000 }}
            placeholder="随手记内容，Ctrl / Command + Enter 保存"
            onChange={(event) => setForm({ ...form, content: event.target.value })}
            onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save() } }}
            sx={{ mb: 1.5 }}
          />
          <Box>
            <TextField fullWidth size="small" label="分类（可选）" value={form.category} placeholder="选择或输入新分类" onChange={(event) => setForm({ ...form, category: event.target.value })} inputProps={{ list: 'memo-categories' }} />
            <datalist id="memo-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          </Box>
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>纸张颜色</Typography>
            <Stack direction="row" spacing={1}>
              {MEMO_COLORS.map((color) => (
                <Box
                  key={color.value}
                  component="button"
                  type="button"
                  aria-label={color.label}
                  aria-pressed={form.color === color.value}
                  onClick={() => setForm({ ...form, color: color.value })}
                  sx={{
                    width: 26, height: 26, borderRadius: 1.5, cursor: 'pointer',
                    border: 2, borderColor: form.color === color.value ? 'primary.main' : 'divider',
                    bgcolor: memoBg(color.value),
                  }}
                />
              ))}
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setDialogOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={saving} onClick={save}>保存</Button>
        </DialogActions>
      </Dialog>

      <WhiteboardPicker open={wbOpen} items={wbItems} sourceLabel="便利贴内容" onClose={() => setWbOpen(false)} />
    </Page>
  )
}
