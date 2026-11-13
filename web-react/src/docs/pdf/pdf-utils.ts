import { PDFDocument, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, degrees, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { parsePageRange } from '@/convert/pdf'

export const MAX_PDF_BYTES = 100 * 1024 * 1024
const PDFJS_ASSETS = {
  cMapUrl: '/pdfjs/6.4.299/cmaps/', cMapPacked: true,
  standardFontDataUrl: '/pdfjs/6.4.299/standard_fonts/',
  wasmUrl: '/pdfjs/6.4.299/wasm/',
}

export interface PdfPageModel {
  id: string
  sourceKey: string
  pageIndex: number
  rotation: number
}

export type AnnotationType = 'highlight' | 'draw' | 'text' | 'check' | 'signature' | 'redaction'

export interface PdfAnnotation {
  id: string
  pageId: string
  type: AnnotationType
  color: string
  opacity: number
  rect?: { x: number; y: number; width: number; height: number }
  points?: { x: number; y: number }[]
  text?: string
  size?: number
  dataUrl?: string
}

export interface PageNumberOptions {
  enabled: boolean
  range: string
  format: string
  position: 'bottom-center' | 'bottom-right' | 'bottom-left'
  size: number
  color: string
  opacity: number
}

export interface WatermarkOptions {
  enabled: boolean
  range: string
  text: string
  size: number
  color: string
  opacity: number
  angle: number
}

export interface PdfSource {
  key: string
  name: string
  bytes: Uint8Array
  lib: PDFDocument
  pdf: any
  sizes: { width: number; height: number; rotation: number }[]
}

export interface FormField {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionlist' | 'signature' | 'unknown'
  value: string
  options: string[]
  readOnly: boolean
}

let pdfjsPromise: Promise<any> | null = null
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(async (lib: any) => {
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
    lib.GlobalWorkerOptions.workerSrc = workerUrl
    return lib
  })
  return pdfjsPromise
}

export function getPdfJs() { return pdfjs() }

let fontBytes: Promise<Uint8Array> | null = null
function cjkFontBytes() {
  if (!fontBytes) fontBytes = fetch('/fonts/NotoSansSC-Regular.ttf', { credentials: 'same-origin' }).then((response) => {
    if (!response.ok) throw new Error('中文字体加载失败，无法写入 PDF 文字')
    return response.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  })
  return fontBytes
}

