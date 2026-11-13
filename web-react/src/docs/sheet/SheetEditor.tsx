import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Menu, MenuItem, Paper, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { zhCN } from '@mui/x-data-grid/locales'
import {
  Check, Close, CopyDocument, Delete, Download, Edit, FolderOpened, Plus, Refresh, Search, Upload,
} from '@/icons'
import { apiError } from '@/api/client'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { downloadBlob } from '@/convert/files'
import { getFileBytes, type ProjectDetail } from '@/docs/api'
import ProjectActions from '@/docs/ProjectActions'
import {
  MAX_FILE_BYTES, MAX_ROWS, MAX_COLS, addSheet, cellDisplay, cellInput, deleteColumn, deleteRow,
  deleteSheet, exportWorkbook, findAndReplace, insertColumn, insertRow, readWorkbookFile, recalculate,
  renameSheet, sheetAsDelimited, sheetAsJson, sheetBounds, a1, cloneWorkbook, setCell, type SheetModel,
  type WorkbookModel,
} from '@/docs/sheet/model'

const ACCEPT = '.xlsx,.xls,.xlsb,.ods,.csv,.tsv,.json'
const undoLimit = 30

function baseName(name: string) { return name.replace(/\.[^.]+$/, '') || '工作簿' }

function isPanelVisible(element: HTMLElement | null) {
  if (!element || element.offsetParent === null) return false
  return window.getComputedStyle(element).visibility !== 'hidden'
}

