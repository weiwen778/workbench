// IndexedDB-backed drafts for the whiteboard module. Kept dependency-free so
// the editor can write local recovery data without touching the network.
export interface DraftFile {
  id: string
  dataURL: string
  mimeType: string
  created: number
}

export interface WhiteboardDraft {
  key: string
  userId: number
  boardId: number
  elements: readonly unknown[]
  appState: Record<string, unknown>
  files: DraftFile[]
  baseVersion: number
  dirty: boolean
  updatedAt: number
}

export type DraftWriteResult =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'unavailable' | 'error'; message: string }

const DB_NAME = 'nexus-whiteboard'
const STORE = 'drafts'
const DB_VERSION = 1
const PREFIX = 'wb-draft-v1'

let dbPromise: Promise<IDBDatabase> | null = null
let unavailableReason = ''

export function draftKey(userId: number, boardId: number) {
  return `${PREFIX}:${userId}:${boardId}`
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本地草稿存储'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('无法打开本地草稿存储'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('user', 'userId', { unique: false })
        store.createIndex('board', ['userId', 'boardId'], { unique: false })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error || new Error('无法打开本地草稿存储'))
    request.onblocked = () => reject(new Error('本地草稿存储被其他标签页占用'))
  })
  dbPromise = pending.catch((error): never => {
    dbPromise = null
    unavailableReason = error instanceof Error ? error.message : '本地草稿存储不可用'
    throw error
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, task: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>
    try {
      const tx = db.transaction(STORE, mode)
      request = task(tx.objectStore(STORE))
    } catch (error) {
      reject(error)
      return
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('本地草稿操作失败'))
  }))
}

function explain(error: unknown): DraftWriteResult {
  const name = (error as { name?: string } | null)?.name || ''
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return { ok: false, reason: 'quota', message: '本地草稿空间不足，请先保存白板或导出后再继续编辑' }
  }
  return { ok: false, reason: 'error', message: (error instanceof Error ? error.message : '') || unavailableReason || '本地草稿写入失败' }
}

export async function loadDraft(userId: number, boardId: number): Promise<WhiteboardDraft | null> {
  try {
    const record = await run<WhiteboardDraft | undefined>('readonly', (store) => store.get(draftKey(userId, boardId)))
    if (!record) return null
    if (record.userId !== userId || record.boardId !== boardId) return null
    return record
  } catch {
    return null
  }
}

export async function saveDraft(draft: WhiteboardDraft): Promise<DraftWriteResult> {
  try {
    await run('readwrite', (store) => store.put(draft))
    return { ok: true }
  } catch (error) {
    return explain(error)
  }
}

export async function deleteDraft(userId: number, boardId: number): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(draftKey(userId, boardId)))
  } catch {
    /* 清理失败不影响当前编辑 */
  }
}

export async function listDraftBoardIds(userId: number): Promise<number[]> {
  try {
    const records = await run<WhiteboardDraft[]>('readonly', (store) => store.index('user').getAll(userId))
    return records.filter((record) => record.dirty).map((record) => record.boardId)
  } catch {
    return []
  }
}
