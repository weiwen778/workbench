import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Menu, MenuItem, Stack, TextField,
} from '@mui/material'
import { Download, Upload } from '@/icons'
import { toast } from '@/ui/feedback'
import { downloadBlob } from '@/convert/files'
import { getFileBytes, type ProjectDetail } from '@/docs/api'
import ProjectActions from '@/docs/ProjectActions'
import { useUnloadWarning } from '@/docs/useUnloadWarning'
import { useTheme } from '@mui/material/styles'
import { createUniver, LocaleType, mergeLocales, darkBlueTheme, type IWorkbookData } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
import * as XLSX from 'xlsx'
import { sheetJsToUniver, univerToSheetJs, workbookToBlob, type NumberFormatPatch } from './xlsx-bridge'

const ACCEPT = '.xlsx,.xls,.xlsb,.ods,.csv,.tsv'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const SNAPSHOT_SUFFIX = '.univer.json'

type UniverInstance = ReturnType<typeof createUniver>['univer']
type UniverApi = ReturnType<typeof createUniver>['univerAPI']

function baseName(name: string) { return name.replace(/\.[^.]+$/, '') || '工作簿' }

let unitSeq = 0

/** 每次装载都生成新的 unitId，避免与当前实例冲突。 */
function nextUnitId() {
  unitSeq += 1
  return ['wb', Date.now().toString(36), unitSeq].join('-')
}

function isWorkbookFile(name: string) { return /\.(xlsx|xls|xlsb|ods|csv|tsv)$/i.test(name) }

/**
 * 工作簿编辑器：编辑内核由 Univer 1.5 提供（公式、样式、合并、冻结、数字格式、查找替换）。
 * XLSX 读写走本地 SheetJS 桥接（Univer 官方 XLSX exchanger 属 Pro + 服务端，离线不可用）。
 * 项目保存落两份附件：XLSX（可交付/导出）与 Univer 快照（重开无损）。
 */
