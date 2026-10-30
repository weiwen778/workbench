// Local image pipeline. This module deliberately has no network or API dependencies.
export type Point = { x: number; y: number }
export type Mark = { kind: 'brush' | 'rectangle' | 'mosaic'; points: Point[]; color: string; size: number }
export type ImageOptions = {
  rotation: number; flipX: boolean; flipY: boolean
  crop: { x: number; y: number; w: number; h: number }
  width: number; height: number; fit: 'stretch' | 'contain' | 'cover'
  brightness: number; contrast: number; saturation: number; grayscale: number; sepia: number; blur: number
  padding: number; radius: number; background: string; transparent: boolean
  cutout: boolean; cutoutColor: string; tolerance: number; feather: number
  watermark: string; watermarkSize: number; watermarkColor: string; watermarkOpacity: number
  watermarkPosition: string; watermarkAngle: number; marks: Mark[]
}
export type ExportOptions = { format: 'image/png' | 'image/jpeg' | 'image/webp'; quality: number; targetKB: number }
export type ImageAsset = { id: number; name: string; file: File; image: HTMLImageElement; url: string; options: ImageOptions; checked: boolean; history: string[]; historyIndex: number }
export const MAX_EDGE = 8192
export const MAX_PIXELS = 24_000_000
export function defaults(): ImageOptions {
  return { rotation: 0, flipX: false, flipY: false, crop: { x: 0, y: 0, w: 1, h: 1 }, width: 0, height: 0, fit: 'stretch', brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, padding: 0, radius: 0, background: '#ffffff', transparent: true, cutout: false, cutoutColor: '#ffffff', tolerance: 25, feather: 10, watermark: '', watermarkSize: 40, watermarkColor: '#ffffff', watermarkOpacity: 70, watermarkPosition: 'bottom-right', watermarkAngle: -25, marks: [] }
}
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
export function orientedSize(image: HTMLImageElement, options: ImageOptions) {
  return options.rotation % 180 ? { width: image.naturalHeight, height: image.naturalWidth } : { width: image.naturalWidth, height: image.naturalHeight }
}
export function outputSize(image: HTMLImageElement, options: ImageOptions) {
  const size = orientedSize(image, options)
  const cw = Math.max(1, size.width * options.crop.w), ch = Math.max(1, size.height * options.crop.h)
  const width = options.width || (options.height ? options.height * cw / ch : cw)
  const height = options.height || width * ch / cw
  return { width: Math.max(1, Math.round(width + options.padding * 2)), height: Math.max(1, Math.round(height + options.padding * 2)) }
}
export function validateSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new Error('输出尺寸过大：每边最多 8192 像素，总像素最多 2400 万，请缩小尺寸或减少拼图数量。')
}
function canvas(width: number, height: number) {
  const result = document.createElement('canvas')
  result.width = Math.max(1, Math.round(width)); result.height = Math.max(1, Math.round(height))
  return result
}
function context(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法创建图片画布，请使用 Chrome 或 Edge。')
  return ctx
}
function roundedPath(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath(); ctx.moveTo(r, 0); ctx.arcTo(width, 0, width, height, r); ctx.arcTo(width, height, 0, height, r); ctx.arcTo(0, height, 0, 0, r); ctx.arcTo(0, 0, width, 0, r); ctx.closePath()
}
function rgb(hex: string) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] }
export function renderImage(image: HTMLImageElement, options: ImageOptions, maxEdge = 0): HTMLCanvasElement {
  const size = outputSize(image, options)
  if (!maxEdge) validateSize(size.width, size.height)
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(size.width, size.height)) : 1
  const result = canvas(size.width * scale, size.height * scale)
  const layer = canvas(result.width, result.height), ctx = context(layer)
  const full = orientedSize(image, options), crop = options.crop
  const cw = Math.max(1, crop.w * full.width), ch = Math.max(1, crop.h * full.height)
  const pad = options.padding * scale, width = Math.max(1, result.width - pad * 2), height = Math.max(1, result.height - pad * 2)
  let dw = width, dh = height
  if (options.fit !== 'stretch') {
    const factor = (options.fit === 'contain' ? Math.min : Math.max)(width / cw, height / ch)
    dw = cw * factor; dh = ch * factor
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.save(); ctx.beginPath(); ctx.rect(pad, pad, width, height); ctx.clip()
  ctx.filter = `brightness(${options.brightness}%) contrast(${options.contrast}%) saturate(${options.saturation}%) grayscale(${options.grayscale}%) sepia(${options.sepia}%) blur(${options.blur * scale}px)`
  ctx.translate(pad + (width - dw) / 2, pad + (height - dh) / 2)
  ctx.scale(dw / cw, dh / ch); ctx.translate(-crop.x * full.width, -crop.y * full.height)
  ctx.translate(full.width / 2, full.height / 2); ctx.scale(options.flipX ? -1 : 1, options.flipY ? -1 : 1); ctx.rotate(options.rotation * Math.PI / 180)
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2); ctx.restore()
  if (options.cutout) {
    const pixels = ctx.getImageData(0, 0, layer.width, layer.height), [r, g, b] = rgb(options.cutoutColor)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const distance = Math.hypot(pixels.data[i] - r, pixels.data[i + 1] - g, pixels.data[i + 2] - b)
      const alpha = Math.max(0, Math.min(1, (distance - options.tolerance) / Math.max(1, options.feather)))
      pixels.data[i + 3] = Math.round(pixels.data[i + 3] * alpha)
    }
    ctx.putImageData(pixels, 0, 0)
  }
  const out = context(result)
  roundedPath(out, result.width, result.height, options.radius * scale); out.clip()
  if (!options.transparent) { out.fillStyle = options.background; out.fillRect(0, 0, result.width, result.height) }
  out.drawImage(layer, 0, 0)
  for (const mark of options.marks) drawMark(out, result, mark, scale)
  if (options.watermark.trim()) {
    out.save(); out.globalAlpha = options.watermarkOpacity / 100
    const fontSize = Math.max(1, options.watermarkSize * scale)
    out.font = `600 ${fontSize}px system-ui, sans-serif`; out.fillStyle = options.watermarkColor; out.textBaseline = 'middle'
    out.shadowColor = 'rgba(0,0,0,.3)'; out.shadowBlur = 2 * scale
    const text = options.watermark.trim(), margin = 16 * scale
    if (options.watermarkPosition === 'repeat') {
      out.translate(result.width / 2, result.height / 2); out.rotate(options.watermarkAngle * Math.PI / 180); out.textAlign = 'center'
      const reach = Math.hypot(result.width, result.height), dx = Math.max(80 * scale, fontSize * 3, out.measureText(text).width + fontSize * 2), dy = Math.max(60 * scale, fontSize * 4)
      for (let y = -reach; y < reach; y += dy) for (let x = -reach; x < reach; x += dx) out.fillText(text, x, y)
    } else {
      const right = options.watermarkPosition.includes('right'), left = options.watermarkPosition.includes('left'), top = options.watermarkPosition.includes('top')
      out.textAlign = right ? 'right' : left ? 'left' : 'center'
      out.fillText(text, right ? result.width - margin : left ? margin : result.width / 2, options.watermarkPosition === 'center' ? result.height / 2 : top ? margin + fontSize / 2 : result.height - margin - fontSize / 2, Math.max(1, result.width - margin * 2))
    }
    out.restore()
  }
  // Let temporary pixel buffers be reclaimed promptly, especially during batches.
  layer.width = layer.height = 1
  return result
}
function drawMark(ctx: CanvasRenderingContext2D, result: HTMLCanvasElement, mark: Mark, scale: number) {
  if (!mark.points.length) return
  const points = mark.points.map(p => ({ x: p.x * result.width, y: p.y * result.height }))
  ctx.save(); ctx.strokeStyle = mark.color; ctx.fillStyle = mark.color; ctx.lineWidth = Math.max(1, mark.size * scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (mark.kind === 'brush') {
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y)
    for (const p of points) ctx.lineTo(p.x, p.y)
    if (points.length === 1) { ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill() } else ctx.stroke()
  } else {
    const a = points[0], b = points[points.length - 1], x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.max(1, Math.abs(b.x - a.x)), h = Math.max(1, Math.abs(b.y - a.y))
    if (mark.kind === 'rectangle') ctx.strokeRect(x, y, w, h)
    else {
      const block = Math.max(4, mark.size * scale), tiny = canvas(Math.ceil(w / block), Math.ceil(h / block))
      context(tiny).drawImage(result, x, y, w, h, 0, 0, tiny.width, tiny.height)
      ctx.imageSmoothingEnabled = false; ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h); tiny.width = tiny.height = 1
    }
  }
  ctx.restore()
}
export type CollageOptions = { columns: number; tileWidth: number; tileHeight: number; gap: number; background: string; fit: 'contain' | 'cover' }
export function collageSize(count: number, options: CollageOptions) {
  if (!count) return { width: 0, height: 0, columns: 1 }
  const columns = Math.min(count, Math.max(1, options.columns)), rows = Math.ceil(count / columns)
  return { width: columns * options.tileWidth + (columns + 1) * options.gap, height: rows * options.tileHeight + (rows + 1) * options.gap, columns }
}
export function renderCollage(assets: Pick<ImageAsset, 'image' | 'options'>[], options: CollageOptions, maxEdge = 0) {
  if (!assets.length) throw new Error('请先勾选参与拼图的图片。')
  const size = collageSize(assets.length, options)
  if (!maxEdge) validateSize(size.width, size.height)
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(size.width, size.height)) : 1
  const result = canvas(size.width * scale, size.height * scale), ctx = context(result)
  ctx.fillStyle = options.background; ctx.fillRect(0, 0, result.width, result.height)
  assets.forEach((asset, i) => {
    const tile = renderImage(asset.image, asset.options, Math.ceil(Math.max(options.tileWidth, options.tileHeight) * scale))
    const w = options.tileWidth * scale, h = options.tileHeight * scale, factor = (options.fit === 'cover' ? Math.max : Math.min)(w / tile.width, h / tile.height)
    const x = (options.gap + (i % size.columns) * (options.tileWidth + options.gap)) * scale, y = (options.gap + Math.floor(i / size.columns) * (options.tileHeight + options.gap)) * scale
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(tile, x + (w - tile.width * factor) / 2, y + (h - tile.height * factor) / 2, tile.width * factor, tile.height * factor); ctx.restore()
    tile.width = tile.height = 1
  })
  return result
}
function blob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(result => {
    if (!result) reject(new Error('图片导出失败，请尝试缩小尺寸。'))
    else if (result.type !== type) reject(new Error('当前浏览器不支持此导出格式，请改用 PNG 或 JPEG。'))
    else resolve(result)
  }, type, quality))
}
export async function encodeImage(source: HTMLCanvasElement, options: ExportOptions, background = '#ffffff') {
  let current = source, owned: HTMLCanvasElement | null = null
  if (options.format === 'image/jpeg') {
    owned = canvas(source.width, source.height); const ctx = context(owned)
    ctx.fillStyle = background; ctx.fillRect(0, 0, owned.width, owned.height); ctx.drawImage(source, 0, 0); current = owned
  }
  try {
    let result = await blob(current, options.format, options.quality)
    const target = options.targetKB * 1024
    for (let pass = 0; target && result.size > target && pass < 8; pass++) {
      if (options.format !== 'image/png') {
        let low = .05, high = options.quality, best: Blob | null = null
        for (let i = 0; i < 7; i++) {
          const mid = (low + high) / 2, trial = await blob(current, options.format, mid)
          if (trial.size <= target) { best = trial; low = mid } else high = mid
        }
        result = best || await blob(current, options.format, .05)
        if (result.size <= target) break
      }
      if (current.width === 1 && current.height === 1) break
      const factor = Math.max(.25, Math.min(.9, Math.sqrt(target / result.size) * .9)), next = canvas(current.width * factor, current.height * factor)
      const ctx = context(next); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(current, 0, 0, next.width, next.height)
      if (owned) owned.width = owned.height = 1
      owned = next; current = owned; result = await blob(current, options.format, options.quality)
    }
    return { blob: result, width: current.width, height: current.height, withinTarget: !target || result.size <= target }
  } finally { if (owned) owned.width = owned.height = 1 }
}
export function extension(format: string) { return format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png' }
export function safeName(name: string) { return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'image' }
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
// ZIP STORE: image blobs are already compressed. UTF-8 names and CRC32 keep the
// archive compatible with common unzip tools without fetching a third-party runtime.
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export async function zipImages(files: { name: string; blob: Blob }[]) {
  const local: BlobPart[] = [], central: BlobPart[] = [], encoder = new TextEncoder()
  let offset = 0, centralLength = 0
  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer()), name = encoder.encode(file.name)
    let crc = 0xffffffff
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
    crc = (crc ^ 0xffffffff) >>> 0
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer)
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 33, true)
    h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, name.length, true); header.set(name, 30)
    const entry = new Uint8Array(46 + name.length), e = new DataView(entry.buffer)
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x800, true); e.setUint16(14, 33, true)
    e.setUint32(16, crc, true); e.setUint32(20, bytes.length, true); e.setUint32(24, bytes.length, true); e.setUint16(28, name.length, true); e.setUint32(42, offset, true); entry.set(name, 46)
    local.push(header, file.blob); central.push(entry); centralLength += entry.length; offset += header.length + bytes.length
    if (offset + centralLength > 0xffffffff) throw new Error('打包体积过大，请分批导出。')
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, centralLength, true); e.setUint32(16, offset, true)
  return new Blob([...local, ...central, end], { type: 'application/zip' })
}
