
export const SIDEBAR_ORDER_EVENT = 'wb:sidebar-order-changed'
export const SIDEBAR_MODE_EVENT = 'wb:sidebar-mode-changed'

export type SidebarMode = 'wide' | 'narrow'

export function sidebarOrderKey(userId?: number) {
  return `wb_sidebar_order_${userId || 'guest'}`
}

export function sidebarModeKey(userId?: number) {
  return `wb_sidebar_mode_${userId || 'guest'}`
}

function validKeys(values: unknown, defaults: string[]): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value === 'string' && defaults.includes(value) && !seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

/**
 * Reads the pinned navigation items. The old sidebar stored every module in
 * `wb_sidebar_order_*`; keep its order but pin only the first N so the rail
 * never has to scroll after upgrading.
 */
export function readPinnedKeys(userId: number | undefined, defaults: string[], allKeys: string[]): string[] {
  try {
    const raw = localStorage.getItem(sidebarOrderKey(userId))
    if (raw) {
      const values = JSON.parse(raw)
      const valid = validKeys(values, allKeys)
      const parsed = valid
      // Older orders can contain dynamic entries (for example a table id).
      // Fill defaults only when entries were dropped during migration; an
      // intentionally unpinned list must stay short, including an empty one.
      if (Array.isArray(values) && valid.length < values.length) {
        const seen = new Set(parsed)
        return [...parsed, ...defaults.filter((key) => !seen.has(key))]
      }
      if (Array.isArray(values)) return parsed
    }
  } catch {
    /* localStorage may be unavailable */
  }
  return defaults
}

export function writePinnedKeys(userId: number | undefined, keys: string[]) {
  try {
    localStorage.setItem(sidebarOrderKey(userId), JSON.stringify(keys))
  } catch {
    /* localStorage may be unavailable */
  }
  window.dispatchEvent(new Event(SIDEBAR_ORDER_EVENT))
}

export function readSidebarMode(userId: number | undefined): SidebarMode {
  try {
    return localStorage.getItem(sidebarModeKey(userId)) === 'wide' ? 'wide' : 'narrow'
  } catch {
    return 'narrow'
  }
}

export function writeSidebarMode(userId: number | undefined, mode: SidebarMode) {
  try {
    localStorage.setItem(sidebarModeKey(userId), mode)
  } catch {
    /* localStorage may be unavailable */
  }
  window.dispatchEvent(new Event(SIDEBAR_MODE_EVENT))
}

/** Kept for callers that only need to normalize an order list. */
export function readSidebarOrder(key: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaults
    const parsed = validKeys(JSON.parse(raw), defaults)
    const seen = new Set(parsed)
    return [...parsed, ...defaults.filter((value) => !seen.has(value))]
  } catch {
    return defaults
  }
}

/** Kept for callers that only need to persist an order list. */
export function writeSidebarOrder(key: string, order: string[]) {
  try { localStorage.setItem(key, JSON.stringify(order)) } catch { /* ignore */ }
  window.dispatchEvent(new Event(SIDEBAR_ORDER_EVENT))
}
