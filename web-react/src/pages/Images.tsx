import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Box, Button, Checkbox, FormControl, IconButton, InputLabel, MenuItem, Select,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { Divider } from '@mui/material'
import {
  ArrowDown, ArrowUp, AspectRatio, Brush, ChevronDown, ContentCut, Crop, Delete, Download, GridView,
  Lock, LockOpen, Palette, Picture, Plus, RoundedCorner, TextFields, Tune, WaterDrop,
} from '@/icons'
import { confirmDialog, toast } from '@/ui/feedback'
import {  } from '@/ui/common'
import {
  clone, collageSize, defaults, download, encodeImage, extension, orientedSize, outputSize,
  renderCollage, renderImage, safeName, validateSize, zipImages, type CollageOptions, type ExportOptions,
  type ImageAsset, type ImageOptions, type Point,
} from '@/utils/image-tools'

const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${(value / 1024).toFixed(1)} KB`

const IMAGE_ACCEPT = [
  '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.webp', '.gif', '.bmp', '.svg', '.avif', '.ico',
  'image/png', 'image/apng', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml', 'image/avif', 'image/x-icon',
].join(',')

const SIZE_PRESETS = [
  ['800x800', '天猫/淘宝主图 · 800×800'],
  ['1440x1440', '京东新规 / 天猫 · 1440×1440'],
  ['750x1000', '京东长图 · 750×1000'],
  ['800x1200', '天猫长图 · 800×1200'],
  ['900x1200', 'Ozon 鞋服 · 900×1200'],
  ['1080x1080', 'Shopee 主图 · 1080×1080'],
  ['1340x1785', 'SHEIN · 1340×1785'],
  ['1600x1600', 'TikTok / Amazon / eBay · 1600×1600'],
  ['2000x2000', 'Amazon 高清 · 2000×2000'],
  ['1080x1440', '竖版 · 1080×1440'],
  ['1920x1080', '横版 · 1920×1080'],
] as const

function LabeledSelect({ label, value, onChange, children, sx }: {
  label: string; value: any; onChange: (event: any) => void; children: ReactNode; sx?: any
}) {
  const id = useId()
  return (
    <FormControl fullWidth size="small" sx={{ mb: 1.5, ...sx }}>
      <InputLabel id={id} shrink>{label}</InputLabel>
      <Select labelId={id} label={label} value={value} onChange={onChange} inputProps={{ 'aria-label': label }}>{children}</Select>
    </FormControl>
  )
}

const TOOL_TABS = [
  { label: '调整', hint: '裁剪、旋转与输出尺寸', icon: Tune },
  { label: '色彩', hint: '滤镜、调色、叠加与去底', icon: Palette },
  { label: '标记', hint: '涂鸦、形状与马赛克', icon: Brush },
  { label: '文字', hint: '文字水印', icon: TextFields },
  { label: '拼图', hint: '多图拼接', icon: GridView },
  { label: '切图', hint: '宫格与按尺寸切分', icon: ContentCut },
  { label: '导出', hint: '格式、压缩与批量导出', icon: Download },
] as const

function ToolSection({ icon, title, defaultOpen = false, children }: {
  icon: ReactNode; title: string; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1, overflow: 'hidden' }}>
      <Box
        component="button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1,
          border: 0, bgcolor: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ display: 'flex', color: open ? 'primary.main' : 'text.secondary' }}>{icon}</Box>
        <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{title}</Typography>
        <ChevronDown sx={{ fontSize: 18, color: 'text.secondary', transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </Box>
      {open ? <Box sx={{ px: 1.25, pb: 1.25 }}>{children}</Box> : null}
    </Box>
  )
}

const imageCache: { assets: ImageAsset[]; selectedId: number } = { assets: [], selectedId: 0 }

export default function ImagesPage() {
  const [assets, setAssets] = useState<ImageAsset[]>(() => imageCache.assets)
  const [selectedId, setSelectedId] = useState(() => (
    imageCache.assets.some((asset) => asset.id === imageCache.selectedId) ? imageCache.selectedId : imageCache.assets[0]?.id || 0
  ))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [lastExport, setLastExport] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [tab, setTab] = useState(0)
  const [markMode, setMarkMode] = useState<'brush' | 'rectangle' | 'mosaic'>('brush')
  const [markColor, setMarkColor] = useState('#ff3b30')
  const [markSize, setMarkSize] = useState(8)
  const [sliceMode, setSliceMode] = useState<'grid' | 'size'>('grid')
  const [sliceRows, setSliceRows] = useState(2)
  const [sliceCols, setSliceCols] = useState(2)
  const [sliceWidth, setSliceWidth] = useState(800)
  const [sliceHeight, setSliceHeight] = useState(800)
  const [showOriginal, setShowOriginal] = useState(false)
  const [cropRatio, setCropRatio] = useState('free')
  const [sizePreset, setSizePreset] = useState('original')
  const [lockAspect, setLockAspect] = useState(false)
  const [exportOptions, setExportOptions] = useState<ExportOptions>({ format: 'image/png', quality: 0.85, targetKB: 0 })
  const [namePrefix, setNamePrefix] = useState('')
  const [collage, setCollage] = useState<CollageOptions>({ columns: 2, tileWidth: 800, tileHeight: 800, gap: 16, background: '#ffffff', fit: 'contain' })
  const [tick, setTick] = useState(0)
  const [previewArea, setPreviewArea] = useState({ width: 0, height: 0 })
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ points: Point[] } | null>(null)
  const nextId = useRef(Math.max(0, ...imageCache.assets.map((asset) => asset.id)) + 1)
  const disposed = useRef(false)

  const active = assets.find((asset) => asset.id === selectedId)
  const options = active?.options || defaults()
  const checked = assets.filter((asset) => asset.checked)
  const geometry = active ? orientedSize(active.image, options) : { width: 1, height: 1 }
  const displayedSize = active ? (showOriginal ? { width: active.image.naturalWidth, height: active.image.naturalHeight } : outputSize(active.image, options)) : { width: 0, height: 0 }
  const canUndo = Boolean(active && (active.historyIndex > 0 || JSON.stringify(active.options) !== active.history[active.historyIndex]))
  const canRedo = Boolean(active && active.historyIndex < active.history.length - 1)

  const rerender = () => setTick((value) => value + 1)

  const commitAsset = (asset: ImageAsset) => {
    const initial = defaults() as any
    const values = asset.options as any
    for (const [key, value] of Object.entries(initial)) if (typeof value === 'number' && typeof values[key] !== 'number') values[key] = value
    const value = JSON.stringify(asset.options)
    if (asset.history[asset.historyIndex] === value) return
    asset.history.splice(asset.historyIndex + 1)
    asset.history.push(value)
    if (asset.history.length > 30) asset.history.shift()
    asset.historyIndex = asset.history.length - 1
  }

  const commit = () => { if (active) { commitAsset(active); setLastExport(''); rerender() } }

  const addFiles = useCallback(async (files: File[]) => {
    if (busy) return
    setBusy(true); setProgress('正在读取图片…')
    const failures: string[] = []
    const added: ImageAsset[] = []
    try {
      let current = assets
      for (const file of files) {
        if (!file.type.startsWith('image/') && !/\.(png|apng|jpe?g|jpe|jfif|webp|gif|bmp|svg|avif|ico)$/i.test(file.name)) { failures.push(`${file.name}：不是支持的图片`); continue }
        if (current.length + added.length >= 30) { failures.push('最多添加 30 张图片'); break }
        if (file.size > 20 * 1024 * 1024 || [...current, ...added].reduce((sum, asset) => sum + asset.file.size, 0) + file.size > 100 * 1024 * 1024) { failures.push(`${file.name}：超出文件大小限制`); continue }
        const url = URL.createObjectURL(file)
        const image = new Image()
        try {
          image.src = url
          await image.decode()
          if (disposed.current) { URL.revokeObjectURL(url); return }
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片为空或超过 4000 万像素')
          const initial = defaults()
          added.push({ id: nextId.current++, name: file.name || `截图-${nextId.current}.png`, file, image, url, options: initial, checked: true, history: [JSON.stringify(initial)], historyIndex: 0 })
        } catch (error) {
          URL.revokeObjectURL(url)
          failures.push(`${file.name}：${error instanceof Error && error.name !== 'EncodingError' ? error.message : '浏览器无法读取此格式，请先转为 WebP、PNG 或 JPEG'}`)
        }
      }
      if (added.length) {
        setAssets((prev) => [...prev, ...added])
        setSelectedId((prev) => prev || added[0].id)
      }
      if (failures.length) toast.warning(failures.slice(0, 3).join('；'))
    } finally { setBusy(false); setProgress('') }
  }, [busy, assets])

  useEffect(() => {
    imageCache.assets = assets
    imageCache.selectedId = selectedId
  }, [assets, selectedId])

  useEffect(() => {
    disposed.current = false
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (files.length) { event.preventDefault(); void addFiles(files) }
    }
    window.addEventListener('paste', paste)
    return () => { disposed.current = true; window.removeEventListener('paste', paste) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!active || !canvasRef.current) return
    try {
      const settings = showOriginal ? defaults() : options
      const rendered = renderImage(active.image, settings, 1400)
      const canvas = canvasRef.current
      canvas.width = rendered.width; canvas.height = rendered.height
      canvas.getContext('2d')?.drawImage(rendered, 0, 0)
      setCanvasSize({ width: rendered.width, height: rendered.height })
      rendered.width = rendered.height = 1
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '预览失败')
    }
  }, [active, options, showOriginal, tick])

  useEffect(() => {
    const element = previewRef.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      setPreviewArea({
        width: Math.max(0, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
        height: Math.max(0, element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)),
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [assets.length])

  const previewScale = canvasSize.width && previewArea.width
    ? Math.min(1, previewArea.width / canvasSize.width, previewArea.height / canvasSize.height)
    : 1
  const previewDisplay = {
    width: Math.max(1, Math.round(canvasSize.width * previewScale)),
    height: Math.max(1, Math.round(canvasSize.height * previewScale)),
  }

  const selectAsset = (id: number) => { commit(); setSelectedId(id); setShowOriginal(false); setSizePreset('original'); setCropRatio('free') }

  const removeAsset = (id: number) => {
    const index = assets.findIndex((asset) => asset.id === id)
    if (index < 0) return
    const asset = assets[index]
    URL.revokeObjectURL(asset.url); asset.image.src = ''
    const next = assets.filter((item) => item.id !== id)
    if (selectedId === id) {
      setSelectedId(next[Math.min(index, next.length - 1)]?.id || 0)
      setShowOriginal(false); setSizePreset('original'); setCropRatio('free'); clearOverlay(); setLastExport('')
    }
    setAssets(next)
  }

  const moveAsset = (index: number, delta: number) => {
    setAssets((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const clearAll = () => {
    assets.forEach((asset) => { URL.revokeObjectURL(asset.url); asset.image.src = '' })
    setAssets([]); setSelectedId(0); setLastExport('')
    setShowOriginal(false); setSizePreset('original'); setCropRatio('free'); clearOverlay()
  }

  const rotate = (delta: number) => {
    if (!active) return
    const normalized = ((options.rotation + delta) % 360 + 360) % 360
    options.rotation = normalized > 180 ? normalized - 360 : normalized
    options.crop = { x: 0, y: 0, w: 1, h: 1 }
    options.width = options.height = 0
    setSizePreset('')
    setCropRatio('free')
    commit()
  }

  const flip = (key: 'flipX' | 'flipY') => { if (!active) return; options[key] = !options[key]; commit() }

  const resizeDimension = (key: 'width' | 'height', value: number) => {
    if (!active || !value) return
    const next = Math.max(1, Math.min(20000, Math.round(value)))
    options[key] = next
    if (lockAspect) {
      const cw = Math.max(1, geometry.width * options.crop.w)
      const ch = Math.max(1, geometry.height * options.crop.h)
      options[key === 'width' ? 'height' : 'width'] = Math.max(1, Math.round(key === 'width' ? next * ch / cw : next * cw / ch))
    }
    setSizePreset('')
    commit()
  }

  const applySizePreset = (value: string) => {
    setSizePreset(value)
    if (!active) return
    if (value === 'original') options.width = options.height = 0
    else { const [width, height] = value.split('x').map(Number); options.width = width; options.height = height; options.fit = 'contain' }
    commit()
  }

  const undo = () => {
    if (!active) return
    commit()
    if (active.historyIndex > 0) { active.options = JSON.parse(active.history[--active.historyIndex]); setSizePreset(''); setCropRatio('free'); rerender() }
  }
  const redo = () => {
    if (!active || !canRedo) return
    active.options = JSON.parse(active.history[++active.historyIndex]); setSizePreset(''); setCropRatio('free'); rerender()
  }
  const resetCurrent = () => { if (!active) return; active.options = defaults(); setSizePreset('original'); setCropRatio('free'); clearOverlay(); setLastExport(''); commit() }

  const overlayPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    }
  }

  const clearOverlay = () => {
    const layer = overlayRef.current
    if (layer) layer.getContext('2d')?.clearRect(0, 0, layer.width, layer.height)
  }

  const paintOverlay = (points: Point[]) => {
    const layer = overlayRef.current
    if (!layer || !points.length) return
    const rect = layer.getBoundingClientRect()
    if (layer.width !== Math.round(rect.width) || layer.height !== Math.round(rect.height)) {
      layer.width = Math.round(rect.width); layer.height = Math.round(rect.height)
    }
    const ctx = layer.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, layer.width, layer.height)
    const px = points.map((point) => ({ x: point.x * layer.width, y: point.y * layer.height }))
    const outputWidth = active ? outputSize(active.image, options).width : 1
    const visualSize = Math.max(1, markSize * rect.width / Math.max(1, outputWidth))
    ctx.save(); ctx.strokeStyle = markColor; ctx.fillStyle = markColor; ctx.lineWidth = visualSize
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (markMode === 'brush') {
      ctx.beginPath(); ctx.moveTo(px[0].x, px[0].y)
      for (const point of px) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    } else {
      const a = px[0], b = px[px.length - 1]
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
      if (markMode === 'rectangle') {
        ctx.strokeRect(x, y, w, h)
      } else {
        ctx.fillStyle = 'rgba(100,100,100,.35)'; ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = '#ffffff'; ctx.setLineDash([4, 3]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([])
      }
    }
    ctx.restore()
  }

  const startMark = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || tab !== 2) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = overlayPoint(event)
    drawing.current = { points: [point] }
    paintOverlay([point, point])
  }

  const moveMark = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const point = overlayPoint(event)
    if (markMode === 'brush') drawing.current.points.push(point)
    else drawing.current.points[1] = point
    paintOverlay(drawing.current.points)
  }

  const finishMark = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !active) return
    const points = drawing.current.points
    drawing.current = null
    clearOverlay()
    if (markMode !== 'brush') {
      const area = Math.abs((points[1]?.x || 0) - points[0].x) * Math.abs((points[1]?.y || 0) - points[0].y)
      if (area < 0.0005) return
    }
    options.marks = [...(options.marks || []), { kind: markMode, points, color: markColor, size: markSize }]
    commit()
  }

  const undoMark = () => {
    if (!active || !options.marks?.length) return
    options.marks = options.marks.slice(0, -1)
    clearOverlay(); commit()
  }

  const clearMarks = () => {
    if (!active || !options.marks?.length) return
    options.marks = []; clearOverlay(); commit()
  }

  const upscale = (factor: number) => {
    if (!active) return
    const baseWidth = Math.max(1, Math.round(geometry.width * options.crop.w))
    const baseHeight = Math.max(1, Math.round(geometry.height * options.crop.h))
    const width = Math.round(baseWidth * factor)
    const height = Math.round(baseHeight * factor)
    try { validateSize(width + options.padding * 2, height + options.padding * 2) }
    catch (error) { toast.warning(error instanceof Error ? error.message : '放大后的尺寸过大'); return }
    options.width = width
    options.height = height
    options.fit = 'contain'
    setSizePreset('')
    commit()
  }

  const exportCollage = async () => {
    const source = checked.length ? checked : assets
    if (!source.length) return
    await runExport(async () => {
      setProgress('正在生成拼图…')
      const result = renderCollage(source, collage)
      try {
        const encoded = await encodeImage(result, { ...exportOptions, targetKB: 0 }, collage.background)
        download(encoded.blob, `collage-${Date.now()}.${extension(exportOptions.format)}`)
        toast.success('拼图已导出')
      } finally { result.width = result.height = 1 }
    })
  }

  const exportSlices = async () => {
    if (!active) return
    const sourceAssets = active
    await runExport(async () => {
      setProgress('正在生成切图…')
      const source = renderImage(sourceAssets.image, sourceAssets.options)
      const tiles: { name: string; blob: Blob }[] = []
      const baseName = safeName(sourceAssets.name)
      const pushTile = async (canvas: HTMLCanvasElement, label: string) => {
        try {
          const encoded = await encodeImage(canvas, { ...exportOptions, targetKB: 0 }, sourceAssets.options.background)
          tiles.push({ name: `${baseName}-${label}.${extension(exportOptions.format)}`, blob: encoded.blob })
        } finally { canvas.width = canvas.height = 1 }
      }
      if (sliceMode === 'grid') {
        const rows = Math.max(1, Math.min(20, sliceRows)), cols = Math.max(1, Math.min(20, sliceCols))
        const tileW = Math.max(1, Math.floor(source.width / cols)), tileH = Math.max(1, Math.floor(source.height / rows))
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const tile = document.createElement('canvas')
            tile.width = tileW; tile.height = tileH
            tile.getContext('2d')?.drawImage(source, col * tileW, row * tileH, tileW, tileH, 0, 0, tileW, tileH)
            await pushTile(tile, `r${row + 1}c${col + 1}`)
          }
        }
      } else {
        const width = Math.max(16, Math.min(4000, sliceWidth)), height = Math.max(16, Math.min(4000, sliceHeight))
        let index = 0
        for (let y = 0; y < source.height; y += height) {
          for (let x = 0; x < source.width; x += width) {
            const w = Math.min(width, source.width - x), h = Math.min(height, source.height - y)
            const tile = document.createElement('canvas')
            tile.width = w; tile.height = h
            tile.getContext('2d')?.drawImage(source, x, y, w, h, 0, 0, w, h)
            await pushTile(tile, String(++index).padStart(2, '0'))
            if (tiles.length >= 200) throw new Error('切图数量超过 200 张，请增大切片尺寸或减少行列数')
          }
        }
      }
      const zip = await zipImages(tiles)
      download(zip, `${baseName}-slices-${Date.now()}.zip`)
      toast.success(`已导出 ${tiles.length} 张切图`)
      source.width = source.height = 1
    })
  }

  useEffect(() => { if (tab !== 2) clearOverlay() }, [tab, selectedId])

  const fileName = (asset: ImageAsset, index?: number) => {
    const prefix = namePrefix.trim() ? safeName(namePrefix.trim() + '.x') + '-' : ''
    return `${prefix}${index === undefined ? '' : String(index + 1).padStart(2, '0') + '-'}${safeName(asset.name)}-edited.${extension(exportOptions.format)}`
  }

  const runExport = async (job: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await job() }
    catch (error) { toast.error(error instanceof Error ? error.message : '图片处理失败，请重试。') }
    finally { setBusy(false); setProgress('') }
  }

  const exportCurrent = async () => {
    if (!active) return
    const settings = clone(active.options)
    const encoding = clone(exportOptions)
    const name = fileName(active)
    await runExport(async () => {
      setProgress('正在生成图片…')
      const canvas = renderImage(active.image, settings)
      try {
        const result = await encodeImage(canvas, encoding, settings.background)
        download(result.blob, name)
        setLastExport(`已导出 ${name} · ${result.width} × ${result.height} · ${bytes(result.blob.size)}${result.withinTarget ? '' : '（未达到目标体积，可继续缩小尺寸）'}`)
        toast.success('图片已导出')
      } finally { canvas.width = canvas.height = 1 }
    })
  }

  const applyToSelected = async () => {
    if (!active) return
    const targets = checked.filter((asset) => asset.id !== active.id)
    if (!targets.length) {
      toast.warning('请至少再勾选一张图片')
      return
    }
    const ok = await confirmDialog({
      title: '批量修改',
      confirmText: '应用',
      message: `把当前图片的调色、尺寸、画布和水印设置应用到已选 ${targets.length} 张图片？会覆盖它们已有的同类设置，裁剪和标注保留各自内容。`,
    })
    if (!ok) return
    const shared: Partial<ImageOptions> = clone(active.options)
    delete shared.crop
    delete shared.marks
    const targetIds = new Set(targets.map((asset) => asset.id))
    setAssets((prev) => prev.map((asset) => {
      if (!targetIds.has(asset.id)) return asset
      const next = { ...asset.options, ...shared }
      const history = asset.history.slice(0, asset.historyIndex + 1)
      const value = JSON.stringify(next)
      if (history[history.length - 1] !== value) {
        history.push(value)
        if (history.length > 30) history.shift()
      }
      return { ...asset, options: next, history, historyIndex: history.length - 1 }
    }))
    setLastExport('')
    toast.success(`已应用到 ${targets.length} 张图片`)
  }

  const exportBatch = async () => {
    if (!checked.length) return
    const queue = checked.map((asset, index) => ({ image: asset.image, options: clone(asset.options), name: fileName(asset, index) }))
    const encoding = clone(exportOptions)
    await runExport(async () => {
      const files: { name: string; blob: Blob }[] = []
      let oversized = 0
      for (const [index, asset] of queue.entries()) {
        setProgress(`正在处理 ${index + 1} / ${queue.length}`)
        await new Promise((resolve) => setTimeout(resolve, 0))
        const canvas = renderImage(asset.image, asset.options)
        try {
          const result = await encodeImage(canvas, encoding, asset.options.background)
          files.push({ name: asset.name, blob: result.blob })
          if (!result.withinTarget) oversized++
        } finally { canvas.width = canvas.height = 1 }
      }
      setProgress('正在打包 ZIP…')
      const zip = await zipImages(files)
      download(zip, `images-${Date.now()}.zip`)
      setLastExport(`已打包 ${files.length} 张图片 · ${bytes(zip.size)}${oversized ? ` · ${oversized} 张未达到目标体积` : ''}`)
    })
  }

  if (!assets.length) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2, gap: 1.5 }}>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => fileInput.current?.click()}>添加图片</Button>
          <input ref={fileInput} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files) }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', alignSelf: 'center' }}>本地处理 · 图片不上传</Typography>
        </Stack>
        <Box
          onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => { event.preventDefault(); setDragOver(false); void addFiles(Array.from(event.dataTransfer.files || [])) }}
          onClick={() => fileInput.current?.click()}
          sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, border: '1px dashed', borderColor: dragOver ? 'primary.main' : 'divider', borderRadius: 1.5, cursor: 'pointer', textAlign: 'center', p: 3 }}
        >
          <Picture sx={{ fontSize: 52, color: 'text.secondary' }} />
          <Typography sx={{ fontSize: 23, fontWeight: 500 }}>拖入图片开始处理</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>选择文件，或按 Ctrl / Command + V 粘贴</Typography>
          <Button size="small" variant="contained">选择图片</Button>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.9 }}>JPG / PNG / WebP / GIF / BMP / SVG / AVIF / ICO · 单次最多 30 张、100 MB<br />素材暂存在当前标签页，切换页面保留，刷新后清空</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', p: 1.5, gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
        <input ref={fileInput} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void addFiles(files) }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} disabled={busy} onClick={() => fileInput.current?.click()}>添加图片</Button>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}><Picture sx={{ fontSize: 14, verticalAlign: -2, mr: 0.5 }} />本地处理 · 图片不上传</Typography>
        </Stack>
        <div className="spacer" />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" disabled={!active || busy || !canUndo} onClick={undo}>撤销</Button>
          <Button size="small" disabled={!active || busy || !canRedo} onClick={redo}>重做</Button>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" disabled={!active || busy} onClick={resetCurrent}>重置当前图片</Button>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Button size="small" variant="contained" startIcon={<Download fontSize="small" />} disabled={!active || busy} onClick={() => void exportCurrent()}>导出当前图片</Button>
      </Stack>

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, flex: 1, minHeight: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Box sx={{
          width: { xs: '100%', md: 176, lg: 200 }, flexShrink: 0, order: { xs: 2, md: 0 },
          display: 'flex', flexDirection: 'column', minHeight: { xs: 150, md: 0 }, maxHeight: { xs: 190, md: 'none' },
          borderRight: { md: (theme) => `1px solid ${theme.palette.divider}` }, borderTop: { xs: (theme) => `1px solid ${theme.palette.divider}`, md: 0 }, borderColor: 'divider', bgcolor: 'background.paper',
        }}>
          <Stack direction="row" alignItems="center" sx={{ px: 0.75, py: 0.5, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Checkbox
              size="small" checked={assets.length > 0 && checked.length === assets.length}
              indeterminate={checked.length > 0 && checked.length < assets.length}
              onChange={(event) => setAssets((prev) => prev.map((asset) => ({ ...asset, checked: event.target.checked })))}
              inputProps={{ 'aria-label': '全选图片' }}
              sx={{ p: 0.5 }}
            />
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>图片队列</Typography>
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{assets.length} / 30</Typography>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 0.75, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {assets.map((asset, index) => (
              <Box
                key={asset.id}
                sx={{
                  border: 1, borderRadius: 1, p: 0.5,
                  borderColor: asset.id === selectedId ? 'primary.main' : 'divider',
                  bgcolor: asset.id === selectedId ? 'action.selected' : 'transparent',
                }}
              >
                <Box component="button" onClick={() => selectAsset(asset.id)} sx={{ display: 'block', width: '100%', border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0, textAlign: 'left' }}>
                  <Box component="img" src={asset.url} alt="" sx={{ width: '100%', height: 64, objectFit: 'contain', bgcolor: 'action.hover', borderRadius: 0.5 }} />
                  <Typography sx={{ fontSize: 10.5, mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</Typography>
                </Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Checkbox
                    size="small" sx={{ p: 0.25 }} checked={asset.checked}
                    onChange={(event) => setAssets((prev) => prev.map((item) => item.id === asset.id ? { ...item, checked: event.target.checked } : item))}
                    inputProps={{ 'aria-label': `选择 ${asset.name}` }}
                  />
                  <Stack direction="row" spacing={0}>
                    <IconButton size="small" aria-label="上移" disabled={index === 0} onClick={() => moveAsset(index, -1)}><ArrowUp sx={{ fontSize: 13 }} /></IconButton>
                    <IconButton size="small" aria-label="下移" disabled={index === assets.length - 1} onClick={() => moveAsset(index, 1)}><ArrowDown sx={{ fontSize: 13 }} /></IconButton>
                    <IconButton size="small" aria-label="删除图片" onClick={() => removeAsset(asset.id)}><Delete sx={{ fontSize: 13 }} /></IconButton>
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Box>
          <Box sx={{ p: 0.75, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Button fullWidth size="small" disabled={busy} onClick={clearAll}>清空素材</Button>
          </Box>
        </Box>

        <Box sx={{ flex: 1, order: { xs: 1, md: 0 }, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: { xs: 260, md: 0 } }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>{active?.name}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{active?.image.naturalWidth} × {active?.image.naturalHeight} · {active ? bytes(active.file.size) : ''}</Typography>
            </Box>
            <div className="spacer" />
            <Checkbox size="small" checked={showOriginal} onChange={(event) => setShowOriginal(event.target.checked)} disabled={busy} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>查看原图</Typography>
          </Stack>
          <Box ref={previewRef} sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: (theme) => theme.palette.mode === 'dark' ? '#0B1113' : '#E8EDEA', p: 2 }}>
            <Box sx={{ position: 'relative', display: 'block', flexShrink: 0, lineHeight: 0, width: canvasSize.width ? previewDisplay.width : undefined, height: canvasSize.height ? previewDisplay.height : undefined }}>
              <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', boxShadow: '0 2px 12px #0002', background: 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 20px 20px' }} aria-label="图片处理预览" />
              <canvas
                ref={overlayRef}
                onPointerDown={startMark}
                onPointerMove={moveMark}
                onPointerUp={finishMark}
                onPointerCancel={finishMark}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  pointerEvents: tab === 2 ? 'auto' : 'none', cursor: 'crosshair', touchAction: 'none',
                }}
              />
            </Box>
          </Box>
          <Stack direction="row" justifyContent="space-between" sx={{ px: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{showOriginal ? '原图' : '处理后'} · {displayedSize.width} × {displayedSize.height} px</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', ml: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{busy ? progress : (lastExport || '预览适应窗口')}</Typography>
          </Stack>
        </Box>

        <Box sx={{
          width: { xs: '100%', md: 380, lg: 424 }, flexShrink: 0, order: { xs: 3, md: 0 },
          borderLeft: { md: (theme) => `1px solid ${theme.palette.divider}` }, borderTop: { xs: (theme) => `1px solid ${theme.palette.divider}`, md: 0 }, borderColor: 'divider',
          display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 0, bgcolor: 'background.paper',
        }}>
          <Box
            role="tablist" aria-label="图片编辑分类" aria-orientation="vertical"
            sx={{
              width: { xs: '100%', md: 66 }, flexShrink: 0,
              display: 'flex', flexDirection: { xs: 'row', md: 'column' },
              gap: 0.5, p: 0.75, overflowX: { xs: 'auto', md: 'visible' }, overflowY: { xs: 'visible', md: 'auto' },
              borderRight: { md: (theme) => `1px solid ${theme.palette.divider}` }, borderBottom: { xs: (theme) => `1px solid ${theme.palette.divider}`, md: 0 }, borderColor: 'divider',
              bgcolor: (theme) => theme.palette.mode === 'dark' ? '#11181B' : '#FBFCFB',
            }}
          >
            {TOOL_TABS.map((item, index) => {
              const Icon = item.icon
              const selected = tab === index
              return (
                <Box
                  key={item.label} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(index)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setTab(index) } }}
                  sx={{
                    width: { xs: 62, md: '100%' }, minHeight: 52, py: 0.75, flexShrink: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.35,
                    borderRadius: 1.5, cursor: 'pointer', userSelect: 'none',
                    color: selected ? 'primary.contrastText' : 'text.secondary',
                    bgcolor: selected ? 'primary.main' : 'transparent',
                    '&:hover': { bgcolor: selected ? 'primary.main' : 'action.hover', color: selected ? 'primary.contrastText' : 'text.primary' },
                    '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
                  }}
                >
                  <Icon sx={{ fontSize: 20 }} />
                  <Box component="span" sx={{ fontSize: 10.5, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{item.label}</Box>
                </Box>
              )
            })}
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ px: 1.5, py: 0.9, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{TOOL_TABS[tab].label}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.4 }}>{TOOL_TABS[tab].hint}</Typography>
            </Box>

            <Box sx={{ flex: 1, overflow: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin', p: 1.25 }}>
              {tab === 0 ? (
                <>
                  <ToolSection key="crop" icon={<Crop sx={{ fontSize: 17 }} />} title="裁剪旋转">
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
                      <Button size="small" onClick={() => rotate(-90)}>左转 90°</Button>
                      <Button size="small" onClick={() => rotate(90)}>右转 90°</Button>
                      <Button size="small" onClick={() => flip('flipX')}>水平翻转</Button>
                      <Button size="small" onClick={() => flip('flipY')}>垂直翻转</Button>
                    </Box>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>角度校正：{options.rotation}°</Typography>
                    <input type="range" min={-180} max={180} step={0.5} value={options.rotation} onChange={(event) => { options.rotation = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                    <Button size="small" sx={{ mb: 1 }} onClick={() => { options.rotation = 0; commit() }}>复位角度</Button>
                    <LabeledSelect label="裁剪比例" value={cropRatio} onChange={(event) => {
                      const value = event.target.value
                      setCropRatio(value)
                      setSizePreset('')
                      if (!active || value === 'free') return
                      const ratio = value === 'original' ? geometry.width / geometry.height : value.split(':').map(Number).reduce((a: number, b: number) => a / b)
                      const norm = ratio * geometry.height / geometry.width
                      const w = Math.min(1, norm), h = Math.min(1, 1 / norm)
                      options.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
                      options.width = options.height = 0
                      commit()
                    }}>
                      <MenuItem value="free">自由比例</MenuItem>
                      <MenuItem value="original">原图比例</MenuItem>
                      {['1:1', '4:3', '3:4', '16:9', '9:16'].map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                    </LabeledSelect>
                  </ToolSection>

                  <ToolSection key="resize" icon={<AspectRatio sx={{ fontSize: 17 }} />} title="修改尺寸" defaultOpen>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                      <TextField fullWidth size="small" type="number" label="宽（px）" value={options.width || Math.round(geometry.width * options.crop.w)} onChange={(event) => resizeDimension('width', Number(event.target.value))} />
                      <IconButton
                        size="small" aria-label={lockAspect ? '解锁画布比例' : '锁定画布比例'} title={lockAspect ? '解锁画布比例' : '锁定画布比例'}
                        onClick={() => setLockAspect((value) => !value)}
                        sx={{ border: 1, borderColor: lockAspect ? 'primary.main' : 'divider', borderRadius: 1, color: lockAspect ? 'primary.main' : 'text.secondary', flexShrink: 0 }}
                      >
                        {lockAspect ? <Lock sx={{ fontSize: 16 }} /> : <LockOpen sx={{ fontSize: 16 }} />}
                      </IconButton>
                      <TextField fullWidth size="small" type="number" label="高（px）" value={options.height || Math.round(geometry.height * options.crop.h)} onChange={(event) => resizeDimension('height', Number(event.target.value))} />
                    </Stack>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
                      图片始终等比缩放，只留白或裁边。
                    </Typography>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>常用尺寸</Typography>
                      <Button size="small" sx={{ minWidth: 0, py: 0, fontSize: 11 }} onClick={() => applySizePreset('original')}>恢复原图尺寸</Button>
                    </Stack>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, mb: 1 }}>
                      {SIZE_PRESETS.map(([value, label]) => {
                        const [width, height] = value.split('x')
                        const selected = sizePreset === value
                        return (
                          <Box
                            key={value} component="button" type="button" aria-pressed={selected} onClick={() => applySizePreset(value)}
                            sx={{
                              textAlign: 'left', p: '6px 8px', borderRadius: 1, border: 1, cursor: 'pointer', color: 'inherit',
                              borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : 'transparent',
                              '&:hover': { borderColor: 'primary.main' },
                            }}
                          >
                            <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.3 }}>{label.split(' · ')[0]}</Typography>
                            <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>{width} × {height}</Typography>
                          </Box>
                        )
                      })}
                    </Box>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>修改方式</Typography>
                    <ToggleButtonGroup
                      fullWidth size="small" exclusive value={options.fit === 'cover' ? 'cover' : 'contain'}
                      onChange={(_, value) => { if (!value) return; options.fit = value; commit() }} sx={{ mb: 0.5 }}
                    >
                      <ToggleButton value="contain">留白</ToggleButton>
                      <ToggleButton value="cover">裁边</ToggleButton>
                    </ToggleButtonGroup>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>留白或裁边，不拉伸。</Typography>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>高质量放大</Typography>
                      <Stack direction="row" spacing={0.5}>
                        {[2, 3, 4].map((factor) => <Button key={factor} size="small" sx={{ minWidth: 0, px: 1 }} onClick={() => upscale(factor)}>{factor}×</Button>)}
                      </Stack>
                    </Stack>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>非 AI 超分。</Typography>
                  </ToolSection>

                  <ToolSection key="canvas" icon={<RoundedCorner sx={{ fontSize: 17 }} />} title="画布与圆角">
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Checkbox size="small" checked={options.transparent} onChange={(event) => { options.transparent = event.target.checked; commit() }} />
                      <Typography sx={{ fontSize: 12 }}>透明背景</Typography>
                      {!options.transparent ? <input type="color" value={options.background} onChange={(event) => { options.background = event.target.value; commit() }} /> : null}
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField fullWidth size="small" type="number" label="四周留白（px）" value={options.padding} onChange={(event) => { options.padding = Math.max(0, Math.min(500, Number(event.target.value) || 0)); commit() }} />
                      <TextField fullWidth size="small" type="number" label="圆角（px）" value={options.radius} onChange={(event) => { options.radius = Math.max(0, Number(event.target.value) || 0); commit() }} />
                    </Stack>
                  </ToolSection>
                </>
              ) : tab === 1 ? (
                <>
                  <ToolSection key="filters" icon={<Palette sx={{ fontSize: 17 }} />} title="滤镜与调色" defaultOpen>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
                      {['还原', '黑白', '复古', '鲜艳', '柔和', '冷色', '暖色', '电影', '胶片'].map((preset) => (
                        <Button key={preset} size="small" sx={{ minWidth: 0, px: 1 }} onClick={() => {
                          Object.assign(options, { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, hue: 0, overlayColor: '#ffffff', overlayOpacity: 0 })
                          if (preset === '黑白') options.grayscale = 100
                          if (preset === '复古') { options.sepia = 70; options.contrast = 90; options.saturation = 85 }
                          if (preset === '鲜艳') { options.saturation = 135; options.contrast = 110 }
                          if (preset === '柔和') { options.contrast = 85; options.brightness = 108; options.saturation = 85 }
                          if (preset === '冷色') { options.overlayColor = '#3b6ea8'; options.overlayOpacity = 10; options.saturation = 105 }
                          if (preset === '暖色') { options.overlayColor = '#d18b3f'; options.overlayOpacity = 10; options.brightness = 104 }
                          if (preset === '电影') { options.contrast = 115; options.saturation = 85; options.overlayColor = '#14243f'; options.overlayOpacity = 10 }
                          if (preset === '胶片') { options.sepia = 30; options.contrast = 105; options.brightness = 105; options.overlayColor = '#f2d7a0'; options.overlayOpacity = 6 }
                          commit()
                        }}>{preset}</Button>
                      ))}
                    </Stack>
                    {([
                      ['brightness', '亮度', 0, 200], ['contrast', '对比度', 0, 200], ['saturation', '饱和度', 0, 200],
                      ['hue', '色相', -180, 180], ['grayscale', '黑白', 0, 100], ['sepia', '复古', 0, 100], ['blur', '模糊', 0, 30],
                    ] as const).map(([key, label, min, max]) => (
                      <Box key={key} sx={{ mb: 1.25 }}>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}：{options[key]}{key === 'blur' ? ' px' : key === 'hue' ? '°' : '%'}</Typography>
                        <input type="range" min={min} max={max} step={key === 'blur' ? 0.5 : 1} value={options[key]} onChange={(event) => { options[key] = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                      </Box>
                    ))}
                  </ToolSection>

                  <ToolSection key="overlay" icon={<Tune sx={{ fontSize: 17 }} />} title="颜色叠加">
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <input type="color" value={options.overlayColor} onChange={(event) => { options.overlayColor = event.target.value; commit() }} style={{ width: 40, height: 32, padding: 2, border: '1px solid rgba(0,0,0,0.23)' }} />
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>叠加颜色</Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>叠加强度：{options.overlayOpacity}%</Typography>
                    <input type="range" min={0} max={100} value={options.overlayOpacity} onChange={(event) => { options.overlayOpacity = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                  </ToolSection>

                  <ToolSection key="cutout" icon={<WaterDrop sx={{ fontSize: 17 }} />} title="纯色去底">
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Checkbox size="small" checked={options.cutout} onChange={(event) => { options.cutout = event.target.checked; commit() }} /><Typography sx={{ fontSize: 12 }}>启用纯色去底</Typography>
                    </Stack>
                    {options.cutout ? (
                      <>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>移除颜色</Typography>
                          <input type="color" value={options.cutoutColor} onChange={(event) => { options.cutoutColor = event.target.value; commit() }} />
                        </Stack>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>颜色容差：{options.tolerance}</Typography>
                        <input type="range" min={0} max={300} value={options.tolerance} onChange={(event) => { options.tolerance = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>边缘柔化：{options.feather}</Typography>
                        <input type="range" min={0} max={100} value={options.feather} onChange={(event) => { options.feather = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                      </>
                    ) : null}
                  </ToolSection>
                </>
              ) : tab === 2 ? (
                <ToolSection key="mark" icon={<Brush sx={{ fontSize: 17 }} />} title="涂鸦 / 形状 / 马赛克" defaultOpen>
                  <ToggleButtonGroup size="small" exclusive value={markMode} onChange={(_, value) => value && setMarkMode(value)} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
                    <ToggleButton value="brush">涂鸦</ToggleButton>
                    <ToggleButton value="rectangle">矩形</ToggleButton>
                    <ToggleButton value="mosaic">马赛克</ToggleButton>
                  </ToggleButtonGroup>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <input type="color" value={markColor} onChange={(event) => setMarkColor(event.target.value)} style={{ width: 40, height: 32, padding: 2, border: '1px solid rgba(0,0,0,0.23)' }} />
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{markMode === 'mosaic' ? '马赛克块大小' : '笔刷大小'}：{markSize}</Typography>
                  </Stack>
                  <input type="range" min={2} max={40} value={markSize} onChange={(event) => setMarkSize(Number(event.target.value))} style={{ width: '100%' }} />
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.8, mt: 1 }}>
                    在图片上拖动绘制；马赛克在导出时生效。
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <Button size="small" disabled={!options.marks?.length} onClick={undoMark}>撤销最后一笔</Button>
                    <Button size="small" color="error" disabled={!options.marks?.length} onClick={clearMarks}>清空标注</Button>
                  </Stack>
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 1 }}>当前标注：{options.marks?.length || 0} 个</Typography>
                </ToolSection>
              ) : tab === 3 ? (
                <ToolSection key="text" icon={<TextFields sx={{ fontSize: 17 }} />} title="文字水印" defaultOpen>
                  <TextField fullWidth size="small" label="水印文字" value={options.watermark} placeholder="输入店铺名或水印文字" inputProps={{ maxLength: 100 }} onChange={(event) => { options.watermark = event.target.value; commit() }} sx={{ mb: 1.5 }} />
                  <LabeledSelect label="水印位置" value={options.watermarkPosition} onChange={(event) => { options.watermarkPosition = event.target.value; commit() }}>
                    {[['bottom-right', '右下角'], ['bottom-left', '左下角'], ['top-right', '右上角'], ['top-left', '左上角'], ['center', '居中'], ['repeat', '全图平铺']].map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </LabeledSelect>
                  <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                    <TextField fullWidth size="small" type="number" label="字号（px）" value={options.watermarkSize} onChange={(event) => { options.watermarkSize = Math.max(8, Math.min(500, Number(event.target.value) || 8)); commit() }} />
                    <input type="color" value={options.watermarkColor} onChange={(event) => { options.watermarkColor = event.target.value; commit() }} style={{ width: 40, height: 40, padding: 2, border: '1px solid rgba(0,0,0,0.23)' }} />
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>不透明度：{options.watermarkOpacity}%</Typography>
                  <input type="range" min={1} max={100} value={options.watermarkOpacity} onChange={(event) => { options.watermarkOpacity = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>平铺角度：{options.watermarkAngle}°</Typography>
                  <input type="range" min={-90} max={90} value={options.watermarkAngle} onChange={(event) => { options.watermarkAngle = Number(event.target.value); rerender() }} onMouseUp={commit} style={{ width: '100%' }} />
                </ToolSection>
              ) : tab === 4 ? (
                <ToolSection key="collage" icon={<GridView sx={{ fontSize: 17 }} />} title="拼图设置" defaultOpen>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
                    使用勾选图片；未勾选则使用全部 {assets.length} 张。
                  </Typography>
                  <LabeledSelect label="列数" value={collage.columns} onChange={(event) => setCollage({ ...collage, columns: Number(event.target.value) })}>
                    {[1, 2, 3, 4, 5, 6].map((value) => <MenuItem key={value} value={value}>{value} 列</MenuItem>)}
                  </LabeledSelect>
                  <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                    <TextField fullWidth size="small" type="number" label="单格宽（px）" value={collage.tileWidth} onChange={(event) => setCollage({ ...collage, tileWidth: Math.max(16, Number(event.target.value) || 16) })} />
                    <TextField fullWidth size="small" type="number" label="单格高（px）" value={collage.tileHeight} onChange={(event) => setCollage({ ...collage, tileHeight: Math.max(16, Number(event.target.value) || 16) })} />
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                    <TextField fullWidth size="small" type="number" label="间距（px）" value={collage.gap} onChange={(event) => setCollage({ ...collage, gap: Math.max(0, Number(event.target.value) || 0) })} />
                    <input type="color" value={collage.background} onChange={(event) => setCollage({ ...collage, background: event.target.value })} style={{ width: 44, height: 40, padding: 2, border: '1px solid rgba(0,0,0,0.23)' }} />
                  </Stack>
                  <LabeledSelect label="填充方式" value={collage.fit} onChange={(event) => setCollage({ ...collage, fit: event.target.value as any })}>
                    <MenuItem value="contain">完整放入（留白）</MenuItem>
                    <MenuItem value="cover">铺满格子（裁边）</MenuItem>
                  </LabeledSelect>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1.5 }}>
                    预计画布：{collageSize(checked.length || assets.length, collage).width} × {collageSize(checked.length || assets.length, collage).height} px
                  </Typography>
                  <Button fullWidth size="small" variant="contained" onClick={() => void exportCollage()}>生成拼图并下载</Button>
                </ToolSection>
              ) : tab === 5 ? (
                <ToolSection key="slice" icon={<ContentCut sx={{ fontSize: 17 }} />} title="宫格切图" defaultOpen>
                  <ToggleButtonGroup size="small" exclusive value={sliceMode} onChange={(_, value) => value && setSliceMode(value)} sx={{ mb: 1.5 }}>
                    <ToggleButton value="grid">按宫格</ToggleButton>
                    <ToggleButton value="size">按尺寸</ToggleButton>
                  </ToggleButtonGroup>
                  {sliceMode === 'grid' ? (
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                      <TextField fullWidth size="small" type="number" label="行数" value={sliceRows} inputProps={{ min: 1, max: 20 }} onChange={(event) => setSliceRows(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
                      <TextField fullWidth size="small" type="number" label="列数" value={sliceCols} inputProps={{ min: 1, max: 20 }} onChange={(event) => setSliceCols(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                      <TextField fullWidth size="small" type="number" label="切片宽（px）" value={sliceWidth} onChange={(event) => setSliceWidth(Math.max(16, Number(event.target.value) || 16))} />
                      <TextField fullWidth size="small" type="number" label="切片高（px）" value={sliceHeight} onChange={(event) => setSliceHeight(Math.max(16, Number(event.target.value) || 16))} />
                    </Stack>
                  )}
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1.5 }}>
                    按当前处理结果切分，使用「导出」的格式设置。
                  </Typography>
                  <Button fullWidth size="small" variant="contained" onClick={() => void exportSlices()}>切图并下载 ZIP</Button>
                </ToolSection>
              ) : (
                <>
                  <ToolSection key="format" icon={<Download sx={{ fontSize: 17 }} />} title="格式与压缩" defaultOpen>
                    <LabeledSelect label="导出格式" value={exportOptions.format} onChange={(event) => setExportOptions({ ...exportOptions, format: event.target.value as any })}>
                      <MenuItem value="image/png">PNG · 无损 / 透明</MenuItem>
                      <MenuItem value="image/jpeg">JPEG · 照片 / 更小体积</MenuItem>
                      <MenuItem value="image/webp">WebP · 压缩 / 透明</MenuItem>
                    </LabeledSelect>
                    {exportOptions.format !== 'image/png' ? (
                      <>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>质量：{Math.round(exportOptions.quality * 100)}%</Typography>
                        <input type="range" min={0.1} max={1} step={0.01} value={exportOptions.quality} onChange={(event) => setExportOptions({ ...exportOptions, quality: Number(event.target.value) })} style={{ width: '100%' }} />
                      </>
                    ) : null}
                    <TextField fullWidth size="small" type="number" label="目标大小（KB，0 表示不限）" value={exportOptions.targetKB} onChange={(event) => setExportOptions({ ...exportOptions, targetKB: Math.max(0, Number(event.target.value) || 0) })} sx={{ my: 1 }} />
                    <Button fullWidth size="small" variant="contained" onClick={() => void exportCurrent()}>导出当前图片</Button>
                  </ToolSection>

                  <ToolSection key="naming" icon={<TextFields sx={{ fontSize: 17 }} />} title="文件命名">
                    <TextField fullWidth size="small" label="文件名前缀" value={namePrefix} placeholder="可选，例如：店铺主图" inputProps={{ maxLength: 40 }} onChange={(event) => setNamePrefix(event.target.value)} />
                  </ToolSection>

                  <ToolSection key="batch" icon={<GridView sx={{ fontSize: 17 }} />} title={`批量处理 · 已选 ${checked.length} 张`}>
                    <Button
                      fullWidth size="small" variant="outlined" onClick={() => void applyToSelected()}
                      disabled={!active || checked.filter((asset) => asset.id !== active.id).length === 0}
                    >
                      把当前调整应用到已选
                    </Button>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.75, mb: 1.25, lineHeight: 1.6 }}>
                      应用调色、尺寸、画布和水印；保留各自裁剪与标注。
                    </Typography>
                    <Button fullWidth size="small" variant="contained" disabled={!checked.length} onClick={() => void exportBatch()}>批量导出 ZIP</Button>
                  </ToolSection>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