export default function SheetEditor() {
  const [workbook, setWorkbook] = useState<WorkbookModel | null>(null)
  const [title, setTitle] = useState('未命名工作簿')
  const [current, setCurrent] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const [formula, setFormula] = useState('')
  const [history, setHistory] = useState<WorkbookModel[]>([])
  const [future, setFuture] = useState<WorkbookModel[]>([])
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [replaceAllSheets, setReplaceAllSheets] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const computed = useMemo(() => workbook ? recalculate(workbook) : { values: {}, warnings: [] }, [workbook])
  const activeSheet = workbook?.sheets[workbook.activeSheet] || null
  const warnings = useMemo(() => [...new Set([...(workbook?.warnings || []), ...computed.warnings])], [workbook, computed.warnings])

  const commit = useCallback((next: WorkbookModel) => {
    if (workbook) {
      setHistory((list) => [...list.slice(-(undoLimit - 1)), cloneWorkbook(workbook)])
      setFuture([])
    }
    setWorkbook(next)
  }, [workbook])

  const updateActive = useCallback((mutate: (sheet: SheetModel) => void) => {
    if (!workbook) return
    const next = cloneWorkbook(workbook)
    const sheet = next.sheets[next.activeSheet]
    if (!sheet) return
    mutate(sheet)
    next.dirty = true
    commit(next)
  }, [workbook, commit])

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) { setError(`文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限`); return }
    setLoading(true); setError('')
    try {
      const parsed = await readWorkbookFile(file)
      setWorkbook(parsed)
      setTitle(baseName(file.name))
      setCurrent(null)
      setHistory([]); setFuture([]); setSelected(null); setFormula('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工作簿无法打开')
    } finally { setLoading(false) }
  }

  const openProject = async (detail: ProjectDetail) => {
    const attachment = detail.attachments[0]
    if (!attachment) throw new Error('项目没有工作簿附件')
    const bytes = await getFileBytes(attachment.id)
    const file = new File([bytes], attachment.name, { type: attachment.content_type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    setLoading(true)
    try {
      const parsed = await readWorkbookFile(file)
      const active = Number(detail.state?.activeSheet)
      parsed.activeSheet = Number.isInteger(active) && active >= 0 && active < parsed.sheets.length ? active : 0
      parsed.fileName = attachment.name
      setWorkbook(parsed); setTitle(detail.title); setHistory([]); setFuture([]); setError('')
    } finally { setLoading(false) }
  }

  const buildSave = async () => {
    if (!workbook) throw new Error('还没有工作簿')
    const blob = exportWorkbook(workbook)
    const name = `${baseName(title || workbook.fileName)}.xlsx`
    return {
      state: { activeSheet: workbook.activeSheet, fileName: name, sourceFormat: workbook.sourceFormat },
      files: [new File([blob], name, { type: blob.type })],
    }
  }

  const switchSheet = (index: number) => {
    if (!workbook) return
    setWorkbook({ ...workbook, activeSheet: index })
    setSelected(null); setFormula('')
  }

  const add = () => {
    if (!workbook) return
    commit(addSheet(workbook, `Sheet${workbook.sheets.length + 1}`))
  }

  const rename = () => {
    if (!workbook || !activeSheet) return
    setRenameValue(activeSheet.name); setRenameOpen(true)
  }

  const applyRename = () => {
    if (!workbook) return
    try {
      commit(renameSheet(workbook, workbook.activeSheet, renameValue))
      setRenameOpen(false)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '重命名失败') }
  }

  const removeSheet = async () => {
    if (!workbook || !activeSheet) return
    const ok = await confirmDialog({ title: '删除工作表', danger: true, confirmText: '删除', message: `删除工作表「${activeSheet.name}」？` })
    if (!ok) return
    try { commit(deleteSheet(workbook, workbook.activeSheet)); setSelected(null) }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : '删除失败') }
  }

  const undo = () => {
    if (!history.length || !workbook) return
    const previous = history[history.length - 1]
    setHistory(history.slice(0, -1))
    setFuture([cloneWorkbook(workbook), ...future].slice(0, undoLimit))
    setWorkbook(previous)
  }

  const redo = () => {
    if (!future.length || !workbook) return
    const next = future[0]
    setFuture(future.slice(1))
    setHistory([...history.slice(-(undoLimit - 1)), cloneWorkbook(workbook)])
    setWorkbook(next)
  }

  const editCell = (row: number, col: number, input: string) => {
    if (!activeSheet) return
    const existing = activeSheet.cells[a1(row, col)]
    const currentInput = cellInput(existing)
    if (currentInput === input) return
    updateActive((sheet) => setCell(sheet, row, col, input))
  }

  const commitFormula = () => {
    if (!selected) return
    editCell(selected.row, selected.col, formula)
  }

  const selectCell = (row: number, col: number) => {
    setSelected({ row, col })
    setFormula(activeSheet ? cellInput(activeSheet.cells[a1(row, col)]) : '')
  }

  const bounds = activeSheet ? sheetBounds(activeSheet) : { rowCount: 20, colCount: 10 }
  const rowCount = Math.min(MAX_ROWS, Math.max(bounds.rowCount, 30))
  const colCount = Math.min(MAX_COLS, Math.max(bounds.colCount, 10))

  const rows = useMemo(() => {
    if (!activeSheet) return []
    const list: any[] = Array.from({ length: rowCount }, (_, row) => ({ id: row, __row: row }))
    for (const [key, cell] of Object.entries(activeSheet.cells)) {
      const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(key)
      if (!match) continue
      const row = Number(match[2]) - 1
      const col = match[1].toUpperCase().split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1
      if (row < rowCount && col < colCount && list[row]) list[row][`c${col}`] = cellInput(cell)
    }
    return list
  }, [activeSheet, rowCount, colCount])

  const columns: GridColDef[] = useMemo(() => {
    const list: GridColDef[] = [{
      field: '__row', headerName: '', width: 48, sortable: false, filterable: false, editable: false, disableColumnMenu: true,
      renderCell: (params) => <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{params.row.__row + 1}</Typography>,
    }]
    for (let col = 0; col < colCount; col += 1) {
      const name = a1(0, col).replace('1', '')
      const width = Number(activeSheet?.cols?.[col]?.wch) > 0 ? Math.min(320, Math.max(70, Number(activeSheet?.cols?.[col]?.wch) * 8)) : 112
      list.push({
        field: `c${col}`, headerName: name, width, editable: true, sortable: true,
        renderCell: (params) => {
          const raw = activeSheet?.cells[a1(params.row.__row, col)]
          if (!raw) return null
          const text = cellDisplay(raw, computed.values[`${activeSheet?.name}!${a1(params.row.__row, col)}`])
          const errorText = /^#[A-Z0-9/?!]+$/.test(text)
          return <Typography component="span" sx={{ fontSize: 12, color: errorText ? 'error.main' : 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Typography>
        },
      })
    }
    return list
  }, [colCount, activeSheet, computed.values])

  const processRowUpdate = (newRow: any, oldRow: any) => {
    for (let col = 0; col < colCount; col += 1) {
      const field = `c${col}`
      if ((newRow[field] ?? '') !== (oldRow[field] ?? '')) {
        editCell(newRow.__row, col, newRow[field] ?? '')
        selectCell(newRow.__row, col)
        break
      }
    }
    return newRow
  }

  const applyPasteText = useCallback((text: string) => {
    if (!workbook || !selected || !text) return
    const matrix = text.replace(/\r/g, '').split('\n').filter((line, index, list) => line.length || index < list.length - 1).map((line) => line.split('\t'))
    const next = cloneWorkbook(workbook)
    const sheet = next.sheets[next.activeSheet]
    try {
      matrix.forEach((line, rowOffset) => line.forEach((value, colOffset) => setCell(sheet, selected.row + rowOffset, selected.col + colOffset, value)))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '粘贴超出工作表上限')
      return
    }
    next.dirty = true
    commit(next)
    toast.success(`已粘贴 ${matrix.length} 行`)
  }, [workbook, selected, commit])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!workbook || !selected || !isPanelVisible(wrapperRef.current)) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,[contenteditable=true]')) return
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return
      event.preventDefault()
      applyPasteText(text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [workbook, selected, applyPasteText])

  const copy = async () => {
    if (!selected || !activeSheet) return
    const raw = activeSheet.cells[a1(selected.row, selected.col)]
    const text = raw ? cellDisplay(raw, computed.values[`${activeSheet.name}!${a1(selected.row, selected.col)}`]) : ''
    try { await navigator.clipboard.writeText(text); toast.success('已复制单元格') }
    catch { toast.warning('浏览器不允许自动复制') }
  }

  const applyReplace = () => {
    if (!workbook) return
    try {
      const next = findAndReplace(activeSheet!, findText, replaceText, replaceAllSheets, workbook)
      commit(next); setFindOpen(false); toast.success('已完成替换')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '替换失败') }
  }

  const exportAs = async (kind: 'xlsx' | 'csv' | 'tsv' | 'json') => {
    setExportAnchor(null)
    if (!workbook || !activeSheet) return
    try {
      if (kind === 'xlsx') {
        downloadBlob(exportWorkbook(workbook), `${baseName(title || workbook.fileName)}.xlsx`)
        return
      }
      if (kind === 'json') {
        downloadBlob(new Blob([sheetAsJson(workbook, workbook.activeSheet)], { type: 'application/json;charset=utf-8' }), `${baseName(activeSheet.name)}.json`)
        return
      }
      const ok = await confirmDialog({
        title: kind === 'csv' ? '导出 CSV' : '导出 TSV', confirmText: '继续导出',
        message: `只导出工作表「${activeSheet.name}」，公式会变为当前计算结果，格式、图片和其他工作表不会保留${kind === 'tsv' ? '；制表符会替换为空格' : ''}。`,
      })
      if (!ok) return
      const text = sheetAsDelimited(workbook, workbook.activeSheet, kind === 'csv' ? ',' : '\t')
      downloadBlob(new Blob(['\uFEFF' + text], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8' }), `${baseName(activeSheet.name)}.${kind}`)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '导出失败') }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (!isPanelVisible(wrapperRef.current)) return
      if ((event.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]')) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
      if (event.key.toLowerCase() === 'c') { event.preventDefault(); void copy() }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!workbook) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 3 }}>
        <Paper variant="outlined" sx={{ maxWidth: 680, width: '100%', p: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 650, mb: 0.5 }}>导入工作簿</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
            XLSX / XLS / XLSB / ODS / CSV / TSV / JSON；浏览器内解析，未保存时不离开设备。
          </Typography>
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadFile(file) }} />
          <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={<Upload fontSize="small" />} disabled={loading} onClick={() => inputRef.current?.click()}>{loading ? '正在解析…' : '选择文件'}</Button>
            <Button startIcon={<Plus fontSize="small" />} onClick={() => { setWorkbook({ fileName: '未命名.xlsx', sourceFormat: 'xlsx', sheets: [{ name: 'Sheet1', cells: {}, rowCount: 30, colCount: 10 }], activeSheet: 0, warnings: [], dirty: false }); setTitle('未命名工作簿') }}>空白工作簿</Button>
            <ProjectActions kind="sheet" kindLabel="表格" title={title} onTitleChange={setTitle} current={current} onCurrentChange={setCurrent} buildSave={async () => { throw new Error('请先创建工作簿') }} onOpen={openProject} disabled={!workbook} />
          </Stack>
          {error ? <Alert severity="error" sx={{ mt: 2, textAlign: 'left', py: 0.4, fontSize: 12 }}>{error}</Alert> : null}
          <Typography sx={{ mt: 2, fontSize: 10.5, color: 'text.disabled' }}>
            单文件最多 {MAX_FILE_BYTES / 1024 / 1024} MB；最多 {MAX_ROWS.toLocaleString()} 行、{MAX_COLS} 列。超过限制会提示先拆分。XLS/XLSB/ODS 可导入，首版统一导出 XLSX。
          </Typography>
        </Paper>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadFile(file) }} />
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.7, borderBottom: 1, borderColor: 'divider' }}>
        <TextField size="small" value={title} onChange={(event) => setTitle(event.target.value)} inputProps={{ maxLength: 200, 'aria-label': '工作簿标题' }} aria-label="工作簿标题" sx={{ width: { xs: 150, sm: 240 }, '& .MuiInputBase-input': { fontSize: 13, fontWeight: 600, py: 0.5 } }} />
        <Chip size="small" variant="outlined" label={`${workbook.sheets.length} 个工作表`} />
        <Box sx={{ flex: 1 }} />
        <ProjectActions kind="sheet" kindLabel="表格" title={title} onTitleChange={setTitle} current={current} onCurrentChange={setCurrent} buildSave={buildSave} onOpen={openProject} />
        <Button size="small" startIcon={<Upload fontSize="small" />} onClick={() => inputRef.current?.click()}>导入</Button>
        <Button size="small" startIcon={<Download fontSize="small" />} onClick={(event) => setExportAnchor(event.currentTarget)}>导出</Button>
        <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => void exportAs('xlsx')}>导出 XLSX</MenuItem>
          <MenuItem onClick={() => void exportAs('csv')}>导出 CSV（当前工作表）</MenuItem>
          <MenuItem onClick={() => void exportAs('tsv')}>导出 TSV（当前工作表）</MenuItem>
          <MenuItem onClick={() => void exportAs('json')}>导出 JSON（当前工作表）</MenuItem>
        </Menu>
      </Stack>

      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.55, borderBottom: 1, borderColor: 'divider' }}>
        <Tooltip title="撤销"><span><IconButton size="small" aria-label="撤销" disabled={!history.length} onClick={undo}><Refresh fontSize="small" sx={{ transform: 'scaleX(-1)' }} /></IconButton></span></Tooltip>
        <Tooltip title="重做"><span><IconButton size="small" aria-label="重做" disabled={!future.length} onClick={redo}><Refresh fontSize="small" /></IconButton></span></Tooltip>
        <Button size="small" startIcon={<Plus fontSize="small" />} onClick={() => { updateActive((sheet) => insertRow(sheet, (selected?.row ?? 0) + 1)); toast.info('已插入行，请检查相关公式引用') }}>插入行</Button>
        <Button size="small" startIcon={<Delete fontSize="small" />} onClick={() => { updateActive((sheet) => deleteRow(sheet, selected?.row ?? 0)); toast.info('已删除行，请检查相关公式引用') }}>删除行</Button>
        <Button size="small" onClick={() => { updateActive((sheet) => insertColumn(sheet, (selected?.col ?? 0) + 1)); toast.info('已插入列，请检查相关公式引用') }}>插入列</Button>
        <Button size="small" onClick={() => { updateActive((sheet) => deleteColumn(sheet, selected?.col ?? 0)); toast.info('已删除列，请检查相关公式引用') }}>删除列</Button>
        <Button size="small" startIcon={<Search fontSize="small" />} onClick={() => setFindOpen(true)}>查找替换</Button>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{selected ? a1(selected.row, selected.col) : '未选择单元格'}</Typography>
      </Stack>

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'monospace', minWidth: 46 }}>{selected ? a1(selected.row, selected.col) : 'fx'}</Typography>
        <TextField
          size="small" value={formula} placeholder="单元格内容或 =SUM(A1:A3)"
          onChange={(event) => setFormula(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitFormula() } }}
          onBlur={commitFormula}
          inputProps={{ 'aria-label': '公式栏', style: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 } }}
          sx={{ flex: 1 }}
        />
        <Tooltip title="复制单元格"><IconButton size="small" aria-label="复制单元格" disabled={!selected} onClick={() => void copy()}><CopyDocument fontSize="small" /></IconButton></Tooltip>
        <Button size="small" startIcon={<Check fontSize="small" />} disabled={!selected} onClick={commitFormula}>写入</Button>
      </Stack>

      {error ? <Alert severity="error" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 12 }} onClose={() => setError('')}>{error}</Alert> : null}
      {warnings.length ? (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}>
          {warnings.slice(0, 3).join('；')}{warnings.length > 3 ? `；另 ${warnings.length - 3} 项` : ''}
        </Alert>
      ) : null}

      <Box sx={{ px: 1.25, pt: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Tabs value={workbook.activeSheet} onChange={(_, value) => switchSheet(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 32, flex: 1, '& .MuiTab-root': { minHeight: 32, py: 0, fontSize: 12, minWidth: 90 } }}>
          {workbook.sheets.map((sheet) => <Tab key={sheet.name} value={workbook.sheets.indexOf(sheet)} label={sheet.name} />)}
        </Tabs>
        <Tooltip title="添加工作表"><IconButton size="small" aria-label="添加工作表" onClick={add}><Plus fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="重命名工作表"><IconButton size="small" aria-label="重命名工作表" onClick={rename}><Edit fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="删除工作表"><span><IconButton size="small" aria-label="删除工作表" disabled={workbook.sheets.length <= 1} onClick={() => void removeSheet()}><Delete fontSize="small" /></IconButton></span></Tooltip>
      </Box>

      <Box ref={wrapperRef} onKeyDownCapture={(event) => {
        if (!isPanelVisible(wrapperRef.current)) return
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && selected) {
          const target = event.target as HTMLElement
          if (target.closest('input,textarea,[contenteditable=true]')) return
          event.preventDefault()
          event.stopPropagation()
          void navigator.clipboard.readText().then(applyPasteText).catch(() => { /* 浏览器拒绝读取剪贴板时回退到 paste 事件 */ })
        }
      }} sx={{ flex: 1, minHeight: 0, p: 1.25, position: 'relative' }}>
        {loading ? <Stack sx={{ position: 'absolute', inset: 0, zIndex: 4, alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', opacity: 0.82 }}><CircularProgress size={22} /><Typography sx={{ mt: 1, fontSize: 12 }}>正在解析工作簿…</Typography></Stack> : null}
        <DataGrid
          rows={rows}
          columns={columns}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={(reason) => toast.error(reason instanceof Error ? reason.message : '单元格写入失败')}
          onCellClick={(params) => { if (params.field !== '__row') selectCell(params.row.__row, Number(String(params.field).slice(1))) }}
          onCellEditStop={(params) => { if (params.field !== '__row') selectCell(params.row.__row, Number(String(params.field).slice(1))) }}
          disableRowSelectionOnClick
          hideFooter
          rowHeight={30}
          columnHeaderHeight={32}
          filterMode="client"
          sortingMode="client"
          localeText={zhCN.components.MuiDataGrid.defaultProps.localeText}
          sx={{
            height: '100%', border: 1, borderColor: 'divider', borderRadius: 1,
            bgcolor: 'background.paper',
            '& .MuiDataGrid-cell': { fontSize: 12, px: 0.75 },
            '& .MuiDataGrid-columnHeaderTitle': { fontSize: 11, fontWeight: 650 },
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'action.hover' },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
          }}
        />
      </Box>

      <Dialog open={findOpen} onClose={() => setFindOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>查找与替换</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField fullWidth size="small" label="查找" value={findText} onChange={(event) => setFindText(event.target.value)} sx={{ mb: 1.25 }} />
          <TextField fullWidth size="small" label="替换为" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} />
          <Box sx={{ mt: 1.25 }}>
            <ToggleButtonGroup size="small" exclusive value={replaceAllSheets ? 'all' : 'active'} onChange={(_, value) => setReplaceAllSheets(value === 'all')}>
              <ToggleButton value="active">当前工作表</ToggleButton>
              <ToggleButton value="all">全部工作表</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setFindOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={!findText} onClick={applyReplace}>全部替换</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>重命名工作表</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth size="small" label="工作表名称" value={renameValue} inputProps={{ maxLength: 31 }} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyRename() }} /></DialogContent>
        <DialogActions><Button size="small" onClick={() => setRenameOpen(false)}>取消</Button><Button size="small" variant="contained" onClick={applyRename}>保存</Button></DialogActions>
      </Dialog>
    </Box>
  )
}
