import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Paper, Stack, Tab, Tabs, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material'
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import { Check, CopyDocument, Download, Picture, Upload, View } from '@/icons'
import { copyText } from '@/api/client'
import { Page, PageBody, PageToolbar } from '@/ui/common'
import { toast } from '@/ui/feedback'
import { downloadBlob } from '@/convert/files'
import { decodeCodeImage, type DecodedCode } from '@/codes/decode'
import { isValidHttpUrl, normalizeEan13, parseWifi, wifiPayload, type WifiData } from '@/codes/format'

type GenerateType = 'url' | 'text' | 'wifi' | 'code128' | 'ean13'

const TYPE_LABELS: Record<GenerateType, string> = {
  url: '网址', text: '纯文字', wifi: 'Wi-Fi', code128: 'Code 128', ean13: 'EAN-13',
}

interface Encoded {
  payload: string
  display: string
  note: string
}

function safeFileName(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'code'
}

function maskedWifi(data: WifiData) {
  const payload = wifiPayload(data)
  return data.auth === 'nopass' ? payload : payload.replace(/P:(?:\\.|[^;])*;/, 'P:***;')
}

export default function CodesPage() {
  const [tab, setTab] = useState<'generate' | 'recognize'>('generate')
  const [type, setType] = useState<GenerateType>('url')
  const [url, setUrl] = useState('https://example.com')
  const [text, setText] = useState('')
  const [wifi, setWifi] = useState<WifiData>({ ssid: '', auth: 'WPA', password: '', hidden: false })
  const [showPassword, setShowPassword] = useState(false)
  const [barcodeValue, setBarcodeValue] = useState('')
  const [showBarcodeText, setShowBarcodeText] = useState(true)
  const [encoded, setEncoded] = useState<Encoded | null>(null)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const generateSeq = useRef(0)

  const [recognizeFile, setRecognizeFile] = useState<File | null>(null)
  const [recognizePreview, setRecognizePreview] = useState('')
  const [recognizeState, setRecognizeState] = useState<'idle' | 'loading' | 'success' | 'empty' | 'error'>('idle')
  const [recognizeError, setRecognizeError] = useState('')
  const [recognizeResult, setRecognizeResult] = useState<DecodedCode | null>(null)
  const [recognizeWifi, setRecognizeWifi] = useState<WifiData | null>(null)
  const recognizeSeq = useRef(0)
  const recognizeInput = useRef<HTMLInputElement>(null)

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
  }

  const resolvePayload = (): Encoded => {
    if (type === 'url') {
      const value = url.trim()
      if (!value) throw new Error('请输入网址')
      if (!isValidHttpUrl(value)) throw new Error('请输入以 http:// 或 https:// 开头的有效网址')
      return { payload: value, display: value, note: '' }
    }
    if (type === 'text') {
      if (!text) throw new Error('请输入要生成二维码的文字')
      return { payload: text, display: text, note: '保留空格和换行' }
    }
    if (type === 'wifi') {
      if (!wifi.ssid.trim()) throw new Error('请输入网络名称（SSID）')
      if (wifi.auth !== 'nopass' && !wifi.password) throw new Error('请输入 Wi-Fi 密码，或将加密方式设为开放网络')
      return { payload: wifiPayload(wifi), display: maskedWifi(wifi), note: '预览中的密码已遮盖；二维码和导出文件包含实际连接信息' }
    }
    if (type === 'code128') {
      if (!barcodeValue) throw new Error('请输入 Code 128 内容')
      if (/[^\x20-\x7E]/.test(barcodeValue)) throw new Error('Code 128 仅支持 ASCII 字母、数字和常用符号')
      return { payload: barcodeValue, display: barcodeValue, note: '' }
    }
    const normalized = normalizeEan13(barcodeValue)
    return {
      payload: normalized.value, display: normalized.value,
      note: normalized.computed ? `已按前 12 位自动计算校验位：${normalized.checkDigit}` : `校验位验证通过：${normalized.checkDigit}`,
    }
  }

  useEffect(() => {
    if (tab !== 'generate') return
    const timer = window.setTimeout(() => {
      const sequence = ++generateSeq.current
      setGenerating(true)
      setError('')
      try {
        const next = resolvePayload()
        const canvas = canvasRef.current
        if (!canvas) return
        if (type === 'url' || type === 'text' || type === 'wifi') {
          void QRCode.toCanvas(canvas, next.payload, {
            width: 320, margin: 4, errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
          }).then(() => {
            if (sequence !== generateSeq.current) return
            setEncoded(next); setGenerating(false)
          }).catch((reason: unknown) => {
            if (sequence !== generateSeq.current) return
            setEncoded(null); setGenerating(false); clearCanvas()
            const message = reason instanceof Error ? reason.message : ''
            setError(/too big|too long|amount of data/i.test(message) ? '内容过长，二维码无法容纳，请缩短内容' : '二维码生成失败，请检查输入')
          })
        } else {
          const context = canvas.getContext('2d')
          if (!context) throw new Error('浏览器无法创建画布')
          context.clearRect(0, 0, canvas.width, canvas.height)
          JsBarcode(canvas, next.payload, {
            format: type === 'code128' ? 'CODE128' : 'EAN13',
            displayValue: showBarcodeText, width: 2, height: 80, margin: 12,
            background: '#ffffff', lineColor: '#000000', fontSize: 16,
          })
          if (sequence !== generateSeq.current) return
          setEncoded(next); setGenerating(false)
        }
      } catch (reason) {
        setGenerating(false); setEncoded(null); clearCanvas()
        setError(reason instanceof Error ? reason.message : '生成失败')
      }
    }, 180)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, type, url, text, wifi, barcodeValue, showBarcodeText])

  const downloadPng = () => {
    if (!encoded || !canvasRef.current) return
    canvasRef.current.toBlob((blob) => {
      if (!blob) { toast.error('图片导出失败'); return }
      downloadBlob(blob, `${safeFileName(type + '-' + (encoded.display || 'code'))}.png`)
    }, 'image/png')
  }

  const downloadSvg = async () => {
    if (!encoded) return
    try {
      let content = ''
      if (type === 'url' || type === 'text' || type === 'wifi') {
        content = await QRCode.toString(encoded.payload, {
          type: 'svg', width: 512, margin: 4, errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        })
      } else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        JsBarcode(svg, encoded.payload, {
          format: type === 'code128' ? 'CODE128' : 'EAN13', displayValue: showBarcodeText,
          width: 2, height: 80, margin: 12, background: '#ffffff', lineColor: '#000000', fontSize: 16,
          xmlDocument: document,
        } as any)
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        content = new XMLSerializer().serializeToString(svg)
      }
      downloadBlob(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }), `${safeFileName(type + '-' + (encoded.display || 'code'))}.svg`)
    } catch { toast.error('SVG 导出失败') }
  }

  const copy = async (value: string, label: string) => {
    const ok = await copyText(value)
    if (ok) toast.success(`已复制${label}`)
    else toast.warning('浏览器不允许自动复制，请手动选择文本')
  }

  const recognize = async (file: File) => {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      if (recognizePreview) URL.revokeObjectURL(recognizePreview)
      setRecognizeFile(null); setRecognizePreview(''); setRecognizeResult(null); setRecognizeWifi(null)
      setRecognizeError('请选择图片文件'); setRecognizeState('error'); return
    }
    const sequence = ++recognizeSeq.current
    if (recognizePreview) URL.revokeObjectURL(recognizePreview)
    setRecognizeFile(file)
    setRecognizePreview(URL.createObjectURL(file))
    setRecognizeState('loading'); setRecognizeError(''); setRecognizeResult(null); setRecognizeWifi(null)
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    try {
      const result = await decodeCodeImage(file)
      if (sequence !== recognizeSeq.current) return
      if (!result.supported) {
        setRecognizeState('error')
        setRecognizeError(`检测到 ${result.format}，当前版本仅支持 QR Code、Code 128 和 EAN-13`)
        return
      }
      setRecognizeResult(result)
      setRecognizeState('success')
      setRecognizeWifi(parseWifi(result.text))
    } catch (reason) {
      if (sequence !== recognizeSeq.current) return
      const notFound = reason instanceof Error && /NotFound|No MultiFormat/i.test(reason.name + reason.message)
      setRecognizeState(notFound ? 'empty' : 'error')
      setRecognizeError(notFound
        ? '未识别到二维码或条码。请使用更清晰、四周留白完整的图片，或放大后重试。'
        : '图片无法读取或识别失败，请检查文件是否损坏')
    }
  }

  useEffect(() => {
    if (tab !== 'recognize') return
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || [])
      if (!files.length) return
      event.preventDefault()
      void recognize(files[0])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, recognizePreview])

  useEffect(() => () => { if (recognizePreview) URL.revokeObjectURL(recognizePreview) }, [recognizePreview])

  const recognizedUrl = recognizeResult && (() => {
    try {
      const parsed = new URL(recognizeResult.text)
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
    } catch { return '' }
  })()

  return (
    <Page variant="dense">
      <PageToolbar sx={{ gap: 1 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34, py: 0, fontSize: 13 } }}>
          <Tab value="generate" label="生成" />
          <Tab value="recognize" label="识别" />
        </Tabs>
        <div className="spacer" />
        <Chip size="small" variant="outlined" label="本地处理 · 不上传" />
      </PageToolbar>
      <PageBody>
        <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {tab === 'generate' ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 400px' }, gap: 1.5, alignItems: 'start' }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1.5}>
                  <ToggleButtonGroup size="small" exclusive value={type} onChange={(_, value) => value && setType(value)} sx={{ flexWrap: 'wrap' }}>
                    {(Object.keys(TYPE_LABELS) as GenerateType[]).map((key) => <ToggleButton key={key} value={key}>{TYPE_LABELS[key]}</ToggleButton>)}
                  </ToggleButtonGroup>
                  {type === 'url' ? (
                    <TextField
                      label="网页地址" value={url} onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/page" fullWidth helperText="仅支持 http:// 或 https:// 地址"
                    />
                  ) : null}
                  {type === 'text' ? (
                    <TextField
                      label="文字内容" value={text} onChange={(event) => setText(event.target.value)}
                      multiline minRows={5} maxRows={12} fullWidth placeholder="中文、英文、数字、空格和换行都会保留"
                    />
                  ) : null}
                  {type === 'wifi' ? (
                    <Stack spacing={1.25}>
                      <TextField label="网络名称（SSID）" value={wifi.ssid} onChange={(event) => setWifi({ ...wifi, ssid: event.target.value })} fullWidth />
                      <Stack direction="row" spacing={1}>
                        <Box sx={{ flex: 1 }}>
                          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.25 }}>加密方式</Typography>
                          <ToggleButtonGroup size="small" exclusive value={wifi.auth} onChange={(_, value) => value && setWifi({ ...wifi, auth: value })}>
                            <ToggleButton value="WPA">WPA/WPA2</ToggleButton>
                            <ToggleButton value="WEP">WEP</ToggleButton>
                            <ToggleButton value="nopass">开放网络</ToggleButton>
                          </ToggleButtonGroup>
                        </Box>
                      </Stack>
                      {wifi.auth !== 'nopass' ? (
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <TextField
                            label="密码" type={showPassword ? 'text' : 'password'} value={wifi.password}
                            onChange={(event) => setWifi({ ...wifi, password: event.target.value })} fullWidth
                            helperText="密码默认遮盖；预览二维码和导出文件包含实际连接信息"
                          />
                          <IconButton size="small" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)} sx={{ mt: -2 }}><View fontSize="small" /></IconButton>
                        </Stack>
                      ) : <Alert severity="info" sx={{ py: 0, fontSize: 12 }}>开放网络不包含密码字段。</Alert>}
                      <FormControlLabel control={<Checkbox checked={wifi.hidden} onChange={(event) => setWifi({ ...wifi, hidden: event.target.checked })} />} label={<Typography sx={{ fontSize: 12.5 }}>隐藏网络</Typography>} />
                    </Stack>
                  ) : null}
                  {type === 'code128' ? (
                    <TextField
                      label="Code 128 内容" value={barcodeValue} onChange={(event) => setBarcodeValue(event.target.value)} fullWidth
                      placeholder="例如：SKU-2026-001" helperText="支持 ASCII 字母、数字和常用符号"
                    />
                  ) : null}
                  {type === 'ean13' ? (
                    <TextField
                      label="商品编号" value={barcodeValue} onChange={(event) => setBarcodeValue(event.target.value)} fullWidth
                      placeholder="12 位数字自动补校验位，或输入 13 位校验" helperText="前导零会保留；输入 13 位时会验证校验位"
                    />
                  ) : null}
                  {type === 'code128' || type === 'ean13' ? (
                    <FormControlLabel control={<Checkbox checked={showBarcodeText} onChange={(event) => setShowBarcodeText(event.target.checked)} />} label={<Typography sx={{ fontSize: 12.5 }}>显示条码下方编号</Typography>} />
                  ) : null}
                  {error ? <Alert severity="error" sx={{ py: 0, fontSize: 12 }}>{error}</Alert> : null}
                  {encoded ? (
                    <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.75}>
                        <Typography sx={{ fontSize: 11.5, fontWeight: 600, flex: 1 }}>编码内容</Typography>
                        <Button size="small" startIcon={<CopyDocument fontSize="small" />} onClick={() => void copy(encoded.display, '内容')}>复制</Button>
                      </Stack>
                      <Typography component="pre" sx={{ m: 0, mt: 0.5, fontSize: 11.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 140, overflow: 'auto', fontFamily: 'monospace' }}>{encoded.display}</Typography>
                      {encoded.note ? <Typography sx={{ mt: 0.5, fontSize: 10.5, color: 'text.secondary' }}>{encoded.note}</Typography> : null}
                    </Box>
                  ) : null}
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>实时预览</Typography>
                  {generating ? <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>生成中…</Typography> : null}
                </Stack>
                <Box sx={{ bgcolor: '#ffffff', borderRadius: 1, border: 1, borderColor: 'divider', p: 2, minHeight: 320, display: 'grid', placeItems: 'center', overflow: 'auto' }}>
                  <canvas ref={canvasRef} aria-label="二维码或条码预览" style={{ maxWidth: '100%', height: 'auto', imageRendering: 'pixelated' }} />
                </Box>
                <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                  <Button fullWidth size="small" variant="contained" startIcon={<Download fontSize="small" />} disabled={!encoded || generating} onClick={downloadPng}>下载 PNG</Button>
                  <Button fullWidth size="small" startIcon={<Download fontSize="small" />} disabled={!encoded || generating} onClick={() => void downloadSvg()}>下载 SVG</Button>
                </Stack>
                <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled' }}>默认深色码、白色底并保留四周留白；PNG 按整数像素渲染。</Typography>
              </Paper>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 420px' }, gap: 1.5, alignItems: 'start' }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <input
                  ref={recognizeInput} type="file" accept="image/*" hidden
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void recognize(file) }}
                />
                <Box
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void recognize(file) }}
                  onClick={() => recognizeInput.current?.click()}
                  sx={{ minHeight: 280, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1, p: 2, display: 'grid', placeItems: 'center', cursor: 'pointer', bgcolor: 'action.hover' }}
                >
                  {recognizePreview ? (
                    <Box component="img" src={recognizePreview} alt="待识别图片" sx={{ maxWidth: '100%', maxHeight: 420, borderRadius: 1, objectFit: 'contain' }} />
                  ) : (
                    <Box sx={{ textAlign: 'center' }}>
                      <Picture sx={{ fontSize: 34, color: 'text.secondary' }} />
                      <Typography sx={{ fontSize: 13, mt: 1 }}>拖入、选择或粘贴含二维码/条码的图片</Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>支持 QR Code、Code 128、EAN-13；图片不上传</Typography>
                      <Button size="small" variant="contained" startIcon={<Upload fontSize="small" />} sx={{ mt: 1.25 }} onClick={(event) => { event.stopPropagation(); recognizeInput.current?.click() }}>选择图片</Button>
                    </Box>
                  )}
                </Box>
                <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled' }}>建议使用清晰、四周留白完整的截图；识别在同一设备本地完成。</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>识别结果</Typography>
                {recognizeState === 'loading' ? <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>正在识别…</Typography> : null}
                {recognizeState === 'empty' || recognizeState === 'error' ? <Alert severity="warning" sx={{ fontSize: 12 }}>{recognizeError}</Alert> : null}
                {recognizeState === 'success' && recognizeResult ? (
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Chip size="small" color="success" icon={<Check sx={{ fontSize: 14 }} />} label={recognizeResult.format} />
                      <Button size="small" startIcon={<CopyDocument fontSize="small" />} onClick={() => void copy(recognizeResult.text, '识别内容')}>复制</Button>
                    </Stack>
                    <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto', fontFamily: 'monospace' }}>{recognizeResult.text}</Box>
                    {recognizedUrl ? (
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Button size="small" variant="outlined" href={recognizedUrl} target="_blank" rel="noopener noreferrer">打开网址</Button>
                        <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary', minWidth: 0 }}>{recognizedUrl}</Typography>
                      </Stack>
                    ) : null}
                    {recognizeWifi ? (
                      <Box sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Typography sx={{ fontSize: 12 }}>Wi-Fi：{recognizeWifi.ssid}</Typography>
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>加密方式：{recognizeWifi.auth === 'nopass' ? '开放网络' : recognizeWifi.auth}{recognizeWifi.hidden ? ' · 隐藏网络' : ''}</Typography>
                        {recognizeWifi.auth !== 'nopass' ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>密码：••••••（默认遮盖）</Typography> : null}
                        <Button size="small" sx={{ mt: 0.5 }} onClick={() => {
                          setType('wifi'); setWifi(recognizeWifi); setTab('generate')
                        }}>填入生成</Button>
                      </Box>
                    ) : null}
                  </Stack>
                ) : null}
                {recognizeState === 'idle' ? (
                  <Stack spacing={0.75} sx={{ color: 'text.secondary', fontSize: 12 }}>
                    <Typography sx={{ fontSize: 12 }}>选择图片后在这里显示：</Typography>
                    <Typography sx={{ fontSize: 12 }}>· 识别格式与原始内容</Typography>
                    <Typography sx={{ fontSize: 12 }}>· 网址可由你主动打开（仅 http/https）</Typography>
                    <Typography sx={{ fontSize: 12 }}>· Wi-Fi 名称与加密方式，密码默认遮盖</Typography>
                  </Stack>
                ) : null}
                {recognizeState === 'empty' || recognizeState === 'error' ? <Typography sx={{ mt: 0.75, fontSize: 10.5, color: 'text.disabled' }}>可尝试更清晰、更大、四周留白完整的图片，或裁剪到码区域后重试。</Typography> : null}
              </Paper>
            </Box>
          )}
        </Box>
      </PageBody>
    </Page>
  )
}
