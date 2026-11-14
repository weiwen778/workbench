import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Menu, MenuItem, Paper, Popover, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { Divider } from '@mui/material'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowRight, Clock, Delete, DragIndicator, Edit, MoreFilled, Plus, Refresh } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { EmptyHint, FieldRow, LoadingBlock, Page, PageToolbar } from '@/ui/common'

type TodoDrag = {
  attributes: Record<string, any>
  listeners: Record<string, any> | undefined
  setActivatorNodeRef: (node: HTMLElement | null) => void
}
const TodoDragContext = createContext<TodoDrag | null>(null)

function SortableTodo({ id, disabled, children }: { id: number; disabled?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: Boolean(disabled) })
  return (
    <TodoDragContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
      <Box
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform), transition,
          zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.6 : 1, position: 'relative',
        }}
      >
        {children}
      </Box>
    </TodoDragContext.Provider>
  )
}

function TodoDragHandle({ label }: { label: string }) {
  const drag = useContext(TodoDragContext)
  if (!drag) return null
  return (
    <Box
      ref={drag.setActivatorNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      component="button"
      type="button"
      aria-label={`拖动排序：${label}`}
      title="拖动排序"
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 28, height: 28, p: 0, border: 0, borderRadius: 0.75, bgcolor: 'transparent',
        color: 'text.disabled', cursor: 'grab', touchAction: 'none',
        '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
        '&:active': { cursor: 'grabbing' },
      }}
    >
      <DragIndicator sx={{ fontSize: 17 }} />
    </Box>
  )
}

