import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, Badge, Box, Button, CircularProgress, IconButton, Paper, Stack, Toolbar, Tooltip,
  Typography,
} from '@mui/material'
import {
  ChecklistRtl, DarkModeOutlined, EventAvailable, LightModeOutlined, List as ListIcon, MoreHoriz,
  Search, Settings, TableChart, TaskAlt,
} from '@mui/icons-material'
import AppRail from './AppRail'
import ModuleTabs from './ModuleTabs'
import { ManageNavDialog, NavAllDrawer } from './NavPanels'
import { APP_NAV_KEYS, DEFAULT_PINNED_KEYS, MAX_PINNED } from './app-nav'
import { readPinnedKeys, readSidebarMode, writePinnedKeys, writeSidebarMode, type SidebarMode } from './sidebar-order'
import GlobalSearchDialog from '@/components/GlobalSearchDialog'
import WorkspaceToolsDialog from '@/components/WorkspaceToolsDialog'
import { buildGroups, toolItems, type SidebarData } from './nav'
import { http, apiError } from '@/api/client'
import { toggleTheme, useSession } from '@/session'
import { toast } from '@/ui/feedback'

const EMPTY_DATA: SidebarData = {
  checkinTargets: [], tables: [], dashboards: [], todoLists: [], noteFolders: [],
  uncategorizedCount: 0, memoCategories: [], bookmarkCategories: [],
}

export const MODULE_KEYS = ['checkin', 'visualizations', 'data', 'todos', 'notes', 'memos', 'bookmarks']

function moduleKeyFromPath(pathname: string) {
  if (pathname.startsWith('/checkins')) return 'checkin'
  if (pathname.startsWith('/data')) return 'data'
  if (pathname.startsWith('/todos')) return 'todos'
  if (pathname.startsWith('/notes')) return 'notes'
  if (pathname.startsWith('/memos')) return 'memos'
  if (pathname.startsWith('/visualizations')) return 'visualizations'
  if (pathname.startsWith('/bookmarks')) return 'bookmarks'
  return ''
}

function memoTitle(search: string) {
  const params = new URLSearchParams(search)
  if (params.get('uncategorized') === '1') return '未分类便利贴'
  return params.get('category') || '全部便利贴'
}

