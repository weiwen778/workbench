import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link,
  Menu, MenuItem, Paper, Select, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { AutoAwesome, Check, ChevronDown, Close, Delete, Edit, InfoFilled, Plus, Refresh, Sort, Tune } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import { DataTable, EmptyHint, FieldRow, PageBody, PageToolbar, Pager } from '@/ui/common'
import RecordDrawer from '@/components/RecordDrawer'
import FieldManager from '@/components/FieldManager'
import ImportWizard from '@/components/ImportWizard'
import DeleteTableDialog from '@/components/DeleteTableDialog'
import AttachmentPreview from '@/components/AttachmentPreview'
import TableAnalysisDialog from '@/components/TableAnalysisDialog'
import AiTableFill from '@/components/AiTableFill'
import { display, type Field } from '@/table-core'

const operatorsByType: Record<string, { label: string; value: string }[]> = {
  short_text: [{ label: '包含', value: 'contains' }, { label: '等于', value: 'eq' }, { label: '为空', value: 'empty' }, { label: '不为空', value: 'not_empty' }],
  long_text: [{ label: '包含', value: 'contains' }, { label: '为空', value: 'empty' }, { label: '不为空', value: 'not_empty' }],
  number: [{ label: '等于', value: 'eq' }, { label: '大于等于', value: 'gte' }, { label: '小于等于', value: 'lte' }, { label: '大于', value: 'gt' }, { label: '小于', value: 'lt' }, { label: '区间', value: 'between' }, { label: '为空', value: 'empty' }, { label: '不为空', value: 'not_empty' }],
  date: [{ label: '等于', value: 'eq' }, { label: '不早于', value: 'gte' }, { label: '不晚于', value: 'lte' }, { label: '早于', value: 'lt' }, { label: '晚于', value: 'gt' }, { label: '区间', value: 'between' }, { label: '为空', value: 'empty' }],
  select: [{ label: '等于', value: 'eq' }, { label: '不等于', value: 'ne' }, { label: '为空', value: 'empty' }],
  multiselect: [{ label: '包含任一', value: 'has_any' }, { label: '包含全部', value: 'has_all' }, { label: '为空', value: 'empty' }],
  checkbox: [{ label: '已勾选', value: 'eq' }, { label: '未勾选', value: 'eq' }],
  url: [{ label: '包含', value: 'contains' }, { label: '为空', value: 'empty' }],
  attachment: [{ label: '有附件', value: 'not_empty' }, { label: '无附件', value: 'empty' }],
}

