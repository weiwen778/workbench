import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControl, FormControlLabel, IconButton, InputLabel, LinearProgress, List, ListItem, ListItemButton,
  ListItemText, Menu, MenuItem, Paper, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import HighlightIcon from '@mui/icons-material/Highlight'
import DrawIcon from '@mui/icons-material/Draw'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import CheckIcon from '@mui/icons-material/Check'
import SignatureIcon from '@mui/icons-material/DriveFileRenameOutline'
import RedactIcon from '@mui/icons-material/VisibilityOff'
import OpenWithIcon from '@mui/icons-material/OpenWith'
import { ArrowLeft, Check, CopyDocument, Delete, Download, DragIndicator, Edit, MoreFilled, Picture, Plus, Refresh, Search, Upload } from '@/icons'
import { apiError } from '@/api/client'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { downloadBlob, downloadOutputs } from '@/convert/files'
import { composePdf, parsePageRange, pdfPagesToImages } from '@/convert/pdf'
import { DEFAULT_SETTINGS } from '@/convert/types'
import { getFileBytes, type ProjectDetail } from '@/docs/api'
import ProjectActions from '@/docs/ProjectActions'
import {
  destroySource, exportPdf, formFields, hasSignature, loadPdfSource, sourcePages, verifyRedactedPages,
  type FormField, type PageNumberOptions, type PdfAnnotation, type PdfPageModel, type PdfSource, type WatermarkOptions,
} from '@/docs/pdf/pdf-utils'
import { getPdfJs } from '@/docs/pdf/pdf-utils'
import { useUnloadWarning } from '@/docs/useUnloadWarning'
import '@/docs/pdf/pdf.css'

type Tool = 'select' | 'highlight' | 'draw' | 'text' | 'check' | 'signature' | 'redact'

interface Snapshot {
  pages: PdfPageModel[]
  annotations: PdfAnnotation[]
}

