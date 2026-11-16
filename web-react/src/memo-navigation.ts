export function memoFilter(search: string) {
  const params = new URLSearchParams(search)
  const uncategorized = params.get('uncategorized') === '1'
  const category = !uncategorized && params.get('category') ? String(params.get('category')) : ''
  return { category, uncategorized }
}

export function memoPath(category?: string | null) {
  return category === undefined ? '/memos' : category === null ? '/memos?uncategorized=1' : `/memos?category=${encodeURIComponent(category)}`
}

export function isMemoActive(pathname: string, search: string, category?: string | null) {
  if (pathname !== '/memos') return false
  const selected = memoFilter(search)
  return category === undefined
    ? !selected.category && !selected.uncategorized
    : category === null
      ? selected.uncategorized
      : !selected.uncategorized && selected.category === category
}

export function memoTitle(search: string) {
  const selected = memoFilter(search)
  return selected.uncategorized ? '未分类便利贴' : selected.category || '全部便利贴'
}
