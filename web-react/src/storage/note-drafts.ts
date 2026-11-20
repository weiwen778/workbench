/**
 * 笔记草稿的本地兜底。
 *
 * 服务端自动保存有 1.5 秒防抖；如果用户在这段时间内刷新、切页或关闭标签页，
 * 浏览器不一定来得及把 PUT 发出去。把最新内容同步写到 localStorage，重新打开
 * 笔记时可以恢复，避免“刚写的字丢了”。
 *
 * 草稿只保留内容快照，成功保存到服务端后会删除。
 * 用 localStorage 而不是 Dexie：pagehide/卸载阶段只能同步写入，异步 IndexedDB
 * 可能来不及完成。键按账号隔离，退出登录时由 session 统一清理。
 */
const PREFIX = 'wb_note_draft_v1:'

export interface NoteDraft {
  title: string
  content: string
  folderId: number | null
  tagNames: string[]
  /** 生成草稿时服务端的版本号，用于判断服务端是否已经更新过。 */
  version: number
  userId: number
}

function key(noteId: number, userId: number) {
  return `${PREFIX}${userId}:${noteId}`
}

function userPrefix(userId: number) {
  return `${PREFIX}${userId}:`
}

export function readNoteDraft(noteId: number, userId: number): NoteDraft | null {
  try {
    const raw = localStorage.getItem(key(noteId, userId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<NoteDraft>
    if (typeof value.content !== 'string' || typeof value.title !== 'string') return null
    if (Number(value.userId) !== userId) return null
    return {
      title: value.title,
      content: value.content,
      folderId: typeof value.folderId === 'number' ? value.folderId : null,
      tagNames: Array.isArray(value.tagNames) ? value.tagNames.filter((tag): tag is string => typeof tag === 'string') : [],
      version: Number(value.version) || 0,
      userId,
    }
  } catch {
    return null
  }
}

export function writeNoteDraft(noteId: number, userId: number, draft: Omit<NoteDraft, 'userId'>): boolean {
  try {
    localStorage.setItem(key(noteId, userId), JSON.stringify({ ...draft, userId }))
    return true
  } catch {
    return false
  }
}

export function clearNoteDraft(noteId: number, userId: number): void {
  try {
    localStorage.removeItem(key(noteId, userId))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 退出登录时清掉这个账号的所有笔记草稿，避免下一个账号读到旧数据。 */
export function clearNoteDrafts(userId: number): void {
  if (!userId) return
  try {
    const prefix = userPrefix(userId)
    for (const storageKey of Object.keys(localStorage)) {
      if (storageKey.startsWith(prefix)) localStorage.removeItem(storageKey)
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
