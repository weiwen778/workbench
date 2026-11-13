export type ConvertKind = 'image' | 'pdf' | 'pdf-compose' | 'csv' | 'xlsx'

export type ConvertTarget = 'jpg' | 'png' | 'webp' | 'pdf' | 'xlsx' | 'csv'

export type ItemStatus = 'waiting' | 'converting' | 'success' | 'failed' | 'cancelled'

export interface ConvertSettings {
  quality: number
  background: string
  maxEdge: number
  pageSize: 'fit' | 'a4'
  margin: number
  pages: string
  dpi: number
  delimiter: 'auto' | ',' | ';' | '\t' | '|'
  encoding: string
  hasHeader: boolean
  sheetMode: 'one' | 'all'
  sheetName: string
  outputName: string
}

export interface ConvertOutput {
  blob: Blob
  name: string
}

export interface ConvertResult {
  outputs: ConvertOutput[]
  previewUrl?: string
  previewKind?: 'image' | 'pdf' | 'table'
  columns?: string[]
  rows?: string[][]
  warnings?: string[]
  note?: string
}

export interface ConvertItem {
  id: string
  kind: ConvertKind
  file: File | null
  files: File[]
  name: string
  size: number
  sourceExt: string
  target: ConvertTarget
  settings: ConvertSettings
  status: ItemStatus
  progress: number
  message: string
  error: string
  result: ConvertResult | null
  thumbUrl?: string
  local: true
}

export interface ConvertPreset {
  id: string
  name: string
  kind: ConvertKind
  target: ConvertTarget
  settings: ConvertSettings
}

export interface ConvertLimits {
  imageMB: number
  pdfMB: number
  tableMB: number
  maxItems: number
  concurrency: number
  timeoutMin: number
}

export const DEFAULT_SETTINGS: ConvertSettings = {
  quality: 90,
  background: '#ffffff',
  maxEdge: 0,
  pageSize: 'fit',
  margin: 10,
  pages: '',
  dpi: 2,
  delimiter: 'auto',
  encoding: 'utf-8',
  hasHeader: true,
  sheetMode: 'one',
  sheetName: '',
  outputName: '',
}

export const DEFAULT_LIMITS: ConvertLimits = {
  imageMB: 50,
  pdfMB: 100,
  tableMB: 30,
  maxItems: 50,
  concurrency: 2,
  timeoutMin: 30,
}

export const TARGET_LABELS: Record<ConvertTarget, string> = {
  jpg: 'JPG', png: 'PNG', webp: 'WebP', pdf: 'PDF', xlsx: 'Excel', csv: 'CSV',
}

export const KIND_LABELS: Record<ConvertKind, string> = {
  image: '图片', pdf: 'PDF', 'pdf-compose': '图片合成 PDF', csv: 'CSV', xlsx: 'Excel',
}
