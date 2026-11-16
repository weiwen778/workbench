import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { DraftFile } from '@/whiteboard/db'

// Only the state needed to restore a session. Everything else (selection,
// collaborators, hover targets, active tool) is intentionally dropped.
const APP_STATE_KEYS = [
  'viewBackgroundColor', 'gridSize', 'gridModeEnabled', 'gridStep', 'gridMode',
  'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle',
  'currentItemStrokeWidth', 'currentItemStrokeStyle', 'currentItemRoughness',
  'currentItemOpacity', 'currentItemFontFamily', 'currentItemFontSize',
  'currentItemTextAlign', 'currentItemStartArrowhead', 'currentItemEndArrowhead',
  'currentItemRoundness', 'currentItemArrowType', 'currentItemLineHeight',
  'exportBackground', 'exportWithDarkMode', 'exportScale', 'exportEmbedScene',
  'zoom', 'scrollX', 'scrollY',
] as const

export function appStateForSave(appState: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!appState) return {}
  const result: Record<string, unknown> = {}
  for (const key of APP_STATE_KEYS) {
    if (appState[key] !== undefined) result[key] = appState[key]
  }
  return result
}

export function referencedFileIds(elements: readonly unknown[]): string[] {
  const ids = new Set<string>()
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const item = element as { type?: string; fileId?: string; isDeleted?: boolean }
    if (item.isDeleted) continue
    if (item.type === 'image' && item.fileId) ids.add(item.fileId)
  }
  return [...ids]
}

export function serializeFiles(files: BinaryFiles): DraftFile[] {
  return Object.values(files)
    .filter((file) => file && typeof file.dataURL === 'string' && file.dataURL.startsWith('data:'))
    .map((file) => ({
      id: file.id,
      dataURL: file.dataURL,
      mimeType: file.mimeType || 'image/png',
      created: file.created || Date.now(),
    }))
}

export function filesRecord(files: DraftFile[]): BinaryFiles {
  const record: BinaryFiles = {}
  for (const file of files) {
    if (!file?.id || !file.dataURL) continue
    record[file.id] = {
      id: file.id,
      dataURL: file.dataURL,
      mimeType: file.mimeType || 'image/png',
      created: file.created || Date.now(),
      lastRetrieved: Date.now(),
    } as BinaryFiles[string]
  }
  return record
}

export function elementHash(elements: readonly ExcalidrawElement[]): string {
  // Local, cheap signature used to tell content changes from viewport-only
  // appState changes. Excalidraw bumps version/versionNonce on every edit.
  return elements.map((element) => `${element.id}:${element.version}:${element.versionNonce}:${element.isDeleted ? 1 : 0}`).join('|')
}

const STYLE_KEYS = [
  'viewBackgroundColor', 'gridSize', 'gridModeEnabled', 'gridStep', 'gridMode',
  'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle',
  'currentItemStrokeWidth', 'currentItemStrokeStyle', 'currentItemRoughness',
  'currentItemOpacity', 'currentItemFontFamily', 'currentItemFontSize',
  'currentItemTextAlign', 'currentItemStartArrowhead', 'currentItemEndArrowhead',
  'currentItemRoundness', 'currentItemArrowType', 'currentItemLineHeight',
] as const

export function styleHash(appState: Record<string, unknown> | null | undefined): string {
  if (!appState) return ''
  return STYLE_KEYS.map((key) => `${key}:${String(appState[key] ?? '')}`).join('|')
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export function safeFileStem(value: string) {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'whiteboard'
}

export function insertFileId() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `wbimg_${random}`.slice(0, 80)
}