export async function loadPdfSource(bytes: Uint8Array, name: string, key: string): Promise<PdfSource> {
  if (bytes.length > MAX_PDF_BYTES) throw new Error(`PDF 超过 ${MAX_PDF_BYTES / 1024 / 1024} MB 上限`)
  const header = new TextDecoder().decode(bytes.slice(0, 5))
  if (header !== '%PDF-') throw new Error('文件不是有效的 PDF')
  let lib: PDFDocument
  try {
    lib = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (error: any) {
    if (/encrypt/i.test(String(error?.message || error))) throw new Error('PDF 已加密；首版暂不支持受密码保护 PDF 的编辑和导出')
    throw new Error('PDF 无法打开，文件可能已损坏')
  }
  let pdf: any
  try {
    const libJs = await pdfjs()
    pdf = await libJs.getDocument({ data: bytes.slice(), ...PDFJS_ASSETS }).promise
  } catch (error: any) {
    if (error?.name === 'PasswordException') throw new Error('PDF 已加密；首版暂不支持受密码保护 PDF 的阅读和编辑')
    throw new Error('PDF 预览加载失败，文件可能已损坏')
  }
  const sizes = lib.getPages().map((page) => {
    const { width, height } = page.getSize()
    return { width, height, rotation: page.getRotation().angle }
  })
  return { key, name, bytes, lib, pdf, sizes }
}

export async function destroySource(source: PdfSource | undefined) {
  try { await source?.pdf?.destroy?.() } catch { /* ignore */ }
}

export function sourcePages(source: PdfSource): PdfPageModel[] {
  return source.sizes.map((_, index) => ({
    id: `${source.key}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    sourceKey: source.key,
    pageIndex: index,
    rotation: 0,
  }))
}

export function formFields(source: PdfSource): FormField[] {
  try {
    return source.lib.getForm().getFields().map((field: any) => {
      const name = field.getName()
      const readOnly = Boolean(field.isReadOnly?.())
      if (field instanceof PDFTextField) return { name, type: 'text', value: field.getText() || '', options: [], readOnly }
      if (field instanceof PDFCheckBox) return { name, type: 'checkbox', value: field.isChecked() ? 'true' : 'false', options: [], readOnly }
      if (field instanceof PDFDropdown) return { name, type: 'dropdown', value: field.getSelected()[0] || '', options: field.getOptions(), readOnly }
      if (field instanceof PDFRadioGroup) return { name, type: 'radio', value: field.getSelected() || '', options: field.getOptions(), readOnly }
      if (field instanceof PDFOptionList) return { name, type: 'optionlist', value: field.getSelected().join(','), options: field.getOptions(), readOnly }
      if (field instanceof PDFSignature) return { name, type: 'signature', value: '', options: [], readOnly: true }
      return { name, type: 'unknown', value: '', options: [], readOnly }
    })
  } catch { return [] }
}

export function hasSignature(source: PdfSource): boolean {
  return formFields(source).some((field) => field.type === 'signature')
}

function displaySize(rotation: number, width: number, height: number) {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width }
}

function pdfPointFromView(rotation: number, width: number, height: number, nx: number, ny: number) {
  const display = displaySize(rotation, width, height)
  const x = nx * display.width
  const y = ny * display.height
  if (rotation === 90) return { x: y, y: x }
  if (rotation === 180) return { x: width - x, y }
  if (rotation === 270) return { x: width - y, y: height - x }
  return { x, y: height - y }
}

function viewOffsetToPdf(rotation: number, dx: number, dy: number) {
  if (rotation === 90) return { x: dy, y: dx }
  if (rotation === 180) return { x: -dx, y: dy }
  if (rotation === 270) return { x: -dy, y: -dx }
  return { x: dx, y: -dy }
}

function rgbColor(value: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value || '')
  const hex = match ? match[1] : '000000'
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片生成失败')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

function canvasFor(width: number, height: number, scale = 2) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建 Canvas')
  context.scale(scale, scale)
  return { canvas, context }
}

async function textPng(text: string, size: number, color: string, opacity: number, font = 'sans-serif') {
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `${size}px ${font}`
  const width = Math.max(1, Math.ceil(measure.measureText(text).width + 4))
  const height = Math.max(1, Math.ceil(size * 1.35))
  const { canvas, context } = canvasFor(width, height)
  context.globalAlpha = opacity
  context.fillStyle = color
  context.font = `${size}px ${font}`
  context.textBaseline = 'bottom'
  context.fillText(text, 2, height - Math.max(1, size * 0.2))
  return { bytes: await canvasPng(canvas), width, height }
}

async function renderRedactedPage(source: PdfSource, pageIndex: number, redactions: PdfAnnotation[], rotation: number) {
  const page = await source.pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 2, rotation: 0 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建页面画布')
  await page.render({ canvasContext: context, viewport, canvas }).promise
  const { width, height } = source.sizes[pageIndex]
  context.fillStyle = '#000000'
  for (const item of redactions) {
    if (!item.rect) continue
    context.fillRect(
      Math.max(0, item.rect.x * 2),
      Math.max(0, (height - item.rect.y - item.rect.height) * 2),
      Math.max(0, item.rect.width * 2),
      Math.max(0, item.rect.height * 2),
    )
  }
  page.cleanup?.()
  return { bytes: await canvasPng(canvas), width, height }
}

function annotationColor(annotation: PdfAnnotation) { return rgbColor(annotation.color || '#f59e0b') }

async function drawAnnotation(
  page: any, annotation: PdfAnnotation, rotation: number, font: any, doc: PDFDocument,
) {
  const color = annotationColor(annotation)
  if (annotation.type === 'highlight' && annotation.rect) {
    page.drawRectangle({ ...annotation.rect, color, opacity: annotation.opacity })
  } else if (annotation.type === 'draw' && annotation.points?.length) {
    for (let index = 1; index < annotation.points.length; index += 1) {
      page.drawLine({
        start: annotation.points[index - 1], end: annotation.points[index],
        thickness: annotation.size || 2, color, opacity: annotation.opacity,
      })
    }
  } else if (annotation.type === 'check' && annotation.rect) {
    const { x, y, width, height } = annotation.rect
    page.drawLine({ start: { x, y: y + height * 0.5 }, end: { x: x + width * 0.4, y }, thickness: 2, color, opacity: annotation.opacity })
    page.drawLine({ start: { x: x + width * 0.4, y }, end: { x: x + width, y: y + height }, thickness: 2, color, opacity: annotation.opacity })
  } else if (annotation.type === 'text' && annotation.text && annotation.rect) {
    const size = annotation.size || 16
    const text = annotation.text.replace(/\s+/g, ' ')
    page.drawText(text, {
      x: annotation.rect.x, y: annotation.rect.y + Math.max(0, annotation.rect.height - size * 1.1),
      size, font, color, opacity: annotation.opacity, rotate: degrees(rotation),
    })
  } else if (annotation.type === 'signature' && annotation.dataUrl && annotation.rect) {
    const bytes = new Uint8Array(await (await fetch(annotation.dataUrl)).arrayBuffer())
    const image = annotation.dataUrl.includes('image/jpeg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
    page.drawImage(image, { ...annotation.rect, opacity: annotation.opacity })
  }
}

async function embedFont(doc: PDFDocument) {
  doc.registerFontkit(fontkit as any)
  return doc.embedFont(await cjkFontBytes(), { subset: false })
}

function applyForm(doc: PDFDocument, values: Record<string, string>, font: any) {
  const form = doc.getForm()
  for (const field of form.getFields()) {
    const value = values[field.getName()]
    if (value === undefined) continue
    try {
      if (field instanceof PDFTextField) field.setText(value)
      else if (field instanceof PDFCheckBox) { if (value === 'true') field.check(); else field.uncheck() }
      else if (field instanceof PDFDropdown) field.select(value)
      else if (field instanceof PDFRadioGroup) field.select(value)
      else if (field instanceof PDFOptionList) field.select(value.split(',').filter(Boolean))
    } catch { /* 单个字段失败不阻断导出 */ }
  }
  try { form.updateFieldAppearances(font) } catch { /* optional */ }
}

export interface ExportPdfOptions {
  pages: PdfPageModel[]
  sources: Map<string, PdfSource>
  annotations: PdfAnnotation[]
  pageNumber: PageNumberOptions
  watermark: WatermarkOptions
  formValues: Record<string, string>
  preserveForms: boolean
}

export async function exportPdf(options: ExportPdfOptions): Promise<{ blob: Blob; warnings: string[] }> {
  const { pages, sources, annotations, pageNumber, watermark, formValues, preserveForms } = options
  if (!pages.length) throw new Error('没有可导出的页面')
  const firstSource = sources.get(pages[0].sourceKey)
  if (!firstSource) throw new Error('页面来源已丢失')
  const warnings: string[] = []
  const onlySingleSource = new Set(pages.map((page) => page.sourceKey)).size === 1
  const redactedPages = new Set(annotations.filter((item) => item.type === 'redaction').map((item) => item.pageId))
  const formMode = preserveForms && onlySingleSource && !redactedPages.size
  const needsFont = formMode || pageNumber.enabled || watermark.enabled || annotations.some((item) => item.type === 'text')
  let doc: PDFDocument
  let font: any = null
  if (formMode) {
    doc = await PDFDocument.load(firstSource.bytes, { updateMetadata: false })
    font = await embedFont(doc)
    applyForm(doc, formValues, font)
    for (let index = 0; index < pages.length; index += 1) {
      const model = pages[index]
      const outputPage = doc.getPage(index)
      outputPage.setRotation(degrees((firstSource.sizes[model.pageIndex]?.rotation || 0) + model.rotation))
    }
  } else {
    doc = await PDFDocument.create()
    if (preserveForms || Object.keys(formValues).length) {
      warnings.push('当前页序经过合并/重排/删除或包含删密页，导出时无法保留 AcroForm 交互字段')
    }
  }
  if (needsFont && !font) font = await embedFont(doc)
  const pageAnnotations = new Map<string, PdfAnnotation[]>()
  for (const item of annotations) {
    if (!pageAnnotations.has(item.pageId)) pageAnnotations.set(item.pageId, [])
    pageAnnotations.get(item.pageId)!.push(item)
  }

  let outputIndex = 0
  for (const model of pages) {
    const source = sources.get(model.sourceKey)
    if (!source) throw new Error('页面来源已丢失，请重新导入 PDF')
    const sourceIndex = model.pageIndex
    const base = source.sizes[sourceIndex]
    const rotation = ((base?.rotation || 0) + model.rotation + 360) % 360
    let outputPage: any
    const redactions = (pageAnnotations.get(model.id) || []).filter((item) => item.type === 'redaction' && item.rect)
    if (redactions.length) {
      const image = await renderRedactedPage(source, sourceIndex, redactions, rotation)
      outputPage = doc.addPage([image.width, image.height])
      const embedded = await doc.embedPng(image.bytes)
      outputPage.drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height })
      outputPage.setRotation(degrees(rotation))
      warnings.push(`第 ${outputIndex + 1} 页含删密区域，已栅格化该页；文字层和交互表单不会保留`)
    } else if (formMode) {
      outputPage = doc.getPage(outputIndex)
    } else {
      const [copied] = await doc.copyPages(source.lib, [sourceIndex])
      copied.setRotation(degrees(rotation))
      outputPage = doc.addPage(copied)
    }
    for (const annotation of pageAnnotations.get(model.id) || []) {
      if (annotation.type === 'redaction') continue
      await drawAnnotation(outputPage, annotation, rotation, font, doc)
    }
    outputIndex += 1
  }

  if (pageNumber.enabled) {
    const range = parsePageRange(pageNumber.range, pages.length)
    for (const pageNo of range) {
      const page = doc.getPage(pageNo - 1)
      const rotation = page.getRotation().angle
      const { width, height } = page.getSize()
      const text = pageNumber.format.replace(/\{page\}/g, String(pageNo)).replace(/\{total\}/g, String(pages.length))
      const textWidth = font.widthOfTextAtSize(text, pageNumber.size)
      const xNorm = pageNumber.position === 'bottom-left' ? 0.05 : pageNumber.position === 'bottom-right' ? 0.95 : 0.5
      const anchor = pdfPointFromView(rotation, width, height, xNorm, 0.95)
      const offset = viewOffsetToPdf(rotation, pageNumber.position === 'bottom-left' ? 0 : pageNumber.position === 'bottom-right' ? -textWidth : -textWidth / 2, 0)
      page.drawText(text, {
        x: anchor.x + offset.x, y: anchor.y + offset.y, size: pageNumber.size, font,
        color: rgbColor(pageNumber.color), opacity: pageNumber.opacity, rotate: degrees(rotation),
      })
    }
  }
  if (watermark.enabled && watermark.text.trim()) {
    const range = parsePageRange(watermark.range, pages.length)
    for (const pageNo of range) {
      const page = doc.getPage(pageNo - 1)
      const rotation = page.getRotation().angle
      const { width, height } = page.getSize()
      const textWidth = font.widthOfTextAtSize(watermark.text, watermark.size)
      const angle = watermark.angle + rotation
      const radians = angle * Math.PI / 180
      const offsetX = -Math.cos(radians) * textWidth / 2
      const offsetY = -Math.sin(radians) * textWidth / 2
      page.drawText(watermark.text, {
        x: width / 2 + offsetX, y: height / 2 + offsetY, size: watermark.size, font,
        color: rgbColor(watermark.color), opacity: watermark.opacity, rotate: degrees(angle),
      })
    }
  }
  const bytes = await doc.save()
  return { blob: new Blob([bytes], { type: 'application/pdf' }), warnings: [...new Set(warnings)] }
}

export async function verifyRedactedPages(
  blob: Blob,
  pages: PdfPageModel[],
  annotations: PdfAnnotation[],
  pageNumber?: PageNumberOptions,
  watermark?: WatermarkOptions,
): Promise<boolean> {
  const redacted = new Set(annotations.filter((item) => item.type === 'redaction').map((item) => item.pageId))
  const indices = pages.map((page, index) => redacted.has(page.id) ? index + 1 : 0).filter(Boolean)
  if (!indices.length) return true
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...PDFJS_ASSETS }).promise
  try {
    for (const index of indices) {
      const page = await doc.getPage(index)
      const content = await page.getTextContent()
      let residue = content.items.map((item: any) => String(item.str || '')).join(' ').replace(/\s+/g, '')
      const pageId = pages[index - 1].id
      const expected: string[] = []
      if (pageNumber?.enabled && parsePageRange(pageNumber.range, pages.length).includes(index)) {
        expected.push(pageNumber.format.replace(/\{page\}/g, String(index)).replace(/\{total\}/g, String(pages.length)))
      }
      if (watermark?.enabled && watermark.text && parsePageRange(watermark.range, pages.length).includes(index)) {
        expected.push(watermark.text)
      }
      for (const annotation of annotations) {
        if (annotation.pageId === pageId && annotation.type === 'text' && annotation.text) expected.push(annotation.text)
      }
      for (const value of expected) residue = residue.split(value.replace(/\s+/g, '')).join('')
      if (residue.length) return false
      page.cleanup?.()
    }
    return true
  } finally { await doc.destroy?.() }
}
