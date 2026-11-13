export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface HSL {
  h: number
  s: number
  l: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function parseColor(input: string): RGBA | null {
  const value = input.trim()
  if (!value) return null
  if (value.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = value.match(/^#?([0-9a-f]{3,8})$/i)
  if (hex) {
    const raw = hex[1]
    if (![3, 4, 6, 8].includes(raw.length)) return null
    const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16)
    if (raw.length <= 4) {
      return { r: expand(raw[0]), g: expand(raw[1]), b: expand(raw[2]), a: raw.length === 4 ? expand(raw[3]) / 255 : 1 }
    }
    return {
      r: expand(raw.slice(0, 2)), g: expand(raw.slice(2, 4)), b: expand(raw.slice(4, 6)),
      a: raw.length === 8 ? expand(raw.slice(6, 8)) / 255 : 1,
    }
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
  if (rgb) {
    const channel = (part: string) => part.endsWith('%') ? clamp(Number(part.slice(0, -1)) * 2.55, 0, 255) : clamp(Number(part), 0, 255)
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])
    return { r: channel(rgb[1]), g: channel(rgb[2]), b: channel(rgb[3]), a: clamp(alpha, 0, 1) }
  }
  const hsl = value.match(/^hsla?\(\s*([-\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
  if (hsl) {
    const alpha = hsl[4] === undefined ? 1 : hsl[4].endsWith('%') ? Number(hsl[4].slice(0, -1)) / 100 : Number(hsl[4])
    const rgbValue = hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100)
    return { ...rgbValue, a: clamp(alpha, 0, 1) }
  }
  return null
}

export function rgbToHsl(color: RGBA): HSL {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const delta = max - min
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h = 0
  if (max === r) h = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360 / 360
  if (s === 0) { const value = Math.round(l * 255); return { r: value, g: value, b: value } }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let next = t
    if (next < 0) next += 1
    if (next > 1) next -= 1
    if (next < 1 / 6) return p + (q - p) * 6 * next
    if (next < 1 / 2) return q
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6
    return p
  }
  return {
    r: Math.round(channel(hue + 1 / 3) * 255),
    g: Math.round(channel(hue) * 255),
    b: Math.round(channel(hue - 1 / 3) * 255),
  }
}

export function toHex(color: RGBA, alpha = true) {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  const base = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
  return alpha && color.a < 1 ? `${base}${channel(color.a * 255)}`.toUpperCase() : base.toUpperCase()
}

export function toRgbaString(color: RGBA) {
  const alpha = Number(color.a.toFixed(3))
  return alpha < 1 ? `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})` : `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

export function toHslString(color: RGBA) {
  const hsl = rgbToHsl(color)
  return color.a < 1 ? `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${Number(color.a.toFixed(3))})` : `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`
}

/** RGBA over an opaque base; returns an opaque RGBA. */
export function compositeOver(color: RGBA, base: RGBA): RGBA {
  const alpha = color.a + base.a * (1 - color.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (color.r * color.a + base.r * base.a * (1 - color.a)) / alpha,
    g: (color.g * color.a + base.g * base.a * (1 - color.a)) / alpha,
    b: (color.b * color.a + base.b * base.a * (1 - color.a)) / alpha,
    a: alpha,
  }
}

function channelLuminance(value: number) {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: RGBA) {
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b)
}

export function contrastRatio(foreground: RGBA, background: RGBA) {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export interface ContrastReport {
  ratio: number
  normalAA: boolean
  normalAAA: boolean
  largeAA: boolean
  largeAAA: boolean
  ui: boolean
}

export function contrastReport(foreground: RGBA, background: RGBA): ContrastReport {
  const ratio = contrastRatio(foreground, background)
  return {
    ratio,
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7,
    largeAA: ratio >= 3,
    largeAAA: ratio >= 4.5,
    ui: ratio >= 3,
  }
}