interface SourceMeta { key: string; name: string; bytes: Uint8Array }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`)
const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || '文档'
const defaultPageNumber = (): PageNumberOptions => ({ enabled: false, range: '', format: '第 {page} 页 / 共 {total} 页', position: 'bottom-center', size: 9, color: '#333333', opacity: 1 })
const defaultWatermark = (): WatermarkOptions => ({ enabled: false, range: '', text: '内部使用', size: 48, color: '#777777', opacity: 0.16, angle: -35 })

function measureText(text: string, size: number) {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return text.length * size * 0.58
  context.font = `${size}px sans-serif`
  return context.measureText(text).width
}

export default function PdfEditor() {
  const [sourcesMeta, setSourcesMeta] = useState<SourceMeta[]>([])
  const sourcesRef = useRef(new Map<string, PdfSource>())
  const [pages, setPages] = useState<PdfPageModel[]>([])
  useUnloadWarning(pages.length > 0)
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#f5c542')
  const [stroke, setStroke] = useState(2)
  const [viewport, setViewport] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('未命名 PDF')
  const [current, setCurrent] = useState<ProjectDetail | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [pageNumber, setPageNumber] = useState<PageNumberOptions>(defaultPageNumber)
  const [watermark, setWatermark] = useState<WatermarkOptions>(defaultWatermark)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [fields, setFields] = useState<FormField[]>([])
  const [signature, setSignature] = useState('')
  const [preview, setPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [draftPoints, setDraftPoints] = useState<{ x: number; y: number }[]>([])
  const [drag, setDrag] = useState<{ startPdf: { x: number; y: number }; startView: { x: number; y: number } } | null>(null)
  const [pageMenu, setPageMenu] = useState<HTMLElement | null>(null)
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null)
  const [pageDialog, setPageDialog] = useState(false)
  const [watermarkDialog, setWatermarkDialog] = useState(false)
  const [formsDialog, setFormsDialog] = useState(false)
  const [searchDialog, setSearchDialog] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<{ pageId: string; pageNo: number; snippet: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [extractDialog, setExtractDialog] = useState(false)
  const [extractRange, setExtractRange] = useState('')
  const [imageDialog, setImageDialog] = useState(false)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imageBusy, setImageBusy] = useState(false)
  const [imageProgress, setImageProgress] = useState(0)
  const [imageExportDialog, setImageExportDialog] = useState(false)
  const [imageExportRange, setImageExportRange] = useState('')
  const [imageExportFormat, setImageExportFormat] = useState<'png' | 'jpg'>('png')
  const [imageExportBusy, setImageExportBusy] = useState(false)
  const [imageExportProgress, setImageExportProgress] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const signatureInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const importMode = useRef<'append' | 'insert'>('append')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const renderTask = useRef<any>(null)
  const textLayer = useRef<any>(null)
  const currentPage = pages.find((page) => page.id === selectedPageId) || null
  const currentIndex = pages.findIndex((page) => page.id === selectedPageId)
  const currentSource = currentPage ? sourcesRef.current.get(currentPage.sourceKey) : null
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const snapshot = useCallback((): Snapshot => ({
    pages: structuredClone(pages), annotations: structuredClone(annotations),
  }), [pages, annotations])

  const restore = useCallback((value: Snapshot) => {
    setPages(value.pages); setAnnotations(value.annotations)
    if (value.pages.length && !value.pages.some((page) => page.id === selectedPageId)) setSelectedPageId(value.pages[0].id)
  }, [selectedPageId])

  const commit = useCallback((next: Snapshot) => {
    setHistory((list) => [...list.slice(-29), snapshot()])
    setFuture([])
    restore(next)
  }, [snapshot, restore])

  const undo = () => {
    if (!history.length) return
    const previous = history[history.length - 1]
    setHistory(history.slice(0, -1)); setFuture([snapshot(), ...future].slice(0, 30)); restore(previous)
  }

  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setFuture(future.slice(1)); setHistory([...history.slice(-29), snapshot()]); restore(next)
  }

  const loadFiles = async (files: File[], mode: 'append' | 'insert' = 'append') => {
    if (!files.length) return
    setLoading(true); setError('')
    const failures: string[] = []
    const loaded: { source: PdfSource; meta: SourceMeta }[] = []
    try {
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const key = `src_${uid()}`
          const source = await loadPdfSource(bytes, file.name, key)
          sourcesRef.current.set(key, source)
          loaded.push({ source, meta: { key, name: file.name, bytes } })
        } catch (reason) {
          failures.push(`${file.name}：${reason instanceof Error ? reason.message : '无法打开'}`)
        }
      }
      if (!loaded.length) return
      const replace = pages.length === 0
      const newPages = loaded.flatMap(({ source }) => sourcePages(source))
      const before = snapshot()
      setSourcesMeta(replace ? loaded.map(({ meta }) => meta) : [...sourcesMeta, ...loaded.map(({ meta }) => meta)])
      if (replace) {
        setPages(newPages)
        setSelectedPageId(newPages[0]?.id || null)
        setTitle(baseName(loaded[0].source.name))
        setHistory([]); setFuture([])
      } else {
        const at = mode === 'insert' ? Math.max(0, Math.min(pages.length, currentIndex + 1)) : pages.length
        setPages([...pages.slice(0, at), ...newPages, ...pages.slice(at)])
        setSelectedPageId(newPages[0]?.id || null)
        setHistory((list) => [...list.slice(-29), before])
        setFuture([])
      }
      const firstFields = formFields(loaded[0].source)
      if (replace || !fields.length) {
        setFields(firstFields)
        setFormValues(Object.fromEntries(firstFields.filter((field) => !['signature', 'unknown'].includes(field.type)).map((field) => [field.name, field.value])))
      }
    } finally {
      setLoading(false)
      if (failures.length) setError(failures.join('；'))
    }
  }

  const openProject = async (detail: ProjectDetail) => {
    setLoading(true); setError('')
    const nextSources = new Map<string, PdfSource>()
    try {
      const state = detail.state || {}
      const metas: SourceMeta[] = []
      for (let index = 0; index < (state.sources || []).length; index += 1) {
        const info = state.sources[index]
        const attachment = detail.attachments[info.attachmentIndex ?? index]
          || detail.attachments.find((item) => item.name === info.name)
          || detail.attachments[index]
        if (!attachment) throw new Error('项目缺少 PDF 附件')
        const bytes = new Uint8Array(await getFileBytes(attachment.id))
        const source = await loadPdfSource(bytes, info.name || attachment.name, info.key || `src_${index}`)
        nextSources.set(source.key, source)
        metas.push({ key: source.key, name: source.name, bytes })
      }
      const validPages = (state.pages || []).filter((page: PdfPageModel) => page && nextSources.has(page.sourceKey))
      if (!validPages.length) throw new Error('项目中没有可恢复的 PDF 页面')
      const previous = sourcesRef.current
      sourcesRef.current = nextSources
      for (const source of previous.values()) void destroySource(source)
      setSourcesMeta(metas); setPages(validPages)
      setAnnotations(state.annotations || [])
      setPageNumber({ ...defaultPageNumber(), ...(state.pageNumber || {}) })
      setWatermark({ ...defaultWatermark(), ...(state.watermark || {}) })
      setFormValues(state.formValues || {})
      const first = metas.length ? nextSources.get(metas[0].key) : null
      setFields(first ? formFields(first) : [])
      setSelectedPageId(validPages[0].id); setTitle(detail.title); setHistory([]); setFuture([])
    } catch (reason) {
      for (const source of nextSources.values()) void destroySource(source)
      setError(reason instanceof Error ? reason.message : '项目恢复失败')
    } finally { setLoading(false) }
  }

  const buildSave = async () => {
    if (!sourcesMeta.length) throw new Error('还没有 PDF')
    const existing = current?.attachments || []
    const reuse = existing.length === sourcesMeta.length && existing.every((file, index) => file.name === sourcesMeta[index].name)
    const files = reuse ? [] : sourcesMeta.map((source) => new File([source.bytes], source.name, { type: 'application/pdf' }))
    return {
      state: {
        sources: sourcesMeta.map((source, index) => ({ key: source.key, name: source.name, attachmentIndex: index })),
        pages, annotations, pageNumber, watermark, formValues,
      },
      files,
      existingAttachmentIds: reuse ? existing.map((file) => file.id) : [],
    }
  }

  useEffect(() => () => { for (const source of sourcesRef.current.values()) void destroySource(source) }, [])

  const renderCurrent = useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    const container = textLayerRef.current
    if (!canvas || !container || !currentPage || !currentSource) return
    renderTask.current?.cancel?.()
    textLayer.current?.cancel?.()
    container.innerHTML = ''
    setViewport(null)
    void (async () => {
      try {
        const page = await currentSource.pdf.getPage(currentPage.pageIndex + 1)
        if (cancelled) return
        const base = currentSource.sizes[currentPage.pageIndex]?.rotation || 0
        const view = page.getViewport({ scale: zoom, rotation: (base + currentPage.rotation + 360) % 360 })
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.round(view.width * ratio)
        canvas.height = Math.round(view.height * ratio)
        canvas.style.width = `${view.width}px`
        canvas.style.height = `${view.height}px`
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器无法创建 PDF 画布')
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        renderTask.current = page.render({ canvasContext: context, viewport: view, canvas })
        await renderTask.current.promise
        if (cancelled) return
        setViewport(view)
        const lib = await getPdfJs()
        textLayer.current = new lib.TextLayer({ textContentSource: page.streamTextContent(), container, viewport: view })
        await textLayer.current.render()
      } catch (reason: any) {
        if (!cancelled && reason?.name !== 'RenderingCancelledException') setError('页面渲染失败，文件可能已损坏')
      }
    })()
    return () => {
      cancelled = true
      try { renderTask.current?.cancel?.() } catch { /* ignore */ }
      try { textLayer.current?.cancel?.() } catch { /* ignore */ }
    }
  }, [currentPage, currentSource, zoom])

  const pageText = async (model: PdfPageModel) => {
    const source = sourcesRef.current.get(model.sourceKey)
    if (!source) return ''
    const page = await source.pdf.getPage(model.pageIndex + 1)
    const content = await page.getTextContent()
    const text = content.items.map((item: any) => item.str || '').join(' ')
    page.cleanup?.()
    return text
  }

  const copyPageText = async () => {
    if (!currentPage) return
    try {
      const text = await pageText(currentPage)
      if (!text.trim()) { toast.warning('本页没有可复制的文字层'); return }
      await navigator.clipboard.writeText(text)
      toast.success('已复制本页文字')
    } catch { toast.warning('浏览器不允许自动复制') }
  }

  const searchPdf = async () => {
    const query = searchText.trim().toLowerCase()
    if (!query) return
    setSearching(true); setSearchResults([])
    try {
      const found: { pageId: string; pageNo: number; snippet: string }[] = []
      for (let index = 0; index < pages.length; index += 1) {
        const text = await pageText(pages[index])
        const at = text.toLowerCase().indexOf(query)
        if (at >= 0) found.push({ pageId: pages[index].id, pageNo: index + 1, snippet: text.slice(Math.max(0, at - 30), at + query.length + 50) })
        if (found.length >= 100) break
      }
      setSearchResults(found)
    } finally { setSearching(false) }
  }

  const pointerPoint = (event: React.PointerEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect || !viewport) return null
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y) as [number, number]
    return { view: { x, y }, pdf: { x: pdfX, y: pdfY } }
  }

  const addTextAt = async (point: { x: number; y: number }) => {
    const text = await promptDialog({ title: '添加文字批注', label: '文字', placeholder: '输入要放在页面上的文字', maxLength: 500, confirmText: '放置' })
    if (!text) return
    const size = 16
    const width = Math.max(40, measureText(text, size))
    const annotation: PdfAnnotation = {
      id: uid(), pageId: currentPage!.id, type: 'text', text, size, color: '#1f2937', opacity: 1,
      rect: { x: point.x, y: point.y, width, height: size * 1.35 },
    }
    commit({ ...snapshot(), annotations: [...annotations, annotation] })
  }

  const pointerDown = (event: React.PointerEvent) => {
    if (tool === 'select' || !currentPage) return
    const point = pointerPoint(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'text') { void addTextAt(point.pdf); return }
    if (tool === 'check') {
      commit({ ...snapshot(), annotations: [...annotations, { id: uid(), pageId: currentPage.id, type: 'check', color: '#147d64', opacity: 1, rect: { x: point.pdf.x, y: point.pdf.y, width: 18, height: 18 } }] })
      setTool('select'); return
    }
    if (tool === 'signature') {
      if (!signature) { toast.warning('请先选择签名图片'); return }
      commit({ ...snapshot(), annotations: [...annotations, { id: uid(), pageId: currentPage.id, type: 'signature', dataUrl: signature, color: '#000000', opacity: 1, rect: { x: point.pdf.x, y: point.pdf.y - 50, width: 150, height: 50 } }] })
      setTool('select'); return
    }
    if (tool === 'highlight' || tool === 'redact') {
      setDrag({ startPdf: point.pdf, startView: point.view })
      setPreview({ x: point.view.x, y: point.view.y, width: 0, height: 0 })
    }
    if (tool === 'draw') { setDraftPoints([point.pdf]) }
  }

  const pointerMove = (event: React.PointerEvent) => {
    if (!drag && !draftPoints.length) return
    const point = pointerPoint(event)
    if (!point) return
    if (drag) {
      setPreview({ x: Math.min(drag.startView.x, point.view.x), y: Math.min(drag.startView.y, point.view.y), width: Math.abs(point.view.x - drag.startView.x), height: Math.abs(point.view.y - drag.startView.y) })
    } else {
      setDraftPoints((points) => [...points, point.pdf])
    }
  }

  const pointerUp = (event: React.PointerEvent) => {
    if (!currentPage) return
    if (drag) {
      const point = pointerPoint(event)
      if (point) {
        const x = Math.min(drag.startPdf.x, point.pdf.x)
        const y = Math.min(drag.startPdf.y, point.pdf.y)
        const width = Math.abs(point.pdf.x - drag.startPdf.x)
        const height = Math.abs(point.pdf.y - drag.startPdf.y)
        if (width > 1 && height > 1) {
          commit({ ...snapshot(), annotations: [...annotations, {
            id: uid(), pageId: currentPage.id, type: tool === 'redact' ? 'redaction' : 'highlight',
            color: tool === 'redact' ? '#000000' : color, opacity: tool === 'redact' ? 1 : 0.28,
            rect: { x, y, width, height },
          }] })
          if (tool === 'redact') toast.info('已标记删密区域；导出时会栅格化该页并移除原文字层')
        }
      }
      setDrag(null); setPreview(null)
    } else if (draftPoints.length) {
      if (draftPoints.length > 1) {
        commit({ ...snapshot(), annotations: [...annotations, { id: uid(), pageId: currentPage.id, type: 'draw', points: draftPoints, color, opacity: 1, size: stroke }] })
      }
      setDraftPoints([])
    }
  }

  const selectedAnnotations = useMemo(() => currentPage ? annotations.filter((item) => item.pageId === currentPage.id) : [], [annotations, currentPage])

  const overlayItems = useMemo(() => {
    if (!viewport || !currentPage) return []
    return selectedAnnotations.map((annotation) => {
      if (annotation.rect) {
        const topLeft = viewport.convertToViewportPoint(annotation.rect.x, annotation.rect.y + annotation.rect.height)
        const bottomRight = viewport.convertToViewportPoint(annotation.rect.x + annotation.rect.width, annotation.rect.y)
        const left = Math.min(topLeft[0], bottomRight[0]); const top = Math.min(topLeft[1], bottomRight[1])
        const width = Math.abs(bottomRight[0] - topLeft[0]); const height = Math.abs(bottomRight[1] - topLeft[1])
        return { annotation, left, top, width, height }
      }
      const points = (annotation.points || []).map((point) => viewport.convertToViewportPoint(point.x, point.y))
      return { annotation, points }
    })
  }, [selectedAnnotations, viewport, currentPage])

  const preserveForms = useMemo(() => {
    if (sourcesMeta.length !== 1 || !fields.length) return false
    const source = sourcesRef.current.get(sourcesMeta[0].key)
    if (!source || pages.length !== source.sizes.length) return false
    if (annotations.some((item) => item.type === 'redaction')) return false
    return pages.every((page, index) => page.sourceKey === source.key && page.pageIndex === index)
  }, [sourcesMeta, fields.length, pages, annotations])

  const signatureAlert = useMemo(() => sourcesMeta.length ? hasSignature(sourcesRef.current.get(sourcesMeta[0].key)!) : false, [sourcesMeta])

  const buildExport = async (subset?: PdfPageModel[]) => exportPdf({
    pages: subset || pages, sources: sourcesRef.current, annotations,
    pageNumber, watermark, formValues, preserveForms: preserveForms && !subset,
  })

  const exportCurrent = async () => {
    setExportMenu(null)
    if (!pages.length) { toast.warning('还没有可导出的 PDF'); return }
    const hasRedaction = annotations.some((item) => item.type === 'redaction')
    if (hasRedaction) {
      const ok = await confirmDialog({ title: '导出含删密区域的副本', danger: true, confirmText: '应用删除并导出', message: '包含删密标记的页面会被栅格化后完整重写，原文字层和交互表单不会保留；未标记页面保持矢量。导出后将检查删密页文字层。' })
      if (!ok) return
    }
    setLoading(true)
    try {
      const result = await buildExport()
      if (hasRedaction) {
        const verified = await verifyRedactedPages(result.blob, pages, annotations, pageNumber, watermark)
        if (!verified) toast.warning('删密页仍检测到文字层，请检查导出结果')
        else toast.success('删密页已无文字层')
      }
      downloadBlob(result.blob, `${baseName(title)}.pdf`)
      if (result.warnings.length) toast.info(result.warnings.slice(0, 2).join('；'))
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'PDF 导出失败') }
    finally { setLoading(false) }
  }

  const extractPages = async () => {
    try {
      const selected = parsePageRange(extractRange, pages.length).map((number) => pages[number - 1])
      const result = await buildExport(selected)
      downloadBlob(result.blob, `${baseName(title)}-抽取.pdf`)
      setExtractDialog(false)
      toast.success(`已导出 ${selected.length} 页`)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '页码无效') }
  }

  const removeRange = async () => {
    const value = await promptDialog({ title: '按范围删除页面', label: '页码范围', placeholder: '例如 2-4,7', maxLength: 200, confirmText: '继续' })
    if (!value) return
    try {
      const numbers = new Set(parsePageRange(value, pages.length))
      const ok = await confirmDialog({ title: '删除页面', danger: true, confirmText: '删除', message: `删除 ${numbers.size} 页？页面上的批注一并移除。` })
      if (!ok) return
      const nextPages = pages.filter((_, index) => !numbers.has(index + 1))
      const removed = new Set(pages.filter((_, index) => numbers.has(index + 1)).map((page) => page.id))
      commit({ ...snapshot(), pages: nextPages, annotations: annotations.filter((item) => !removed.has(item.pageId)) })
      setSelectedPageId(nextPages[0]?.id || null)
      toast.success('页面已删除')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '页码范围无效') }
  }

  const rotatePage = () => {
    if (!currentPage) return
    commit({ ...snapshot(), pages: pages.map((page) => page.id === currentPage.id ? { ...page, rotation: (page.rotation + 90) % 360 } : page) })
  }

  const movePage = (delta: number) => {
    if (!currentPage) return
    const to = currentIndex + delta
    if (to < 0 || to >= pages.length) return
    commit({ ...snapshot(), pages: arrayMove(pages, currentIndex, to) })
  }

  const duplicatePage = () => {
    if (!currentPage || currentIndex < 0) return
    const id = uid()
    const next = pages.slice()
    next.splice(currentIndex + 1, 0, { ...currentPage, id })
    const copies = annotations.filter((item) => item.pageId === currentPage.id).map((item) => ({ ...structuredClone(item), id: uid(), pageId: id }))
    commit({ ...snapshot(), pages: next, annotations: [...annotations, ...copies] })
    setSelectedPageId(id)
  }

  const deletePage = async () => {
    if (!currentPage) return
    const ok = await confirmDialog({ title: '删除页面', danger: true, confirmText: '删除', message: '删除当前页及其批注？' })
    if (!ok) return
    const index = pages.findIndex((page) => page.id === currentPage.id)
    const next = pages.filter((page) => page.id !== currentPage.id)
    commit({ ...snapshot(), pages: next, annotations: annotations.filter((item) => item.pageId !== currentPage.id) })
    setSelectedPageId(next[Math.max(0, index - 1)]?.id || null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = pages.findIndex((page) => page.id === active.id)
    const to = pages.findIndex((page) => page.id === over.id)
    if (from < 0 || to < 0) return
    commit({ ...snapshot(), pages: arrayMove(pages, from, to) })
  }

  const composeImages = async () => {
    if (!imageFiles.length) return
    setImageBusy(true); setImageProgress(0)
    try {
      const output = await composePdf(imageFiles, { ...DEFAULT_SETTINGS, pageSize: 'fit', margin: 0, outputName: '图片合成.pdf' }, setImageProgress)
      const bytes = new Uint8Array(await output.blob.arrayBuffer())
      const key = `src_${uid()}`
      const source = await loadPdfSource(bytes, output.name, key)
      const newPages = sourcePages(source)
      sourcesRef.current.set(key, source)
      setSourcesMeta((list) => [...list, { key, name: output.name, bytes }])
      setPages((list) => [...list, ...newPages])
      setSelectedPageId(newPages[0]?.id || null)
      setHistory((list) => [...list.slice(-29), snapshot()])
      setFuture([])
      setImageDialog(false); setImageFiles([])
      toast.success('图片已转为 PDF 页面')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '图片合成失败') }
    finally { setImageBusy(false) }
  }

  const exportImages = async () => {
    setImageExportBusy(true); setImageExportProgress(0)
    try {
      const result = await buildExport()
      const file = new File([result.blob], `${baseName(title)}.pdf`, { type: 'application/pdf' })
      const outputs = await pdfPagesToImages(file, imageExportFormat, {
        ...DEFAULT_SETTINGS, pages: imageExportRange, dpi: 2, quality: 92,
      }, setImageExportProgress)
      await downloadOutputs(outputs, `${baseName(title)}-${imageExportFormat}.zip`)
      setImageExportDialog(false)
      toast.success('页面图片已导出')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : '页面导出失败') }
    finally { setImageExportBusy(false) }
  }

  const changeForm = (name: string, value: string) => setFormValues((values) => ({ ...values, [name]: value }))

  if (!pages.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Paper variant="outlined" sx={{ maxWidth: 720, width: '100%', p: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 16, fontWeight: 650 }}>打开 PDF</Typography>
          <Typography sx={{ mt: 0.5, mb: 2, fontSize: 12, color: 'text.secondary' }}>本地读取、预览、整理、批注和导出；文件处理在浏览器内完成。</Typography>
          <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void loadFiles(files, 'append') }} />
          <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={<Upload fontSize="small" />} disabled={loading} onClick={() => inputRef.current?.click()}>{loading ? '正在打开…' : '选择 PDF'}</Button>
            <ProjectActions kind="pdf" kindLabel="PDF" title={title} onTitleChange={setTitle} current={current} onCurrentChange={setCurrent} buildSave={async () => { throw new Error('请先打开 PDF') }} onOpen={openProject} disabled={!pages.length} />
          </Stack>
          {error ? <Alert severity="error" sx={{ mt: 2, textAlign: 'left', py: 0.3, fontSize: 12 }}>{error}</Alert> : null}
          <Typography sx={{ mt: 2, fontSize: 10.5, color: 'text.disabled' }}>受密码保护的 PDF 首版仅提示错误；合并多个 PDF 时可在打开后继续添加。</Typography>
        </Paper>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void loadFiles(files, importMode.current) }} />
      <input ref={signatureInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => { setSignature(String(reader.result || '')); setTool('signature'); toast.info('签名已载入，点击页面放置') }
        reader.readAsDataURL(file)
      }} />
      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(event) => { setImageFiles(Array.from(event.target.files || [])); event.target.value = '' }} />

      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.6, borderBottom: 1, borderColor: 'divider' }}>
        <TextField size="small" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="PDF 标题" inputProps={{ maxLength: 200, 'aria-label': 'PDF 标题' }} sx={{ width: { xs: 130, sm: 210 }, '& .MuiInputBase-input': { fontSize: 13, fontWeight: 600, py: 0.5 } }} />
        <Chip size="small" variant="outlined" label={`${pages.length} 页`} />
        <Box sx={{ flex: 1 }} />
        <ProjectActions kind="pdf" kindLabel="PDF" title={title} onTitleChange={setTitle} current={current} onCurrentChange={setCurrent} buildSave={buildSave} onOpen={openProject} />
        <Button size="small" startIcon={<Download fontSize="small" />} onClick={(event) => setExportMenu(event.currentTarget)}>导出</Button>
        <Menu anchorEl={exportMenu} open={Boolean(exportMenu)} onClose={() => setExportMenu(null)}>
          <MenuItem onClick={() => void exportCurrent()}>导出修改后的 PDF</MenuItem>
          <MenuItem onClick={() => { setExportMenu(null); setExtractDialog(true); setExtractRange('') }}>抽取指定页</MenuItem>
          <MenuItem onClick={() => { setExportMenu(null); setImageExportDialog(true); setImageExportRange('') }}>页面转 PNG / JPG</MenuItem>
          <MenuItem onClick={() => { setExportMenu(null); setImageDialog(true); setImageFiles([]) }}>图片合成 PDF</MenuItem>
        </Menu>
      </Stack>

      <Stack direction="row" spacing={0.4} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <IconButton size="small" aria-label="上一页" disabled={currentIndex <= 0} onClick={() => setSelectedPageId(pages[Math.max(0, currentIndex - 1)]?.id || null)}><ArrowLeft fontSize="small" /></IconButton>
        <TextField size="small" value={currentIndex + 1} onChange={(event) => { const value = Number(event.target.value); if (value >= 1 && value <= pages.length) setSelectedPageId(pages[value - 1].id) }} inputProps={{ style: { textAlign: 'center', padding: '3px 4px', width: 38 } }} />
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>/ {pages.length}</Typography>
        <IconButton size="small" aria-label="下一页" disabled={currentIndex >= pages.length - 1} onClick={() => setSelectedPageId(pages[Math.min(pages.length - 1, currentIndex + 1)]?.id || null)}><ArrowLeft fontSize="small" sx={{ transform: 'rotate(180deg)' }} /></IconButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.4 }} />
        <Tooltip title="缩小"><IconButton size="small" aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.35, value / 1.2))}><Typography sx={{ fontSize: 16 }}>−</Typography></IconButton></Tooltip>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', width: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Typography>
        <Tooltip title="放大"><IconButton size="small" aria-label="放大" onClick={() => setZoom((value) => Math.min(3, value * 1.2))}><Plus fontSize="small" /></IconButton></Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.4 }} />
        <Tooltip title="撤销"><span><IconButton size="small" aria-label="撤销" disabled={!history.length} onClick={undo}><Refresh fontSize="small" sx={{ transform: 'scaleX(-1)' }} /></IconButton></span></Tooltip>
        <Tooltip title="重做"><span><IconButton size="small" aria-label="重做" disabled={!future.length} onClick={redo}><Refresh fontSize="small" /></IconButton></span></Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.4 }} />
        <Tooltip title="选择/复制文字"><IconButton size="small" aria-label="选择工具" color={tool === 'select' ? 'primary' : 'default'} onClick={() => setTool('select')}><OpenWithIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="高亮"><IconButton size="small" aria-label="高亮" color={tool === 'highlight' ? 'primary' : 'default'} onClick={() => setTool('highlight')}><HighlightIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="手绘"><IconButton size="small" aria-label="手绘" color={tool === 'draw' ? 'primary' : 'default'} onClick={() => setTool('draw')}><DrawIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="文字批注"><IconButton size="small" aria-label="文字批注" color={tool === 'text' ? 'primary' : 'default'} onClick={() => setTool('text')}><TextFieldsIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="勾选标记"><IconButton size="small" aria-label="勾选标记" color={tool === 'check' ? 'primary' : 'default'} onClick={() => setTool('check')}><CheckIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="放置签名图片"><IconButton size="small" aria-label="放置签名" color={tool === 'signature' ? 'primary' : 'default'} onClick={() => { if (signature) setTool('signature'); else signatureInput.current?.click() }}><SignatureIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="标记删密区域"><IconButton size="small" aria-label="标记删密" color={tool === 'redact' ? 'error' : 'default'} onClick={() => setTool('redact')}><RedactIcon fontSize="small" /></IconButton></Tooltip>
        <Box component="input" type="color" aria-label="批注颜色" value={color} onChange={(event) => setColor(event.target.value)} sx={{ width: 26, height: 26, p: 0, border: 1, borderColor: 'divider', borderRadius: 0.75, bgcolor: 'transparent', cursor: 'pointer' }} />
        <TextField size="small" type="number" value={stroke} onChange={(event) => setStroke(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} inputProps={{ min: 1, max: 12, style: { padding: '2px 4px', width: 42 } }} aria-label="手绘粗细" />
        <Divider orientation="vertical" flexItem sx={{ mx: 0.4 }} />
        <Button size="small" startIcon={<Search fontSize="small" />} onClick={() => setSearchDialog(true)}>搜索</Button>
        <Button size="small" startIcon={<CopyDocument fontSize="small" />} onClick={() => void copyPageText()}>复制本页文字</Button>
        {fields.length ? <Button size="small" startIcon={<Edit fontSize="small" />} onClick={() => setFormsDialog(true)}>表单</Button> : null}
        <Button size="small" onClick={() => setPageDialog(true)}>页码</Button>
        <Button size="small" onClick={() => setWatermarkDialog(true)}>水印</Button>
        <Button size="small" startIcon={<Refresh fontSize="small" />} onClick={() => { importMode.current = 'append'; inputRef.current?.click() }}>添加 PDF</Button>
        <Button size="small" onClick={() => { importMode.current = 'insert'; inputRef.current?.click() }}>插入 PDF</Button>
        <Button size="small" startIcon={<Plus fontSize="small" />} onClick={() => setImageDialog(true)}>图片成 PDF</Button>
      </Stack>

      {error ? <Alert severity="error" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 12 }} onClose={() => setError('')}>{error}</Alert> : null}
      {signatureAlert ? <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}>检测到数字签名字段；修改、删页或重排可能使原签名失效。请保留原件并在导出副本中核对。</Alert> : null}
      {tool === 'redact' ? <Alert severity="error" variant="outlined" sx={{ mx: 1.25, mt: 0.5, py: 0.2, fontSize: 11.5 }}>删密标记只会在导出时应用；含删密区域的页面会被栅格化，原文字层和表单不再保留。</Alert> : null}

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '210px minmax(0,1fr)' }, overflow: 'hidden' }}>
        <Paper variant="outlined" square sx={{ minHeight: 0, overflow: 'auto', borderRight: 1, borderColor: 'divider', p: 0.75, display: { xs: 'none', md: 'block' } }}>
          <Stack direction="row" alignItems="center" sx={{ px: 0.5, pb: 0.5 }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 650, flex: 1 }}>页面</Typography>
            <Tooltip title="添加 PDF"><IconButton size="small" aria-label="添加 PDF" onClick={() => { importMode.current = 'append'; inputRef.current?.click() }}><Plus fontSize="small" /></IconButton></Tooltip>
          </Stack>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pages.map((page) => page.id)} strategy={verticalListSortingStrategy}>
              <Stack spacing={0.5}>
                {pages.map((page, index) => {
                  const source = sourcesRef.current.get(page.sourceKey)
                  return source ? <PdfThumb key={page.id} model={page} source={source} index={index} active={page.id === selectedPageId} onSelect={() => setSelectedPageId(page.id)} /> : null
                })}
              </Stack>
            </SortableContext>
          </DndContext>
        </Paper>
        <Box sx={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>拖动左侧缩略图重排；当前第 {currentIndex + 1} 页</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={rotatePage}>旋转 90°</Button>
            <Button size="small" disabled={currentIndex <= 0} onClick={() => movePage(-1)}>上移</Button>
            <Button size="small" disabled={currentIndex >= pages.length - 1} onClick={() => movePage(1)}>下移</Button>
            <Button size="small" onClick={duplicatePage}>复制本页</Button>
            <Button size="small" color="error" onClick={() => void removeRange()}>按范围删除</Button>
            <Button size="small" color="error" onClick={() => void deletePage()}>删除本页</Button>
            {selectedAnnotations.length ? <Button size="small" onClick={() => commit({ ...snapshot(), annotations: annotations.filter((item) => item.pageId !== currentPage?.id) })}>清除本页批注</Button> : null}
          </Stack>
          <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? '#151B1D' : '#E9EEEC' }}>
            {loading ? <LinearProgress sx={{ mb: 1 }} /> : null}
            {currentPage ? (
              <Box className="pdf-page-shell" sx={{ width: viewport?.width || 600, height: viewport?.height || 800 }}>
                <canvas ref={canvasRef} className="pdf-page-canvas" aria-label="PDF 页面预览" />
                <div ref={textLayerRef} className="pdf-text-layer" style={{ pointerEvents: tool === 'select' && viewport ? 'auto' : 'none' }} />
                {viewport ? (
                <div
                  ref={overlayRef} className="pdf-overlay"
                  style={{ pointerEvents: tool === 'select' ? 'none' : 'auto', cursor: tool === 'select' ? 'default' : 'crosshair' }}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={pointerUp}
                >
                  {overlayItems.map(({ annotation, left, top, width, height, points }: any) => {
                    if (points) {
                      return (
                        <svg key={annotation.id} width={viewport.width} height={viewport.height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                          <polyline points={points.map((point: number[]) => `${point[0]},${point[1]}`).join(' ')} fill="none" stroke={annotation.color} strokeWidth={annotation.size || 2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )
                    }
                    if (annotation.type === 'text') {
                      return <Box key={annotation.id} sx={{ position: 'absolute', left, top: top - (annotation.size || 16) * zoom, color: annotation.color, fontSize: (annotation.size || 16) * zoom, lineHeight: 1.1, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{annotation.text}</Box>
                    }
                    if (annotation.type === 'check') {
                      return <Box key={annotation.id} sx={{ position: 'absolute', left, top, color: annotation.color, fontSize: 18 * zoom, lineHeight: 1, pointerEvents: 'none' }}>✓</Box>
                    }
                    if (annotation.type === 'signature') {
                      return <Box key={annotation.id} component="img" src={annotation.dataUrl} alt="签名" sx={{ position: 'absolute', left, top, width, height, objectFit: 'contain', pointerEvents: 'none' }} />
                    }
                    return <Box key={annotation.id} sx={{ position: 'absolute', left, top, width, height, bgcolor: annotation.type === 'redaction' ? '#000' : annotation.color, opacity: annotation.type === 'redaction' ? 1 : annotation.opacity, pointerEvents: 'none' }} />
                  })}
                  {preview ? <Box sx={{ position: 'absolute', left: preview.x, top: preview.y, width: preview.width, height: preview.height, bgcolor: tool === 'redact' ? '#000' : color, opacity: tool === 'redact' ? 1 : 0.3, pointerEvents: 'none' }} /> : null}
                  {draftPoints.length > 1 ? <svg width={viewport.width} height={viewport.height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><polyline points={draftPoints.map((point) => { const converted = viewport.convertToViewportPoint(point.x, point.y); return `${converted[0]},${converted[1]}` }).join(' ')} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" /></svg> : null}
                </div>
                ) : null}
                {viewport && pageNumber.enabled && currentIndex + 1 >= 1 ? <Box sx={{ position: 'absolute', left: pageNumber.position === 'bottom-left' ? 10 : pageNumber.position === 'bottom-right' ? undefined : '50%', right: pageNumber.position === 'bottom-right' ? 10 : undefined, bottom: 8, transform: pageNumber.position === 'bottom-center' ? 'translateX(-50%)' : 'none', color: pageNumber.color, opacity: pageNumber.opacity, fontSize: pageNumber.size * zoom, pointerEvents: 'none' }}>{pageNumber.format.replace('{page}', String(currentIndex + 1)).replace('{total}', String(pages.length))}</Box> : null}
                {viewport && watermark.enabled && watermark.text ? <Box sx={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) rotate(${watermark.angle}deg)`, color: watermark.color, opacity: watermark.opacity, fontSize: watermark.size * zoom, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{watermark.text}</Box> : null}
                {!viewport ? <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}><CircularProgress size={20} /><Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>正在渲染页面…</Typography></Stack> : null}
              </Box>
            ) : <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}><CircularProgress size={20} /><Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>正在渲染页面…</Typography></Stack>}
          </Box>
        </Box>
      </Box>

      {/* page number dialog */}
      <Dialog open={pageDialog} onClose={() => setPageDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>添加页码</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControlLabel control={<Checkbox checked={pageNumber.enabled} onChange={(event) => setPageNumber({ ...pageNumber, enabled: event.target.checked })} />} label="启用页码" />
          <TextField fullWidth size="small" label="页码格式" value={pageNumber.format} onChange={(event) => setPageNumber({ ...pageNumber, format: event.target.value })} helperText="支持 {page} 和 {total}" sx={{ mt: 1 }} />
          <TextField fullWidth size="small" label="页码范围" value={pageNumber.range} onChange={(event) => setPageNumber({ ...pageNumber, range: event.target.value })} placeholder="留空为全部，例如 1-3,5" sx={{ mt: 1 }} />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField size="small" type="number" label="字号" value={pageNumber.size} onChange={(event) => setPageNumber({ ...pageNumber, size: Math.max(6, Math.min(40, Number(event.target.value) || 9)) })} sx={{ width: 90 }} />
            <TextField size="small" type="number" label="透明度" value={pageNumber.opacity} inputProps={{ min: 0, max: 1, step: 0.05 }} onChange={(event) => setPageNumber({ ...pageNumber, opacity: Math.max(0, Math.min(1, Number(event.target.value) || 0)) })} sx={{ width: 100 }} />
            <Box component="input" type="color" aria-label="页码颜色" value={pageNumber.color} onChange={(event) => setPageNumber({ ...pageNumber, color: event.target.value })} sx={{ width: 34, height: 34, p: 0, mt: 0.5, border: 1, borderColor: 'divider', borderRadius: 1 }} />
          </Stack>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel>位置</InputLabel>
            <Select label="位置" value={pageNumber.position} onChange={(event) => setPageNumber({ ...pageNumber, position: event.target.value as any })}>
              <MenuItem value="bottom-center">底部居中</MenuItem>
              <MenuItem value="bottom-left">左下角</MenuItem>
              <MenuItem value="bottom-right">右下角</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button size="small" onClick={() => setPageDialog(false)}>关闭</Button><Button size="small" variant="contained" onClick={() => setPageDialog(false)}>应用</Button></DialogActions>
      </Dialog>

      {/* watermark dialog */}
      <Dialog open={watermarkDialog} onClose={() => setWatermarkDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>文字水印</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControlLabel control={<Checkbox checked={watermark.enabled} onChange={(event) => setWatermark({ ...watermark, enabled: event.target.checked })} />} label="启用水印" />
          <TextField fullWidth size="small" label="水印文字" value={watermark.text} onChange={(event) => setWatermark({ ...watermark, text: event.target.value })} sx={{ mt: 1 }} />
          <TextField fullWidth size="small" label="页码范围" value={watermark.range} onChange={(event) => setWatermark({ ...watermark, range: event.target.value })} placeholder="留空为全部" sx={{ mt: 1 }} />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField size="small" type="number" label="字号" value={watermark.size} onChange={(event) => setWatermark({ ...watermark, size: Math.max(10, Math.min(160, Number(event.target.value) || 48)) })} sx={{ width: 90 }} />
            <TextField size="small" type="number" label="角度" value={watermark.angle} onChange={(event) => setWatermark({ ...watermark, angle: Number(event.target.value) || 0 })} sx={{ width: 90 }} />
            <TextField size="small" type="number" label="透明度" value={watermark.opacity} inputProps={{ min: 0, max: 1, step: 0.02 }} onChange={(event) => setWatermark({ ...watermark, opacity: Math.max(0, Math.min(1, Number(event.target.value) || 0)) })} sx={{ width: 100 }} />
          </Stack>
          <Box component="input" type="color" aria-label="水印颜色" value={watermark.color} onChange={(event) => setWatermark({ ...watermark, color: event.target.value })} sx={{ width: 34, height: 34, p: 0, mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button size="small" onClick={() => setWatermarkDialog(false)}>关闭</Button><Button size="small" variant="contained" onClick={() => setWatermarkDialog(false)}>应用</Button></DialogActions>
      </Dialog>

      {/* forms */}
      <Dialog open={formsDialog} onClose={() => setFormsDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>填写 PDF 表单</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {!preserveForms ? <Alert severity="warning" sx={{ mb: 1.5, py: 0.25, fontSize: 12 }}>当前文档经过合并、重排、删页或包含删密区域；首版导出无法保留可交互表单，填写值仅供参考或不保存。</Alert> : null}
          <Stack spacing={1.25}>
            {fields.map((field) => {
              if (field.type === 'signature') return <Typography key={field.name} sx={{ fontSize: 12, color: 'text.secondary' }}>{field.name}：数字签名字段，首版不修改</Typography>
              if (field.type === 'checkbox') return <FormControlLabel key={field.name} control={<Checkbox disabled={!preserveForms || field.readOnly} checked={formValues[field.name] === 'true'} onChange={(event) => changeForm(field.name, event.target.checked ? 'true' : 'false')} />} label={field.name} />
              if (field.type === 'dropdown' || field.type === 'radio') return (
                <FormControl key={field.name} fullWidth size="small" disabled={!preserveForms || field.readOnly}>
                  <InputLabel>{field.name}</InputLabel>
                  <Select label={field.name} value={formValues[field.name] || ''} onChange={(event) => changeForm(field.name, event.target.value)}>
                    {field.options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                  </Select>
                </FormControl>
              )
              return <TextField key={field.name} fullWidth size="small" label={field.name} disabled={!preserveForms || field.readOnly} value={formValues[field.name] || ''} onChange={(event) => changeForm(field.name, event.target.value)} helperText={field.type === 'unknown' ? '暂不支持此字段类型' : undefined} />
            })}
            {!fields.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>当前 PDF 没有可填写的表单字段。</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button size="small" onClick={() => setFormsDialog(false)}>关闭</Button><Button size="small" variant="contained" onClick={() => { setFormsDialog(false); toast.success('表单值已记录，导出时应用') }}>完成</Button></DialogActions>
      </Dialog>

      {/* search */}
      <Dialog open={searchDialog} onClose={() => setSearchDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>搜索 PDF 文字</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack direction="row" spacing={1}>
            <TextField autoFocus fullWidth size="small" label="搜索文字" value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchPdf() }} />
            <Button size="small" variant="contained" disabled={searching || !searchText.trim()} onClick={() => void searchPdf()}>{searching ? '搜索中…' : '搜索'}</Button>
          </Stack>
          <List dense sx={{ mt: 1, maxHeight: 300, overflow: 'auto' }}>
            {searchResults.map((result) => <ListItem key={`${result.pageId}-${result.snippet}`} disablePadding><ListItemButton onClick={() => { setSelectedPageId(result.pageId); setSearchDialog(false) }}><ListItemText primary={`第 ${result.pageNo} 页`} secondary={result.snippet} primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 11 }} /></ListItemButton></ListItem>)}
            {!searching && searchText && !searchResults.length ? <Typography sx={{ p: 1.5, fontSize: 12, color: 'text.secondary' }}>没有找到匹配文字，或该页是扫描图片没有文字层。</Typography> : null}
          </List>
        </DialogContent>
        <DialogActions><Button size="small" onClick={() => setSearchDialog(false)}>关闭</Button></DialogActions>
      </Dialog>

      {/* extract */}
      <Dialog open={extractDialog} onClose={() => setExtractDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>抽取 / 拆分页面</DialogTitle>
        <DialogContent sx={{ pt: 2 }}><TextField autoFocus fullWidth size="small" label="页码范围" value={extractRange} onChange={(event) => setExtractRange(event.target.value)} placeholder={`1-${pages.length}`} helperText={`当前共 ${pages.length} 页；支持 1-3,5`} /></DialogContent>
        <DialogActions><Button size="small" onClick={() => setExtractDialog(false)}>取消</Button><Button size="small" variant="contained" onClick={() => void extractPages()}>导出选中页</Button></DialogActions>
      </Dialog>

      {/* images to PDF */}
      <Dialog open={imageDialog} onClose={() => setImageDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>图片合成 PDF</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Button size="small" startIcon={<Picture fontSize="small" />} onClick={() => imageInput.current?.click()}>选择图片（可多选）</Button>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              const { active, over } = event
              if (!over || active.id === over.id) return
              setImageFiles((prev) => arrayMove(prev, Number(active.id), Number(over.id)))
            }}
          >
            <SortableContext items={imageFiles.map((_, index) => String(index))} strategy={verticalListSortingStrategy}>
              <Stack spacing={0.5} sx={{ mt: 1.25, maxHeight: 260, overflow: 'auto' }}>
                {imageFiles.map((file, index) => (
                  <SortableImageFile
                    key={`${file.name}-${index}-${file.size}`}
                    id={String(index)}
                    file={file}
                    index={index}
                    onRemove={() => setImageFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
          {imageBusy ? <Box sx={{ mt: 1 }}><LinearProgress variant="determinate" value={imageProgress} /></Box> : null}
        </DialogContent>
        <DialogActions><Button size="small" onClick={() => setImageDialog(false)}>取消</Button><Button size="small" variant="contained" disabled={!imageFiles.length || imageBusy} onClick={() => void composeImages()}>生成并加入</Button></DialogActions>
      </Dialog>

      {/* pages to images */}
      <Dialog open={imageExportDialog} onClose={() => setImageExportDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>页面转图片</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField autoFocus fullWidth size="small" label="页码范围" value={imageExportRange} onChange={(event) => setImageExportRange(event.target.value)} placeholder={`1-${pages.length}，留空为全部`} />
          <FormControl fullWidth size="small" sx={{ mt: 1.25 }}>
            <InputLabel>格式</InputLabel>
            <Select label="格式" value={imageExportFormat} onChange={(event) => setImageExportFormat(event.target.value as 'png' | 'jpg')}><MenuItem value="png">PNG</MenuItem><MenuItem value="jpg">JPG</MenuItem></Select>
          </FormControl>
          {imageExportBusy ? <Box sx={{ mt: 1 }}><LinearProgress variant="determinate" value={imageExportProgress} /></Box> : null}
        </DialogContent>
        <DialogActions><Button size="small" onClick={() => setImageExportDialog(false)}>取消</Button><Button size="small" variant="contained" disabled={imageExportBusy} onClick={() => void exportImages()}>导出图片</Button></DialogActions>
      </Dialog>
    </Box>
  )
}

function SortableImageFile({ id, file, index, onRemove }: { id: string; file: File; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <Stack
      ref={setNodeRef}
      direction="row"
      spacing={0.5}
      alignItems="center"
      style={{
        transform: CSS.Transform.toString(transform), transition,
        zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.65 : 1, position: 'relative',
      }}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 0.5, bgcolor: 'background.paper' }}
    >
      <Box
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        component="button"
        type="button"
        aria-label={`拖动${file.name}排序`}
        title="拖动排序"
        sx={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22,
          p: 0, border: 0, borderRadius: 0.75, bgcolor: 'transparent', color: 'text.disabled',
          cursor: 'grab', touchAction: 'none',
          '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicator sx={{ fontSize: 17 }} />
      </Box>
      <Typography sx={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{index + 1}. {file.name}</Typography>
      <IconButton size="small" aria-label="移除图片" onClick={onRemove}><Delete fontSize="small" /></IconButton>
    </Stack>
  )
}

function PdfThumb({ model, source, index, active, onSelect }: { model: PdfPageModel; source: PdfSource; index: number; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: model.id })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setVisible(true) }, { rootMargin: '120px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: any = null
    void (async () => {
      try {
        const page = await source.pdf.getPage(model.pageIndex + 1)
        const base = source.sizes[model.pageIndex]?.rotation || 0
        const raw = page.getViewport({ scale: 1, rotation: (base + model.rotation + 360) % 360 })
        const viewport = page.getViewport({ scale: 96 / Math.max(1, raw.width), rotation: (base + model.rotation + 360) % 360 })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.max(1, Math.round(viewport.width * 2))
        canvas.height = Math.max(1, Math.round(viewport.height * 2))
        const context = canvas.getContext('2d')
        if (!context) return
        context.scale(2, 2)
        task = page.render({ canvasContext: context, viewport, canvas })
        await task.promise
        page.cleanup?.()
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true; try { task?.cancel?.() } catch { /* ignore */ } }
  }, [visible, model.pageIndex, model.rotation, source])
  return (
    <Box
      ref={(node) => setNodeRef(node as HTMLElement | null)}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.65 : 1 }}
      sx={{ border: 2, borderColor: active ? 'primary.main' : 'divider', borderRadius: 1, bgcolor: active ? 'action.selected' : 'background.paper', p: 0.5 }}
    >
      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ mb: 0.25 }}>
        <Box ref={setActivatorNodeRef} {...attributes} {...listeners} sx={{ cursor: 'grab', color: 'text.disabled', display: 'flex', touchAction: 'none' }} aria-label={`拖动第 ${index + 1} 页`}><MoreFilled sx={{ fontSize: 14 }} /></Box>
        <Typography sx={{ fontSize: 10.5, color: 'text.secondary', flex: 1 }}>第 {index + 1} 页</Typography>
        {model.rotation ? <Typography sx={{ fontSize: 9.5, color: 'text.disabled' }}>{model.rotation}°</Typography> : null}
      </Stack>
      <Box ref={hostRef} onClick={onSelect} sx={{ cursor: 'pointer', minHeight: 80, display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
        <canvas ref={canvasRef} className="pdf-thumb-canvas" aria-label={`第 ${index + 1} 页缩略图`} />
      </Box>
    </Box>
  )
}
