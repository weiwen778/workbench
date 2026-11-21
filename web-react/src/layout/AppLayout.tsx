import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, Badge, Box, Button, IconButton, Paper, Toolbar, Tooltip,
} from '@mui/material'
import {
  BugIcon, Calendar, CheckCircle, Collection, ListIcon, Moon, MoreFilled,
  PanelLeftIcon, Search, Setting, Sunny, Todo,
} from '@/icons'
import AppRail from './AppRail'
import { NavAllDrawer } from './NavPanels'
import { APP_NAV_KEYS, DEFAULT_PINNED_KEYS } from './app-nav'
import { readPinnedKeys, readSidebarMode, writePinnedKeys, writeSidebarMode, SIDEBAR_MODE_EVENT, SIDEBAR_ORDER_EVENT, type SidebarMode } from './sidebar-order'
import GlobalSearchDialog from '@/components/GlobalSearchDialog'
import FeedbackDialog from '@/components/FeedbackDialog'
import WorkspaceToolsDialog from '@/components/WorkspaceToolsDialog'
import PageTransition from '@/motion/components/PageTransition'
import SkeletonPulse from '@/motion/components/SkeletonPulse'
import { buildGroups, type SidebarData } from './nav'
import { http, apiError } from '@/api/client'
import { toggleTheme, useSession } from '@/session'
import { toast } from '@/ui/feedback'

const EMPTY_DATA: SidebarData = {
  checkinTargets: [], tables: [], dashboards: [], todoLists: [], noteFolders: [],
  uncategorizedCount: 0, memoCategories: [], bookmarkCategories: [],
}

export const MODULE_KEYS = ['checkin', 'visualizations', 'data', 'todos', 'notes', 'memos', 'bookmarks']

function memoTitle(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('uncategorized') === '1') return '未分类便利贴'
  return params.get('category') || '全部便利贴'
}

