import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, IconButton, Paper, Slider, Stack, Typography,
} from '@mui/material'
import { Lock, LockOpen, Picture, Upload } from '@/icons'
import { copyText } from '@/api/client'
import ColorFormats from '@/components/ColorFormats'
import { EmptyHint, ModuleToolbar, Page, PageBody } from '@/ui/common'
import { toast } from '@/ui/feedback'
import { decodeImageFile } from '@/convert/image'
import { rgbToHsl, toHex, toHslString, toRgbaString, type RGBA } from '@/color/color'

const MAX_PIXELS = 24_000_000
const CHECKER = 'repeating-conic-gradient(#d9dddb 0% 25%, #ffffff 0% 50%) 50% / 16px 16px'

export default function ColorPage() {
  const fileInput = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const magnifierRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [imageName, setImageName] = useState('')
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<RGBA | null>(null)
  const [hoverAt, setHoverAt] = useState<{ x: number; y: number } | null>(null)
  const [locked, setLocked] = useState<RGBA | null>(null)
  const [loading, setLoading] = useState(false)
  const sample = locked || hover
  const hsl = sample ? rgbToHsl(sample) : null

  const drawMagnifier = useCallback((canvas: HTMLCanvasElement | null, x: number, y: number) => {
    if (!canvas) return
    const source = canvasRef.current
    if (!source) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    const size = 15
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, x - Math.floor(size / 2), y - Math.floor(size / 2), size, size, 0, 0, canvas.width, canvas.height)
    context.strokeStyle = '#B3392E'
    context.lineWidth = 1
    const cell = canvas.width / size
    context.strokeRect(Math.floor(size / 2) * cell, Math.floor(size / 2) * cell, cell, cell)
  }, [])

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      toast.warning('请选择图片文件')
      return
    }
    setLoading(true)
    try {
      const decoded = await decodeImageFile(file)
      try {
        if (decoded.width * decoded.height > MAX_PIXELS) throw new Error('图片像素过多（最多 2400 万），请先缩小后再取色')
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = decoded.width
        canvas.height = decoded.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('当前浏览器无法读取图片像素')
        context.clearRect(0, 0, decoded.width, decoded.height)
        context.drawImage(decoded.drawable as CanvasImageSource, 0, 0, decoded.width, decoded.height)
        setImageName(file.name)
        setImageSize({ width: decoded.width, height: decoded.height })
        setHover(null); setLocked(null); setHoverAt(null)
        const available = Math.max(200, (stageRef.current?.clientWidth || 640) - 40)
        setZoom(Math.max(0.1, Math.min(1, available / decoded.width)))
      } finally { decoded.dispose() }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片无法读取，请换一张图片')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || [])
      if (!files.length) return
      event.preventDefault()
      void loadFile(files[0])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  const pointerColor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((event.clientX - rect.left) / rect.width * canvas.width)
    const y = Math.floor((event.clientY - rect.top) / rect.height * canvas.height)
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    const data = context.getImageData(x, y, 1, 1).data
    return { x, y, color: { r: data[0], g: data[1], b: data[2], a: data[3] / 255 } }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (locked) return
    const result = pointerColor(event)
    if (!result) { setHover(null); setHoverAt(null); return }
    setHover(result.color); setHoverAt({ x: result.x, y: result.y })
    drawMagnifier(magnifierRef.current, result.x, result.y)
  }

  const onPointerLeave = () => { if (!locked) { setHover(null); setHoverAt(null) } }

  const onClick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const result = pointerColor(event)
    if (!result) return
    setLocked(result.color)
    setHover(result.color)
    setHoverAt({ x: result.x, y: result.y })
    drawMagnifier(magnifierRef.current, result.x, result.y)
  }

  const copy = async (value: string, label: string) => {
    const ok = await copyText(value)
    if (ok) toast.success(`已复制 ${label}`)
    else toast.warning('浏览器不允许自动复制，请手动选择文本')
  }


  return (
    <Page variant="dense">
      <ModuleToolbar
        info={(
          <>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}><Picture sx={{ fontSize: 14, verticalAlign: -2, mr: 0.5 }} />本地处理 · 图片不上传</Typography>
            <Chip size="small" variant="outlined" label="sRGB · HEX / RGB / HSL / HSV / CMYK" />
          </>
        )}
        primary={<Button size="small" variant="contained" startIcon={<Picture fontSize="small" />} onClick={() => fileInput.current?.click()} disabled={loading}>选择图片</Button>}
      />
      <PageBody>
        <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 430px' }, gridAutoRows: 'max-content', gap: 1.25, alignItems: 'start' }}>
          <input ref={fileInput} type="file" accept="image/*,.heic,.heif" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadFile(file) }} />

          <Paper variant="outlined" sx={{ minWidth: 0, overflow: 'hidden' }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 120 }} noWrap>{imageName || '图片取色'}</Typography>
              {imageSize.width ? <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{imageSize.width} × {imageSize.height}</Typography> : null}
              <IconButton size="small" aria-label="缩小" disabled={!imageSize.width} onClick={() => setZoom((value) => Math.max(0.1, value / 1.25))}><Typography sx={{ fontSize: 16, lineHeight: 1 }}>−</Typography></IconButton>
              <Slider size="small" value={Math.round(zoom * 100)} min={10} max={400} step={5} onChange={(_, value) => setZoom((value as number) / 100)} sx={{ width: 120 }} aria-label="预览缩放" />
              <IconButton size="small" aria-label="放大" disabled={!imageSize.width} onClick={() => setZoom((value) => Math.min(4, value * 1.25))}><Typography sx={{ fontSize: 16, lineHeight: 1 }}>+</Typography></IconButton>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', width: 42, textAlign: 'right' }}>{Math.round(zoom * 100)}%</Typography>
            </Stack>
            <Box
              ref={stageRef}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void loadFile(file) }}
              onClick={() => { if (!imageSize.width) fileInput.current?.click() }}
              sx={{
                minHeight: 360, maxHeight: 'min(62vh, 640px)', overflow: 'auto', p: 2,
                bgcolor: dragging ? 'action.selected' : 'action.hover', cursor: imageSize.width ? 'default' : 'pointer',
                backgroundImage: imageSize.width ? CHECKER : 'none',
              }}
            >
              <Box sx={{ display: imageSize.width ? 'block' : 'none', width: imageSize.width ? imageSize.width * zoom : 0, height: imageSize.height ? imageSize.height * zoom : 0, margin: 'auto' }}>
                <canvas
                  ref={canvasRef}
                  onPointerMove={onPointerMove}
                  onPointerLeave={onPointerLeave}
                  onClick={onClick}
                  style={{ display: 'block', width: '100%', height: '100%', cursor: 'crosshair', imageRendering: zoom >= 2 ? 'pixelated' : 'auto', boxShadow: '0 2px 12px #0002' }}
                  aria-label="取色图片预览"
                />
              </Box>
              <Box sx={{ display: imageSize.width ? 'none' : 'block' }}>
                <EmptyHint action={<Button size="small" variant="contained" startIcon={<Upload fontSize="small" />} onClick={(event) => { event.stopPropagation(); fileInput.current?.click() }}>选择图片</Button>}>
                  拖入图片、点击选择，或按 Ctrl / Command + V 粘贴
                </EmptyHint>
              </Box>
            </Box>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.25, py: 0.75, borderTop: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>鼠标移动查看像素，点击锁定取样</Typography>
              {locked ? <Chip size="small" icon={<Lock sx={{ fontSize: 13 }} />} label="已锁定" variant="outlined" /> : null}
              {locked ? <Button size="small" startIcon={<LockOpen fontSize="small" />} onClick={() => { setLocked(null); setHover(null) }}>解除锁定</Button> : null}
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{hoverAt ? `像素 ${hoverAt.x}, ${hoverAt.y}` : ''}</Typography>
            </Stack>
          </Paper>

          <Stack spacing={1.25} sx={{ minWidth: 0 }}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <canvas ref={magnifierRef} width={96} height={96} aria-label="像素放大预览" style={{ border: '1px solid #B3392E', borderRadius: 4, background: '#fff', imageRendering: 'pixelated' }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  {sample ? (
                    <>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Box sx={{ width: 28, height: 28, borderRadius: 1, border: 1, borderColor: 'divider', background: CHECKER }}>
                          <Box sx={{ width: '100%', height: '100%', bgcolor: toRgbaString(sample) }} />
                        </Box>
                        <Typography data-testid="sample-hex" sx={{ fontSize: 13, fontWeight: 600 }}>{toHex(sample)}</Typography>
                        {sample.a === 0 ? <Chip size="small" color="warning" variant="outlined" label="全透明" /> : null}
                      </Stack>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>{toRgbaString(sample)}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{hsl ? toHslString(sample) : ''} · 透明度 {Math.round(sample.a * 100)}%</Typography>
                    </>
                  ) : <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>在图片上移动查看放大像素；点击后锁定颜色。</Typography>}
                </Box>
              </Stack>
              {sample ? (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                  <Button size="small" onClick={() => void copy(toHex(sample), 'HEX')}>复制 HEX</Button>
                  <Button size="small" onClick={() => void copy(toRgbaString(sample), 'RGB')}>复制 RGB</Button>
                  <Button size="small" onClick={() => void copy(toHslString(sample), 'HSL')}>复制 HSL</Button>
                </Stack>
              ) : null}
              {sample?.a === 0 ? <Alert severity="warning" sx={{ mt: 0.75, py: 0, fontSize: 11.5 }}>这是全透明像素；如需换算颜色格式，请选择有实色的笔画像素。</Alert> : null}
              <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled' }}>提示：抗锯齿边缘可能混合了背景色，取色时请选择笔画实色区域。</Typography>
            </Paper>

            <ColorFormats color={sample} />
          </Stack>
        </Box>
      </PageBody>
    </Page>
  )
}
