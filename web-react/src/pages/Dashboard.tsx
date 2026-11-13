import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel,
  Avatar, Card, CardActionArea, IconButton, Link, List, ListItem, ListItemButton, ListItemText, Menu, MenuItem, Paper, Select, Stack, TextField, Tooltip,
  ToggleButton, ToggleButtonGroup, Typography, useTheme,
} from '@mui/material'
import { Divider } from '@mui/material'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import GridView from '@mui/icons-material/GridView'
import ViewList from '@mui/icons-material/ViewList'
import { AutoAwesome, ChevronDown, DashboardIcon, DragIndicator, MoreFilled, Plus, Refresh, Search } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { EmptyHint, FieldRow, Page, PageBody, PageToolbar } from '@/ui/common'
import DashboardChart from '@/components/DashboardChart'
import DashboardAiDialog from '@/components/DashboardAiDialog'
import ProgressEditor from '@/components/ProgressEditor'
import { aggregationLabels, chartLabels, chartPalette, type DashboardBoard, type DashboardResult, type DashboardWidget, type ProgressConfig } from '@/dashboard'

const emptyProgress = (): ProgressConfig => ({
  mode: 'tasks', display: 'bar', completed: { field: '', op: 'eq', value: true },
  actual_field: null, target_mode: 'rows', target_field: null, target_value: '100', filters: [], due_field: null,
})

const emptyWidget = (): DashboardWidget => ({
  id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, title: '', kind: 'metric', table_id: 0,
  aggregation: 'count', value_field: null, value_fields: [], group_field: null, date_field: null,
  date_bucket: 'day', sort: 'value_desc', limit: 10, decimals: 0, unit: '', wide: false, progress: emptyProgress(),
})

function readIds(key: string): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'number') : []
  } catch { return [] }
}

function relativeTime(value?: string) {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return '—'
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

type DragHandleState = {
  attributes: Record<string, any>
  listeners: Record<string, any> | undefined
  setActivatorNodeRef: (node: HTMLElement | null) => void
}

const DragHandleContext = createContext<DragHandleState | null>(null)

function WidgetDragHandle({ label }: { label: string }) {
  const handle = useContext(DragHandleContext)
  if (!handle) return null
  return (
    <Box
      ref={handle.setActivatorNodeRef}
      {...handle.attributes}
      {...handle.listeners}
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

function SortableWidget({ id, disabled, gridColumn, children }: { id: string; disabled?: boolean; gridColumn: any; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: Boolean(disabled) })
  return (
    <DragHandleContext.Provider value={{ attributes, listeners, setActivatorNodeRef }}>
      <Paper
        ref={setNodeRef}
        variant="outlined"
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          zIndex: isDragging ? 3 : undefined,
          position: 'relative',
          opacity: isDragging ? 0.65 : 1,
        }}
        sx={{ gridColumn, minWidth: 0, p: 2, boxShadow: isDragging ? '0 18px 36px -16px rgba(26,36,38,0.35)' : undefined }}
      >
        {children}
      </Paper>
    </DragHandleContext.Provider>
  )
}

