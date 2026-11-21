import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  Menu, MenuItem, Paper, Select, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { AutoAwesome, Close, Download, FilterList, MoreFilled, Plus, Sort, Tune } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import { DataTable, EmptyHint, ModuleToolbar, PageBody, Pager, type Column } from '@/ui/common'
import RecordDrawer from '@/components/RecordDrawer'
import FieldManager from '@/components/FieldManager'
import ImportWizard from '@/components/ImportWizard'
import DeleteTableDialog from '@/components/DeleteTableDialog'
import AttachmentPreview from '@/components/AttachmentPreview'
import TableAnalysisDialog from '@/components/TableAnalysisDialog'
import AiTableFill from '@/components/AiTableFill'
import TableCell from '@/components/TableCell'
import { setTableCellSaving, stopTableCellEdit } from '@/components/table-edit-store'
import { isLikelyStaticDerived, valueAlign, type Field } from '@/table-core'

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
  const [centerX, setCenterX] = useState(() => localStorage.getItem('wb_table_center_x') === '1')
  const [centerY, setCenterY] = useState(() => localStorage.getItem('wb_table_center_y') !== '0')
  const toggleCenterX = (value: boolean) => { setCenterX(value); localStorage.setItem('wb_table_center_x', value ? '1' : '0') }
  const toggleCenterY = (value: boolean) => { setCenterY(value); localStorage.setItem('wb_table_center_y', value ? '1' : '0') }
  const [pinColumns, setPinColumns] = useState(() => localStorage.getItem('wb_table_pin_columns') === '1')
  const togglePinColumns = (value: boolean) => { setPinColumns(value); localStorage.setItem('wb_table_pin_columns', value ? '1' : '0') }
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
  const [rowSelectionModel, setRowSelectionModel] = useState<readonly (string | number)[]>([])
  const [recordOpen, setRecordOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any | null>(null)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [addFieldRequest, setAddFieldRequest] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInitialText, setAiInitialText] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportScope, setExportScope] = useState<'all' | 'filtered'>('all')
  const [exporting, setExporting] = useState(false)
  const [previewFile, setPreviewFile] = useState<any | null>(null)
  const [rowMenu, setRowMenu] = useState<{ el: HTMLElement; row: any } | null>(null)

  const viewActive = useRef(true)
  const recordsRequest = useRef(0)
  useEffect(() => {
    viewActive.current = true
    return () => { viewActive.current = false; stopTableCellEdit() }
  }, [])

  const sortableFields = useMemo(
    () => fields.filter((field) => !['long_text', 'multiselect', 'attachment'].includes(field.type)),
    [fields],
  )
  const selection = useMemo(
    () => rowSelectionModel.map(Number).filter((id) => Number.isFinite(id)),
    [rowSelectionModel],
  )
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

  const removeRecord = useCallback(async (row: any) => {
    const ok = await confirmDialog({ title: '删除行', danger: true, confirmText: '删除', message: '删除这一行？删除后会在回收站保留 30 天。' })
    if (!ok) return
    try {
      await http.delete(`/records/${row.id}`)
      await loadRecords()
      setRowSelectionModel((prev) => prev.filter((id) => String(id) !== String(row.id)))
    } catch (error) { toast.error(apiError(error).message) }
  }, [loadRecords])

  const batchDelete = useCallback(async () => {
    const ok = await confirmDialog({ title: '删除行', danger: true, confirmText: '删除', message: `删除选中的 ${selection.length} 行？一次最多 100 行。` })
    if (!ok) return
    try {
      await http.post(`/tables/${tableId}/records/batch-delete`, { ids: selection })
      toast.success('已移入回收站'); setRowSelectionModel([]); await loadRecords()
    } catch (error) { toast.error(apiError(error).message) }
  }, [loadRecords, selection, tableId])

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

  const openAttachment = useCallback(async (id: number) => {
    try { setPreviewFile((await http.get(`/files/${id}`)).data) }
    catch (error) { toast.error(apiError(error).message) }
  }, [])

  const addFilter = () => {
    const first = sortableFields[0]
    if (!first) return
    setFilters([...filters, { field: first.key, op: operatorsFor(first.key)[0].value, value: '' }])
  }

  const saveCell = useCallback(async (row: any, field: Field, value: any) => {
    setTableCellSaving(true)
    try {
      const data = { ...row.data, [field.key]: value === '' ? null : value }
      const response = await http.put(`/records/${row.id}`, { data, version: row.version })
      setRows((prev) => prev.map((item) => item.id === row.id ? response.data : item))
      stopTableCellEdit()
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setTableCellSaving(false)
    }
  }, [])

  const headerSort = sorts.length === 1 ? sorts[0] : null
  const toggleSort = useCallback((field: string, direction?: 'asc' | 'desc') => {
    const current = sorts.find((item) => item.field === field)
    setSorts([{ field, order: direction || (current?.order === 'asc' ? 'desc' : 'asc') }])
    setPage(1)
  }, [sorts])

  // 默认固定「日期 + 店铺/门店」两列，横向滚动到金额、备注时仍能读出这一行属于哪一天、哪家店。
  // MUI 社区版只支持固定排在最前面的连续列：表头取 visibleColumns 的前 N 列，表体却按 pinnedColumns
  // 的定义渲染。若把中间列（例如名字里带「店」的「全店曝光」）塞进去，就会出现无表头的重复列并压住
  // 相邻列。因此这里只固定可见列中从头开始连续命中的列，其余列保持普通展示。
  const pinnedLeft = useMemo(() => {
    if (!pinColumns || !fields.length) return []
    const date = fields.find((field) => field.type === 'date')
    // 只认真正的店铺/门店列，避免「全店曝光」「本店访客」这类指标被误判。
    const store = fields.find((field) => field.type !== 'date' && /店铺|门店/.test(field.name))
    const desired = new Set(
      [date?.key, store?.key].filter((key): key is string => typeof key === 'string'),
    )
    const keys: string[] = []
    for (const field of fields) {
      if (columnVisibility[field.key] === false) continue
      if (!desired.has(field.key)) break
      keys.push(field.key)
    }
    return keys
  }, [fields, columnVisibility, pinColumns])

  const fieldHeader = useCallback((field: Field, sortable = false) => {
    const align = valueAlign(field)
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={align === 'right' ? 'flex-end' : 'flex-start'} sx={{ minWidth: 0, width: '100%' }}>
        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field.name}</Box>
        {sortable ? <Sort sx={{ fontSize: 12, color: 'text.disabled', flexShrink: 0 }} /> : null}
        {isLikelyStaticDerived(field) ? (
          <Tooltip title="静态派生值：按录入时的数值保存，修改源数据后不会自动重算。建议改用「公式」列，或在列设置里确认它是手工录入值。">
            <Box component="span" sx={{ flexShrink: 0, fontSize: 10, lineHeight: '14px', px: 0.5, border: 1, borderColor: 'divider', color: 'text.secondary', borderRadius: 0.5, fontWeight: 500 }}>静态</Box>
          </Tooltip>
        ) : null}
      </Stack>
    )
  }, [])

  const sortableKeys = useMemo(() => new Set(sortableFields.map((field) => field.key)), [sortableFields])
  // 列宽默认值需容纳完整字段名：表头文字 + 排序图标 + 「静态」标记 + 单元格左右内边距。
  const headerFitWidth = useCallback((field: Field) => {
    const textWidth = Array.from(field.name || '').reduce(
      (sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0x2e7f ? 14 : 8), 0,
    )
    const sortWidth = sortableKeys.has(field.key) ? 16 : 0
    const badgeWidth = isLikelyStaticDerived(field) ? 34 : 0
    return Math.ceil(textWidth + sortWidth + badgeWidth + 26)
  }, [sortableKeys])
  const columns = useMemo<Column<any>[]>(() => [
    ...fields.map((field) => {
      const baseWidth = field.type === 'long_text' ? 220 : field.type === 'url' ? 200 : field.type === 'number' ? 110 : 130
      const minWidth = Math.max(baseWidth, headerFitWidth(field))
      return {
        key: field.key, label: field.name, width: minWidth, minWidth,
        align: valueAlign(field), headerAlign: valueAlign(field), headerRender: fieldHeader(field, sortableKeys.has(field.key)),
        ellipsis: true, sortable: sortableKeys.has(field.key),
        render: (row: any) => <TableCell field={field} row={row} onSave={saveCell} onOpenAttachment={openAttachment} />,
      }
    }),
    {
      key: '__actions', label: '', width: 56, sticky: true,
      render: (row) => (
        <Stack direction="row" spacing={0.25} onClick={(event) => event.stopPropagation()}>
          <IconButton
            size="small" aria-label="行操作" onClick={(event) => setRowMenu({ el: event.currentTarget, row })}
            sx={{ width: 24, height: 24, p: 0 }}
          ><MoreFilled sx={{ fontSize: 16 }} /></IconButton>
        </Stack>
      ),
    },
  ], [fieldHeader, fields, headerFitWidth, openAttachment, removeRecord, saveCell, sortableKeys])
  const clearSort = useCallback(() => { setSorts([]); setPage(1) }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, p: '10px', gap: '10px' }}>
      <ModuleToolbar
        sx={{ py: 0 }}
        info={(
          <>
            <Button
              variant="outlined" size="small" startIcon={<FilterList />}
              onClick={() => setFiltersOpen(!filtersOpen)} color={filtersOpen ? 'primary' : 'inherit'}
              sx={{ height: 36 }}
            >筛选{filters.length ? `(${filters.length})` : ''}</Button>
            <Button variant="outlined" size="small" startIcon={<Sort />} onClick={(event: any) => { setSortDraft(sorts.length ? [...sorts] : []); setSortAnchor(event.currentTarget) }} sx={{ height: 36 }}>排序{sortDraft.length ? `(${sortDraft.length})` : sorts.length ? `(${sorts.length})` : ''}</Button>
            <Button variant="outlined" size="small" startIcon={<Tune />} onClick={(event) => setViewAnchor(event.currentTarget)} sx={{ height: 36 }}>视图</Button>
            <Menu anchorEl={viewAnchor} open={Boolean(viewAnchor)} onClose={() => setViewAnchor(null)}>
              <Box sx={{ px: 1.5, py: 1, width: 236 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>行高</Typography>
                <ToggleButtonGroup size="small" exclusive fullWidth value={density} onChange={(_, value) => value && changeDensity(value)} aria-label="表格行高" sx={{ mb: 1.25 }}>
                  <ToggleButton value="compact" aria-label="窄行高" sx={{ flex: 1, fontSize: 11.5 }}>窄行高</ToggleButton>
                  <ToggleButton value="comfortable" aria-label="宽行高" sx={{ flex: 1, fontSize: 11.5 }}>宽行高</ToggleButton>
                </ToggleButtonGroup>
                {[
                  { label: '固定日期/店铺列', checked: pinColumns, change: togglePinColumns },
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
          </>
        )}
        onRefresh={() => void reload()}
        refreshLabel="刷新表格数据"
        more={(
          <>
            <Tooltip title="更多表格操作">
              <IconButton size="small" aria-label="更多表格操作" onClick={(event) => setMoreAnchor(event.currentTarget)}><MoreFilled fontSize="small" /></IconButton>
            </Tooltip>
            <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
              <MenuItem onClick={() => { setMoreAnchor(null); setFieldsOpen(true) }}>列设置</MenuItem>
              <MenuItem onClick={() => { setMoreAnchor(null); setFieldsOpen(true); setAddFieldRequest((value) => value + 1) }} disabled={fields.length >= 200}>添加一列</MenuItem>
              <MenuItem onClick={() => { setMoreAnchor(null); setAiInitialText(''); setAiOpen(true) }}>AI 填入</MenuItem>
              <MenuItem onClick={() => { setMoreAnchor(null); setExportOpen(true) }}>导出</MenuItem>
              <MenuItem onClick={() => { setMoreAnchor(null); setAnalysisOpen(true) }}>汇总与透视</MenuItem>
              <MenuItem onClick={() => { setMoreAnchor(null); navigate(`/visualizations?table=${tableId}`) }}>用于数据可视化</MenuItem>
              <MenuItem divider onClick={() => { setMoreAnchor(null); setDeleteOpen(true) }} sx={{ color: 'error.main' }}>导出备份后删除表格</MenuItem>
            </Menu>
          </>
        )}
        primary={(
          <>
            <Button variant="outlined" startIcon={<Download />} onClick={() => setImportOpen(true)} sx={{ height: 36 }}>导入</Button>
            <Button variant="contained" startIcon={<Plus />} onClick={openCreate} sx={{ height: 36 }}>添加一行</Button>
          </>
        )}
      />

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
                striped={striped}
                centerX={centerX}
                centerY={centerY}
                columnWidths={columnWidths}
                onColumnWidthsChange={saveColumnWidths}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={saveColumnVisibility}
                pinnedLeft={pinnedLeft}
                size={density === 'compact' ? 'small' : 'medium'}
                checkboxSelection
                rowSelectionModel={rowSelectionModel}
                onRowSelectionModelChange={setRowSelectionModel}
                sortKey={headerSort?.field}
                sortDirection={headerSort?.order === 'desc' ? 'desc' : 'asc'}
                onSort={toggleSort}
                onSortClear={clearSort}
                columns={columns}
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

      <Menu anchorEl={rowMenu?.el || null} open={Boolean(rowMenu)} onClose={() => setRowMenu(null)}>
        <MenuItem onClick={() => {
          const row = rowMenu?.row
          setRowMenu(null)
          if (row) { setEditingRecord(row); setRecordOpen(true) }
        }}>编辑整行</MenuItem>
        <MenuItem divider sx={{ color: 'error.main' }} onClick={() => {
          const row = rowMenu?.row
          setRowMenu(null)
          if (row) void removeRecord(row)
        }}>删除</MenuItem>
      </Menu>

      <RecordDrawer open={recordOpen} tableId={tableId} fields={fields} record={editingRecord} onClose={() => setRecordOpen(false)} onSaved={() => void loadRecords()} />
      <FieldManager open={fieldsOpen} tableId={tableId} fields={fields} addRequest={addFieldRequest} onClose={() => setFieldsOpen(false)} onUpdated={() => void reload()} />
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
