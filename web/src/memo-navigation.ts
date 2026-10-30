import type { LocationQuery, RouteLocationNormalizedLoaded } from 'vue-router'

export function memoFilter(query: LocationQuery) {
  const uncategorized = query.uncategorized === '1'
  const category = !uncategorized && typeof query.category === 'string' ? query.category : ''
  return { category, uncategorized }
}
export function memoPath(category?: string | null) {
  return category === undefined ? '/memos' : category === null ? '/memos?uncategorized=1' : `/memos?category=${encodeURIComponent(category)}`
}
export function isMemoActive(route: RouteLocationNormalizedLoaded, category?: string | null) {
  if (route.name !== 'memos') return false
  const selected = memoFilter(route.query)
  return category === undefined ? !selected.category && !selected.uncategorized : category === null ? selected.uncategorized : !selected.uncategorized && selected.category === category
}
export function memoTitle(query: LocationQuery) {
  const selected = memoFilter(query)
  return selected.uncategorized ? '未分类便利贴' : selected.category || '全部便利贴'
}