export default function TodosPage() {
  const params = useParams()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const focusId = search.get('focus') ? Number(search.get('focus')) : undefined

  const [lists, setLists] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [completed, setCompleted] = useState<any[]>([])
  const [counts, setCounts] = useState({ nodes_total: 0, nodes_pending: 0, nodes_done: 0, top_pending: 0, top_done: 0 })
  const [sortMode, setSortMode] = useState<'auto' | 'manual'>('auto')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [missing, setMissing] = useState(false)
  const [pendingPage, setPendingPage] = useState(1)
  const [donePage, setDonePage] = useState(1)
  const [completedOpen, setCompletedOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [listMenu, setListMenu] = useState<HTMLElement | null>(null)
  const [dueAnchor, setDueAnchor] = useState<HTMLElement | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const [newDue, setNewDue] = useState<{ due_date: string; due_time: string }>({ due_date: '', due_time: '' })
  const [subDraft, setSubDraft] = useState<Record<number, string>>({})
  const [subOpen, setSubOpen] = useState<Record<number, boolean>>({})
  const [toggling, setToggling] = useState<Set<number>>(new Set())
  const [completing, setCompleting] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ title: '', note: '', due_date: '', due_time: '' })
  const [editSaving, setEditSaving] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const listId = Number(params.listId) || null
  const currentList = lists.find((list) => list.id === listId) || null
  const viewActive = useRef(true)
  const loadRequest = useRef(0)
  useEffect(() => {
    viewActive.current = true
    return () => { viewActive.current = false }
  }, [])

  const dueText = (item: any) => !item.due_date ? '' : item.due_time ? `${item.due_date} ${item.due_time}` : item.due_date
  const formatTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''

  const focusTarget = async () => {
    if (!focusId) return
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-todo-id="${focusId}"]`)
      target?.scrollIntoView({ block: 'center' })
      target?.closest('.task-row')?.classList.add('search-focus')
    }, 60)
  }

  const loadLists = useCallback(async () => {
    const { data } = await http.get('/todo-lists')
    setLists(data)
    const selected = data.find((list: any) => String(list.id) === String(params.listId))
    if (selected) setSortMode(selected.sort_mode)
    setMissing(Boolean(params.listId) && !selected)
    return data as any[]
  }, [params.listId])

  const load = useCallback(async (silent = false) => {
    if (!listId || !viewActive.current) return
    const request = ++loadRequest.current
    if (!silent) setLoading(true)
    try {
      const { data } = await http.get('/todos', {
        params: { list_id: listId, page: pendingPage, completed_page: donePage, page_size: 50, focus: focusId },
      })
      if (!viewActive.current || request !== loadRequest.current) return
      if (focusId && data.completed.some((item: any) => item.id === focusId || item.children.some((child: any) => child.id === focusId))) setCompletedOpen(true)
      setMissing(false); setLoadError('')
      setPendingPage(data.page || 1); setDonePage(data.completed_page || 1)
      setPending(data.pending); setCompleted(data.completed); setCounts(data.counts); setLists(data.lists)
      setSortMode(data.list.sort_mode)
      window.dispatchEvent(new CustomEvent('wb:todos-changed', { detail: { lists: data.lists } }))
      void focusTarget()
    } catch (error: any) {
      if (viewActive.current && request === loadRequest.current) {
        const message = apiError(error).message
        setLoadError(message)
        setMissing(error?.response?.status === 404)
        toast.error(message)
      }
    } finally {
      if (viewActive.current && request === loadRequest.current) { setLoading(false); setLoaded(true) }
    }
  }, [listId, pendingPage, donePage, focusId])

  useEffect(() => {
    if (params.listId) { void load(); return }
    void loadLists().then((data) => {
      const first = data[0]
      if (first) navigate(`/todos/${first.id}`, { replace: true })
      else { setLoading(false); setLoaded(true) }
    }).catch((error) => toast.error(apiError(error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.listId])

  const createList = async () => {
    const value = await promptDialog({ title: '新建清单', label: '清单名称', defaultValue: '工作', confirmText: '创建' })
    if (!value) return
    try {
      const { data } = await http.post('/todo-lists', { name: value })
      window.dispatchEvent(new Event('wb:todos-changed'))
      navigate(`/todos/${data.id}`)
    } catch (error) { toast.error(apiError(error).message) }
  }

  const listCommand = async (command: string, list: any) => {
    setListMenu(null)
    if (command === 'rename') {
      const value = await promptDialog({ title: '重命名', label: '清单名称', defaultValue: list.name })
      if (!value) return
      try { await http.patch(`/todo-lists/${list.id}`, { name: value }); await load() } catch (error) { toast.error(apiError(error).message) }
      return
    }
    try {
      const { data } = await http.get(`/todo-lists/${list.id}/delete-preview`)
      const ok = await confirmDialog({
        title: '删除清单', danger: true, confirmText: '删除',
        message: `清单「${data.list_name}」里有 ${data.top_total} 个待办、${data.subtask_total} 个子任务（含已完成的）。回收站保留 30 天。`,
      })
      if (!ok) return
      await http.delete(`/todo-lists/${list.id}`)
      const { data: nextLists } = await http.get('/todo-lists')
      setLists(nextLists)
      window.dispatchEvent(new Event('wb:todos-changed'))
      navigate(nextLists.length ? `/todos/${nextLists[0].id}` : '/todos', { replace: true })
      toast.success('已删除')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const addTodo = async () => {
    if (!listId || !newTitle.trim()) return
    setAdding(true)
    try {
      await http.post('/todos', {
        list_id: listId, title: newTitle.trim(), note: null,
        due_date: newDue.due_date || null, due_time: newDue.due_time || null,
      })
      setNewTitle(''); setNewDue({ due_date: '', due_time: '' })
      await load(true); await focusTarget()
    } catch (error) { toast.error(apiError(error).message) }
    finally { setAdding(false) }
  }

  const addSubtask = async (parent: any) => {
    const title = (subDraft[parent.id] || '').trim()
    if (!title) return
    try {
      await http.post('/todos', { list_id: listId, parent_id: parent.id, title })
      setSubDraft((prev) => ({ ...prev, [parent.id]: '' }))
      await load(true); await focusTarget()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const toggleCompletion = async (item: any) => {
    if (toggling.has(item.id)) return
    setToggling((prev) => new Set(prev).add(item.id))
    try {
      await http.post(`/todos/${item.id}/${item.completed ? 'cancel' : 'complete'}`)
      if (!viewActive.current) return
      if (!item.completed) {
        setCompleting((prev) => new Set(prev).add(item.id))
        await new Promise((resolve) => window.setTimeout(resolve, 160))
      }
      await load(true)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setToggling((prev) => { const next = new Set(prev); next.delete(item.id); return next })
      setCompleting((prev) => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  const changeSortMode = async (value: 'auto' | 'manual') => {
    try { await http.patch(`/todo-lists/${listId}`, { sort_mode: value }); await load(true) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const reorderTasks = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pending.findIndex((item) => item.id === active.id)
    const newIndex = pending.findIndex((item) => item.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const order = arrayMove(pending.map((item) => item.id), oldIndex, newIndex)
    setPending((prev) => arrayMove(prev, oldIndex, newIndex))
    try {
      await http.post('/todos/reorder', { start_index: (pendingPage - 1) * 50, list_id: listId, order })
      await load(true)
    } catch (error) {
      toast.error(apiError(error).message)
      await load(true)
    }
  }

  const openEdit = (item: any) => {
    setEditing(item)
    setEditForm({ title: item.title, note: item.note || '', due_date: item.due_date || '', due_time: item.due_time || '' })
  }

  const saveEdit = async () => {
    if (!editing || editSaving) return
    if (!editForm.title.trim()) { toast.warning('标题不能为空'); return }
    setEditSaving(true)
    try {
      const payload: Record<string, any> = { title: editForm.title.trim(), note: editForm.note }
      if (editForm.due_date) { payload.due_date = editForm.due_date; payload.due_time = editForm.due_time || null }
      else payload.clear_due = true
      await http.patch(`/todos/${editing.id}`, payload)
      setEditing(null)
      await load(true)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setEditSaving(false) }
  }

  const removeTodo = async (item: any) => {
    const suffix = item.children?.length ? `及其 ${item.children.length} 个子任务` : ''
    const ok = await confirmDialog({ title: '删除待办', danger: true, confirmText: '删除', message: `删除「${item.title}」${suffix}？回收站保留 30 天。` })
    if (!ok) return
    try { await http.delete(`/todos/${item.id}`); await load(true) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const renderTask = (item: any, kind: 'pending' | 'completed') => (
    <Box
      key={item.id}
      aria-busy={toggling.has(item.id)}
      data-todo-id={item.id}
      sx={{ borderTop: 1, borderColor: 'divider', opacity: completing.has(item.id) ? 0.55 : 1, '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Box className={`task-row${item.overdue ? ' overdue' : ''}${kind === 'completed' ? ' completed' : ''}`} sx={{ px: 1.5, py: 0.5, minHeight: 40 }}>
        <Tooltip title={item.can_toggle ? '' : '有子任务时，完成情况看子任务，请一个个勾选'}>
          <span>
            <Checkbox
              size="small"
              data-todo-id={item.id}
              checked={kind === 'completed' ? true : Boolean(item.completed || completing.has(item.id))}
              disabled={!item.can_toggle || toggling.has(item.id)}
              onChange={() => void toggleCompletion(item)}
            />
          </span>
        </Tooltip>
        <div className="task-main">
          <div className="task-title">
            <Typography component="span" variant="body2" sx={{ textDecoration: kind === 'completed' ? 'line-through' : 'none', color: kind === 'completed' ? 'text.secondary' : 'text.primary' }}>{item.title}</Typography>
            {item.subtask_total ? <Typography variant="caption" color="text.secondary">子任务 {item.subtask_done}/{item.subtask_total}</Typography> : null}
            {item.overdue ? <Typography component="span" variant="caption" color="error">逾期</Typography> : null}
          </div>
          <div className="task-meta">
            {item.due_date ? <Typography variant="caption" color="text.secondary"><Clock sx={{ fontSize: 14, verticalAlign: -2 }} /> {dueText(item)}</Typography> : null}
            {item.note ? <Typography variant="caption" color="text.secondary" className="note-text">{item.note}</Typography> : null}
            {kind === 'completed' && item.completed_at ? <Typography variant="caption" color="text.secondary">完成于 {formatTime(item.completed_at)}</Typography> : null}
          </div>
          {(item.children.length || subOpen[item.id]) ? (
            <div className="subtasks">
              {item.children.map((child: any) => (
                <div key={child.id} className={`subtask-row${completing.has(child.id) ? ' is-completing' : ''}`} data-todo-id={child.id}>
                  <Checkbox
                    size="small" checked={Boolean(child.completed || completing.has(child.id))}
                    disabled={toggling.has(child.id)} onChange={() => void toggleCompletion(child)}
                    sx={{ p: 0.4 }}
                  />
                  <span className={`todo-label${child.completed ? ' done' : ''}`}>{child.title}</span>
                  <div className="spacer" />
                  {kind === 'pending' ? <IconButton size="small" title="删除子任务" onClick={() => void removeTodo(child)}><Delete sx={{ fontSize: 15 }} /></IconButton> : null}
                </div>
              ))}
              {kind === 'pending' ? (
                <div className="subtask-add">
                  <TextField
                    size="small" fullWidth placeholder="添加子任务，回车保存" inputProps={{ maxLength: 200 }}
                    value={subDraft[item.id] || ''}
                    onChange={(event) => setSubDraft((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === 'Enter') void addSubtask(item) }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {kind === 'pending' ? (
          <div className="task-actions">
            {sortMode === 'manual' ? <TodoDragHandle label={item.title} /> : null}
            {!item.children.length ? <IconButton size="small" title="添加子任务" onClick={() => setSubOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}><Plus sx={{ fontSize: 16 }} /></IconButton> : null}
            <IconButton size="small" title="编辑待办" onClick={() => openEdit(item)}><Edit sx={{ fontSize: 16 }} /></IconButton>
            <IconButton size="small" title="删除" onClick={() => void removeTodo(item)}><Delete sx={{ fontSize: 16 }} /></IconButton>
          </div>
        ) : (
          <div className="task-actions" style={{ opacity: 0.55 }}><IconButton size="small" title="删除" onClick={() => void removeTodo(item)}><Delete sx={{ fontSize: 16 }} /></IconButton></div>
        )}
      </Box>
    </Box>
  )

  return (
    <Box className="todos-layout">
      <Box className="task-pane" sx={{ p: 1.5, gap: 1 }}>
        <PageToolbar sx={{ rowGap: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            {currentList ? (
              <>
                <IconButton size="small" aria-label="清单操作" onClick={(event) => setListMenu(event.currentTarget)}><MoreFilled fontSize="small" /></IconButton>
                <Menu anchorEl={listMenu} open={Boolean(listMenu)} onClose={() => setListMenu(null)}>
                  <MenuItem onClick={() => { setListMenu(null); void createList() }}>新建清单</MenuItem>
                  <MenuItem onClick={() => currentList && void listCommand('rename', currentList)}>重命名清单</MenuItem>
                  <MenuItem divider sx={{ color: 'error.main' }} onClick={() => currentList && void listCommand('delete', currentList)}>删除清单</MenuItem>
                </Menu>
              </>
            ) : null}
            <ToggleButtonGroup size="small" exclusive value={sortMode} disabled={!currentList} onChange={(_, value) => value && void changeSortMode(value)}>
              <ToggleButton value="auto">按截止时间</ToggleButton>
              <ToggleButton value="manual">手动排序</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">未完成 {counts.nodes_pending} / 全部 {counts.nodes_total}</Typography>
          </Stack>
          <div className="spacer" />
          <Tooltip title="刷新">
            <span><IconButton size="small" aria-label="刷新待办" onClick={() => void load()}><Refresh fontSize="small" /></IconButton></span>
          </Tooltip>
        </PageToolbar>

        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, mb: 1 }}>
          <Plus sx={{ fontSize: 16, color: 'text.disabled' }} />
          <TextField
            fullWidth variant="standard" value={newTitle} disabled={!currentList}
            placeholder="添加待办，回车保存" inputProps={{ maxLength: 200 }}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addTodo() }}
            InputProps={{ disableUnderline: true }}
            sx={{ minWidth: 0 }}
          />
          <Button size="small" startIcon={<Clock fontSize="small" />} disabled={!currentList} onClick={(event) => setDueAnchor(event.currentTarget)} sx={{ whiteSpace: 'nowrap', flexShrink: 0, color: 'text.secondary' }}>
            {newDue.due_date ? (newDue.due_time ? `${newDue.due_date} ${newDue.due_time}` : newDue.due_date) : '截止'}
          </Button>
          <IconButton size="small" aria-label="添加待办" disabled={!currentList || adding} onClick={() => void addTodo()}><Plus fontSize="small" /></IconButton>
        </Paper>

        <div className="scroll-area">
          {loading ? <LoadingBlock /> : null}
          {loadError ? <Alert severity="error" action={<Button size="small" onClick={() => void load()}>重试加载</Button>}>{loadError}</Alert> : null}
          {!currentList ? (
            <EmptyHint action={<Button size="small" sx={{ mt: 1.5 }} onClick={createList}>新建清单</Button>}>
              {missing ? '清单不存在或已删除' : '选择或新建清单'}
            </EmptyHint>
          ) : (
            <>
              {counts.top_pending > 50 ? (
                <Stack direction="row" justifyContent="flex-end" sx={{ py: 0.5 }}>
                  <Button size="small" disabled={pendingPage <= 1} onClick={() => setPendingPage(pendingPage - 1)}>上一页</Button>
                  <Typography sx={{ fontSize: 12, alignSelf: 'center', px: 1 }}>{pendingPage} / {Math.ceil(counts.top_pending / 50)}</Typography>
                  <Button size="small" disabled={pendingPage >= Math.ceil(counts.top_pending / 50)} onClick={() => setPendingPage(pendingPage + 1)}>下一页</Button>
                </Stack>
              ) : null}
              {pending.length || completed.length ? (
                <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                  {loaded ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void reorderTasks(event)}>
                      <SortableContext items={pending.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                        {pending.map((item) => (
                          <SortableTodo key={item.id} id={item.id} disabled={sortMode !== 'manual'}>
                            {renderTask(item, 'pending')}
                          </SortableTodo>
                        ))}
                      </SortableContext>
                    </DndContext>
                  ) : null}
                  {completed.length ? (
                    <>
                      <Button
                        size="small" fullWidth onClick={() => setCompletedOpen(!completedOpen)}
                        startIcon={completedOpen ? <ArrowDown fontSize="small" /> : <ArrowRight fontSize="small" />}
                        sx={{ justifyContent: 'flex-start', color: 'text.secondary', borderTop: pending.length ? 1 : 0, borderColor: 'divider', borderRadius: 0 }}
                      >
                        已完成 {counts.top_done}
                      </Button>
                      {completedOpen ? (
                        <>
                          {counts.top_done > 50 ? (
                            <Stack direction="row" justifyContent="flex-end" sx={{ py: 0.5 }}>
                              <Button size="small" disabled={donePage <= 1} onClick={() => setDonePage(donePage - 1)}>上一页</Button>
                              <Typography sx={{ fontSize: 12, alignSelf: 'center', px: 1 }}>{donePage} / {Math.ceil(counts.top_done / 50)}</Typography>
                              <Button size="small" disabled={donePage >= Math.ceil(counts.top_done / 50)} onClick={() => setDonePage(donePage + 1)}>下一页</Button>
                            </Stack>
                          ) : null}
                          {completed.map((item) => renderTask(item, 'completed'))}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </Paper>
              ) : null}
              {!pending.length && !completed.length && !loading ? <EmptyHint>这个清单还没有待办</EmptyHint> : null}
            </>
          )}
        </div>
      </Box>

      <Popover open={Boolean(dueAnchor)} anchorEl={dueAnchor} onClose={() => setDueAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ width: 300, p: 1.5 }}>
          <Typography sx={{ fontSize: 13, mb: 1 }}>截止时间（可不填）</Typography>
          <TextField fullWidth size="small" type="date" label="日期" InputLabelProps={{ shrink: true }} value={newDue.due_date} onChange={(event) => setNewDue({ ...newDue, due_date: event.target.value })} />
          <TextField fullWidth size="small" type="time" label="时间" InputLabelProps={{ shrink: true }} value={newDue.due_time} onChange={(event) => setNewDue({ ...newDue, due_time: event.target.value })} sx={{ mt: 1.5 }} />
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
            <Button size="small" onClick={() => setNewDue({ due_date: '', due_time: '' })}>清空</Button>
          </Stack>
        </Box>
      </Popover>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>编辑待办</DialogTitle>
        <DialogContent>
          <FieldRow label="标题" required><TextField fullWidth value={editForm.title} inputProps={{ maxLength: 200 }} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} /></FieldRow>
          <FieldRow label="说明"><TextField fullWidth multiline minRows={3} inputProps={{ maxLength: 5000 }} value={editForm.note} onChange={(event) => setEditForm({ ...editForm, note: event.target.value })} /></FieldRow>
          <FieldRow label="截止日期"><TextField fullWidth type="date" value={editForm.due_date} onChange={(event) => setEditForm({ ...editForm, due_date: event.target.value })} /></FieldRow>
          <FieldRow label="具体时间（可选）"><TextField fullWidth type="time" value={editForm.due_time} onChange={(event) => setEditForm({ ...editForm, due_time: event.target.value })} /></FieldRow>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setEditForm({ ...editForm, due_date: '', due_time: '' })}>清空截止</Button>
          <Button size="small" onClick={() => setEditing(null)}>取消</Button>
          <Button size="small" variant="contained" disabled={editSaving} onClick={saveEdit}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
