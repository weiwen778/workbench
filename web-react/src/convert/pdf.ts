import { baseName } from './files'
import { imageForPdf } from './image'
import type { ConvertOutput, ConvertSettings, ConvertTarget } from './types'

const PDFJS_ASSETS = {
  cMapUrl: '/pdfjs/6.4.299/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/6.4.299/standard_fonts/',
  wasmUrl: '/pdfjs/6.4.299/wasm/',
}

export function parsePageRange(input: string, maxPage: number): number[] {
  const text = input.trim()
  if (!text) return Array.from({ length: maxPage }, (_, index) => index + 1)
  const pages = new Set<number>()
  for (const part of text.split(/[,，\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-~]\s*(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start < 1 || end > maxPage || start > end) throw new Error(`页码无效：${part}（当前共 ${maxPage} 页）`)
      for (let page = start; page <= end; page += 1) pages.add(page)
      continue
    }
    if (!/^\d+$/.test(part)) throw new Error(`页码格式无效：${part}`)
    const page = Number(part)
    if (page < 1 || page > maxPage) throw new Error(`页码越界：${part}（当前共 ${maxPage} 页）`)
    pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

export async function composePdf(
  files: File[],
  settings: ConvertSettings,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ConvertOutput> {
  if (!files.length) throw new Error('没有参与合成的图片')
  const { jsPDF } = await import('jspdf')
  const margin = Math.max(0, Math.min(30, settings.margin))
  let doc: any = null
  let first = true
  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) throw new Error('已取消')
    const image = await imageForPdf(files[index], signal)
    const landscape = image.width > image.height
    if (settings.pageSize === 'a4') {
      if (first) doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' })
      else doc.addPage('a4', landscape ? 'landscape' : 'portrait')
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const availableWidth = pageWidth - margin * 2
      const availableHeight = pageHeight - margin * 2
      const ratio = Math.min(availableWidth / image.width, availableHeight / image.height)
      const width = image.width * ratio
      const height = image.height * ratio
      doc.addImage(image.dataUrl, 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height)
    } else {
      if (first) {
        doc = new jsPDF({ unit: 'px', format: [image.width, image.height], orientation: landscape ? 'landscape' : 'portrait', hotfixes: ['px_scaling'] })
      } else {
        doc.addPage([image.width, image.height], landscape ? 'landscape' : 'portrait')
      }
      doc.addImage(image.dataUrl, 'JPEG', 0, 0, image.width, image.height)
    }
    first = false
    onProgress(Math.round(((index + 1) / files.length) * 90))
  }
  if (!doc) throw new Error('没有可合成的图片')
  doc.setProperties({ title: settings.outputName || '图片合成' })
  onProgress(96)
  const blob: Blob = doc.output('blob')
  onProgress(100)
  return { blob, name: settings.outputName || `图片合成-${files.length}张.pdf` }
}

async function pdfjs() {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjsLib
}

export async function pdfPageCount(file: File): Promise<number> {
  const { getDocument } = await pdfjs()
  try {
    const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...PDFJS_ASSETS }).promise
    const count = doc.numPages
    await (doc as any).destroy?.()
    return count
  } catch (error: any) {
    if (error?.name === "PasswordException") throw new Error("PDF 已加密，暂不支持转换，请先解除密码")
    throw new Error("PDF 无法打开，文件可能已损坏")
  }
}

export async function renderPdfPreview(blob: Blob, maxWidth = 420): Promise<string> {
  const { getDocument } = await pdfjs()
  const data = new Uint8Array(await blob.arrayBuffer())
  const doc = await getDocument({ data, ...PDFJS_ASSETS }).promise
  try {
    const page = await doc.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1.5, maxWidth / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建 Canvas')
    await page.render({ canvasContext: context, viewport, canvas }).promise
    return canvas.toDataURL('image/png')
  } finally {
    await (doc as any).destroy?.()
  }
}

export async function pdfPagesToImages(
  file: File,
  target: ConvertTarget,
  settings: ConvertSettings,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ConvertOutput[]> {
  const { getDocument, PasswordException } = await pdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  let doc
  try {
    doc = await getDocument({ data, ...PDFJS_ASSETS }).promise
  } catch (error: any) {
    if (error?.name === 'PasswordException' || error instanceof PasswordException) {
      throw new Error('PDF 已加密，暂不支持转换，请先解除密码')
    }
    throw new Error('PDF 无法打开，文件可能已损坏或加密')
  }
  try {
    const pages = parsePageRange(settings.pages, doc.numPages)
    const outputs: ConvertOutput[] = []
    const scale = Math.max(0.5, Math.min(4, settings.dpi || 2))
    for (let index = 0; index < pages.length; index += 1) {
      if (signal?.aborted) throw new Error('已取消')
      const pageNumber = pages[index]
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法创建 Canvas')
      await page.render({ canvasContext: context, viewport, canvas }).promise
      const mime = target === 'jpg' ? 'image/jpeg' : 'image/png'
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片编码失败')), mime, (settings.quality || 90) / 100)
      })
      outputs.push({ blob, name: `${baseName(file.name)}-第${pageNumber}页.${target}` })
      page.cleanup()
      onProgress(Math.round(((index + 1) / pages.length) * 100))
    }
    if (!outputs.length) throw new Error('没有可转换的页面')
    return outputs
  } finally {
    await (doc as any).destroy?.()
  }
}
