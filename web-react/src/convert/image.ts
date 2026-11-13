import { baseName, extOf } from './files'
import type { ConvertOutput, ConvertSettings, ConvertTarget } from './types'

type Drawable = ImageBitmap | HTMLImageElement

interface Decoded {
  drawable: Drawable
  width: number
  height: number
  dispose: () => void
}

async function decodeBlob(blob: Blob, signal?: AbortSignal): Promise<Decoded> {
  if (signal?.aborted) throw new Error('已取消')
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return { drawable: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() }
  } catch {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.src = url
    await image.decode()
    return {
      drawable: image, width: image.naturalWidth, height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    }
  }
}

async function blobToJpeg(file: File): Promise<Blob> {
  const ext = extOf(file.name)
  if (!['heic', 'heif'].includes(ext)) return file
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 })
  return Array.isArray(converted) ? converted[0] : converted
}

export async function decodeImageFile(file: File, signal?: AbortSignal): Promise<Decoded> {
  const blob = await blobToJpeg(file)
  return decodeBlob(blob, signal)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片编码失败，浏览器可能不支持该格式')), type, quality)
  })
}

export async function convertImage(
  file: File,
  target: ConvertTarget,
  settings: ConvertSettings,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ConvertOutput> {
  onProgress(10)
  const decoded = await decodeImageFile(file, signal)
  try {
    if (signal?.aborted) throw new Error('已取消')
    onProgress(45)
    const max = Math.max(decoded.width, decoded.height)
    const scale = settings.maxEdge > 0 && max > settings.maxEdge ? settings.maxEdge / max : 1
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建 Canvas')
    if (target === 'jpg') {
      context.fillStyle = settings.background || '#ffffff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(decoded.drawable as CanvasImageSource, 0, 0, width, height)
    const mime = target === 'png' ? 'image/png' : target === 'webp' ? 'image/webp' : 'image/jpeg'
    const blob = await toBlob(canvas, mime, (settings.quality || 90) / 100)
    onProgress(100)
    return { blob, name: `${baseName(file.name)}.${target}` }
  } finally {
    decoded.dispose()
  }
}

export async function imageForPdf(file: File, signal?: AbortSignal): Promise<{ dataUrl: string; width: number; height: number }> {
  const decoded = await decodeImageFile(file, signal)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width
    canvas.height = decoded.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建 Canvas')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, decoded.width, decoded.height)
    context.drawImage(decoded.drawable as CanvasImageSource, 0, 0, decoded.width, decoded.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: decoded.width, height: decoded.height }
  } finally {
    decoded.dispose()
  }
}
