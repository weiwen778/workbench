import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, IconButton, Paper, Slider, Stack, TextField, Typography,
} from '@mui/material'
import {
  Check, Close, Lock, LockOpen, Picture, Upload,
} from '@/icons'
import { copyText } from '@/api/client'
import { EmptyHint, Page, PageBody, PageToolbar } from '@/ui/common'
import { toast } from '@/ui/feedback'
import { decodeImageFile } from '@/convert/image'
import {
  compositeOver, contrastReport, parseColor, rgbToHsl, toHex, toHslString, toRgbaString,
  type RGBA,
} from '@/color/color'

const MAX_PIXELS = 24_000_000
const CHECKER = 'repeating-conic-gradient(#d9dddb 0% 25%, #ffffff 0% 50%) 50% / 16px 16px'

function ColorField({ label, color, onChange }: { label: string; color: RGBA; onChange: (color: RGBA) => void }) {
  const [text, setText] = useState(() => toHex(color))
  const [error, setError] = useState(false)
  useEffect(() => { setText(toHex(color)); setError(false) }, [color])
  const commit = () => {
    const parsed = parseColor(text)
    if (!parsed) { setError(true); return }
    setError(false)
    onChange(parsed)
  }
  return (
    <Stack direction="row" spacing={0.75} alignItems="flex-start" flexWrap="wrap" useFlexGap>
      <Box
        component="input" type="color" aria-label={`${label}取色器`} value={toHex({ ...color, a: 1 })}
        onChange={(event) => {
          const parsed = parseColor(event.target.value)
          if (parsed) onChange({ ...parsed, a: color.a })
        }}
        sx={{ width: 34, height: 34, p: 0, mt: 0.5, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }}
      />
      <TextField
        size="small" label={label} value={text} error={error} onChange={(event) => setText(event.target.value)}
        onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
        helperText={error ? '支持 #RRGGBB、rgb()、hsl()' : ''}
        sx={{ width: 156, '& .MuiFormHelperText-root': { mt: 0.25 } }}
      />
      <TextField
        size="small" type="number" label="透明度%" value={Math.round(color.a * 100)}
        inputProps={{ min: 0, max: 100 }} onChange={(event) => onChange({ ...color, a: Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100 })}
        sx={{ width: 92 }}
      />
    </Stack>
  )
}

