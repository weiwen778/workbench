export interface InsertText {
  kind: 'text'
  text: string
  title?: string
  color?: string
}

export interface InsertImage {
  kind: 'image'
  id: string
  dataURL: string
  mimeType: string
  width: number
  height: number
  name?: string
}

export type InsertItem = InsertText | InsertImage

interface PendingInsert {
  token: string
  items: InsertItem[]
  createdAt: number
}

// The picker runs inside the SPA, so a module-level map is enough to carry the
// payload across the route change. Content stays in memory until consumed.
const pending = new Map<string, PendingInsert>()
const MAX_AGE = 30 * 60 * 1000

function cleanup() {
  const now = Date.now()
  pending.forEach((value, key) => {
    if (now - value.createdAt > MAX_AGE) pending.delete(key)
  })
}

export function stageInsert(items: InsertItem[]): string {
  cleanup()
  const token = `ins_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  pending.set(token, { token, items, createdAt: Date.now() })
  return token
}

export function takeInsert(token: string | null | undefined): InsertItem[] | null {
  if (!token) return null
  const entry = pending.get(token)
  if (!entry) return null
  pending.delete(token)
  return entry.items
}

export function discardInsert(token: string | null | undefined) {
  if (token) pending.delete(token)
}