function requestId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function TableView({ tableId }: { tableId: number }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const recordParam = searchParams.get('record')
  const [table, setTable] = useState<any>(null)
  const [fields, setFields] = useState<Field[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem('wb_table_page_size'))
    return [20, 50, 100].includes(saved) ? saved : 50
  })
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() => localStorage.getItem('wb_table_density') === 'comfortable' ? 'comfortable' : 'compact')
  const [striped, setStriped] = useState(() => localStorage.getItem('wb_table_striped') === '1')
  const toggleStriped = (value: boolean) => { setStriped(value); localStorage.setItem('wb_table_striped', value ? '1' : '0') }
  const [centerX, setCenterX] = useState(() => localStorage.getItem('wb_table_center_x') !== '0')
  const [centerY, setCenterY] = useState(() => localStorage.getItem('wb_table_center_y') !== '0')
  const toggleCenterX = (value: boolean) => { setCenterX(value); localStorage.setItem('wb_table_center_x', value ? '1' : '0') }
  const toggleCenterY = (value: boolean) => { setCenterY(value); localStorage.setItem('wb_table_center_y', value ? '1' : '0') }
  const readColumnWidths = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(`wb_table_widths:${tableId}`) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : {}
    } catch { return {} }
  }
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(readColumnWidths)
  useEffect(() => { setColumnWidths(readColumnWidths()) }, [tableId])
  const saveColumnWidths = useCallback((widths: Record<string, number>) => {
    setColumnWidths((prev) => {
      const next = { ...prev }
      for (const [field, width] of Object.entries(widths)) if (Number.isFinite(width) && width > 0) next[field] = width
      try { localStorage.setItem(`wb_table_widths:${tableId}`, JSON.stringify(next)) } catch { /* ignore quota errors */ }
      return next
    })
  }, [tableId])
  const readColumnVisibility = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(`wb_table_visibility:${tableId}`) || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {}
    } catch { return {} }
  }
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(readColumnVisibility)
  useEffect(() => { setColumnVisibility(readColumnVisibility()) }, [tableId])
  const saveColumnVisibility = useCallback((model: Record<string, boolean>) => {
    setColumnVisibility(model)
    try { localStorage.setItem(`wb_table_visibility:${tableId}`, JSON.stringify(model)) } catch { /* ignore quota errors */ }
  }, [tableId])
  const changeDensity = (value: 'compact' | 'comfortable') => { setDensity(value); localStorage.setItem('wb_table_density', value) }
  const [loading, setLoading] = useState(false)
  const [initialError, setInitialError] = useState('')
  const [filters, setFilters] = useState<any[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sorts, setSorts] = useState<any[]>([])
  const [sortDraft, setSortDraft] = useState<any[]>([])
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)
  const [selection, setSelection] = useState<number[]>([])
  const [recordOpen, setRecordOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any | null>(null)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInitialText, setAiInitialText] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportScope, setExportScope] = useState<'all' | 'filtered'>('all')
  const [exporting, setExporting] = useState(false)
  const [previewFile, setPreviewFile] = useState<any | null>(null)
  const [editingCell, setEditingCell] = useState<{ rowId: number; key: string } | null>(null)
  const [editValue, setEditValue] = useState<any>('')
  const [cellSaving, setCellSaving] = useState(false)
  const [quickValue, setQuickValue] = useState('')
  const skipBlur = useRef(false)

  const viewActive = useRef(true)
  const recordsRequest = useRef(0)
  useEffect(() => {
    viewActive.current = true
    return () => { viewActive.current = false }
  }, [])

  const sortableFields = fields.filter((field) => !['long_text', 'multiselect', 'attachment'].includes(field.type))
  const fieldType = (key: string) => fields.find((field) => field.key === key)?.type || 'short_text'
  const operatorsFor = (key: string) => operatorsByType[fieldType(key)] || operatorsByType.short_text
  const optionsOf = (key: string) => fields.find((field) => field.key === key)?.options || []

  const normalizedFilters = () => filters.flatMap((filter) => {
    if (!filter.field || !filter.op) return []
    if (!['empty', 'not_empty'].includes(filter.op)) {
      if (filter.op === 'between') { if (!filter.value?.[0] && !filter.value?.[1]) return [] }
      else if (filter.value === '' || filter.value === null || filter.value === undefined) return []
    }
    return [{ field: filter.field, op: filter.op, value: filter.value }]
  })

  const loadTable = useCallback(async () => {
    const { data } = await http.get(`/tables/${tableId}`)
    setTable(data); setFields(data.fields)
    if (data.fields.length > 60 && pageSize === 50) setPageSize(20)
  }, [tableId, pageSize])

  const loadRecords = useCallback(async () => {
    if (!viewActive.current) return
    const request = ++recordsRequest.current
    setLoading(true)
    try {
      const params: Record<string, any> = { page, page_size: pageSize }
      const activeFilters = normalizedFilters()
      if (activeFilters.length) params.filters = JSON.stringify(activeFilters)
      if (sorts.length) params.sorts = JSON.stringify(sorts)
      const { data } = await http.get(`/tables/${tableId}/records`, { params })
      if (!viewActive.current || request !== recordsRequest.current) return
      if (!data.items.length && page > 1) {
        setPage(data.total > 0 ? Math.max(1, Math.ceil(data.total / pageSize)) : 1)
        return
      }
      setRows(data.items); setTotal(data.total)
    } catch (error) {
      if (viewActive.current && request === recordsRequest.current) {
        if (!fields.length) setInitialError(apiError(error).message)
        toast.error(apiError(error).message)
      }
    } finally { if (viewActive.current && request === recordsRequest.current) setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, page, pageSize, filters, sorts, fields.length])

  const reload = useCallback(async () => {
    try { await loadTable(); await loadRecords(); window.dispatchEvent(new Event('wb:tables-changed')) }
    catch (error) { toast.error(apiError(error).message) }
  }, [loadTable, loadRecords])

  useEffect(() => {
    void (async () => {
      try {
        await loadTable()
        const raw = searchParams.get('filters')
        if (raw) {
          if (raw.length > 12000) throw new Error('来源筛选条件过长')
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed) || parsed.length > 10) throw new Error('来源筛选条件无效，请重新从看板打开')
          setFilters(parsed); setFiltersOpen(Boolean(parsed.length))
        }
      } catch (error) { setInitialError(apiError(error).message) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  useEffect(() => { void loadRecords() }, [loadRecords])

  useEffect(() => {
    const record = recordParam
    if (record) void http.get(`/records/${Number(record)}`).then(({ data }) => { setEditingRecord(data); setRecordOpen(true) }).catch((error) => toast.error(apiError(error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordParam])

  const openCreate = () => {
    if (!fields.length) { toast.warning('这张表格还没有列，先在「列设置」里添加一列'); return }
    setEditingRecord(null); setRecordOpen(true)
  }

  const removeRecord = async (row: any) => {
    const ok = await confirmDialog({ title: '删除行', danger: true, confirmText: '删除', message: '删除这一行？删除后会在回收站保留 30 天。' })
    if (!ok) return
    try { await http.delete(`/records/${row.id}`); await loadRecords(); setSelection((prev) => prev.filter((id) => id !== row.id)) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const batchDelete = async () => {
    const ok = await confirmDialog({ title: '删除行', danger: true, confirmText: '删除', message: `删除选中的 ${selection.length} 行？一次最多 100 行。` })
    if (!ok) return
    try {
      await http.post(`/tables/${tableId}/records/batch-delete`, { ids: selection })
      toast.success('已移入回收站'); setSelection([]); await loadRecords()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const exportTable = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const body: Record<string, any> = { scope: exportScope }
      if (exportScope === 'filtered') { body.filters = normalizedFilters(); body.sorts = sorts }
      await http.post(`/tables/${tableId}/export-tasks`, body, { headers: { 'Idempotency-Key': requestId() } })
      toast.success('已提交后台导出，可在任务中心查看进度并下载')
      setExportOpen(false)
      window.dispatchEvent(new Event('wb:open-tasks'))
    } catch (error) { toast.error(apiError(error).message) }
    finally { setExporting(false) }
  }

  const openAttachment = async (id: number) => {
    try { setPreviewFile((await http.get(`/files/${id}`)).data) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const addFilter = () => {
    const first = sortableFields[0]
    if (!first) return
    setFilters([...filters, { field: first.key, op: operatorsFor(first.key)[0].value, value: '' }])
  }

  const saveCell = async (row: any, field: Field, value: any) => {
    if (cellSaving) return
    setCellSaving(true)
    try {
      const data = { ...row.data, [field.key]: value === '' ? null : value }
      const response = await http.put(`/records/${row.id}`, { data, version: row.version })
      setRows((prev) => prev.map((item) => item.id === row.id ? response.data : item))
      setEditingCell(null)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setCellSaving(false)
    }
  }

  const startEdit = (row: any, field: Field) => {
    if (['attachment', 'multiselect', 'reference', 'formula', 'lookup', 'rollup'].includes(field.type)) return
    setEditingCell({ rowId: row.id, key: field.key })
    setEditValue(row.data[field.key] ?? (field.type === 'checkbox' ? false : ''))
  }

  const renderEditor = (field: Field, row: any) => {
    const value = editValue
    const commit = () => {
      if (skipBlur.current) { skipBlur.current = false; return }
      void saveCell(row, field, value)
    }
    if (field.type === 'checkbox') {
      return <Checkbox size="small" checked={Boolean(value)} disabled={cellSaving} onChange={(event) => void saveCell(row, field, event.target.checked)} sx={{ p: 0.25 }} />
    }
    if (field.type === 'select') {
      return (
        <Select
          autoFocus size="small" value={value ?? ''} disabled={cellSaving}
          onChange={(event) => void saveCell(row, field, event.target.value)}
          sx={{ minWidth: 110, height: 30 }}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') setEditingCell(null) }}
        >
          <MenuItem value="">—</MenuItem>
          {(field.options || []).map((option) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
        </Select>
      )
    }
    return (
      <TextField
        autoFocus fullWidth size="small" disabled={cellSaving}
        type={field.type === 'date' ? 'date' : 'text'}
        value={value ?? ''}
        placeholder={field.type === 'date' ? 'YYYY-MM-DD' : ''}
        onChange={(event) => setEditValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLElement).blur() }
          if (event.key === 'Escape') { skipBlur.current = true; setEditingCell(null) }
        }}
        inputProps={{ inputMode: field.type === 'number' ? 'decimal' : undefined }}
        sx={{ height: '100%', minHeight: 0, '& .MuiInputBase-root': { height: '100%', minHeight: 0, fontSize: 13 }, '& .MuiInputBase-input': { paddingTop: 0, paddingBottom: 0, height: '100%', boxSizing: 'border-box' } }}
      />
    )
  }

  const renderCell = (field: Field, row: any) => {
    const value = row.data[field.key]
    if (editingCell && editingCell.rowId === row.id && editingCell.key === field.key) return renderEditor(field, row)
    if (field.type === 'attachment' && value) return <Link component="button" onClick={(event) => { event.stopPropagation(); void openAttachment(value) }} underline="none">查看附件</Link>
    if (field.type === 'url' && value) return <Link href={value} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{value}</Link>
    const content = field.type === 'checkbox'
      ? (value ? <Check sx={{ fontSize: 16, color: 'primary.main' }} /> : <Typography component="span" variant="body2" color="text.secondary">否</Typography>)
      : display(field, value)
    return (
      <Box
        onClick={(event) => { event.stopPropagation(); startEdit(row, field) }}
        title={typeof content === 'string' && content ? content : undefined}
        sx={{
          minWidth: 0, width: '100%', minHeight: 22, mx: -0.5, px: 0.5, borderRadius: 0.5,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          cursor: ['multiselect', 'reference', 'formula', 'lookup', 'rollup', 'attachment'].includes(field.type) ? 'default' : 'text',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {content}
      </Box>
    )
  }

  const quickField = fields.find((field) => ['short_text', 'number', 'long_text', 'url'].includes(field.type))
  const addQuickRow = async () => {
    if (!quickField || !quickValue.trim()) return
    try {
      await http.post(`/tables/${tableId}/records`, { data: { [quickField.key]: quickValue.trim() } })
      setQuickValue('')
      await loadRecords()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const submitQuick = () => {
    if (!quickField || !quickValue.trim()) return
    // Long or multiline text is almost always pasted unstructured data; open AI fill instead of stuffing it into one column.
    if (quickValue.length > 60 || quickValue.includes('\n')) {
      setAiInitialText(quickValue)
      setQuickValue('')
      setAiOpen(true)
      return
    }
    void addQuickRow()
  }

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selection.includes(row.id))
  const someVisibleSelected = rows.some((row) => selection.includes(row.id)) && !allVisibleSelected
  const toggleVisibleSelection = (checked: boolean) => {
    const ids = new Set(rows.map((row) => row.id))
    setSelection((prev) => checked ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.has(id)))
  }
  const headerSort = sorts.length === 1 ? sorts[0] : null
  const toggleSort = (field: string, direction?: 'asc' | 'desc') => {
    const current = sorts.find((item) => item.field === field)
    setSorts([{ field, order: direction || (current?.order === 'asc' ? 'desc' : 'asc') }])
    setPage(1)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: 2 }}>
      <PageToolbar sx={{ py: 0.5 }}>
        {table?.note ? <Box title={table.note} sx={{ color: 'text.secondary', display: 'flex' }}><InfoFilled sx={{ fontSize: 16 }} /></Box> : null}
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {total} 行</Typography>
        <div className="spacer" />
        <Button size="small" onClick={() => setFiltersOpen(!filtersOpen)} color={filtersOpen ? 'primary' : undefined}>筛选{filters.length ? `(${filters.length})` : ''}</Button>
        <Button size="small" startIcon={<Sort fontSize="small" />} onClick={(event: any) => { setSortDraft(sorts.length ? [...sorts] : []); setSortAnchor(event.currentTarget) }}>排序{sortDraft.length ? `(${sortDraft.length})` : sorts.length ? `(${sorts.length})` : ''}</Button>
        <Button size="small" startIcon={<Tune fontSize="small" />} onClick={(event) => setViewAnchor(event.currentTarget)}>视图</Button>
        <Button size="small" endIcon={<ChevronDown fontSize="small" />} onClick={(event) => setMoreAnchor(event.currentTarget)}>更多</Button>
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
          <MenuItem onClick={() => { setMoreAnchor(null); void reload() }}>刷新</MenuItem>
          <MenuItem onClick={() => { setMoreAnchor(null); setFieldsOpen(true) }}>列设置</MenuItem>
          <MenuItem onClick={() => { setMoreAnchor(null); setImportOpen(true) }}>批量导入</MenuItem>
          <MenuItem onClick={() => { setMoreAnchor(null); setExportOpen(true) }}>导出</MenuItem>
          <MenuItem onClick={() => { setMoreAnchor(null); setAnalysisOpen(true) }}>汇总与透视</MenuItem>
          <MenuItem onClick={() => { setMoreAnchor(null); navigate(`/visualizations?table=${tableId}`) }}>用于数据可视化</MenuItem>
          <MenuItem divider onClick={() => { setMoreAnchor(null); setDeleteOpen(true) }} sx={{ color: 'error.main' }}>导出备份后删除表格</MenuItem>
        </Menu>
        <Menu anchorEl={viewAnchor} open={Boolean(viewAnchor)} onClose={() => setViewAnchor(null)}>
          <Box sx={{ px: 1.5, py: 1, width: 236 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>行高</Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={density} onChange={(_, value) => value && changeDensity(value)} aria-label="表格行高" sx={{ mb: 1.25 }}>
              <ToggleButton value="compact" aria-label="窄行高" sx={{ flex: 1, fontSize: 11.5 }}>窄行高</ToggleButton>
              <ToggleButton value="comfortable" aria-label="宽行高" sx={{ flex: 1, fontSize: 11.5 }}>宽行高</ToggleButton>
            </ToggleButtonGroup>
            {[
              { label: '斑马纹', checked: striped, change: toggleStriped },
              { label: '水平居中', checked: centerX, change: toggleCenterX },
              { label: '垂直居中', checked: centerY, change: toggleCenterY },
            ].map((option) => (
              <Stack key={option.label} direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 32 }}>
                <Typography sx={{ fontSize: 12.5 }}>{option.label}</Typography>
                <Switch size="small" checked={option.checked} onChange={(event) => option.change(event.target.checked)} />
              </Stack>
            ))}
            <Button size="small" fullWidth startIcon={<Tune fontSize="small" />} onClick={() => { setViewAnchor(null); setFieldsOpen(true) }} sx={{ mt: 0.75, justifyContent: 'flex-start' }}>列设置</Button>
          </Box>
        </Menu>
        <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
          <Box sx={{ p: 1.5, width: 340 }}>
            <Typography sx={{ fontSize: 13, mb: 0.75 }}>排序（最多 3 列，临时）</Typography>
            {sortDraft.map((sort, index) => (
              <Stack key={index} direction="row" spacing={1} sx={{ mb: 0.75 }}>
                <Select size="small" value={sort.field} onChange={(event) => setSortDraft(sortDraft.map((item, i) => i === index ? { ...item, field: event.target.value } : item))} sx={{ width: 150 }}>
                  {sortableFields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
                </Select>
                <Select size="small" value={sort.order} onChange={(event) => setSortDraft(sortDraft.map((item, i) => i === index ? { ...item, order: event.target.value } : item))} sx={{ width: 90 }}>
                  <MenuItem value="asc">升序</MenuItem>
                  <MenuItem value="desc">降序</MenuItem>
                </Select>
                <IconButton size="small" onClick={() => setSortDraft(sortDraft.filter((_, i) => i !== index))}><Close fontSize="small" /></IconButton>
              </Stack>
            ))}
            <Stack direction="row" spacing={1}>
              <Button size="small" startIcon={<Plus fontSize="small" />} disabled={sortDraft.length >= 3} onClick={() => {
                const first = sortableFields[0]
                if (first) setSortDraft([...sortDraft, { field: first.key, order: 'asc' }])
              }}>添加排序</Button>
              <Button size="small" onClick={() => { setSortDraft([]); setSorts([]); setPage(1) }}>清除</Button>
              <Button size="small" variant="contained" onClick={() => {
                setSorts(sortDraft.filter((item) => item.field))
                setSortAnchor(null); setPage(1)
              }}>应用</Button>
            </Stack>
          </Box>
        </Menu>
        <Button size="small" startIcon={<AutoAwesome fontSize="small" />} onClick={() => { setAiInitialText(''); setAiOpen(true) }}>AI 填入</Button>
        <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={openCreate}>添加一行</Button>
      </PageToolbar>

      {quickField ? (
        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, mb: 1, flexShrink: 0 }}>
          <Plus sx={{ fontSize: 16, color: 'text.disabled' }} />
          <TextField
            fullWidth variant="standard" value={quickValue} placeholder="快速新增一行"
            onChange={(event) => setQuickValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submitQuick() }}
            InputProps={{ disableUnderline: true }}
            sx={{ minWidth: 0, '& .MuiInputBase-input': { textAlign: centerX ? 'center' : 'left' } }}
          />
          <Typography sx={{ fontSize: 11, color: 'text.disabled', whiteSpace: 'nowrap' }}>仅填「{quickField.name}」</Typography>
          {quickValue.trim() ? (
            <Button size="small" sx={{ fontSize: 11.5, whiteSpace: 'nowrap' }} onClick={() => { setAiInitialText(quickValue); setQuickValue(''); setAiOpen(true) }}>识别文本</Button>
          ) : null}
          <IconButton size="small" aria-label="添加" disabled={!quickValue.trim()} onClick={submitQuick}>
            <Plus fontSize="small" />
          </IconButton>
        </Paper>
      ) : null}

      {(filtersOpen) ? (
        <Paper variant="outlined" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', p: 1.25, mb: 1, flexShrink: 0 }}>
          {filters.map((filter, index) => (
            <Stack key={index} direction="row" spacing={0.75} alignItems="center">
              <Select size="small" value={filter.field} onChange={(event) => {
                const field = event.target.value
                setFilters(filters.map((item, i) => i === index ? { ...item, field, op: operatorsFor(field)[0].value, value: '' } : item))
              }} sx={{ width: 130 }}>
                {sortableFields.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
              </Select>
              <Select size="small" value={filter.op} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, op: event.target.value } : item))} sx={{ width: 104 }}>
                {operatorsFor(filter.field).map((op) => <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>)}
              </Select>
              {!['empty', 'not_empty'].includes(filter.op) ? (
                filter.op === 'between' ? (
                  fieldType(filter.field) === 'date' ? (
                    <Stack direction="row" spacing={0.5}>
                      <TextField size="small" type="date" value={filter.value?.[0] || ''} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: [event.target.value, item.value?.[1] || ''] } : item))} />
                      <TextField size="small" type="date" value={filter.value?.[1] || ''} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: [item.value?.[0] || '', event.target.value] } : item))} />
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField size="small" placeholder="最小" value={filter.value?.[0] || ''} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: [event.target.value, item.value?.[1] || ''] } : item))} sx={{ width: 90 }} />
                      <span>~</span>
                      <TextField size="small" placeholder="最大" value={filter.value?.[1] || ''} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: [item.value?.[0] || '', event.target.value] } : item))} sx={{ width: 90 }} />
                    </Stack>
                  )
                ) : ['select', 'multiselect'].includes(fieldType(filter.field)) ? (
                  <Select size="small" multiple={fieldType(filter.field) === 'multiselect'} value={filter.value || (fieldType(filter.field) === 'multiselect' ? [] : '')} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} sx={{ width: 160 }} displayEmpty>
                    <MenuItem value="">—</MenuItem>
                    {optionsOf(filter.field).map((option: any) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
                  </Select>
                ) : fieldType(filter.field) === 'checkbox' ? (
                  <Select size="small" value={String(filter.value)} onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: event.target.value === 'true' } : item))} sx={{ width: 110 }}>
                    <MenuItem value="true">是</MenuItem>
                    <MenuItem value="false">否</MenuItem>
                  </Select>
                ) : (
                  <TextField size="small" value={filter.value ?? ''} placeholder="值" onChange={(event) => setFilters(filters.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} onKeyDown={(event) => { if (event.key === 'Enter') setPage(1) }} sx={{ width: 140 }} />
                )
              ) : null}
              <IconButton size="small" title="移除条件" onClick={() => setFilters(filters.filter((_, i) => i !== index))}><Close fontSize="small" /></IconButton>
            </Stack>
          ))}
          <Button size="small" startIcon={<Plus fontSize="small" />} disabled={filters.length >= 10} onClick={addFilter}>添加条件</Button>
          <Button size="small" variant="contained" onClick={() => setPage(1)}>查询</Button>
          {filters.length ? <Button size="small" onClick={() => { setFilters([]); setPage(1) }}>重置</Button> : null}
        </Paper>
      ) : null}

      <PageBody sx={{ minHeight: 0 }}>
        {initialError ? <Alert severity="error" action={<Button size="small" onClick={() => void reload()}>重试加载</Button>}>{initialError}</Alert> : null}
        {!fields.length && !initialError ? (
          <EmptyHint action={<Button size="small" variant="contained" onClick={() => setFieldsOpen(true)}>添加一列</Button>}>这张表格还没有列</EmptyHint>
        ) : (
          <>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <DataTable
                rows={rows}
                loading={loading}
                maxHeight="100%"
                columnDividers
                striped={striped}
                centerX={centerX}
                centerY={centerY}
                columnWidths={columnWidths}
                onColumnWidthsChange={saveColumnWidths}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={saveColumnVisibility}
                size={density === 'compact' ? 'small' : 'medium'}
                rowKey={(row) => row.id}
                sortKey={headerSort?.field}
                sortDirection={headerSort?.order === 'desc' ? 'desc' : 'asc'}
                onSort={toggleSort}
                onSortClear={() => { setSorts([]); setPage(1) }}
                columns={[
                  {
                    key: '__select', label: '', width: 42,
                    headerRender: <Checkbox size="small" checked={allVisibleSelected} indeterminate={someVisibleSelected} onChange={(event) => toggleVisibleSelection(event.target.checked)} inputProps={{ 'aria-label': '全选当前页' }} />,
                    render: (row) => (
                      <Checkbox
                        size="small" checked={selection.includes(row.id)} onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setSelection((prev) => event.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id))}
                      />
                    ),
                  },
                  ...fields.map((field) => ({
                    key: field.key, label: field.name, width: field.type === 'long_text' ? 220 : field.type === 'url' ? 200 : 130,
                    ellipsis: true, sortable: sortableFields.some((item) => item.key === field.key), render: (row: any) => renderCell(field, row),
                  })),
                  {
                    key: '__actions', label: '操作', width: 88, sticky: true,
                    render: (row) => (
                      <Stack direction="row" spacing={0.25} onClick={(event) => event.stopPropagation()}>
                        <IconButton size="small" aria-label="编辑整行" title="编辑整行" onClick={() => { setEditingRecord(row); setRecordOpen(true) }}><Edit fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label="删除" title="删除" color="error" onClick={() => void removeRecord(row)}><Delete fontSize="small" /></IconButton>
                      </Stack>
                    ),
                  },
                ]}
                sx={{ '& .MuiDataGrid-cell[data-field="__select"]': { fontSize: 0 } }}
              />
            </Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
              {selection.length ? <Button size="small" onClick={() => void batchDelete()}>删除选中的 {selection.length} 行</Button> : null}
              {!rows.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>没有符合条件的内容</Typography> : null}
              <div className="spacer" />
              <Pager page={page} pageSize={pageSize} total={total} onPage={(value) => setPage(value)} onPageSize={(value) => { setPageSize(value); setPage(1); sessionStorage.setItem(`wb-table-page-size:${tableId}`, String(value)) }} />
            </Stack>
          </>
        )}
      </PageBody>

      <RecordDrawer open={recordOpen} tableId={tableId} fields={fields} record={editingRecord} onClose={() => setRecordOpen(false)} onSaved={() => void loadRecords()} />
      <FieldManager open={fieldsOpen} tableId={tableId} fields={fields} onClose={() => setFieldsOpen(false)} onUpdated={() => void reload()} />
      <ImportWizard open={importOpen} tableId={tableId} existingFields={fields} onClose={() => setImportOpen(false)} onDone={() => void reload()} />
      <DeleteTableDialog open={deleteOpen} table={table ? { id: tableId, name: table.name } : null} onClose={() => setDeleteOpen(false)} onDeleted={() => navigate('/data')} />
      <TableAnalysisDialog open={analysisOpen} tableId={tableId} onClose={() => setAnalysisOpen(false)} />
      <AiTableFill open={aiOpen} tableId={tableId} initialText={aiInitialText} onClose={() => setAiOpen(false)} onSaved={() => void reload()} />
      <AttachmentPreview open={Boolean(previewFile)} file={previewFile} onClose={() => setPreviewFile(null)} />

      <Dialog open={exportOpen} onClose={() => !exporting && setExportOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>导出表格</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <label><input type="radio" checked={exportScope === 'all'} onChange={() => setExportScope('all')} /> 整张表格（{total} 行）</label>
            <label><input type="radio" checked={exportScope === 'filtered'} onChange={() => setExportScope('filtered')} /> 当前筛选结果</label>
          </Stack>
          {exportScope === 'filtered' ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>导出全部筛选结果，不受分页影响。</Typography> : null}
          {exporting ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>正在生成导出文件，数据较多时请稍候…</Typography> : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" disabled={exporting} onClick={() => setExportOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={exporting} onClick={exportTable}>导出</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