function ContrastLine({ label, threshold, passed, testId }: { label: string; threshold: string; passed: boolean; testId: string }) {
  return (
    <Stack data-testid={testId} direction="row" alignItems="center" spacing={0.75} sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ flex: 1, fontSize: 12.5 }}>{label}</Box>
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{threshold}</Typography>
      <Stack direction="row" spacing={0.4} alignItems="center" sx={{ color: passed ? 'success.main' : 'error.main', minWidth: 74 }}>
        {passed ? <Check sx={{ fontSize: 15 }} /> : <Close sx={{ fontSize: 15 }} />}
        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{passed ? '通过' : '未通过'}</Typography>
      </Stack>
    </Stack>
  )
}

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
  const [foreground, setForeground] = useState<RGBA>({ r: 26, g: 36, b: 38, a: 1 })
  const [background, setBackground] = useState<RGBA>({ r: 255, g: 255, b: 255, a: 1 })
  const [baseColor, setBaseColor] = useState<RGBA>({ r: 255, g: 255, b: 255, a: 1 })
  const [chineseText, setChineseText] = useState('中文正文预览：清晰的对比度让阅读更轻松。')
  const [englishText, setEnglishText] = useState('English body preview: good contrast keeps text readable.')
  const [headingText, setHeadingText] = useState('大字号标题预览')
  const [buttonText, setButtonText] = useState('按钮文字')
  const sample = locked || hover
  const effectiveBackground = background.a < 1 ? compositeOver(background, { ...baseColor, a: 1 }) : background
  const effectiveForeground = foreground.a < 1 ? compositeOver(foreground, effectiveBackground) : foreground
  const fullyTransparent = foreground.a === 0
  const report = fullyTransparent ? null : contrastReport(effectiveForeground, effectiveBackground)
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

  const setAsForeground = () => {
    if (!sample) return
    if (sample.a === 0) { toast.warning('全透明像素不能直接作为前景色'); return }
    setForeground(sample)
  }
  const setAsBackground = () => {
    if (!sample) return
    if (sample.a === 0) { toast.warning('全透明像素不能直接作为背景色'); return }
    setBackground(sample)
  }

  return (
    <Page variant="dense">
      <PageToolbar>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" variant="contained" startIcon={<Picture fontSize="small" />} onClick={() => fileInput.current?.click()} disabled={loading}>选择图片</Button>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}><Picture sx={{ fontSize: 14, verticalAlign: -2, mr: 0.5 }} />本地处理 · 图片不上传</Typography>
        </Stack>
        <div className="spacer" />
        <Chip size="small" variant="outlined" label="WCAG 2.2 · sRGB" />
      </PageToolbar>
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
                  <Button size="small" disabled={sample.a === 0} onClick={setAsForeground}>设为前景</Button>
                  <Button size="small" disabled={sample.a === 0} onClick={setAsBackground}>设为背景</Button>
                </Stack>
              ) : null}
              {sample?.a === 0 ? <Alert severity="warning" sx={{ mt: 0.75, py: 0, fontSize: 11.5 }}>全透明像素不能当作黑色或白色使用；请选择有实色的笔画像素。</Alert> : null}
              <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled' }}>提示：抗锯齿边缘可能混合了前后景色，请选择笔画实色和对应的纯色背景再计算。</Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>可读性检查</Typography>
                <Button size="small" onClick={() => { const old = foreground; setForeground(background); setBackground(old) }}>交换两色</Button>
              </Stack>
              <Stack spacing={1}>
                <ColorField label="前景色" color={foreground} onChange={setForeground} />
                <ColorField label="背景色" color={background} onChange={setBackground} />
                {background.a < 1 ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>背景含透明度，需指定底色</Typography>
                    <Box
                      component="input" type="color" aria-label="背景底色" value={toHex({ ...baseColor, a: 1 })}
                      onChange={(event) => { const parsed = parseColor(event.target.value); if (parsed) setBaseColor({ ...parsed, a: 1 }) }}
                      sx={{ width: 30, height: 30, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }}
                    />
                    <Typography sx={{ fontSize: 11.5, fontFamily: 'monospace' }}>{toHex({ ...baseColor, a: 1 })}</Typography>
                  </Stack>
                ) : null}
                {foreground.a < 1 && !fullyTransparent ? <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>前景已与背景合成后再计算（实际前景 {toHex(effectiveForeground)}）。</Typography> : null}
                {background.a < 1 ? <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>背景已与底色合成（实际背景 {toHex(effectiveBackground)}）。</Typography> : null}
                {fullyTransparent ? (
                  <Alert severity="warning" sx={{ py: 0, fontSize: 11.5 }}>前景完全透明，不能计算对比度；请选择实色前景。</Alert>
                ) : report ? (
                  <>
                    <Stack direction="row" alignItems="baseline" spacing={1}>
                      <Typography data-testid="contrast-ratio" sx={{ fontSize: 32, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{report.ratio.toFixed(2)}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>: 1 对比度</Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>判定使用未舍入值</Typography>
                    </Stack>
                    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                      <ContrastLine testId="contrast-normal-aa" label="普通文字 AA" threshold="≥ 4.5" passed={report.normalAA} />
                      <ContrastLine testId="contrast-normal-aaa" label="普通文字 AAA" threshold="≥ 7.0" passed={report.normalAAA} />
                      <ContrastLine testId="contrast-large-aa" label="大文字 AA（≥18pt / 14pt 粗体）" threshold="≥ 3.0" passed={report.largeAA} />
                      <ContrastLine testId="contrast-large-aaa" label="大文字 AAA" threshold="≥ 4.5" passed={report.largeAAA} />
                      <ContrastLine testId="contrast-ui" label="界面组件与图形（相邻颜色）" threshold="≥ 3.0" passed={report.ui} />
                    </Box>
                  </>
                ) : null}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.75 }}>实时预览</Typography>
              <Box sx={{ bgcolor: toRgbaString(effectiveBackground), color: toRgbaString(effectiveForeground), p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}>
                <Typography component="h2" sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, mb: 0.75 }}>{headingText}</Typography>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.65, mb: 0.5 }}>{chineseText}</Typography>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.65, mb: 1 }}>{englishText}</Typography>
                <Box component="button" type="button" sx={{ px: 1.75, py: 0.75, border: 2, borderColor: 'currentColor', borderRadius: 1, bgcolor: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{buttonText}</Box>
              </Box>
              <Stack spacing={0.75} sx={{ mt: 1 }}>
                <TextField size="small" label="中文预览文案" value={chineseText} onChange={(event) => setChineseText(event.target.value)} />
                <TextField size="small" label="英文预览文案" value={englishText} onChange={(event) => setEnglishText(event.target.value)} />
                <Stack direction="row" spacing={0.75}>
                  <TextField size="small" label="标题文案" value={headingText} onChange={(event) => setHeadingText(event.target.value)} sx={{ flex: 1 }} />
                  <TextField size="small" label="按钮文案" value={buttonText} onChange={(event) => setButtonText(event.target.value)} sx={{ flex: 1 }} />
                </Stack>
              </Stack>
              <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled' }}>依据 WCAG 2.2：sRGB 相对亮度与对比度公式；抗锯齿边缘可能产生混合色，取色时请选择实色笔画和纯背景。</Typography>
            </Paper>
          </Stack>
        </Box>
      </PageBody>
    </Page>
  )
}
