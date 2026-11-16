import { zipSync } from 'fflate'
import type { ConvertKind, ConvertOutput, ConvertTarget } from './types'

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])
const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm'])
const EXT_KIND: Record<string, ConvertKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', heic: 'image', heif: 'image',
  pdf: 'pdf', csv: 'csv', xlsx: 'xlsx', xls: 'xlsx',
}

export const extOf = (name: string) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

export function sanitizeName(name: string) {
  const base = name.split(/[\\/]/).pop() || 'file'
  return base.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').slice(0, 160) || 'file'
}

export function uniqueName(name: string, used: Set<string>) {
  if (!used.has(name)) { used.add(name); return name }
  const ext = extOf(name)
  const base = ext ? name.slice(0, -(ext.length + 1)) : name
  let index = 2
  let candidate = `${base} (${index}).${ext}`
  while (used.has(candidate)) { index += 1; candidate = `${base} (${index}).${ext}` }
  used.add(candidate)
  return candidate
}

export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = sanitizeName(name)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function zipOutputs(outputs: ConvertOutput[], zipName: string) {
  const used = new Set<string>()
  const entries: Record<string, Uint8Array> = {}
  for (const output of outputs) {
    const name = uniqueName(sanitizeName(output.name), used)
    entries[name] = new Uint8Array(await output.blob.arrayBuffer())
  }
  const data = zipSync(entries, { level: 6 })
  return new Blob([data], { type: 'application/zip' })
}

export function downloadOutputs(outputs: ConvertOutput[], singleName: string) {
  if (outputs.length === 1) {
    downloadBlob(outputs[0].blob, outputs[0].name || singleName)
    return
  }
  return zipOutputs(outputs, `${baseName(singleName)}.zip`).then((blob) => downloadBlob(blob, `${baseName(singleName)}.zip`))
}

async function sniff(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const ascii = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  if (ascii.startsWith('%PDF')) return 'pdf'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp'
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12).toLowerCase()
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic'
    if (brand === 'qt  ') return 'mov'
    return 'mp4'
  }
  if (ascii.startsWith('PK')) return 'zip'
  return ''
}

export async function classifyFile(file: File): Promise<{ kind: ConvertKind | 'unsupported'; ext: string; note: string }> {
  const ext = extOf(file.name)
  const magic = await sniff(file)
  if (ext === 'xlsx' || ext === 'xls') return { kind: 'xlsx', ext, note: magic === 'zip' ? '' : '文件内容不像 Excel，可能已损坏' }
  if (ext === 'csv') return { kind: 'csv', ext, note: '' }
  if (ext === 'pdf' || magic === 'pdf') {
    if (magic !== 'pdf') return { kind: 'unsupported', ext, note: '扩展名是 PDF，但文件内容不是有效 PDF' }
    return { kind: 'pdf', ext, note: '' }
  }
  if (IMAGE_EXT.has(ext)) {
    if (magic && !['jpg', 'png', 'webp', 'heic'].includes(magic)) return { kind: 'unsupported', ext, note: '文件内容与图片扩展名不匹配' }
    return { kind: 'image', ext, note: '' }
  }
  if (VIDEO_EXT.has(ext)) return { kind: 'unsupported', ext, note: '当前版本未接入浏览器端音视频转码，暂不支持视频文件' }
  const guessed = EXT_KIND[ext]
  if (guessed) return { kind: guessed, ext, note: '' }
  return { kind: 'unsupported', ext, note: `暂不支持 .${ext || '未知'} 格式` }
}

export function targetsFor(kind: ConvertKind, ext: string): ConvertTarget[] {
  switch (kind) {
    case 'image':
      return ext === 'heic' || ext === 'heif' ? ['jpg'] : ['jpg', 'png', 'webp']
    case 'pdf':
      return ['png', 'jpg']
    case 'pdf-compose':
      return ['pdf']
    case 'csv':
      return ['xlsx']
    case 'xlsx':
      return ['csv']
    default:
      return []
  }
}

export function defaultTarget(kind: ConvertKind, ext: string): ConvertTarget {
  return targetsFor(kind, ext)[0]
}
