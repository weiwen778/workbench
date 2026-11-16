import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { copyText } from '@/api/client'
import { toHex, toHslString, toRgbaString, type RGBA } from '@/color/color'
import { toast } from '@/ui/feedback'

/** 常用潘通色的近似 sRGB 参考值。Pantone 为 Pantone LLC 商标，此处仅作近似对照，非官方色卡。 */
const PANTONE_REFERENCE: Array<{ code: string; name: string; hex: string }> = [
  { code: '186 C', name: '经典正红', hex: '#C8102E' },
  { code: '485 C', name: '暖红', hex: '#DA291C' },
  { code: '199 C', name: '亮红', hex: '#D50032' },
  { code: '021 C', name: '橙', hex: '#FE5000' },
  { code: '137 C', name: '橙黄', hex: '#FFA300' },
  { code: '116 C', name: '明黄', hex: '#FFCD00' },
  { code: 'Yellow C', name: '正黄', hex: '#FEDD00' },
  { code: '375 C', name: '黄绿', hex: '#97D700' },
  { code: '348 C', name: '正绿', hex: '#00843D' },
  { code: '3435 C', name: '深绿', hex: '#154734' },
  { code: '3272 C', name: '青绿', hex: '#00A499' },
  { code: '3125 C', name: '青', hex: '#00AEC7' },
  { code: '306 C', name: '天蓝', hex: '#00B5E2' },
  { code: '300 C', name: '正蓝', hex: '#005EB8' },
  { code: '286 C', name: '深蓝', hex: '#0033A0' },
  { code: '072 C', name: '靛蓝', hex: '#10069F' },
  { code: '2685 C', name: '紫', hex: '#56008C' },
  { code: '2592 C', name: '洋红紫', hex: '#9B26B6' },
  { code: '219 C', name: '品红', hex: '#DA1884' },
  { code: '706 C', name: '浅粉', hex: '#FAD1DF' },
  { code: '7527 C', name: '米灰', hex: '#D6D2C4' },
  { code: 'Cool Gray 4 C', name: '冷灰', hex: '#BBBCBC' },
  { code: '424 C', name: '中灰', hex: '#707372' },
  { code: 'Black 6 C', name: '深黑', hex: '#101820' },
]

function clamp(value: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value))
}

function toHsv(color: RGBA) {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : (delta / max) * 100
  return { h: Math.round(h), s: Math.round(s), v: Math.round(max * 100) }
}

function toCmyk(color: RGBA) {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  const c = (1 - r - k) / (1 - k)
  const m = (1 - g - k) / (1 - k)
  const y = (1 - b - k) / (1 - k)
  return {
    c: Math.round(c * 100), m: Math.round(m * 100), y: Math.round(y * 100), k: Math.round(k * 100),
  }
}

/** 在参考表里找最接近的潘通色（RGB 欧氏距离）。 */
function nearestPantone(color: RGBA) {
  let best: { code: string; name: string; hex: string; distance: number } | null = null
  for (const entry of PANTONE_REFERENCE) {
    const r = parseInt(entry.hex.slice(1, 3), 16)
    const g = parseInt(entry.hex.slice(3, 5), 16)
    const b = parseInt(entry.hex.slice(5, 7), 16)
    const distance = Math.sqrt((r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2)
    if (!best || distance < best.distance) best = { ...entry, distance }
  }
  return best
}

function buildRows(color: RGBA) {
  const hex = toHex(color).toUpperCase()
  const hex8 = `${hex}${Math.round(clamp(color.a * 255) ).toString(16).padStart(2, '0').toUpperCase()}`
  const hsv = toHsv(color)
  const cmyk = toCmyk(color)
  const hsl = toHslString(color)
  return [
    { label: 'HEX', value: hex, hint: 'Web / 设计软件通用' },
    { label: 'HEX 8 位', value: hex8, hint: '含透明度' },
    { label: 'RGB', value: `rgb(${color.r}, ${color.g}, ${color.b})`, hint: '整数 0–255' },
    { label: 'RGBA', value: `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`, hint: '含透明度' },
    { label: 'HSL', value: hsl, hint: '色相/饱和度/亮度' },
    { label: 'HSV', value: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`, hint: '设计软件常用' },
    { label: 'CMYK', value: `C ${cmyk.c}% M ${cmyk.m}% Y ${cmyk.y}% K ${cmyk.k}%`, hint: '印刷四色，非色彩管理结果' },
    {
      label: 'CSS 变量',
      value: `--color: ${color.a < 1 ? toRgbaString(color) : hex};`,
      hint: '直接粘进样式表',
    },
    {
      label: '潘通近似',
      value: (() => {
        const near = nearestPantone(color)
        return near ? `Pantone ${near.code}（${near.name}）` : '—'
      })(),
      hint: '近似参考，非官方色卡匹配',
    },
  ]
}

export default function ColorFormats({ color }: { color: RGBA | null }) {
  if (!color) {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.75 }}>颜色格式</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          在左侧图片上取一个颜色后，这里会给出该颜色的 HEX、RGB、HSL、HSV、CMYK、CSS 变量与潘通近似值。
        </Typography>
      </Paper>
    )
  }

  const rows = buildRows(color)
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>颜色格式</Typography>
        <Box sx={{ width: 22, height: 22, borderRadius: 0.75, border: 1, borderColor: 'divider', bgcolor: toRgbaString(color) }} />
      </Stack>
      <Stack spacing={0.5}>
        {rows.map((row) => (
          <Stack
            key={row.label}
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <Box sx={{ width: 74, flexShrink: 0 }}>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{row.label}</Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                noWrap
                title={row.value}
                sx={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace' }}
              >
                {row.value}
              </Typography>
              <Typography sx={{ fontSize: 10, color: 'text.disabled' }} noWrap>{row.hint}</Typography>
            </Box>
            <Button
              size="small"
              sx={{ minWidth: 44, fontSize: 11.5 }}
              onClick={() => void copyText(row.value).then(() => toast.success(`${row.label} 已复制`))}
            >
              复制
            </Button>
          </Stack>
        ))}
      </Stack>
      <Typography sx={{ mt: 1, fontSize: 10.5, color: 'text.disabled' }}>
        潘通为 Pantone LLC 商标；此处按 RGB 最近邻给出近似参考，印刷请以官方色卡或印厂打样为准。CMYK 为公式换算，未做 ICC 色彩管理。
      </Typography>
    </Paper>
  )
}
