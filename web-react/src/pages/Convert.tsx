import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, LinearProgress, Menu, MenuItem, Paper, Select, Slider,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Close, Collection, Delete, Document, Download, DragIndicator, Folder,
  Picture, Play, Plus, Refresh, Tune, Upload,
} from '@/icons'
import { EmptyHint, ModuleToolbar, Page, PageBody } from '@/ui/common'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { convertImage } from '@/convert/image'
import { composePdf, parsePageRange, pdfPageCount, pdfPagesToImages, renderPdfPreview } from '@/convert/pdf'
import { csvToXlsx, previewXlsx, readCsv, readWorkbook, xlsxToCsv } from '@/convert/table'
import {
  classifyFile, defaultTarget, downloadBlob, downloadOutputs, extOf, formatBytes, targetsFor, zipOutputs,
} from '@/convert/files'
import { loadLimits, loadPresets, mergeSettings, saveLimits, savePresets } from '@/convert/presets'
import {
  DEFAULT_LIMITS, DEFAULT_SETTINGS, KIND_LABELS, TARGET_LABELS,
  type ConvertItem, type ConvertLimits, type ConvertPreset, type ConvertSettings,
  type ConvertTarget,
} from '@/convert/types'

type Category = 'image' | 'pdf' | 'table' | 'all'

const ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'big5', label: 'Big5' },
]

const newId = () => (globalThis.crypto?.randomUUID?.() || `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`)

function revokeItem(item: ConvertItem) {
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
  if (item.result?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.result.previewUrl)
}

function statusLabel(status: ConvertItem['status']) {
  return ({ waiting: '等待', converting: '转换中', success: '成功', failed: '失败', cancelled: '已取消' } as Record<string, string>)[status] || status
}

function statusColor(status: ConvertItem['status']): 'default' | 'info' | 'success' | 'error' {
  return status === 'success' ? 'success' : status === 'failed' ? 'error' : status === 'converting' ? 'info' : 'default'
}

function limitFor(kind: ConvertItem['kind'], limits: ConvertLimits) {
  if (kind === 'image') return limits.imageMB
  if (kind === 'pdf' || kind === 'pdf-compose') return limits.pdfMB
  return limits.tableMB
}

function outputCategory(name: string): Exclude<Category, 'all'> {
  const ext = extOf(name)
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'table'
}

function SortableComposeRow({ id, file, onRemove }: { id: string; file: File; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <Stack
      ref={setNodeRef} direction="row" spacing={1} alignItems="center"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      sx={{ px: 1, py: 0.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}
    >
      <Box
        ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`拖动页序：${file.name}`} title="拖动页序"
        sx={{ display: 'inline-flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center', color: 'text.disabled', cursor: 'grab', touchAction: 'none' }}
      >
        <DragIndicator sx={{ fontSize: 15 }} />
      </Box>
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12 }}>{file.name}</Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{formatBytes(file.size)}</Typography>
      <IconButton size="small" aria-label="移出合成" onClick={onRemove}><Close fontSize="small" /></IconButton>
    </Stack>
  )
}

function ComposeFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onChange(arrayMove(files, Number(active.id), Number(over.id)))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={files.map((_, index) => String(index))} strategy={verticalListSortingStrategy}>
        <Stack spacing={0.5}>
          {files.map((file, index) => (
            <SortableComposeRow
              key={`${file.name}-${file.size}-${index}`} id={String(index)} file={file}
              onRemove={() => onChange(files.filter((_, i) => i !== index))}
            />
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  )
}

export default function ConvertPage() {
  const theme = useTheme()
  const [items, setItems] = useState<ConvertItem[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [selected, setSelected] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [presets, setPresets] = useState<ConvertPreset[]>(() => loadPresets())
  const [limits, setLimits] = useState<ConvertLimits>(() => loadLimits())
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [limitsDraft, setLimitsDraft] = useState<ConvertLimits>(limits)
  const [presetAnchor, setPresetAnchor] = useState<HTMLElement | null>(null)
  const [packAnchor, setPackAnchor] = useState<HTMLElement | null>(null)
  const [packing, setPacking] = useState(false)
  const [configId, setConfigId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ConvertSettings>(DEFAULT_SETTINGS)
  const [draftTarget, setDraftTarget] = useState<ConvertTarget>('jpg')
  const [configError, setConfigError] = useState('')
  const [tablePreview, setTablePreview] = useState<{ columns: string[]; rows: string[][]; warnings: string[] } | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [pdfPages, setPdfPages] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerMode = useRef<{ target?: ConvertTarget; compose?: boolean; accept?: string } | null>(null)
  const running = useRef(new Set<string>())
  const controllers = useRef<Record<string, AbortController>>({})
  const runTokens = useRef<Record<string, number>>({})
  const configSeq = useRef(0)
  const configItem = items.find((item) => item.id === configId) || null
  const successItems = items.filter((item) => item.status === 'success' && item.result)
  const waiting = items.filter((item) => item.status === 'waiting').length
  const selectedImages = items.filter((item) => selected.includes(item.id) && item.kind === 'image' && item.file)

  const updateItem = useCallback((id: string, patch: Partial<ConvertItem>) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [])

  const resetItem = useCallback((item: ConvertItem, patch: Partial<ConvertItem> = {}) => {
    if (item.result?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.result.previewUrl)
    return { ...item, ...patch, status: 'waiting' as const, progress: 0, error: '', message: '', result: null }
  }, [])

  const addFiles = useCallback(async (files: File[], forcedTarget?: ConvertTarget) => {
    if (!files.length) return
    const available = Math.max(0, limits.maxItems - itemsRef.current.length)
    if (!available) { toast.warning(`队列最多 ${limits.maxItems} 项`); return }
    const accepted: ConvertItem[] = []
    const rejected: string[] = []
    for (const file of files.slice(0, available)) {
      const classified = await classifyFile(file)
      if (classified.kind === 'unsupported') { rejected.push(`${file.name}：${classified.note || '不支持的文件'} `); continue }
      const targets = targetsFor(classified.kind, classified.ext)
      if (!targets.length) { rejected.push(`${file.name}：没有可用的目标格式`); continue }
      const target = forcedTarget && targets.includes(forcedTarget) ? forcedTarget : defaultTarget(classified.kind, classified.ext)
      const maxMB = limitFor(classified.kind, limits)
      const over = file.size > maxMB * 1024 * 1024
      const id = newId()
      const item: ConvertItem = {
        id, kind: classified.kind, file, files: [], name: file.name, size: file.size, sourceExt: classified.ext,
        target, settings: { ...DEFAULT_SETTINGS }, status: over ? 'failed' : 'waiting', progress: 0,
        message: '', error: over ? `文件超过 ${maxMB} MB 限制` : classified.note, result: null, local: true,
      }
      if (classified.kind === 'image') {
        if (classified.ext === 'heic' || classified.ext === 'heif') {
          void convertImage(file, 'jpg', { ...DEFAULT_SETTINGS, quality: 70, maxEdge: 96 }, () => {})
            .then((output) => {
              const url = URL.createObjectURL(output.blob)
              setItems((prev) => {
                if (!prev.some((entry) => entry.id === id)) { URL.revokeObjectURL(url); return prev }
                return prev.map((entry) => {
                  if (entry.id !== id) return entry
                  if (entry.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.thumbUrl)
                  return { ...entry, thumbUrl: url }
                })
              })
            })
            .catch(() => {})
        } else item.thumbUrl = URL.createObjectURL(file)
      }
      accepted.push(item)
    }
    if (files.length > available) rejected.push(`超过队列上限，已忽略 ${files.length - available} 个文件`)
    if (accepted.length) setItems((prev) => [...prev, ...accepted].slice(0, limits.maxItems))
    if (rejected.length) toast.warning(rejected.slice(0, 3).join('；') + (rejected.length > 3 ? `等 ${rejected.length} 项` : ''))
  }, [limits])

  const addCompose = useCallback((files: File[]) => {
    if (!files.length) { toast.warning('请选择要合成的图片'); return }
    if (itemsRef.current.length >= limits.maxItems) { toast.warning(`队列最多 ${limits.maxItems} 项`); return }
    const over = files.find((file) => file.size > limits.imageMB * 1024 * 1024)
    if (over) { toast.warning(`${over.name} 超过 ${limits.imageMB} MB 限制`); return }
    const item: ConvertItem = {
      id: newId(), kind: 'pdf-compose', file: null, files, name: `图片合成-${files.length}张.pdf`,
      size: files.reduce((sum, file) => sum + file.size, 0), sourceExt: 'images', target: 'pdf',
      settings: { ...DEFAULT_SETTINGS, pageSize: 'fit' }, status: 'waiting', progress: 0,
      message: '', error: '', result: null, local: true,
    }
    setItems((prev) => [...prev, item])
  }, [limits])

  const openPicker = (mode: { target?: ConvertTarget; compose?: boolean; accept?: string }) => {
    pickerMode.current = mode
    const input = inputRef.current
    if (!input) return
    input.accept = mode.accept || ''
    input.multiple = mode.compose === true || mode.accept === '' || mode.accept === 'image/*'
    input.value = ''
    input.click()
  }

  const onPicked = async (files: File[]) => {
    const mode = pickerMode.current
    pickerMode.current = null
    if (!files.length) return
    if (mode?.compose) addCompose(files)
    else await addFiles(files, mode?.target)
  }

  useEffect(() => () => {
    Object.values(controllers.current).forEach((controller) => controller.abort())
    controllers.current = {}
    itemsRef.current.forEach(revokeItem)
  }, [])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || [])
      if (!files.length) return
      event.preventDefault()
      void addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const runItem = async (item: ConvertItem) => {
    if (running.current.has(item.id)) return
    if (!item.file && !item.files.length) return
    running.current.add(item.id)
    const token = (runTokens.current[item.id] || 0) + 1
    runTokens.current[item.id] = token
    const update = (patch: Partial<ConvertItem>) => {
      if (runTokens.current[item.id] === token) updateItem(item.id, patch)
    }
    const controller = new AbortController()
    controllers.current[item.id] = controller
    if (item.result?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.result.previewUrl)
    update({ status: 'converting', progress: 0, error: '', message: '正在转换', result: null })
    const progress = (value: number) => update({ progress: Math.max(0, Math.min(100, Math.round(value))) })
    let timer: number | undefined
    try {
      const work = (async () => {
        if (item.kind === 'image' && item.file) {
          const output = await convertImage(item.file, item.target, item.settings, progress, controller.signal)
          const previewUrl = URL.createObjectURL(output.blob)
          return { outputs: [output], previewUrl, previewKind: 'image' as const, warnings: [] as string[] }
        }
        if (item.kind === 'pdf' && item.file) {
          const outputs = await pdfPagesToImages(item.file, item.target, item.settings, progress, controller.signal)
          const previewUrl = URL.createObjectURL(outputs[0].blob)
          return { outputs, previewUrl, previewKind: 'image' as const, warnings: outputs.length > 1 ? [`共 ${outputs.length} 页，将打包为 ZIP 下载`] : [] }
        }
        if (item.kind === 'pdf-compose') {
          const output = await composePdf(item.files, item.settings, progress, controller.signal)
          const previewUrl = await renderPdfPreview(output.blob)
          return { outputs: [output], previewUrl, previewKind: 'pdf' as const, warnings: [] as string[] }
        }
        if (item.kind === 'csv' && item.file) {
          const table = await readCsv(item.file, item.settings)
          progress(30)
          const output = await csvToXlsx(item.file, item.settings, progress, controller.signal)
          return { outputs: [output], previewKind: 'table' as const, columns: table.columns, rows: table.rows.slice(0, 6), warnings: table.warnings }
        }
        if (item.kind === 'xlsx' && item.file) {
          const workbook = await readWorkbook(item.file)
          const table = await previewXlsx(item.file, item.settings.sheetName || workbook.sheets[0] || '')
          progress(30)
          const outputs = await xlsxToCsv(item.file, item.settings, progress, controller.signal)
          return { outputs, previewKind: 'table' as const, columns: table.columns, rows: table.rows.slice(0, 6), warnings: workbook.warnings }
        }
        throw new Error('该文件没有可用的转换方式')
      })()
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          controller.abort()
          reject(new Error(`超过 ${limits.timeoutMin} 分钟未完成，已取消`))
        }, limits.timeoutMin * 60000)
      })
      const result = await Promise.race([work, timeout])
      if (controller.signal.aborted) throw new Error('已取消')
      update({
        status: 'success', progress: 100, error: '', message: `完成 · ${result.outputs.length} 个文件`,
        result: {
          outputs: result.outputs,
          previewUrl: 'previewUrl' in result ? result.previewUrl : undefined,
          previewKind: result.previewKind,
          columns: 'columns' in result ? result.columns : undefined,
          rows: 'rows' in result ? result.rows : undefined,
          warnings: result.warnings,
          note: result.outputs.length > 1 ? `${result.outputs.length} 个输出文件` : '',
        },
      })
    } catch (error) {
      if (controller.signal.aborted) update({ status: 'cancelled', message: '已取消', progress: 0 })
      else update({ status: 'failed', error: error instanceof Error ? error.message : '转换失败', message: '', progress: 0 })
    } finally {
      if (timer) window.clearTimeout(timer)
      delete controllers.current[item.id]
      running.current.delete(item.id)
    }
  }

  const runAll = async () => {
    const pending = itemsRef.current.filter((item) => item.status === 'waiting').map((item) => item.id)
    if (!pending.length) { toast.info('没有等待转换的项目'); return }
    let cursor = 0
    const workers = Array.from({ length: Math.max(1, Math.min(limits.concurrency, pending.length)) }, async () => {
      while (cursor < pending.length) {
        const id = pending[cursor]
        cursor += 1
        const item = itemsRef.current.find((entry) => entry.id === id)
        if (item && item.status === 'waiting') await runItem(item)
      }
    })
    await Promise.all(workers)
    toast.success('转换任务已执行完毕')
  }

  const cancelItem = (item: ConvertItem) => {
    controllers.current[item.id]?.abort()
    updateItem(item.id, { status: 'cancelled', message: '已取消', progress: 0 })
  }

  const removeItem = (item: ConvertItem) => {
    controllers.current[item.id]?.abort()
    revokeItem(item)
    setItems((prev) => prev.filter((entry) => entry.id !== item.id))
    setSelected((prev) => prev.filter((id) => id !== item.id))
  }

  const clearFinished = () => {
    setItems((prev) => {
      prev.filter((item) => item.status === 'success' || item.status === 'cancelled').forEach(revokeItem)
      return prev.filter((item) => item.status !== 'success' && item.status !== 'cancelled')
    })
  }

  const downloadItem = async (item: ConvertItem) => {
    if (!item.result) return
    try {
      await downloadOutputs(item.result.outputs, item.name)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败')
    }
  }

  const pack = async (category: Category) => {
    setPackAnchor(null)
    const outputs = successItems.flatMap((item) => item.result?.outputs || []).filter((output) => category === 'all' || outputCategory(output.name) === category)
    if (!outputs.length) { toast.info('没有可打包的结果'); return }
    setPacking(true)
    try {
      const label = ({ image: '图片', pdf: 'PDF', table: '表格', all: '全部结果' } as Record<Category, string>)[category]
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
      const name = `转换结果-${label}-${today}.zip`
      const blob = await zipOutputs(outputs, name)
      downloadBlob(blob, name)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打包失败')
    } finally {
      setPacking(false)
    }
  }

  const openConfig = async (item: ConvertItem) => {
    const sequence = ++configSeq.current
    setConfigId(item.id)
    setDraft({ ...item.settings })
    setDraftTarget(item.target)
    setConfigError('')
    setTablePreview(null)
    setSheetNames([])
    setPdfPages(0)
    if (item.kind === 'pdf' && item.file) {
      try {
        const pages = await pdfPageCount(item.file)
        if (sequence === configSeq.current) setPdfPages(pages)
      } catch (error) { if (sequence === configSeq.current) setConfigError(error instanceof Error ? error.message : 'PDF 无法读取') }
    }
    if (item.kind === 'xlsx' && item.file) {
      try {
        const workbook = await readWorkbook(item.file)
        if (sequence === configSeq.current) {
          setSheetNames(workbook.sheets)
          setDraft((prev) => ({ ...prev, sheetName: prev.sheetName || workbook.sheets[0] || '' }))
        }
      } catch (error) { if (sequence === configSeq.current) setConfigError(error instanceof Error ? error.message : 'Excel 无法读取') }
    }
  }

  const closeConfig = () => {
    configSeq.current += 1
    setConfigId(null)
  }

  useEffect(() => {
    if (!configItem || !configItem.file) return
    if (configItem.kind !== 'csv' && configItem.kind !== 'xlsx') return
    let active = true
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (configItem.kind === 'csv') {
            const table = await readCsv(configItem.file!, draft)
            if (active) { setTablePreview({ columns: table.columns, rows: table.rows.slice(0, 6), warnings: table.warnings }); setConfigError('') }
          } else {
            const table = await previewXlsx(configItem.file!, draft.sheetName)
            if (active) { setTablePreview({ columns: table.columns, rows: table.rows.slice(0, 6), warnings: [] }); setConfigError('') }
          }
        } catch (error) { if (active) { setTablePreview(null); setConfigError(error instanceof Error ? error.message : '预览失败') } }
      })()
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId, configItem?.kind, configItem?.file, draft.encoding, draft.delimiter, draft.hasHeader, draft.sheetName])

  useEffect(() => {
    if (configItem?.kind !== 'pdf' || !pdfPages || !['png', 'jpg'].includes(draftTarget)) { return }
    try { parsePageRange(draft.pages, pdfPages); setConfigError('') }
    catch (error) { setConfigError(error instanceof Error ? error.message : '页码无效') }
  }, [configItem?.kind, draft.pages, draftTarget, pdfPages])

  const saveConfig = () => {
    if (!configItem || configError) return
    controllers.current[configItem.id]?.abort()
    runTokens.current[configItem.id] = (runTokens.current[configItem.id] || 0) + 1
    setItems((prev) => prev.map((item) => item.id === configItem.id ? resetItem(item, { target: draftTarget, settings: { ...draft } }) : item))
    closeConfig()
  }

  const applyToSameKind = () => {
    if (!configItem) return
    let count = 0
    itemsRef.current.forEach((item) => {
      if (item.id !== configItem.id && item.kind === configItem.kind && targetsFor(item.kind, item.sourceExt).includes(draftTarget)) {
        controllers.current[item.id]?.abort()
        runTokens.current[item.id] = (runTokens.current[item.id] || 0) + 1
      }
    })
    setItems((prev) => prev.map((item) => {
      if (item.id === configItem.id || item.kind !== configItem.kind) return item
      if (!targetsFor(item.kind, item.sourceExt).includes(draftTarget)) return item
      count += 1
      return resetItem(item, { target: draftTarget, settings: { ...draft } })
    }))
    toast.success(count ? `已应用到 ${count} 个同类项目` : '没有可应用的同类项目')
  }

  const savePreset = async () => {
    if (!configItem) return
    const name = await promptDialog({ title: '保存转换预设', label: '预设名称', placeholder: '例如：JPG 高质量、A4 合成', maxLength: 40, confirmText: '保存' })
    if (!name) return
    const preset: ConvertPreset = { id: newId(), name, kind: configItem.kind, target: draftTarget, settings: { ...draft } }
    const next = [...presets.filter((item) => item.name !== name), preset]
    setPresets(next); savePresets(next); toast.success('预设已保存')
  }

  const applyPreset = (preset: ConvertPreset) => {
    let count = 0
    itemsRef.current.forEach((item) => {
      if (item.kind === preset.kind && targetsFor(item.kind, item.sourceExt).includes(preset.target)) {
        controllers.current[item.id]?.abort()
        runTokens.current[item.id] = (runTokens.current[item.id] || 0) + 1
      }
    })
    setItems((prev) => prev.map((item) => {
      if (item.kind !== preset.kind || !targetsFor(item.kind, item.sourceExt).includes(preset.target)) return item
      count += 1
      return resetItem(item, { target: preset.target, settings: { ...mergeSettings(preset.settings) } })
    }))
    setPresetAnchor(null)
    toast.success(count ? `已应用「${preset.name}」到 ${count} 项` : '没有适用该预设的项目')
  }

  const deletePreset = async (preset: ConvertPreset) => {
    const ok = await confirmDialog({ title: '删除预设', danger: true, confirmText: '删除', message: `删除预设「${preset.name}」？` })
    if (!ok) return
    const next = presets.filter((item) => item.id !== preset.id)
    setPresets(next); savePresets(next)
  }

  const saveLimitsDraft = () => {
    const next: ConvertLimits = { ...limitsDraft }
    setLimits(next); saveLimits(next); setLimitsOpen(false)
    toast.success('限制已保存')
  }

  const createComposeFromSelection = () => {
    const files = selectedImages.map((item) => item.file).filter((file): file is File => Boolean(file))
    if (files.length < 2) { toast.warning('请至少选择两张图片'); return }
    addCompose(files)
    setSelected([])
  }

  const configTargets = configItem ? targetsFor(configItem.kind, configItem.sourceExt) : []
  const isImageConfig = configItem?.kind === 'image'
  const isPdfImage = configItem?.kind === 'pdf'
  const isCompose = configItem?.kind === 'pdf-compose'
  const isCsv = configItem?.kind === 'csv'
  const isXlsx = configItem?.kind === 'xlsx'

  return (
    <Page variant="dense">
      <ModuleToolbar
        info={<Chip size="small" label={`${items.length} 项 · 本地处理`} variant="outlined" />}
        filters={(
          <>
            <Button size="small" startIcon={<Play fontSize="small" />} disabled={!waiting} onClick={() => void runAll()}>转换全部{waiting ? ` (${waiting})` : ''}</Button>
            <Button size="small" startIcon={<Download fontSize="small" />} disabled={!successItems.length || packing} onClick={(event) => setPackAnchor(event.currentTarget)}>打包下载</Button>
            <Menu anchorEl={packAnchor} open={Boolean(packAnchor)} onClose={() => setPackAnchor(null)}>
              <MenuItem onClick={() => void pack('image')}>图片结果</MenuItem>
              <MenuItem onClick={() => void pack('pdf')}>PDF 结果</MenuItem>
              <MenuItem onClick={() => void pack('table')}>表格结果</MenuItem>
              <MenuItem onClick={() => void pack('all')}>全部成功结果</MenuItem>
            </Menu>
            {selectedImages.length ? <Button size="small" variant="outlined" disabled={selectedImages.length < 2} onClick={createComposeFromSelection}>合成 PDF ({selectedImages.length})</Button> : null}
            <Button size="small" startIcon={<Folder fontSize="small" />} onClick={(event) => setPresetAnchor(event.currentTarget)}>预设</Button>
            <Menu anchorEl={presetAnchor} open={Boolean(presetAnchor)} onClose={() => setPresetAnchor(null)}>
              {presets.length ? presets.map((preset) => (
                <MenuItem key={preset.id} onClick={() => applyPreset(preset)} sx={{ gap: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 12.5 }}>{preset.name}</Typography>
                    <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>{KIND_LABELS[preset.kind]} → {TARGET_LABELS[preset.target]}</Typography>
                  </Box>
                  <IconButton size="small" aria-label={`删除预设 ${preset.name}`} onClick={(event) => { event.stopPropagation(); void deletePreset(preset) }}><Delete fontSize="small" /></IconButton>
                </MenuItem>
              )) : <MenuItem disabled>还没有保存的预设</MenuItem>}
            </Menu>
            <Tooltip title="转换限制"><IconButton size="small" aria-label="转换限制" onClick={() => { setLimitsDraft({ ...limits }); setLimitsOpen(true) }}><Tune fontSize="small" /></IconButton></Tooltip>
            {items.some((item) => item.status === 'success' || item.status === 'cancelled') ? <Button size="small" onClick={clearFinished}>清空已完成</Button> : null}
          </>
        )}
        primary={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => openPicker({})}>添加文件</Button>}
      />

      <PageBody>
        <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 0.5 }}>
          <Box
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)) }}
            onClick={() => openPicker({})}
            sx={{
              mb: 1.25, p: 1.75, border: 1, borderStyle: 'dashed', borderRadius: 1.5, cursor: 'pointer',
              borderColor: dragging ? 'primary.main' : 'divider', bgcolor: dragging ? 'action.selected' : 'action.hover',
              display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
            }}
          >
            <Upload sx={{ fontSize: 22, color: 'primary.main' }} />
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>拖入文件，或点击选择 / Ctrl+V 粘贴</Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>支持 JPG、PNG、WebP、HEIC、PDF、CSV、XLSX；全部在浏览器本地处理，不上传服务器</Typography>
            </Box>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              <Button size="small" onClick={(event) => { event.stopPropagation(); openPicker({ target: 'jpg', accept: '.heic,.heif' }) }}>HEIC 转 JPG</Button>
              <Button size="small" onClick={(event) => { event.stopPropagation(); openPicker({ compose: true, accept: 'image/*' }) }}>图片合成 PDF</Button>
              <Button size="small" onClick={(event) => { event.stopPropagation(); openPicker({ target: 'png', accept: '.pdf' }) }}>PDF 转图片</Button>
              <Button size="small" onClick={(event) => { event.stopPropagation(); openPicker({ target: 'xlsx', accept: '.csv' }) }}>CSV 转 Excel</Button>
            </Stack>
          </Box>
          <input ref={inputRef} type="file" hidden multiple onChange={(event) => { void onPicked(Array.from(event.target.files || [])) }} />

          {!items.length ? (
            <EmptyHint action={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => openPicker({})}>添加第一个文件</Button>}>
              还没有待转换的文件
            </EmptyHint>
          ) : (
            <Stack spacing={1}>
              {items.map((item) => {
                const targets = targetsFor(item.kind, item.sourceExt)
                const Icon = item.kind === 'image' ? Picture : item.kind === 'csv' || item.kind === 'xlsx' ? Collection : Document
                const canRun = item.status !== 'converting' && Boolean(item.file || item.files.length) && targets.length > 0 && !item.error.includes('超过')
                return (
                  <Paper key={item.id} variant="outlined" data-testid="convert-item" data-item-name={item.name} sx={{ p: 1.25 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      {item.kind === 'image' ? (
                        <Checkbox
                          size="small" checked={selected.includes(item.id)} sx={{ p: 0.25 }}
                          onChange={(event) => setSelected((prev) => event.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id))}
                          inputProps={{ 'aria-label': `选择 ${item.name} 用于合成` }}
                        />
                      ) : null}
                      {item.thumbUrl ? (
                        <Box component="img" src={item.thumbUrl} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider' }} />
                      ) : (
                        <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}><Icon sx={{ fontSize: 20, color: 'text.secondary' }} /></Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 180 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap title={item.name}>{item.name}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                          {KIND_LABELS[item.kind]} · {formatBytes(item.size)} · {item.kind === 'pdf-compose' ? `${item.files.length} 张图片` : `.${item.sourceExt}`}
                          {' '}· 本地处理
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>转为</Typography>
                        <Select
                          size="small" value={item.target} disabled={!targets.length || item.status === 'converting'}
                          onChange={(event) => {
                            const target = event.target.value as ConvertTarget
                            setItems((prev) => prev.map((entry) => entry.id === item.id ? resetItem(entry, { target }) : entry))
                          }}
                          sx={{ minWidth: 86, fontSize: 12 }}
                        >
                          {targets.map((target) => <MenuItem key={target} value={target}>{TARGET_LABELS[target]}</MenuItem>)}
                        </Select>
                        <IconButton size="small" aria-label="转换设置" disabled={!targets.length} onClick={() => void openConfig(item)}><Tune fontSize="small" /></IconButton>
                      </Stack>
                      <Chip size="small" label={statusLabel(item.status)} color={statusColor(item.status)} variant={item.status === 'waiting' ? 'outlined' : 'filled'} />
                      <Stack direction="row" spacing={0.25}>
                        {item.status === 'converting' ? (
                          <Tooltip title="取消"><IconButton size="small" aria-label="取消" onClick={() => cancelItem(item)}><Close fontSize="small" /></IconButton></Tooltip>
                        ) : (
                          <Tooltip title={item.status === 'success' ? '重新转换' : item.status === 'failed' ? '重试' : '转换'}>
                            <span><IconButton size="small" aria-label="转换" disabled={!canRun} onClick={() => void runItem(item)}>{item.status === 'failed' ? <Refresh fontSize="small" /> : <Play fontSize="small" />}</IconButton></span>
                          </Tooltip>
                        )}
                        <Tooltip title="下载"><span><IconButton size="small" aria-label="下载" disabled={!item.result} onClick={() => void downloadItem(item)}><Download fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="移除"><IconButton size="small" aria-label="移除" onClick={() => removeItem(item)}><Delete fontSize="small" /></IconButton></Tooltip>
                      </Stack>
                    </Stack>

                    {item.status === 'converting' ? <LinearProgress variant="determinate" value={item.progress} sx={{ mt: 1, height: 5, borderRadius: 3 }} /> : null}
                    {item.error ? <Alert severity="error" sx={{ mt: 1, py: 0, fontSize: 12 }}>{item.error}</Alert> : null}
                    {item.message && !item.error ? <Typography sx={{ mt: 0.75, fontSize: 11.5, color: 'text.secondary' }}>{item.message}</Typography> : null}

                    {item.kind === 'pdf-compose' ? (
                      <Box sx={{ mt: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>拖动调整页序 · 预计输出 1 个 PDF</Typography>
                          <Box sx={{ flex: 1 }} />
                          <Button size="small" startIcon={<Plus fontSize="small" />} onClick={() => openPicker({ compose: true, accept: 'image/*' })}>追加图片</Button>
                        </Stack>
                        <ComposeFiles
                          files={item.files}
                          onChange={(files) => setItems((prev) => prev.map((entry) => entry.id === item.id ? resetItem(entry, { files, name: `图片合成-${files.length}张.pdf`, size: files.reduce((sum, file) => sum + file.size, 0) }) : entry))}
                        />
                      </Box>
                    ) : null}

                    {item.result ? (
                      <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                        <Stack direction="row" spacing={1.25} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                          {item.result.previewUrl ? (
                            <Box component="img" src={item.result.previewUrl} alt="结果预览" sx={{ maxWidth: 220, maxHeight: 150, borderRadius: 1, border: 1, borderColor: 'divider', objectFit: 'contain', bgcolor: 'background.default' }} />
                          ) : null}
                          {item.result.previewKind === 'table' && item.result.columns ? (
                            <Box sx={{ overflowX: 'auto', maxWidth: '100%' }}>
                              <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 11 }}>
                                <thead><tr>{item.result.columns.map((column, index) => <th key={index} style={{ borderBottom: `1px solid ${theme.palette.divider}`, padding: '3px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>{column}</th>)}</tr></thead>
                                <tbody>{(item.result.rows || []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, index) => <td key={index} style={{ borderBottom: `1px solid ${theme.palette.divider}`, padding: '3px 8px', whiteSpace: 'nowrap' }}>{value}</td>)}</tr>)}</tbody>
                              </Box>
                            </Box>
                          ) : null}
                          <Box sx={{ minWidth: 160 }}>
                            <Typography sx={{ fontSize: 12 }}>{item.result.outputs.length} 个结果 · {item.result.note || '可下载'}</Typography>
                            <Button size="small" startIcon={<Download fontSize="small" />} sx={{ mt: 0.5 }} onClick={() => void downloadItem(item)}>
                              {item.result.outputs.length > 1 ? '打包下载' : '下载'}
                            </Button>
                          </Box>
                        </Stack>
                        {item.result.warnings?.length ? <Typography sx={{ mt: 0.75, fontSize: 11, color: 'warning.main' }}>{item.result.warnings.join('；')}</Typography> : null}
                      </Box>
                    ) : null}
                  </Paper>
                )
              })}
            </Stack>
          )}
        </Box>
      </PageBody>

      <Dialog open={Boolean(configItem)} onClose={closeConfig} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>转换设置 · {configItem?.name}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>目标格式</Typography>
              <Select size="small" value={draftTarget} onChange={(event) => setDraftTarget(event.target.value as ConvertTarget)} sx={{ minWidth: 110 }}>
                {configTargets.map((target) => <MenuItem key={target} value={target}>{TARGET_LABELS[target]}</MenuItem>)}
              </Select>
              <Box sx={{ flex: 1 }} />
              <Chip size="small" label="本地处理" variant="outlined" />
            </Stack>

            {isImageConfig ? (
              <>
                {draftTarget === 'jpg' || draftTarget === 'webp' ? (
                  <Box>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>画质 {draft.quality}%</Typography>
                    <Slider value={draft.quality} min={10} max={100} step={1} onChange={(_, value) => setDraft({ ...draft, quality: value as number })} />
                  </Box>
                ) : null}
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <TextField
                    size="small" type="number" label="最长边（像素，0=原尺寸）" value={draft.maxEdge}
                    onChange={(event) => setDraft({ ...draft, maxEdge: Math.max(0, Number(event.target.value) || 0) })}
                    sx={{ width: 240 }}
                  />
                  {draftTarget === 'jpg' ? (
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>透明底色</Typography>
                      <Box component="input" type="color" value={draft.background} onChange={(event) => setDraft({ ...draft, background: event.target.value })} aria-label="透明图转 JPG 的底色" sx={{ width: 30, height: 30, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
                    </Stack>
                  ) : null}
                </Stack>
              </>
            ) : null}

            {isPdfImage ? (
              <>
                <TextField
                  size="small" label="页码范围" value={draft.pages} placeholder="留空为全部，例如 1,3-5"
                  onChange={(event) => setDraft({ ...draft, pages: event.target.value })}
                  helperText={pdfPages ? `当前 PDF 共 ${pdfPages} 页` : '正在读取页数…'}
                  error={Boolean(configError && /页码/.test(configError))}
                />
                <Stack direction="row" spacing={1}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.25 }}>清晰度（倍率）</Typography>
                    <Select size="small" fullWidth value={String(draft.dpi)} onChange={(event) => setDraft({ ...draft, dpi: Number(event.target.value) })}>
                      {[1, 1.5, 2, 3].map((value) => <MenuItem key={value} value={String(value)}>{value}x</MenuItem>)}
                    </Select>
                  </Box>
                  {draftTarget === 'jpg' ? (
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.25 }}>画质 {draft.quality}%</Typography>
                      <Slider value={draft.quality} min={10} max={100} step={1} onChange={(_, value) => setDraft({ ...draft, quality: value as number })} />
                    </Box>
                  ) : null}
                </Stack>
              </>
            ) : null}

            {isCompose ? (
              <>
                <Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>页面尺寸</Typography>
                  <ToggleButtonGroup size="small" exclusive value={draft.pageSize} onChange={(_, value) => value && setDraft({ ...draft, pageSize: value })}>
                    <ToggleButton value="fit">按图片大小</ToggleButton>
                    <ToggleButton value="a4">A4</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                {draft.pageSize === 'a4' ? <TextField size="small" type="number" label="页边距（mm）" value={draft.margin} onChange={(event) => setDraft({ ...draft, margin: Math.max(0, Math.min(30, Number(event.target.value) || 0)) })} sx={{ width: 180 }} /> : null}
                <TextField size="small" label="输出文件名" value={draft.outputName} placeholder={configItem?.name} onChange={(event) => setDraft({ ...draft, outputName: event.target.value })} />
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>共 {configItem?.files.length || 0} 张图片，页序可在队列中拖动调整。</Typography>
              </>
            ) : null}

            {isCsv ? (
              <>
                <Stack direction="row" spacing={1}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.25 }}>分隔符</Typography>
                    <Select size="small" fullWidth value={draft.delimiter} onChange={(event) => setDraft({ ...draft, delimiter: event.target.value as ConvertSettings['delimiter'] })}>
                      <MenuItem value="auto">自动识别</MenuItem><MenuItem value=",">逗号 ,</MenuItem><MenuItem value=";">分号 ;</MenuItem><MenuItem value={'\t'}>Tab</MenuItem><MenuItem value="|">竖线 |</MenuItem>
                    </Select>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.25 }}>编码</Typography>
                    <Select size="small" fullWidth value={draft.encoding} onChange={(event) => setDraft({ ...draft, encoding: event.target.value })}>
                      {ENCODINGS.map((encoding) => <MenuItem key={encoding.value} value={encoding.value}>{encoding.label}</MenuItem>)}
                    </Select>
                  </Box>
                </Stack>
                <FormControlLabel control={<Checkbox checked={draft.hasHeader} onChange={(event) => setDraft({ ...draft, hasHeader: event.target.checked })} />} label={<Typography sx={{ fontSize: 12.5 }}>首行是表头</Typography>} />
                <TextField size="small" label="工作表名称" value={draft.sheetName} placeholder="默认使用文件名" onChange={(event) => setDraft({ ...draft, sheetName: event.target.value })} />
              </>
            ) : null}

            {isXlsx ? (
              <>
                <Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>导出范围</Typography>
                  <ToggleButtonGroup size="small" exclusive value={draft.sheetMode} onChange={(_, value) => value && setDraft({ ...draft, sheetMode: value })}>
                    <ToggleButton value="one">单个工作表</ToggleButton>
                    <ToggleButton value="all">全部工作表分别导出</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                {draft.sheetMode === 'one' ? (
                  <Select size="small" fullWidth value={draft.sheetName} onChange={(event) => setDraft({ ...draft, sheetName: event.target.value })}>
                    {sheetNames.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
                  </Select>
                ) : <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>将每个工作表导出一个 CSV，并打包为 ZIP。</Typography>}
              </>
            ) : null}

            {configError ? <Alert severity="error" sx={{ py: 0, fontSize: 12 }}>{configError}</Alert> : null}
            {tablePreview ? (
              <Box>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.5 }}>预览（前 6 行）</Typography>
                <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
                    <thead><tr>{tablePreview.columns.map((column, index) => <th key={index} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: `1px solid ${theme.palette.divider}`, whiteSpace: 'nowrap' }}>{column}</th>)}</tr></thead>
                    <tbody>{tablePreview.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, index) => <td key={index} style={{ padding: '4px 8px', borderBottom: `1px solid ${theme.palette.divider}`, whiteSpace: 'nowrap' }}>{value}</td>)}</tr>)}</tbody>
                  </Box>
                </Box>
                {tablePreview.warnings.length ? <Typography sx={{ mt: 0.5, fontSize: 11, color: 'warning.main' }}>{tablePreview.warnings.join('；')}</Typography> : null}
              </Box>
            ) : null}
            <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>转换在浏览器本地完成，文件不会上传。CSV 导出使用 UTF-8 BOM，前导零按文本保留；Excel 公式导出已有计算值。</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          <Button size="small" onClick={() => void savePreset()}>保存为预设</Button>
          <Button size="small" onClick={applyToSameKind}>应用到其他同类</Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={closeConfig}>取消</Button>
          <Button size="small" variant="contained" disabled={Boolean(configError)} onClick={saveConfig}>保存设置</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={limitsOpen} onClose={() => setLimitsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>转换限制</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={1.25}>
            {([
              ['imageMB', '图片单文件上限（MB）'], ['pdfMB', 'PDF 单文件上限（MB）'], ['tableMB', '表格单文件上限（MB）'],
              ['maxItems', '队列最多项目数'], ['concurrency', '并发转换数（1–4）'], ['timeoutMin', '单项超时（分钟）'],
            ] as [keyof ConvertLimits, string][]).map(([key, label]) => (
              <TextField
                key={key} size="small" type="number" label={label} value={limitsDraft[key]}
                onChange={(event) => setLimitsDraft({ ...limitsDraft, [key]: Math.max(1, Number(event.target.value) || 1) })}
              />
            ))}
            <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>默认值：图片 {DEFAULT_LIMITS.imageMB} MB、PDF {DEFAULT_LIMITS.pdfMB} MB、表格 {DEFAULT_LIMITS.tableMB} MB；超限文件会逐项提示。</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          <Button size="small" onClick={() => setLimitsOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={saveLimitsDraft}>保存</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}