export default function WorkbookEditor({ active }: { active: boolean }) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<UniverApi | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('未命名工作簿')
  const [current, setCurrent] = useState<ProjectDetail | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [sheetCount, setSheetCount] = useState(1)
  useUnloadWarning(ready)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let instance: { univer: UniverInstance; univerAPI: UniverApi } | null = null
    // StrictMode 下 effect 会「挂载 → 清理 → 再挂载」，而 Univer 内部自建 React 根，
    // 同步创建/销毁会互相踩踏（画布挂不上）。这里把创建推到下一个宏任务，清理时取消。
    const timer = window.setTimeout(() => {
      if (cancelled) return
      try {
        const created = createUniver({
          locale: LocaleType.ZH_CN,
          locales: { [LocaleType.ZH_CN]: mergeLocales(UniverPresetSheetsCoreZhCN) },
          theme: dark ? darkBlueTheme : undefined,
          presets: [
            UniverSheetsCorePreset({ container: host, header: true, toolbar: true, formulaBar: true }),
          ],
        })
        instance = created
        apiRef.current = created.univerAPI
        created.univerAPI.createWorkbook({ name: '未命名工作簿' })
        const refreshSheetCount = () => {
          const workbook = created.univerAPI.getActiveWorkbook()
          if (workbook) setSheetCount(workbook.getSheets().length)
        }
        created.univerAPI.addEvent(created.univerAPI.Event.SheetCreated, refreshSheetCount)
        created.univerAPI.addEvent(created.univerAPI.Event.SheetDeleted, refreshSheetCount)
        setReady(true)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '工作簿初始化失败')
      }
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      const current = instance
      instance = null
      apiRef.current = null
      setReady(false)
      if (current) window.setTimeout(() => { try { current.univer.dispose() } catch { /* 已释放 */ } }, 0)
    }
  }, [])

  const applyNumberFormats = useCallback((formats: NumberFormatPatch[]) => {
    const workbook = apiRef.current?.getActiveWorkbook()
    if (!workbook || !formats.length) return
    for (const format of formats) {
      try {
        workbook.getSheetBySheetId(format.sheetId)?.getRange(format.row, format.col, 1, 1).setNumberFormat(format.pattern)
      } catch { /* 单个格式失败不影响整体导入 */ }
    }
  }, [])

  const replaceWorkbook = useCallback((data: Partial<IWorkbookData>, formats: NumberFormatPatch[] = [], activeSheetId?: string) => {
    const api = apiRef.current
    if (!api) throw new Error('编辑器尚未就绪')
    const previousId = api.getActiveWorkbook()?.getId()
    // 快照里带着上次的 unitId，直接复用会撞 [UniverInstanceService]，每次装载必须换新 id
    const created = api.createWorkbook({ ...data, id: nextUnitId() })
    if (previousId && previousId !== created.getId()) api.disposeUnit(previousId)
    applyNumberFormats(formats)
    const activeSheet = activeSheetId ? created.getSheetBySheetId(activeSheetId) : undefined
    if (activeSheet) created.setActiveSheet(activeSheet)
    setSheetCount(created.getSheets().length || 1)
  }, [applyNumberFormats])

  const loadFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) { setError(`文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限`); return }
    setLoading(true); setError(''); setWarnings([])
    try {
      const buffer = await file.arrayBuffer()
      const parsed = XLSX.read(new Uint8Array(buffer), { type: 'array', cellFormula: true, cellNF: true, cellDates: false })
      const result = sheetJsToUniver(parsed, baseName(file.name))
      replaceWorkbook(result.data, result.numberFormats)
      setTitle(baseName(file.name))
      setCurrent(null)
      setWarnings(result.warnings)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工作簿无法打开')
    } finally { setLoading(false) }
  }

  const openProject = async (detail: ProjectDetail) => {
    const snapshotFile = detail.attachments.find((file) => file.name.toLowerCase().endsWith(SNAPSHOT_SUFFIX))
    const workbookFile = detail.attachments.find((file) => isWorkbookFile(file.name))
    setLoading(true); setError(''); setWarnings([])
    try {
      if (snapshotFile) {
        const bytes = await getFileBytes(snapshotFile.id)
        const data = JSON.parse(new TextDecoder().decode(bytes)) as IWorkbookData
        const activeSheetId = typeof detail.state.activeSheetId === 'string' ? detail.state.activeSheetId : undefined
        replaceWorkbook(data, [], activeSheetId)
      } else if (workbookFile) {
        const bytes = await getFileBytes(workbookFile.id)
        const parsed = XLSX.read(new Uint8Array(bytes), { type: 'array', cellFormula: true, cellNF: true, cellDates: false })
        const result = sheetJsToUniver(parsed, detail.title)
        const activeIndex = detail.state.activeSheet
        const activeSheetId = typeof activeIndex === 'number' && Number.isInteger(activeIndex)
          ? result.data.sheetOrder?.[activeIndex] : undefined
        replaceWorkbook(result.data, result.numberFormats, activeSheetId)
        setWarnings(result.warnings)
      } else {
        throw new Error('项目里没有工作簿附件')
      }
      setTitle(detail.title)
    } finally { setLoading(false) }
  }

  const buildSave = async () => {
    const workbook = apiRef.current?.getActiveWorkbook()
    if (workbook?.isCellEditing()) await workbook.endEditingAsync(true)
    const snapshot = workbook?.save()
    if (!snapshot) throw new Error('还没有工作簿')
    const blob = workbookToBlob(univerToSheetJs(snapshot))
    const name = `${baseName(title || workbook?.getName() || '工作簿')}.xlsx`
    const snapshotName = `${baseName(title || '工作簿')}${SNAPSHOT_SUFFIX}`
    return {
      state: {
        fileName: name, snapshotName, engine: 'univer', engineVersion: '1.5.0',
        sheets: snapshot.sheetOrder?.length || 1, activeSheetId: workbook?.getActiveSheet()?.getSheetId(),
      },
      files: [
        new File([blob], name, { type: blob.type }),
        new File([JSON.stringify(snapshot)], snapshotName, { type: 'application/json' }),
      ],
    }
  }

  const exportAs = async (kind: 'xlsx' | 'csv' | 'tsv' | 'json') => {
    setExportAnchor(null)
    const workbook = apiRef.current?.getActiveWorkbook()
    try {
      if (workbook?.isCellEditing()) await workbook.endEditingAsync(true)
      const snapshot = workbook?.save()
      if (!snapshot) { toast.warning('还没有工作簿'); return }
      if (kind === 'json') {
        downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), `${baseName(title)}.univer.json`)
        return
      }
      if (kind === 'xlsx') {
        downloadBlob(workbookToBlob(univerToSheetJs(snapshot)), `${baseName(title)}.xlsx`)
        return
      }
      const sheetId = workbook?.getActiveSheet()?.getSheetId()
      if (!sheetId || !snapshot.sheets[sheetId]) { toast.warning('没有可导出的工作表'); return }
      const book = univerToSheetJs({ ...snapshot, sheetOrder: [sheetId] })
      const sheetName = book.SheetNames[0]
      const text = XLSX.utils.sheet_to_csv(book.Sheets[sheetName], { FS: kind === 'tsv' ? '\t' : ',' })
      const mime = kind === 'tsv' ? 'text/tab-separated-values' : 'text/csv'
      downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), `${baseName(title)}.${kind}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导出失败')
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <input
        ref={inputRef} type="file" accept={ACCEPT} hidden
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadFile(file) }}
      />
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.7, borderBottom: 1, borderColor: 'divider' }}>
        <TextField
          size="small" value={title} onChange={(event) => setTitle(event.target.value)}
          inputProps={{ maxLength: 200, 'aria-label': '工作簿标题' }} aria-label="工作簿标题"
          sx={{ width: { xs: 150, sm: 240 }, '& .MuiInputBase-input': { fontSize: 13, fontWeight: 600, py: 0.5 } }}
        />
        <Chip size="small" variant="outlined" label={`${sheetCount} 个工作表`} />
        <Box sx={{ flex: 1 }} />
        <ProjectActions
          kind="sheet" kindLabel="工作簿" title={title} onTitleChange={setTitle}
          current={current} onCurrentChange={setCurrent} buildSave={buildSave} onOpen={openProject}
          disabled={!ready || loading} saveShortcut={active}
        />
        <Button size="small" startIcon={<Upload fontSize="small" />} onClick={() => inputRef.current?.click()}>导入</Button>
        <Button size="small" startIcon={<Download fontSize="small" />} onClick={(event) => setExportAnchor(event.currentTarget)}>导出</Button>
        <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => exportAs('xlsx')}>导出 XLSX（全部工作表）</MenuItem>
          <MenuItem onClick={() => exportAs('csv')}>导出 CSV（当前工作表）</MenuItem>
          <MenuItem onClick={() => exportAs('tsv')}>导出 TSV（当前工作表）</MenuItem>
          <MenuItem onClick={() => exportAs('json')}>导出 Univer 快照（无损）</MenuItem>
        </Menu>
      </Stack>

      {error ? <Alert severity="error" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 12 }} onClose={() => setError('')}>{error}</Alert> : null}
      {warnings.length ? (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }} onClose={() => setWarnings([])}>
          {warnings.slice(0, 3).join('；')}{warnings.length > 3 ? `；另 ${warnings.length - 3} 项` : ''}
        </Alert>
      ) : null}

      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Box ref={hostRef} data-testid="univer-host" sx={{ position: 'absolute', inset: 0 }} />
        {loading ? (
          <Stack sx={{ position: 'absolute', inset: 0, zIndex: 4, alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', opacity: 0.82 }}>
            <CircularProgress size={22} />
            <Box sx={{ mt: 1, fontSize: 12 }}>正在解析工作簿…</Box>
          </Stack>
        ) : null}
        {!ready && !loading ? (
          <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 1, bgcolor: 'background.default' }}>
            <CircularProgress size={20} />
            <Box sx={{ fontSize: 12, color: 'text.secondary' }}>正在加载工作簿内核…</Box>
          </Stack>
        ) : null}
      </Box>
    </Box>
  )
}