export default function AppLayout() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsView, setToolsView] = useState<'tasks' | 'activity'>('tasks')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [taskCount, setTaskCount] = useState(0)
  const [data, setData] = useState<SidebarData>(EMPTY_DATA)
  const groups = useMemo(() => buildGroups(data), [data])
  const [navMode, setNavMode] = useState<SidebarMode>(() => readSidebarMode(session.user?.id))
  const [pinned, setPinned] = useState<string[]>(() => readPinnedKeys(session.user?.id, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))

  const loadTargets = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/work-targets')
      setData((prev) => ({ ...prev, checkinTargets: payload }))
    } catch { /* 保留旧目录 */ }
  }, [])
  const loadTables = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/tables')
      setData((prev) => ({ ...prev, tables: payload }))
    } catch { /* 保留旧目录 */ }
  }, [])
  const loadDashboards = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/dashboards')
      setData((prev) => ({ ...prev, dashboards: payload }))
    } catch { /* 保留旧目录 */ }
  }, [])
  const loadTodoLists = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/todo-lists')
      setData((prev) => ({ ...prev, todoLists: payload }))
    } catch { /* 保留旧目录 */ }
  }, [])
  const loadNoteFolders = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/note-folders')
      setData((prev) => ({ ...prev, noteFolders: payload.folders, uncategorizedCount: payload.uncategorized }))
    } catch { /* 保留旧目录 */ }
  }, [])
  const loadMemoCategories = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/memos/categories')
      setData((prev) => ({ ...prev, memoCategories: payload }))
    } catch { /* 保留旧目录 */ }
  }, [])
  const loadBookmarkCategories = useCallback(async () => {
    try {
      const { data: payload } = await http.get('/bookmarks/categories')
      setData((prev) => ({ ...prev, bookmarkCategories: payload }))
    } catch { /* 保留旧目录 */ }
  }, [])

  const loadAll = useCallback(() => {
    void loadTargets(); void loadTables(); void loadDashboards(); void loadTodoLists()
    void loadNoteFolders(); void loadMemoCategories(); void loadBookmarkCategories()
  }, [loadTargets, loadTables, loadDashboards, loadTodoLists, loadNoteFolders, loadMemoCategories, loadBookmarkCategories])

  useEffect(() => {
    loadAll()
    const handlers: Record<string, () => void> = {
      'wb:checkins-changed': loadTargets,
      'wb:tables-changed': loadTables,
      'wb:dashboards-changed': loadDashboards,
      'wb:todos-changed': loadTodoLists,
      'wb:notes-changed': loadNoteFolders,
      'wb:memos-changed': loadMemoCategories,
      'wb-bookmarks-changed': loadBookmarkCategories,
      focus: loadAll,
    }
    Object.entries(handlers).forEach(([event, fn]) => window.addEventListener(event, fn))
    return () => Object.entries(handlers).forEach(([event, fn]) => window.removeEventListener(event, fn))
  }, [loadAll, loadTargets, loadTables, loadDashboards, loadTodoLists, loadNoteFolders, loadMemoCategories, loadBookmarkCategories])

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const sync = () => {
      setNavMode(readSidebarMode(session.user?.id))
      setPinned(readPinnedKeys(session.user?.id, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))
    }
    sync()
    window.addEventListener(SIDEBAR_MODE_EVENT, sync)
    window.addEventListener(SIDEBAR_ORDER_EVENT, sync)
    return () => {
      window.removeEventListener(SIDEBAR_MODE_EVENT, sync)
      window.removeEventListener(SIDEBAR_ORDER_EVENT, sync)
    }
  }, [session.user?.id])

  useEffect(() => {
    if (!narrow) setDrawerOpen(false)
  }, [narrow])

  const toggleNavMode = () => {
    const next: SidebarMode = navMode === 'wide' ? 'narrow' : 'wide'
    setNavMode(next)
    writeSidebarMode(session.user?.id, next)
  }

  const updatePinned = (keys: string[]) => {
    const next = keys
    setPinned(next)
    writePinnedKeys(session.user?.id, next)
  }

  const togglePin = (key: string) => {
    if (pinned.includes(key)) updatePinned(pinned.filter((value) => value !== key))
    else updatePinned([...pinned, key])
  }

  useEffect(() => {
    const openTasks = () => { setToolsView('tasks'); setToolsOpen(true) }
    const openActivity = () => { setToolsView('activity'); setToolsOpen(true) }
    window.addEventListener('wb:open-tasks', openTasks)
    window.addEventListener('wb:open-activity', openActivity)
    return () => {
      window.removeEventListener('wb:open-tasks', openTasks)
      window.removeEventListener('wb:open-activity', openActivity)
    }
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      if (document.hidden) return
      try {
        const { data } = await http.get('/tasks/summary')
        if (active) setTaskCount((data.active || 0) + (data.failed || 0) + (data.agent_pending || 0))
      } catch { /* 角标失败不阻塞导航 */ }
    }
    void load()
    const timer = window.setInterval(load, 60000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    setDrawerOpen(false)
    setSearchOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey && !event.defaultPrevented) {
        const target = event.target as HTMLElement | null
        if (target?.closest('input,textarea,[contenteditable=true],.univer-host,.excalidraw')) return
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pageTitle = useMemo(() => {
    const path = location.pathname
    if (path.startsWith('/settings')) return '设置'
    if (path === '/memos') return memoTitle(location.search)
    const target = data.checkinTargets.find((item) => path === `/checkins/items/${item.id}`)
    if (target) return target.name
    if (path === '/checkins/shops') return session.user?.checkin_shop_label || '店铺打卡'
    if (path === '/checkins/social') return session.user?.checkin_social_label || '社媒打卡'
    if (path.startsWith('/checkins/targets/')) return '资料'
    if (path.startsWith('/data/')) {
      const id = path.split('/')[2]
      return data.tables.find((table) => String(table.id) === id)?.name || '表格'
    }
    if (path.startsWith('/visualizations/')) {
      const id = path.split('/')[2]
      return data.dashboards.find((board) => String(board.id) === id)?.name || '数据可视化'
    }
    if (path.startsWith('/todos/')) {
      const id = path.split('/')[2]
      return data.todoLists.find((list) => String(list.id) === id)?.name || '待办'
    }
    if (path.startsWith('/notes/')) {
      const key = path.split('/')[2]
      if (key === 'uncategorized') return '未分类笔记'
      return data.noteFolders.find((folder) => String(folder.id) === key)?.name || '笔记'
    }
    if (path.startsWith('/whiteboards/')) return '白板'
    return ({
      '/checkins': '打卡',
      '/visualizations': '数据可视化',
      '/data': '表格',
      '/notes': '笔记',
      '/todos': '待办',
      '/translate': '翻译',
      '/images': '图片处理',
      '/convert': '格式转换',
      '/color': '取色与颜色格式',
      '/codes': '二维码与条码',
      '/docs': '文档工作台',
      '/whiteboards': '白板',
      '/bookmarks': '网址导航',
    } as Record<string, string>)[path] || 'Nexus'
  }, [location.pathname, location.search, data, session.user])

  useEffect(() => {
    document.title = `${pageTitle} · Nexus`
  }, [pageTitle])

  const scrollable = useMemo(() => {
    const path = location.pathname
    // 笔记页自己管理左右分栏和滚动，外层不能再滚动。
    if (path === '/notes' || path.startsWith('/notes/')) return false
    if (['/visualizations', '/data', '/memos'].includes(path)) return true
    return ['/visualizations/', '/memos'].some((prefix) => path.startsWith(prefix))
  }, [location.pathname])

  const bottomNav = [
    { key: 'checkin', label: '打卡', path: '/checkins', icon: Calendar },
    { key: 'todos', label: '待办', path: '/todos', icon: Todo },
    { key: 'data', label: '表格', path: '/data', icon: Collection },
    { key: 'more', label: '更多', path: '', icon: MoreFilled },
  ]
  const initials = (session.user?.username || 'admin').slice(0, 2).toUpperCase()

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {!narrow ? (
        <AppRail
          mode={navMode}
          pinned={pinned}
          groups={groups}
        />
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0 }}>
        <AppBar position="static" color="transparent" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1, minHeight: { xs: 52, md: 56 }, px: { xs: 1.5, md: 2 } }}>
            {narrow ? (
              <IconButton size="small" aria-label="打开导航" onClick={() => setDrawerOpen(true)}><ListIcon /></IconButton>
            ) : (
              <Tooltip title={navMode === 'wide' ? '收起侧栏' : '展开侧栏'}>
                <IconButton
                  size="small"
                  aria-label={navMode === 'wide' ? '收起侧栏' : '展开侧栏'}
                  onClick={toggleNavMode}
                  sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
                >
                  <PanelLeftIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            <Button
              onClick={() => setSearchOpen(true)}
              startIcon={<Search sx={{ fontSize: 16 }} />}
              sx={{
                display: { xs: 'none', md: 'inline-flex' }, width: 240, justifyContent: 'flex-start',
                color: 'text.secondary', bgcolor: 'background.paper', border: 1, borderColor: 'divider',
                fontWeight: 400, height: 32, borderRadius: 1, px: 1.25,
                '&:hover': { bgcolor: 'action.hover', borderColor: 'text.disabled' },
              }}
            >
              搜索
              <Box component="kbd" sx={{ ml: 'auto', fontSize: 11.5, color: 'text.disabled', fontFamily: 'inherit' }}>Ctrl K</Box>
            </Button>
            <Tooltip title="搜索">
              <IconButton size="small" aria-label="搜索" sx={{ display: { xs: 'inline-flex', md: 'none' } }} onClick={() => setSearchOpen(true)}>
                <Search sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="任务中心">
              <IconButton
                size="small"
                aria-label="任务中心"
                color={toolsOpen ? 'primary' : 'default'}
                onClick={() => { setToolsView('tasks'); setToolsOpen(true) }}
              >
                <Badge badgeContent={taskCount} max={99} color="primary" invisible={!taskCount}><CheckCircle sx={{ fontSize: 18 }} /></Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="反馈问题或提需求">
              <IconButton
                size="small"
                aria-label="反馈问题或提需求"
                color={feedbackOpen ? 'primary' : 'default'}
                onClick={() => setFeedbackOpen(true)}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                <BugIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="切换浅色／深色主题">
              <span>
                <IconButton
                  size="small"
                  aria-label="切换主题"
                  disabled={session.appearanceSaving}
                  onClick={() => { void toggleTheme().catch((error) => toast.error(apiError(error).message)) }}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                >
                  {session.theme === 'dark' ? <Sunny sx={{ fontSize: 18 }} /> : <Moon sx={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="设置">
              <IconButton
                size="small"
                aria-label="设置"
                color={location.pathname.startsWith('/settings') ? 'primary' : 'default'}
                onClick={() => navigate('/settings')}
              >
                <Setting sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Box
              role="button"
              tabIndex={0}
              aria-label="账号与设置"
              onClick={() => navigate('/settings')}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/settings') } }}
              sx={{
                width: 30, height: 30, borderRadius: '50%', bgcolor: 'action.selected',
                display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 600,
                cursor: 'pointer', flexShrink: 0, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
              }}
            >
              {initials}
            </Box>
          </Toolbar>
        </AppBar>

        <Box sx={{ flex: 1, minHeight: 0, overflow: scrollable ? 'auto' : 'hidden', pb: narrow ? 7 : 0 }}>
          <PageTransition
            narrow={narrow}
            style={{ height: scrollable ? 'auto' : '100%', minHeight: scrollable ? '100%' : 0 }}
          >
            <Suspense fallback={<SkeletonPulse text="正在打开…" />}>
              <Outlet />
            </Suspense>
          </PageTransition>
        </Box>
      </Box>

      <NavAllDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pinned={pinned}
        onTogglePin={togglePin}
      />


      {narrow ? (
        <Paper
          square
          sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1200, borderTop: 1, borderColor: 'divider', display: 'flex', height: 56 }}
        >
          {bottomNav.map((item) => {
            const Icon = item.icon
            const active = item.path ? location.pathname === item.path || location.pathname.startsWith(item.path + '/') : false
            return (
              <Box
                key={item.key}
                role="button"
                tabIndex={0}
                aria-label={item.label}
                onClick={() => item.path ? navigate(item.path) : setDrawerOpen(true)}
                onKeyDown={(event) => { if (event.key === 'Enter') { item.path ? navigate(item.path) : setDrawerOpen(true) } }}
                sx={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.25,
                  fontSize: 11, cursor: 'pointer', color: active ? 'primary.main' : 'text.secondary',
                }}
              >
                <Icon sx={{ fontSize: 20 }} />
                {item.label}
              </Box>
            )
          })}
        </Paper>
      ) : null}

      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <WorkspaceToolsDialog open={toolsOpen} initialView={toolsView} onClose={() => setToolsOpen(false)} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </Box>
  )
}