export default function AppLayout() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const groups = useMemo(() => buildGroups(EMPTY_DATA), [])

  const [narrow, setNarrow] = useState(() => window.innerWidth < 900)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [allNavOpen, setAllNavOpen] = useState(false)
  const [manageNavOpen, setManageNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsView, setToolsView] = useState<'tasks' | 'activity'>('tasks')
  const [taskCount, setTaskCount] = useState(0)
  const [data, setData] = useState<SidebarData>(EMPTY_DATA)
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
    setNavMode(readSidebarMode(session.user?.id))
    setPinned(readPinnedKeys(session.user?.id, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))
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
    const next = keys.slice(0, MAX_PINNED)
    setPinned(next)
    writePinnedKeys(session.user?.id, next)
  }

  const togglePin = (key: string) => {
    if (pinned.includes(key)) updatePinned(pinned.filter((value) => value !== key))
    else if (pinned.length < MAX_PINNED) updatePinned([...pinned, key])
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

  const moduleKey = moduleKeyFromPath(location.pathname)
  const moduleLabel = groups.find((group) => group.key === moduleKey)?.label
    || toolItems.find((tool) => location.pathname.startsWith(tool.path))?.label
    || ''

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
      '/color': '取色与可读性检查',
      '/codes': '二维码与条码',
      '/feeds': '信息聚合',
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
    if (['/visualizations', '/settings', '/data', '/memos'].includes(path)) return true
    return ['/visualizations/', '/settings/', '/memos'].some((prefix) => path.startsWith(prefix))
  }, [location.pathname])

  const bottomNav = [
    { key: 'checkin', label: '打卡', path: '/checkins', icon: EventAvailable },
    { key: 'todos', label: '待办', path: '/todos', icon: ChecklistRtl },
    { key: 'data', label: '表格', path: '/data', icon: TableChart },
    { key: 'more', label: '更多', path: '', icon: MoreHoriz },
  ]

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {!narrow ? (
        <AppRail
          mode={navMode}
          pinned={pinned}
          onToggleMode={toggleNavMode}
          onOpenAll={() => setAllNavOpen(true)}
          onManage={() => setManageNavOpen(true)}
        />
      ) : null}
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0 }}>
        <AppBar position="static" color="transparent" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar variant="dense" sx={{ gap: 0.75, minHeight: 44, px: 2 }}>
            {narrow ? (
              <IconButton edge="start" size="small" aria-label="打开导航" onClick={() => setDrawerOpen(true)}><ListIcon /></IconButton>
            ) : null}
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ minWidth: 0 }}>
              {moduleLabel && !narrow && moduleLabel !== pageTitle ? (
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled', fontFamily: '"IBM Plex Mono", monospace' }}>{moduleLabel}</Typography>
              ) : null}
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} title={pageTitle} noWrap>{pageTitle}</Typography>
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Button
              onClick={() => setSearchOpen(true)}
              startIcon={<Search fontSize="small" />}
              sx={{
                display: { xs: 'none', sm: 'inline-flex' }, minWidth: 230, justifyContent: 'flex-start',
                color: 'text.secondary', bgcolor: 'action.hover', border: 0, fontWeight: 400, height: 30,
                '&:hover': { bgcolor: 'action.selected' },
              }}
            >
              搜索或跳转
              <Box component="kbd" sx={{ ml: 'auto', fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, color: 'text.disabled' }}>Ctrl K</Box>
            </Button>
            <Tooltip title="搜索">
              <IconButton size="small" aria-label="搜索" sx={{ display: { xs: 'inline-flex', sm: 'none' } }} onClick={() => setSearchOpen(true)}>
                <Search fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="任务中心">
              <IconButton
                size="small"
                aria-label="任务中心"
                color={toolsOpen ? 'primary' : 'default'}
                onClick={() => { setToolsView('tasks'); setToolsOpen(true) }}
              >
                <Badge badgeContent={taskCount} max={99} color="error" invisible={!taskCount}><TaskAlt sx={{ fontSize: 19 }} /></Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="切换浅色／深色主题">
              <span>
                <IconButton
                  size="small"
                  aria-label="切换主题"
                  disabled={session.appearanceSaving}
                  onClick={() => { void toggleTheme().catch((error) => toast.error(apiError(error).message)) }}
                >
                  {session.theme === 'dark' ? <LightModeOutlined sx={{ fontSize: 20 }} /> : <DarkModeOutlined sx={{ fontSize: 20 }} />}
                </IconButton>
              </span>
            </Tooltip>
          </Toolbar>
        </AppBar>

        {!narrow && moduleKey ? (
          <ModuleTabs moduleKey={moduleKey} data={data} />
        ) : null}

        <Box sx={{ flex: 1, minHeight: 0, overflow: scrollable ? 'auto' : 'hidden', pb: narrow ? 7 : 0 }}>
          <Box sx={{ height: scrollable ? 'auto' : '100%', minHeight: scrollable ? '100%' : 0 }}>
            <Suspense fallback={(
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 3, color: 'text.secondary' }}>
                <CircularProgress size={18} />
                <Typography variant="body2">正在打开…</Typography>
              </Stack>
            )}>
              <Outlet />
            </Suspense>
          </Box>
        </Box>
      </Box>

      <NavAllDrawer
        open={drawerOpen || allNavOpen}
        onClose={() => { setDrawerOpen(false); setAllNavOpen(false) }}
        pinned={pinned}
        onTogglePin={togglePin}
        onManage={() => { setDrawerOpen(false); setAllNavOpen(false); setManageNavOpen(true) }}
        showFooter={narrow}
      />

      <ManageNavDialog
        open={manageNavOpen}
        onClose={() => setManageNavOpen(false)}
        pinned={pinned}
        onChange={updatePinned}
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
    </Box>
  )
}
