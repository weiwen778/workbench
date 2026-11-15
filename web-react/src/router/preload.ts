/** 页面按需加载，导航悬停时预取，避免点击后再出现整块加载。 */
const loaders: Array<[string, () => Promise<unknown>]> = [
  ['/checkins', () => import('@/pages/Checkin')],
  ['/visualizations', () => import('@/pages/Dashboard')],
  ['/data', () => import('@/pages/TableRoute')],
  ['/todos', () => import('@/pages/Todos')],
  ['/notes', () => import('@/pages/Notes')],
  ['/memos', () => import('@/pages/Memos')],
  ['/translate', () => import('@/pages/Translate')],
  ['/images', () => import('@/pages/Images')],
  ['/convert', () => import('@/pages/Convert')],
  ['/color', () => import('@/pages/Color')],
  ['/codes', () => import('@/pages/Codes')],
  ['/docs', () => import('@/pages/Docs')],
  ['/whiteboards', () => import('@/pages/Whiteboards')],
  ['/bookmarks', () => import('@/pages/Bookmarks')],
  ['/pet', () => import('@/pages/Pet')],
  ['/settings', () => import('@/pages/Settings')],
]

export function preloadPath(path: string) {
  if (path === '/data') { void import('@/pages/Tables'); return }
  if (path.startsWith('/data/')) { void import('@/pages/TableRoute'); return }
  const match = loaders.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'))
  if (match) void match[1]()
}
