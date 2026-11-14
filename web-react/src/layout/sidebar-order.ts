export const SIDEBAR_ORDER_EVENT = 'wb:sidebar-order-changed'

export function sidebarOrderKey(userId?: number) {
  return `wb_sidebar_order_${userId || 'guest'}`
}

export function readSidebarOrder(key: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaults
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of parsed) {
      if (typeof value === 'string' && defaults.includes(value) && !seen.has(value)) {
        seen.add(value)
        result.push(value)
      }
    }
    for (const value of defaults) if (!seen.has(value)) result.push(value)
    return result
  } catch {
    return defaults
  }
}

export function writeSidebarOrder(key: string, order: string[]) {
  try { localStorage.setItem(key, JSON.stringify(order)) } catch { /* localStorage may be unavailable */ }
  window.dispatchEvent(new Event(SIDEBAR_ORDER_EVENT))
}
