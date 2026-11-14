import { localDb, type DocumentDraftRecord } from './db'

export const DOCUMENT_DRAFT_SCHEMA = 1
export const DOCUMENT_DRAFT_MAX_BYTES = 4 * 1024 * 1024

const LEGACY_KEY = 'wb_docs_document_draft_v1'
const FALLBACK_PREFIX = 'wb_docs_document_draft_v2'

export interface DocumentDraft {
  title: string
  markdown: string
  format: string
  savedAt: string
}

export type DocumentDraftSaveResult =
  | { ok: true; storage: 'indexeddb' | 'localstorage' }
  | { ok: false; reason: 'quota' | 'too-large' | 'unavailable' | 'error'; message: string }

export function documentDraftKey(userId: number) {
  return `${userId}:document`
}

function fallbackKey(userId: number) {
  return `${FALLBACK_PREFIX}:${userId}`
}

function normalize(value: unknown): DocumentDraft | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.markdown !== 'string' || !raw.markdown.trim()) return null
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : '未命名文档',
    markdown: raw.markdown,
    format: typeof raw.format === 'string' && raw.format ? raw.format : 'markdown',
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
  }
}

function isQuotaError(error: unknown) {
  const name = (error as { name?: string } | null)?.name || ''
  const message = error instanceof Error ? error.message : ''
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(message)
}

function readFallback(userId: number): DocumentDraft | null {
  try {
    const raw = localStorage.getItem(fallbackKey(userId))
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function readLegacy(): DocumentDraft | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeFallback(userId: number, draft: DocumentDraft): boolean {
  try {
    localStorage.setItem(fallbackKey(userId), JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

function removeFallback(userId: number) {
  try { localStorage.removeItem(fallbackKey(userId)) } catch { /* ignore */ }
}

/**
 * Loads the recoverable draft for one account. The old single-key
 * localStorage draft is migrated once, then removed so it cannot leak into a
 * different account.
 */
export async function loadDocumentDraft(userId: number): Promise<DocumentDraft | null> {
  if (!userId) return null
  const key = documentDraftKey(userId)
  let indexed: DocumentDraft | null = null
  let indexedAt = 0
  try {
    const record = await localDb.documentDrafts.get(key)
    if (record && record.schemaVersion === DOCUMENT_DRAFT_SCHEMA) {
      indexed = normalize(record)
      indexedAt = record.updatedAt || Date.parse(record.savedAt) || 0
    } else if (record) {
      await localDb.documentDrafts.delete(key)
    }
  } catch {
    // IndexedDB can be unavailable (private mode, blocked storage). The
    // localStorage fallback below keeps recovery working.
  }

  const fallback = readFallback(userId)
  const fallbackAt = fallback ? Date.parse(fallback.savedAt) || 0 : 0
  if (indexed && indexedAt >= fallbackAt) return indexed
  if (fallback) return fallback

  const legacy = readLegacy()
  if (legacy) {
    const saved = await saveDocumentDraft(userId, legacy)
    if (saved.ok) {
      try { localStorage.removeItem(LEGACY_KEY) } catch { /* ignore */ }
    }
  }
  return legacy
}

export async function saveDocumentDraft(userId: number, draft: DocumentDraft): Promise<DocumentDraftSaveResult> {
  if (!userId) return { ok: false, reason: 'unavailable', message: '当前账号不可用，未写入本地草稿' }
  let bytes = 0
  try { bytes = new Blob([draft.markdown]).size } catch { bytes = draft.markdown.length }
  if (bytes > DOCUMENT_DRAFT_MAX_BYTES) {
    return { ok: false, reason: 'too-large', message: '内容超过 4 MB，未写入浏览器本地草稿；请保存项目或导出' }
  }
  const record: DocumentDraftRecord = {
    key: documentDraftKey(userId),
    userId,
    title: draft.title,
    markdown: draft.markdown,
    format: draft.format,
    savedAt: draft.savedAt,
    updatedAt: Date.now(),
    schemaVersion: DOCUMENT_DRAFT_SCHEMA,
  }
  try {
    await localDb.documentDrafts.put(record)
    removeFallback(userId)
    return { ok: true, storage: 'indexeddb' }
  } catch (error) {
    // IndexedDB and localStorage have separate quotas; a small fallback copy
    // is still better than silently dropping the user's draft.
    if (writeFallback(userId, draft)) return { ok: true, storage: 'localstorage' }
    if (isQuotaError(error)) {
      return { ok: false, reason: 'quota', message: '本地草稿空间不足，请保存项目或导出后继续编辑' }
    }
    return { ok: false, reason: 'error', message: '浏览器本地草稿写入失败，请保存项目或导出' }
  }
}

export async function clearDocumentDraft(userId: number): Promise<void> {
  if (!userId) return
  removeFallback(userId)
  try { await localDb.documentDrafts.delete(documentDraftKey(userId)) } catch { /* ignore */ }
}