export default function DashboardPage() {
  const theme = useTheme()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const linkedTableId = Number(searchParams.get('table')) || 0
  const activeId = Number(params.dashboardId) || null

  const [boards, setBoards] = useState<DashboardBoard[]>([])
  const [tables, setTables] = useState<any[]>([])
  const [results, setResults] = useState<Record<string, DashboardResult>>({})
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [lastRefresh, setLastRefresh] = useState('')
  const [period, setPeriod] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [widgetMenu, setWidgetMenu] = useState<{ el: HTMLElement; widget: DashboardWidget; index: number } | null>(null)
  const [boardMenu, setBoardMenu] = useState<{ el: HTMLElement; board: DashboardBoard } | null>(null)
  const [boardQuery, setBoardQuery] = useState('')
  const [boardSort, setBoardSort] = useState<'updated' | 'name' | 'widgets'>('updated')
  const [boardView, setBoardViewState] = useState<'cards' | 'list'>(() => localStorage.getItem('wb_board_view') === 'list' ? 'list' : 'cards')
  const [boardFavorites, setBoardFavorites] = useState<number[]>(() => readIds('wb_board_favorites'))
  const [boardRecent, setBoardRecent] = useState<number[]>(() => readIds('wb_board_recent'))

  const [editorOpen, setEditorOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [fields, setFields] = useState<any[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [previewResult, setPreviewResult] = useState<DashboardResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [form, setForm] = useState<DashboardWidget>(emptyWidget())

  const requestId = useRef(0)
  const fieldRequestId = useRef(0)
  const previewRequestId = useRef(0)
  const lastRequestedAt = useRef(0)

  const current = boards.find((board) => board.id === activeId) || null
  const boardsRef = useRef(boards)
  boardsRef.current = boards
  const lastRefreshRef = useRef(lastRefresh)
  lastRefreshRef.current = lastRefresh
  const [dataRefreshKey, setDataRefreshKey] = useState(0)
  // 只有影响汇总结果的数据配置才触发重新取数；排序、配色、标题等不触发
  const dataSignature = useMemo(() => JSON.stringify((current?.widgets || []).map((widget) => ({
    id: widget.id, kind: widget.kind, table_id: widget.table_id,
    aggregation: widget.aggregation, value_field: widget.value_field, value_fields: widget.value_fields,
    group_field: widget.group_field, date_field: widget.date_field, date_bucket: widget.date_bucket,
    sort: widget.sort, limit: widget.limit, progress: widget.progress,
  })).sort((a, b) => a.id.localeCompare(b.id))), [current])
  const metricCount = current?.widgets.filter((widget) => widget.kind === 'metric').length || 0
  const metricSpan = 12 / Math.min(4, Math.max(1, metricCount))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const tableName = (id: number) => tables.find((table) => table.id === id)?.name || '来源表格'
  const numericFields = fields.filter((field) => ['number', 'formula', 'rollup'].includes(field.type))
  const dimensionFields = fields.filter((field) => ['short_text', 'long_text', 'select', 'checkbox', 'date'].includes(field.type))
  const dateFields = fields.filter((field) => field.type === 'date')
  const selectedGroup = fields.find((field) => field.key === form.group_field)

  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const daysAgo = (n: number) => { const date = new Date(today() + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - n); return date.toISOString().slice(0, 10) }

  const dateParams = useCallback((): Record<string, string> => {
    if (period === 'custom' && customFrom && customTo) return { start_date: customFrom, end_date: customTo }
    if (period === 'month') return { start_date: today().slice(0, 7) + '-01', end_date: today() }
    if (period === 'last7' || period === 'last30') return { start_date: daysAgo(period === 'last7' ? 6 : 29), end_date: today() }
    return {}
  }, [period, customFrom, customTo])

  const fetchData = useCallback(async () => {
    const board = boardsRef.current.find((item) => item.id === activeId)
    if (!board) return
    const sequence = ++requestId.current
    setRefreshing(true); lastRequestedAt.current = Date.now()
    try {
      const { data } = await http.get(`/dashboards/${board.id}/data`, { params: dateParams() })
      if (sequence !== requestId.current) return
      if (data.version !== board.version) { setLoadError('看板配置已在其他位置修改，请重新加载；当前仍显示上次数据。'); return }
      setResults(Object.fromEntries(data.widgets.map((result: DashboardResult) => [result.id, result])))
      setLastRefresh(data.generated_at); setLoadError('')
    } catch (error) {
      if (sequence === requestId.current) setLoadError(`刷新失败：${apiError(error).message}${lastRefreshRef.current ? '；当前保留上次成功刷新的数据。' : ''}`)
    } finally { if (sequence === requestId.current) setRefreshing(false) }
  }, [activeId, dateParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [boardsResponse, tablesResponse] = await Promise.all([http.get('/dashboards'), http.get('/tables')])
      setBoards(boardsResponse.data); setTables(tablesResponse.data)
      setResults({}); setLastRefresh(''); setLoadError('')
      setDataRefreshKey((key) => key + 1)
    } catch (error) { setLoadError(apiError(error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (activeId) void fetchData() }, [activeId, fetchData, dataSignature, dataRefreshKey])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && !refreshing && !saving && Date.now() - lastRequestedAt.current > 5000) void fetchData()
    }, 60000)
    const refreshIfVisible = () => { if (!document.hidden && !refreshing && !saving && Date.now() - lastRequestedAt.current > 5000) void fetchData() }
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshIfVisible); document.removeEventListener('visibilitychange', refreshIfVisible) }
  }, [fetchData, refreshing, saving])

  const createBoard = async () => {
    const value = await promptDialog({ title: '新建看板', message: '可以按店铺、业务或用途分别建立看板。', label: '看板名称', placeholder: '例如：天猫旗舰店、抖音店铺', maxLength: 80, confirmText: '创建' })
    if (!value) return
    try {
      const { data } = await http.post('/dashboards', { name: value })
      setBoards((prev) => [...prev, data])
      window.dispatchEvent(new Event('wb:dashboards-changed'))
      navigate(`/visualizations/${data.id}`)
    } catch (error) { toast.error(apiError(error).message) }
  }

  const saveBoard = async (widgets: DashboardWidget[], name = current?.name) => {
    const board = current
    if (!board || saving) return null
    setSaving(true)
    try {
      const { data } = await http.put(`/dashboards/${board.id}`, { name, widgets, version: board.version })
      setBoards((prev) => prev.map((item) => item.id === data.id ? data : item))
      window.dispatchEvent(new Event('wb:dashboards-changed'))
      return data
    } catch (error) { toast.error(apiError(error).message); return null }
    finally { setSaving(false) }
  }

  const renameBoard = async () => {
    if (!current) return
    const value = await promptDialog({ title: '重命名', label: '看板名称', defaultValue: current.name, maxLength: 80, confirmText: '保存' })
    if (!value) return
    await saveBoard(current.widgets, value)
  }

  const removeBoard = async () => {
    if (!current) return
    const ok = await confirmDialog({ title: '删除看板', danger: true, confirmText: '删除', message: `删除“${current.name}”及其图表配置？来源表格和数据会保留。` })
    if (!ok) return
    try {
      await http.delete(`/dashboards/${current.id}`, { params: { version: current.version } })
      ++requestId.current
      setBoards((prev) => prev.filter((item) => item.id !== current.id))
      window.dispatchEvent(new Event('wb:dashboards-changed'))
      navigate('/visualizations')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const loadFields = async (id: number) => {
    const sequence = ++fieldRequestId.current
    setFieldsLoading(true); setFieldError('')
    try {
      const { data } = await http.get(`/tables/${id}`)
      if (sequence !== fieldRequestId.current) return
      setFields(data.fields)
      return data.fields as any[]
    } catch (error) { if (sequence === fieldRequestId.current) setFieldError(apiError(error).message) }
    finally { if (sequence === fieldRequestId.current) setFieldsLoading(false) }
  }

  const openEditor = async (widget?: DashboardWidget) => {
    setEditingId(widget?.id || '')
    const initial = { ...emptyWidget(), ...(widget ? JSON.parse(JSON.stringify(widget)) : {}) } as DashboardWidget
    if (!initial.value_fields?.length && initial.value_field) initial.value_fields = [initial.value_field]
    setForm(initial)
    setFields([]); setFieldError(''); setPreviewError(''); setPreviewResult(null)
    setEditorOpen(true)
    if (initial.table_id) await loadFields(initial.table_id)
    else if (linkedTableId) {
      setForm((prev) => ({ ...prev, table_id: linkedTableId }))
      setSearchParams({}, { replace: true })
      await chooseTable(linkedTableId)
    } else if (tables[0]) {
      setForm((prev) => ({ ...prev, table_id: tables[0].id }))
      await chooseTable(tables[0].id)
    }
  }

  const chooseTable = async (id: number) => {
    setFields([])
    const loaded = await loadFields(id)
    if (!loaded) return
    const isProgress = form.kind === 'progress'
    setForm((prev) => {
      const numeric = loaded.filter((field) => ['number', 'formula', 'rollup'].includes(field.type))
      const dimensions = loaded.filter((field) => ['short_text', 'long_text', 'select', 'checkbox', 'date'].includes(field.type))
      const dates = loaded.filter((field) => field.type === 'date')
      let aggregation = prev.aggregation
      if (['bar', 'line'].includes(prev.kind) && aggregation === 'count' && numeric.length) aggregation = 'sum'
      const valueField = numeric[0]?.key || null
      return {
        ...prev, table_id: id, value_field: valueField, value_fields: valueField ? [valueField] : [],
        group_field: isProgress ? null : dimensions[0]?.key || null, date_field: dates[0]?.key || null,
        aggregation, progress: isProgress ? initializeProgress(prev.progress, loaded) : prev.progress,
      }
    })
  }

  const initializeProgress = (progress: ProgressConfig | null | undefined, loaded: any[]): ProgressConfig => {
    const next = { ...(progress || emptyProgress()) }
    const complete = loaded.find((field) => field.type === 'checkbox') || loaded.find((field) => field.type === 'select') || loaded.find((field) => field.type === 'short_text')
    if (complete && !next.completed?.field) {
      next.completed = {
        field: complete.key, op: 'eq',
        value: complete.type === 'checkbox' ? true : complete.type === 'select' ? (complete.options?.find((option: any) => /^(已完成|完成|done|complete)$/i.test(option.name)) || complete.options?.[0])?.id || '' : '',
      }
    }
    const numeric = loaded.filter((field) => ['number', 'formula', 'rollup'].includes(field.type))
    next.actual_field ||= numeric[0]?.key || null
    next.target_field ||= numeric[1]?.key || numeric[0]?.key || null
    return next
  }

  const kindChanged = (kind: DashboardWidget['kind']) => {
    setForm((prev) => {
      // bar 与 line 共用同一组系列颜色，其他类型切换时清空，避免旧颜色错配到新分类
      const keepColors = ['bar', 'line'].includes(prev.kind) && ['bar', 'line'].includes(kind)
      let next = { ...prev, kind, ...(keepColors ? {} : { colors: [] }) }
      if (kind === 'progress') {
        next = { ...next, aggregation: 'count', value_field: null, value_fields: [], group_field: null, progress: initializeProgress(prev.progress, fields) }
        return next
      }
      if (['bar', 'line'].includes(kind) && next.aggregation === 'count' && numericFields.length) next.aggregation = 'sum'
      if (!['bar', 'line'].includes(kind)) next.value_fields = []
      else if (!next.value_fields?.length && next.value_field) next.value_fields = [next.value_field]
      if (kind === 'pie' && !['count', 'sum'].includes(next.aggregation)) next.aggregation = 'count'
      if (kind === 'line' && selectedGroup?.type === 'date') { next.sort = 'label_asc'; if (!next.date_field) next.date_field = next.group_field }
      return next
    })
  }

  const draft = (): DashboardWidget => ({
    ...form,
    title: form.title.trim() || (form.kind === 'progress' ? `${tableName(form.table_id)} · 任务进度` : `${fields.find((field) => field.key === form.value_field)?.name || tableName(form.table_id)} · ${aggregationLabels[form.aggregation]}`),
    progress: form.kind === 'progress' ? form.progress : null,
    value_fields: ['bar', 'line'].includes(form.kind) && form.aggregation !== 'count' ? form.value_fields || [] : [],
    date_field: form.date_field || null,
    value_field: ['bar', 'line'].includes(form.kind) && form.aggregation !== 'count' ? form.value_fields?.[0] || null : form.value_field || null,
    group_field: form.group_field || null,
  })

  const defaultColors = chartPalette(theme.palette.primary.main)
  const colorTargets: { label: string }[] = (() => {
    if (form.kind === 'metric') return [{ label: '数值颜色' }]
    if (form.kind === 'progress') return [{ label: '进度颜色' }]
    if (form.kind === 'pie') {
      const labels = (previewResult?.points || []).map((point) => point.label).filter(Boolean)
      return labels.length ? labels.map((label) => ({ label })) : [{ label: '主色' }]
    }
    const names = (previewResult?.series || []).map((series) => series.name).filter(Boolean)
    const fieldNames = (form.value_fields?.length ? form.value_fields : [form.value_field])
      .filter((key): key is string => Boolean(key))
      .map((key) => fields.find((field) => field.key === key)?.name || '')
      .filter(Boolean)
    const labels = names.length ? names : fieldNames
    return labels.length ? labels.map((label) => ({ label })) : [{ label: '主色' }]
  })()
  const colorValue = (index: number) => form.colors?.[index] || defaultColors[index % defaultColors.length]
  const setColor = (index: number, value: string) => setForm((prev) => {
    const colors = [...(prev.colors || [])]
    while (colors.length < index) colors.push(defaultColors[colors.length % defaultColors.length])
    colors[index] = value
    return { ...prev, colors }
  })
  // 颜色只影响本地预览渲染，不必触发重新汇总
  const previewSignature = useMemo(() => JSON.stringify({ ...form, colors: [] }), [form])

  const previewReady = Boolean(form.table_id) && !fieldsLoading && !fieldError && (
    form.kind === 'progress'
      ? Boolean(form.progress)
      : form.aggregation === 'count' || (['bar', 'line'].includes(form.kind) ? Boolean(form.value_fields?.length) : Boolean(form.value_field))
  )

  useEffect(() => {
    if (!editorOpen) return
    if (!previewReady) { setPreviewResult(null); setPreviewError(''); setPreviewing(false); return }
    const sequence = ++previewRequestId.current
    const timer = window.setTimeout(() => {
      setPreviewing(true); setPreviewError('')
      http.post('/dashboards/preview', { widget: draft(), ...dateParams() }, { timeout: 60000 })
        .then(({ data }) => { if (sequence === previewRequestId.current) setPreviewResult(data) })
        .catch((error) => { if (sequence === previewRequestId.current) setPreviewError(apiError(error).message) })
        .finally(() => { if (sequence === previewRequestId.current) setPreviewing(false) })
    }, 450)
    return () => window.clearTimeout(timer)
    // draft/dateParams 依赖当前 form、字段和页面时间范围，这里显式跟随即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, previewReady, previewSignature, fields, fieldsLoading, fieldError])

  const saveWidget = async () => {
    if (!current) return
    const widget = draft()
    const widgets = editingId ? current.widgets.map((item) => item.id === editingId ? widget : item) : [...current.widgets, widget]
    if (await saveBoard(widgets)) {
      setEditorOpen(false)
      toast.success('图表已保存')
    }
  }

  const addAiWidgets = async (widgets: DashboardWidget[]) => {
    if (!current) return
    const merged = [...current.widgets, ...widgets].slice(0, 24)
    const saved = await saveBoard(merged)
    if (!saved) throw new Error('保存失败')
  }

  const onWidgetDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!current || saving || !over || active.id === over.id) return
    const from = current.widgets.findIndex((widget) => widget.id === active.id)
    const to = current.widgets.findIndex((widget) => widget.id === over.id)
    if (from < 0 || to < 0) return
    const previous = current.widgets
    const reordered = arrayMove(previous, from, to)
    // 先乐观更新，保存失败再回滚
    setBoards((prev) => prev.map((board) => board.id === current.id ? { ...board, widgets: reordered } : board))
    const saved = await saveBoard(reordered)
    if (!saved) setBoards((prev) => prev.map((board) => board.id === current.id ? { ...board, widgets: previous } : board))
  }

  const widgetCommand = async (command: string, widget: DashboardWidget, index: number) => {
    setWidgetMenu(null)
    if (command === 'edit') { void openEditor(widget); return }
    if (!current) return
    if (command === 'delete') {
      const ok = await confirmDialog({ title: '移除图表', danger: true, confirmText: '移除', message: `移除“${widget.title}”？来源数据会保留。` })
      if (!ok) return
      await saveBoard(current.widgets.filter((item) => item.id !== widget.id))
      return
    }
    const target = command === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= current.widgets.length) return
    const widgets = [...current.widgets]
    ;[widgets[index], widgets[target]] = [widgets[target], widgets[index]]
    await saveBoard(widgets)
  }

  const displayTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

  const setBoardView = (next: 'cards' | 'list') => {
    setBoardViewState(next)
    localStorage.setItem('wb_board_view', next)
  }

  const openBoard = (board: DashboardBoard) => {
    setBoardRecent((prev) => {
      const next = [board.id, ...prev.filter((id) => id !== board.id)].slice(0, 5)
      localStorage.setItem('wb_board_recent', JSON.stringify(next))
      return next
    })
    navigate(`/visualizations/${board.id}${linkedTableId ? `?table=${linkedTableId}` : ''}`)
  }

  const toggleBoardFavorite = (id: number) => {
    setBoardFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      localStorage.setItem('wb_board_favorites', JSON.stringify(next))
      return next
    })
  }

  const boardKinds = (board: DashboardBoard) => {
    const counts = board.widgets.reduce((acc: Record<string, number>, widget) => {
      acc[widget.kind] = (acc[widget.kind] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts).map(([kind, count]) => ({ kind, count }))
  }

  const renameBoardRow = async (board: DashboardBoard) => {
    const value = await promptDialog({ title: '重命名看板', label: '看板名称', defaultValue: board.name, maxLength: 80, confirmText: '保存' })
    if (!value) return
    try {
      await http.put(`/dashboards/${board.id}`, { name: value, widgets: board.widgets, version: board.version })
      window.dispatchEvent(new Event('wb:dashboards-changed'))
      await load()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const deleteBoardRow = async (board: DashboardBoard) => {
    const ok = await confirmDialog({ title: '删除看板', danger: true, confirmText: '删除', message: `删除「${board.name}」及其图表配置？来源表格和数据会保留。` })
    if (!ok) return
    try {
      await http.delete(`/dashboards/${board.id}`, { params: { version: board.version } })
      setBoardFavorites((prev) => {
        const next = prev.filter((id) => id !== board.id)
        localStorage.setItem('wb_board_favorites', JSON.stringify(next))
        return next
      })
      setBoardRecent((prev) => {
        const next = prev.filter((id) => id !== board.id)
        localStorage.setItem('wb_board_recent', JSON.stringify(next))
        return next
      })
      window.dispatchEvent(new Event('wb:dashboards-changed'))
      await load()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const visibleBoards = useMemo(() => {
    const keyword = boardQuery.trim().toLowerCase()
    const rows = boards.filter((board) => !keyword || board.name.toLowerCase().includes(keyword))
    rows.sort((a, b) => {
      if (boardSort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
      if (boardSort === 'widgets') return b.widgets.length - a.widgets.length
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    })
    return [...rows].sort((a, b) => Number(boardFavorites.includes(b.id)) - Number(boardFavorites.includes(a.id)))
  }, [boards, boardQuery, boardSort, boardFavorites])

  const recentBoards = boardRecent.map((id) => boards.find((board) => board.id === id)).filter(Boolean).slice(0, 5) as DashboardBoard[]
  const totalWidgets = boards.reduce((sum, board) => sum + board.widgets.length, 0)
  const latestBoardUpdate = boards.reduce((value, board) => {
    if (!board.updated_at) return value
    return !value || new Date(board.updated_at) > new Date(value) ? board.updated_at : value
  }, '' as string)
  const noBoardResults = boards.length > 0 && visibleBoards.length === 0 && !loading

  return (
    <Page sx={{ p: 1.5, gap: 1.5 }}>
      <PageToolbar sx={{ rowGap: 1 }}>
        {current
          ? <Button size="small" onClick={() => navigate('/visualizations')}>全部看板</Button>
          : (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              {boards.length} 个看板 · {totalWidgets} 张图表{latestBoardUpdate ? ` · 最近更新 ${relativeTime(latestBoardUpdate)}` : ''}
            </Typography>
          )}
        <div className="spacer" />
        {current ? (
          <>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button size="small" startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <Refresh fontSize="small" />} disabled={refreshing} onClick={() => void fetchData()}>刷新数据</Button>
              <Button size="small" onClick={renameBoard}>重命名</Button>
            </Stack>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button size="small" onClick={createBoard}>新建看板</Button>
            </Stack>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button size="small" startIcon={<AutoAwesome fontSize="small" />} disabled={saving || current.widgets.length >= 24} onClick={() => setAiOpen(true)}>AI 生成</Button>
              <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} disabled={saving || current.widgets.length >= 24} onClick={() => void openEditor()}>添加图表</Button>
            </Stack>
          </>
        ) : (
          <>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small" placeholder="搜索看板名称" value={boardQuery}
                onChange={(event) => setBoardQuery(event.target.value)}
                InputProps={{ startAdornment: <Search sx={{ fontSize: 16, mr: 0.75, color: 'text.secondary' }} /> }}
                sx={{ width: { xs: '100%', sm: 220 } }}
              />
              <Select size="small" value={boardSort} onChange={(event) => setBoardSort(event.target.value as any)} sx={{ width: 126 }} inputProps={{ 'aria-label': '看板排序' }}>
                <MenuItem value="updated">最近更新</MenuItem>
                <MenuItem value="name">按名称</MenuItem>
                <MenuItem value="widgets">按图表数</MenuItem>
              </Select>
              <ToggleButtonGroup size="small" exclusive value={boardView} onChange={(_, value) => value && setBoardView(value)}>
                <ToggleButton value="cards" aria-label="卡片视图"><GridView sx={{ fontSize: 17 }} /></ToggleButton>
                <ToggleButton value="list" aria-label="列表视图"><ViewList sx={{ fontSize: 17 }} /></ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button size="small" startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <Refresh fontSize="small" />} disabled={loading} onClick={() => void load()}>刷新</Button>
            </Stack>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
            <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={createBoard}>新建看板</Button>
          </>
        )}
      </PageToolbar>

      <PageBody sx={{ gap: 1.5 }}>
        {loadError ? <Alert severity="error" action={<Button size="small" onClick={() => void load()}>重新加载</Button>}>{loadError}</Alert> : null}

        {!activeId ? (
          <>
            {linkedTableId ? <Alert severity="info">选择看板后添加图表。</Alert> : null}
            {recentBoards.length ? (
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>最近打开</Typography>
                {recentBoards.map((board) => <Chip key={board.id} size="small" label={board.name} onClick={() => openBoard(board)} sx={{ height: 23 }} />)}
              </Stack>
            ) : null}

            {boards.length ? (
              boardView === 'cards' ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0,1fr))', lg: 'repeat(3, minmax(0,1fr))', xl: 'repeat(4, minmax(0,1fr))' }, gap: 1.5, alignContent: 'start' }}>
                  {visibleBoards.map((board) => {
                    const favorite = boardFavorites.includes(board.id)
                    return (
                      <Paper
                        key={board.id}
                        variant="outlined"
                        sx={{
                          p: 1.75, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 158,
                          borderRadius: 1.5, transition: 'border-color .15s, box-shadow .15s',
                          '&:hover': { borderColor: 'primary.main', boxShadow: '0 4px 14px rgba(26,36,38,0.06)' },
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 1, display: 'grid', placeItems: 'center', bgcolor: 'action.selected', color: 'primary.main' }}>
                            <DashboardIcon sx={{ fontSize: 17 }} />
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => openBoard(board)}>
                            <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }} noWrap>{board.name}</Typography>
                            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.25 }} noWrap>
                              {board.widgets.length ? boardKinds(board).map((item) => `${chartLabels[item.kind] || item.kind} ${item.count}`).join(' · ') : '还没有图表'}
                            </Typography>
                          </Box>
                          <Tooltip title={favorite ? '取消收藏' : '收藏'}>
                            <IconButton size="small" aria-label={favorite ? '取消收藏' : '收藏'} onClick={() => toggleBoardFavorite(board.id)}>
                              {favorite ? <Star sx={{ fontSize: 16, color: '#C9A25B' }} /> : <StarBorder sx={{ fontSize: 16, color: 'text.disabled' }} />}
                            </IconButton>
                          </Tooltip>
                          <IconButton size="small" aria-label="更多操作" onClick={(event) => setBoardMenu({ el: event.currentTarget, board })}>
                            <MoreFilled sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Stack>

                        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                          {board.widgets.length ? board.widgets.slice(0, 3).map((widget) => (
                            <Chip key={widget.id} size="small" variant="outlined" label={widget.title} sx={{ height: 20, fontSize: 10.5, maxWidth: 130 }} />
                          )) : null}
                          {board.widgets.length > 3 ? <Chip size="small" variant="outlined" label={`+${board.widgets.length - 3}`} sx={{ height: 20, fontSize: 10.5 }} /> : null}
                        </Stack>

                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 'auto' }}>
                          {board.widgets.length} 张图表 · 更新于 {relativeTime(board.updated_at)}
                        </Typography>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ borderTop: 1, borderColor: 'divider', pt: 0.75 }}>
                          <Button size="small" onClick={() => openBoard(board)}>打开</Button>
                          <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>看板</Typography>
                        </Stack>
                      </Paper>
                    )
                  })}
                </Box>
              ) : (
                <List sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', py: 0 }}>
                  {loading ? (
                    <ListItem><ListItemText primary="加载中…" primaryTypographyProps={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }} /></ListItem>
                  ) : !visibleBoards.length ? (
                    <ListItem><ListItemText primary="没有匹配的看板" primaryTypographyProps={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }} /></ListItem>
                  ) : visibleBoards.map((board) => {
                    const favorite = boardFavorites.includes(board.id)
                    return (
                      <ListItem key={board.id} divider disablePadding sx={{ '&:last-child': { borderBottom: 0 } }}>
                        <ListItemButton onClick={() => openBoard(board)} sx={{ gap: 1.25, px: 1.75, py: 1.25, alignItems: 'center' }}>
                          <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, bgcolor: 'primary.main', flexShrink: 0 }} />
                          <Avatar variant="rounded" sx={{ width: 30, height: 30, bgcolor: 'action.selected', color: 'primary.main' }}>
                            <DashboardIcon sx={{ fontSize: 16 }} />
                          </Avatar>
                          <ListItemText
                            primary={<>{board.name}{favorite ? ' ★' : ''}</>}
                            secondary={board.widgets.length ? boardKinds(board).map((item) => `${chartLabels[item.kind] || item.kind} ${item.count}`).join(' · ') : '还没有图表'}
                            primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600, noWrap: true }}
                            secondaryTypographyProps={{ fontSize: 11.5, noWrap: true }}
                            sx={{ minWidth: 0, my: 0 }}
                          />
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ flexShrink: 0, display: { xs: 'none', md: 'flex' } }}>
                            {board.widgets.slice(0, 3).map((widget) => (
                              <Chip key={widget.id} size="small" variant="outlined" label={widget.title} sx={{ height: 20, fontSize: 10.5, maxWidth: 130 }} />
                            ))}
                            {board.widgets.length > 3 ? <Chip size="small" variant="outlined" label={`+${board.widgets.length - 3}`} sx={{ height: 20, fontSize: 10.5 }} /> : null}
                          </Stack>
                          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexShrink: 0, display: { xs: 'none', sm: 'flex' } }}>
                            <Typography component="span" sx={{ fontSize: 11.5, color: 'text.secondary' }}>{board.widgets.length} 张图表</Typography>
                            <Typography component="span" sx={{ fontSize: 11.5, color: 'text.disabled' }}>{relativeTime(board.updated_at)}</Typography>
                          </Stack>
                          <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }} onClick={(event) => event.stopPropagation()}>
                            <Tooltip title={favorite ? '取消收藏' : '收藏'}>
                              <IconButton size="small" aria-label={favorite ? '取消收藏' : '收藏'} onClick={() => toggleBoardFavorite(board.id)}>
                                {favorite ? <Star sx={{ fontSize: 16, color: '#C9A25B' }} /> : <StarBorder sx={{ fontSize: 16, color: 'text.disabled' }} />}
                              </IconButton>
                            </Tooltip>
                            <Button size="small" onClick={() => openBoard(board)}>打开</Button>
                            <IconButton size="small" aria-label="更多操作" onClick={(event) => setBoardMenu({ el: event.currentTarget, board })}>
                              <MoreFilled sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Stack>
                        </ListItemButton>
                      </ListItem>
                    )
                  })}
                </List>
              )
            ) : !loading ? (
              boardView === 'cards' ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0,1fr))' }, gap: 1.5, maxWidth: 720 }}>
                  {[
                    { title: '新建看板', desc: '按用途分组图表。', icon: <Plus sx={{ fontSize: 22 }} />, action: createBoard },
                    { title: '从表格开始', desc: '准备数据源。', icon: <DashboardIcon sx={{ fontSize: 22 }} />, action: () => navigate('/data') },
                  ].map((item) => (
                    <Paper key={item.title} variant="outlined" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'pointer', transition: 'border-color .15s', '&:hover': { borderColor: 'primary.main' } }} onClick={item.action}>
                      <Box sx={{ width: 38, height: 38, borderRadius: 1.25, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: 'action.selected' }}>{item.icon}</Box>
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{item.title}</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.7 }}>{item.desc}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'primary.main', mt: 0.5 }}>开始 →</Typography>
                    </Paper>
                  ))}
                </Box>
              ) : (
                <List sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', py: 0, maxWidth: 720 }}>
                  {[
                    { title: '新建看板', desc: '按用途分组图表。', icon: <Plus sx={{ fontSize: 16 }} />, action: createBoard },
                    { title: '从表格开始', desc: '准备数据源。', icon: <DashboardIcon sx={{ fontSize: 16 }} />, action: () => navigate('/data') },
                  ].map((item, index) => (
                    <ListItem key={item.title} divider={index === 0} disablePadding>
                      <ListItemButton onClick={item.action} sx={{ gap: 1.25, px: 1.75, py: 1.25 }}>
                        <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, bgcolor: 'primary.main', flexShrink: 0 }} />
                        <Avatar variant="rounded" sx={{ width: 30, height: 30, bgcolor: 'action.selected', color: 'primary.main' }}>{item.icon}</Avatar>
                        <ListItemText primary={item.title} secondary={item.desc} primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 11.5 }} sx={{ my: 0 }} />
                        <Typography sx={{ fontSize: 12, color: 'primary.main', flexShrink: 0 }}>开始 →</Typography>
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )
            ) : null}

            {noBoardResults && boardView === 'cards' ? (
              <Box sx={{ py: 6 }}>
                <EmptyHint action={<Button size="small" onClick={() => setBoardQuery('')}>清除搜索</Button>}>没有匹配「{boardQuery}」的看板</EmptyHint>
              </Box>
            ) : null}
          </>
        ) : current ? (
          <>
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1.5}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>统计时间</Typography>
                <Select size="small" value={period} onChange={(event) => {
                  const value = event.target.value
                  setPeriod(value)
                  if (value === 'custom' && !customFrom) { setCustomFrom(daysAgo(29)); setCustomTo(today()) }
                  else if (value !== 'custom') void fetchData()
                }} sx={{ width: 130 }} inputProps={{ 'aria-label': '统计时间' }}>
                  <MenuItem value="all">全部时间</MenuItem>
                  <MenuItem value="last7">最近 7 天</MenuItem>
                  <MenuItem value="last30">最近 30 天</MenuItem>
                  <MenuItem value="month">本月</MenuItem>
                  <MenuItem value="custom">自定义</MenuItem>
                </Select>
                {period === 'custom' ? (
                  <>
                    <TextField size="small" type="date" label="起始日期" InputLabelProps={{ shrink: true }} value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                    <TextField size="small" type="date" label="结束日期" InputLabelProps={{ shrink: true }} value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
                    <Button size="small" onClick={() => void fetchData()}>应用</Button>
                  </>
                ) : null}
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{lastRefresh ? `更新于 ${displayTime(lastRefresh)}` : ''}</Typography>
            </Stack>

            {!current.widgets.length ? (
              <EmptyHint action={<Stack direction="row" spacing={1}><Button size="small" variant="contained" onClick={() => void openEditor()}>添加图表</Button>{!tables.length ? <Button size="small" onClick={() => navigate('/data')}>创建表格</Button> : null}</Stack>}>
                暂无图表
              </EmptyHint>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onWidgetDragEnd(event)}>
                <SortableContext items={current.widgets.map((widget) => widget.id)} strategy={rectSortingStrategy}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 2, alignItems: 'start' }}>
                    {current.widgets.map((widget, index) => {
                      const result = results[widget.id]
                      const span = widget.kind === 'metric' ? (metricCount === 1 ? 12 : metricSpan) : 6
                      return (
                        <SortableWidget key={widget.id} id={widget.id} disabled={saving} gridColumn={{ xs: 'span 12', md: `span ${widget.wide ? 12 : span}` }}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                            <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: 0 }}>
                              <WidgetDragHandle label={widget.title} />
                              <Typography sx={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{widget.title}</Typography>
                            </Stack>
                            <IconButton size="small" aria-label={`${widget.title}的操作`} disabled={saving} onClick={(event) => setWidgetMenu({ el: event.currentTarget, widget, index })}>
                              <MoreFilled fontSize="small" />
                            </IconButton>
                          </Stack>
                          <Menu
                            anchorEl={widgetMenu?.widget.id === widget.id ? widgetMenu.el : null}
                            open={widgetMenu?.widget.id === widget.id}
                            onClose={() => setWidgetMenu(null)}
                          >
                            <MenuItem onClick={() => widgetMenu && void widgetCommand('edit', widgetMenu.widget, widgetMenu.index)}>编辑图表</MenuItem>
                            <MenuItem disabled={index === 0} onClick={() => widgetMenu && void widgetCommand('up', widgetMenu.widget, widgetMenu.index)}>上移</MenuItem>
                            <MenuItem disabled={index === current.widgets.length - 1} onClick={() => widgetMenu && void widgetCommand('down', widgetMenu.widget, widgetMenu.index)}>下移</MenuItem>
                            <MenuItem divider onClick={() => widgetMenu && void widgetCommand('delete', widgetMenu.widget, widgetMenu.index)}>移除图表</MenuItem>
                          </Menu>
                          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1, lineHeight: 1.7 }}>
                            <Link component={RouterLink} to={`/data/${widget.table_id}`} color="text.secondary" underline="hover">{result?.table_name || tableName(widget.table_id)}</Link>
                            {' · '}{widget.kind === 'progress' ? (widget.progress?.mode === 'quantity' ? '数值累计进度' : '任务完成进度') : aggregationLabels[widget.aggregation]}{widget.unit ? `（${widget.unit}）` : ''}
                          </Typography>
                          {result ? <DashboardChart widget={widget} result={result} /> : <Typography sx={{ py: 3.75, color: 'text.secondary', fontSize: 13 }}>{refreshing ? '正在汇总…' : '等待刷新数据'}</Typography>}
                          {result?.status === 'ok' ? (
                            <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mt: 1.25, fontSize: 12, color: 'text.secondary' }}>
                              {widget.kind !== 'metric' ? <span>{result.matched_rows} 条记录</span> : null}
                              {result.ignored_rows ? <span>{result.ignored_rows} 条空值或无效数值未参与计算</span> : null}
                              {(result.groups_total || 0) > widget.limit ? <span>{widget.kind === 'pie' ? `前 ${widget.limit} 组，其余合并为其他` : widget.kind === 'line' && result.group_type === 'date' ? `显示最近 ${widget.limit} 组` : `显示前 ${widget.limit} / ${result.groups_total} 组`}</span> : null}
                              {result.date_filter_unavailable ? <Box component="span" sx={{ color: 'warning.main' }}>未设日期列，展示全部时间</Box> : null}
                            </Stack>
                          ) : null}
                        </SortableWidget>
                      )
                    })}
                  </Box>
                </SortableContext>
              </DndContext>
            )}
            <Stack direction="row" justifyContent="flex-end">
              <Button size="small" color="error" onClick={removeBoard}>删除此看板</Button>
            </Stack>
          </>
        ) : !loading ? (
          <EmptyHint action={<Button size="small" onClick={() => navigate('/visualizations')}>返回全部看板</Button>}>看板不存在或已删除</EmptyHint>
        ) : null}
      </PageBody>

      <Menu anchorEl={boardMenu?.el} open={Boolean(boardMenu)} onClose={() => setBoardMenu(null)}>
        <MenuItem onClick={() => { if (boardMenu) openBoard(boardMenu.board); setBoardMenu(null) }}>打开</MenuItem>
        <MenuItem onClick={() => { if (boardMenu) void renameBoardRow(boardMenu.board); setBoardMenu(null) }}>重命名</MenuItem>
        <MenuItem divider onClick={() => { if (boardMenu) void deleteBoardRow(boardMenu.board); setBoardMenu(null) }} sx={{ color: 'error.main' }}>删除看板</MenuItem>
      </Menu>

      <DashboardAiDialog
        open={aiOpen}
        tables={tables}
        defaultTableId={current?.widgets[0]?.table_id || linkedTableId || tables[0]?.id}
        dateParams={dateParams()}
        onClose={() => setAiOpen(false)}
        onAdd={addAiWidgets}
        onEdit={(widget) => { setAiOpen(false); void openEditor(widget) }}
      />

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{editingId ? '编辑图表' : '添加图表'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(340px, 400px) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
            <Stack spacing={1.5}>
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>展示方式</Typography>
                <ToggleButtonGroup size="small" exclusive value={form.kind} onChange={(_, kind) => kind && kindChanged(kind)} sx={{ flexWrap: 'wrap' }}>
                  {Object.entries(chartLabels).map(([kind, label]) => <ToggleButton key={kind} value={kind}>{label}</ToggleButton>)}
                </ToggleButtonGroup>
              </Box>

              <FieldRow label="来源表格" required>
                <Select fullWidth displayEmpty value={form.table_id || ''} onChange={(event) => void chooseTable(Number(event.target.value))} inputProps={{ 'aria-label': '来源表格' }}>
                  <MenuItem value="" disabled>选择要关联的表格</MenuItem>
                  {tables.map((table) => <MenuItem key={table.id} value={table.id}>{table.name}{table.kind === 'virtual' ? ' · 虚拟表' : ''}</MenuItem>)}
                </Select>
                {!tables.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>还没有表格。</Typography> : null}
              </FieldRow>

              <FieldRow label="图表标题">
                <TextField fullWidth value={form.title} inputProps={{ maxLength: 100 }} placeholder="留空会自动生成" onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </FieldRow>

              {fieldError ? <Alert severity="error">{fieldError}</Alert> : null}

              {form.kind === 'progress' && form.progress ? (
                <ProgressEditor value={form.progress} fields={fields} grouped={Boolean(form.group_field)} onChange={(progress) => setForm({ ...form, progress })} />
              ) : null}

              {form.kind !== 'progress' ? (
                <>
                  <FormControl fullWidth>
                    <InputLabel shrink>怎么计算？</InputLabel>
                    <Select label="怎么计算？" fullWidth size="small" value={form.aggregation} onChange={(event) => {
                      const aggregation = event.target.value as DashboardWidget['aggregation']
                      setForm({ ...form, aggregation, decimals: aggregation === 'count' ? 0 : form.decimals, value_field: aggregation === 'count' ? form.value_field : (form.value_field || numericFields[0]?.key || null), value_fields: ['bar', 'line'].includes(form.kind) && aggregation !== 'count' ? (form.value_fields?.length ? form.value_fields : (numericFields[0] ? [numericFields[0].key] : [])) : [] })
                    }}>
                      {Object.entries(aggregationLabels).map(([value, label]) => (
                        <MenuItem key={value} value={value} disabled={form.kind === 'pie' && !['count', 'sum'].includes(value)}>{label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {form.aggregation !== 'count' ? (
                    ['bar', 'line'].includes(form.kind) ? (
                      <FormControl fullWidth>
                        <InputLabel shrink>对比哪些数字？（可多选）</InputLabel>
                        <Select label="对比哪些数字？（可多选）" fullWidth multiple size="small" value={form.value_fields || []} onChange={(event) => {
                          const value = event.target.value as string[]
                          setForm({ ...form, value_fields: value.slice(0, 8), value_field: value[0] || null })
                        }} renderValue={(selected) => (selected as string[]).map((key) => fields.find((field) => field.key === key)?.name).filter(Boolean).join('、')}>
                          {numericFields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                    ) : (
                      <FormControl fullWidth>
                        <InputLabel shrink>看哪个数字？</InputLabel>
                        <Select label="看哪个数字？" fullWidth size="small" displayEmpty value={form.value_field || ''} onChange={(event) => setForm({ ...form, value_field: event.target.value })}>
                          <MenuItem value="" disabled>选择数字列</MenuItem>
                          {numericFields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                    )
                  ) : null}

                  {form.kind !== 'metric' ? (
                    <FormControl fullWidth>
                      <InputLabel shrink>{form.kind === 'pie' ? '按什么分类看占比？' : '横轴：按什么对比？'}</InputLabel>
                      <Select label={form.kind === 'pie' ? '按什么分类看占比？' : '横轴：按什么对比？'} fullWidth size="small" displayEmpty value={form.group_field || ''} onChange={(event) => {
                        const groupField = event.target.value || null
                        const group = fields.find((field) => field.key === groupField)
                        setForm({ ...form, group_field: groupField, ...(form.kind === 'line' && group?.type === 'date' ? { sort: 'label_asc' as const, date_field: form.date_field || groupField } : {}) })
                      }}>
                        <MenuItem value="">不分组</MenuItem>
                        {dimensionFields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                      </Select>
                    </FormControl>
                  ) : null}

                  {selectedGroup?.type === 'date' && form.kind !== 'metric' ? (
                    <FormControl fullWidth>
                      <InputLabel shrink>日期怎么汇总？</InputLabel>
                      <Select label="日期怎么汇总？" fullWidth size="small" value={form.date_bucket} onChange={(event) => setForm({ ...form, date_bucket: event.target.value as any })}>
                        <MenuItem value="day">按天</MenuItem>
                        <MenuItem value="week">按周（周一开始）</MenuItem>
                        <MenuItem value="month">按月</MenuItem>
                      </Select>
                    </FormControl>
                  ) : null}

                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                    选择表格后自动带出指标和分组。
                  </Typography>
                </>
              ) : null}

              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>数据颜色</Typography>
                  {form.colors?.length ? <Button size="small" onClick={() => setForm({ ...form, colors: [] })}>恢复默认</Button> : null}
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 0.75, maxHeight: 132, overflow: 'auto' }}>
                  {colorTargets.map((target, index) => (
                    <Stack
                      key={`${target.label}-${index}`} direction="row" alignItems="center" spacing={0.75}
                      sx={{ minWidth: 0, px: 0.75, py: 0.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
                    >
                      <Box
                        component="input" type="color" value={colorValue(index)} aria-label={`${target.label}颜色`}
                        onChange={(event) => setColor(index, event.target.value)}
                        sx={{ width: 26, height: 26, p: 0, border: 0, borderRadius: 0.75, bgcolor: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <Typography noWrap title={target.label} sx={{ fontSize: 12, minWidth: 0 }}>{target.label}</Typography>
                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled', ml: 'auto', flexShrink: 0 }}>{colorValue(index).toUpperCase()}</Typography>
                    </Stack>
                  ))}
                </Box>
                <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>
                  {form.kind === 'pie' ? '按分类顺序取色；不设置时使用默认配色。' : form.kind === 'metric' || form.kind === 'progress' ? '不设置时跟随主题主色。' : '柱状图和折线图按系列顺序取色；不设置时使用默认配色。'}
                </Typography>
              </Box>

              <Accordion disableGutters sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ChevronDown fontSize="small" />}>
                  <Typography sx={{ fontSize: 12.5 }}>高级设置</Typography>
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary', ml: 1 }}>日期筛选、单位、显示数量、排序</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5}>
                    <FormControl fullWidth>
                      <InputLabel shrink>页面顶部的日期筛选用哪一列？</InputLabel>
                      <Select label="页面顶部的日期筛选用哪一列？" fullWidth size="small" displayEmpty value={form.date_field || ''} onChange={(event) => setForm({ ...form, date_field: event.target.value || null })}>
                        <MenuItem value="">不参与页面时间筛选</MenuItem>
                        {dateFields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField fullWidth size="small" label="数值单位" value={form.unit} inputProps={{ maxLength: 12 }} placeholder="例如：元、单、件" onChange={(event) => setForm({ ...form, unit: event.target.value })} />
                    <TextField fullWidth size="small" type="number" label="最多保留小数位" value={form.decimals} inputProps={{ min: 0, max: 6 }} onChange={(event) => setForm({ ...form, decimals: Math.max(0, Math.min(6, Number(event.target.value) || 0)) })} />
                    {form.kind !== 'metric' ? (
                      <TextField fullWidth size="small" type="number" label={form.kind === 'progress' ? '最多展示多少个分组？' : '最多显示多少个横轴项目？'} value={form.limit} inputProps={{ min: 1, max: 30 }} onChange={(event) => setForm({ ...form, limit: Math.max(1, Math.min(30, Number(event.target.value) || 1)) })} />
                    ) : null}
                    {form.kind !== 'metric' && !(form.kind === 'line' && selectedGroup?.type === 'date') ? (
                      <FormControl fullWidth>
                        <InputLabel shrink>{form.kind === 'progress' ? '分组怎么排列？' : '横轴项目怎么排列？'}</InputLabel>
                        <Select label={form.kind === 'progress' ? '分组怎么排列？' : '横轴项目怎么排列？'} fullWidth size="small" value={form.sort} onChange={(event) => setForm({ ...form, sort: event.target.value as any })}>
                          <MenuItem value="value_desc">{form.kind === 'progress' ? '完成率从高到低' : '按第一个指标，从大到小'}</MenuItem>
                          <MenuItem value="label_asc">按名称或日期顺序</MenuItem>
                        </Select>
                      </FormControl>
                    ) : null}
                    <FormControlLabel
                      control={<Checkbox checked={form.wide} onChange={(event) => setForm({ ...form, wide: event.target.checked })} />}
                      label={<Typography sx={{ fontSize: 12.5 }}>图表占满一行</Typography>}
                    />
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>

            <Paper variant="outlined" sx={{ p: 1.75, minHeight: 300, display: 'flex', flexDirection: 'column', gap: 1, position: { md: 'sticky' }, top: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>实时预览</Typography>
                {previewing ? <CircularProgress size={14} /> : null}
              </Stack>
              {previewError ? <Alert severity="error" sx={{ fontSize: 12.5 }}>{previewError}</Alert> : null}
              {previewResult ? (
                <DashboardChart widget={draft()} result={previewResult} />
              ) : (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center' }}>
                    {previewReady ? (previewing ? '正在汇总…' : '等待预览') : '配置后自动预览'}
                  </Typography>
                </Box>
              )}
              <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>使用页面时间范围 · 仅预览</Typography>
            </Paper>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setEditorOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={!form.table_id || fieldsLoading || Boolean(fieldError) || saving} onClick={saveWidget}>保存图表</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}
