import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, Badge, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer,
  IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, TextField, Toolbar, Tooltip,
  Typography,
} from '@mui/material'
import {
  Add, ChecklistRtl, DarkModeOutlined, EventAvailable, LightModeOutlined, List as ListIcon, MoreHoriz,
  Search, Settings, TableChart, TaskAlt,
} from '@mui/icons-material'
import AppRail from './AppRail'
import ModulePanel from './ModulePanel'
import ModuleTabs from './ModuleTabs'
import GlobalSearchDialog from '@/components/GlobalSearchDialog'
import WorkspaceToolsDialog from '@/components/WorkspaceToolsDialog'
import { buildGroups, toolItems, type SidebarData } from './nav'
import { http, apiError } from '@/api/client'
import { toggleTheme, useSession } from '@/session'
import { promptDialog, toast } from '@/ui/feedback'
import { FieldRow } from '@/ui/common'

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsView, setToolsView] = useState<'tasks' | 'activity'>('tasks')
  const [taskCount, setTaskCount] = useState(0)
  const [data, setData] = useState<SidebarData>(EMPTY_DATA)
  const [newTableOpen, setNewTableOpen] = useState(false)
  const [newTable, setNewTable] = useState({ name: '', note: '' })
  const [creatingTable, setCreatingTable] = useState(false)
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)

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

  const createForGroup = async (key: string) => {
    setCreateAnchor(null)
    try {
      if (key === 'checkin') {
        const value = await promptDialog({ title: '新建打卡项目', label: '打卡项目名称', placeholder: '例如：天猫旗舰店', maxLength: 100, confirmText: '创建' })
        if (!value) return
        const { data: target } = await http.post('/work-targets', { kind: 'shop', name: value })
        await loadTargets()
        window.dispatchEvent(new Event('wb:checkins-changed'))
        navigate(`/checkins/targets/${target.id}`)
      } else if (key === 'visualizations') {
        const value = await promptDialog({ title: '新建看板', label: '看板名称', placeholder: '例如：天猫旗舰店、抖音店铺', maxLength: 80, confirmText: '创建' })
        if (!value) return
        const { data: board } = await http.post('/dashboards', { name: value })
        await loadDashboards()
        navigate(`/visualizations/${board.id}`)
      } else if (key === 'data') {
        setNewTable({ name: '', note: '' })
        setNewTableOpen(true)
      } else if (key === 'todos') {
        const value = await promptDialog({ title: '新建清单', label: '清单名称', placeholder: '例如：本周工作、店铺活动', maxLength: 100, confirmText: '创建' })
        if (!value) return
        const { data: list } = await http.post('/todo-lists', { name: value })
        await loadTodoLists()
        navigate(`/todos/${list.id}`)
      } else if (key === 'notes') {
        const value = await promptDialog({ title: '新建文件夹', label: '文件夹名称', placeholder: '例如：经营复盘、流程与SOP', maxLength: 100, confirmText: '创建' })
        if (!value) return
        const { data: folder } = await http.post('/note-folders', { name: value })
        await loadNoteFolders()
        navigate(`/notes/${folder.id}`)
      } else if (key === 'memos') {
        const value = await promptDialog({
          title: '新建便利贴分类', label: '分类名称', placeholder: '例如：工作灵感', maxLength: 80, confirmText: '创建',
          validate: (name) => (!name || name === '未分类' ? '请输入 1–80 个字的名称，不能使用未分类' : true),
        })
        if (!value) return
        const { data: created } = await http.post('/memos/categories', { name: value })
        await loadMemoCategories()
        window.dispatchEvent(new Event('wb:memos-changed'))
        navigate(`/memos?category=${encodeURIComponent(created.name)}`)
      } else if (key === 'bookmarks') {
        const value = await promptDialog({ title: '新建网址分类', label: '分类名称', placeholder: '例如：运营工具', maxLength: 80, confirmText: '创建' })
        if (!value) return
        const { data: created } = await http.post('/bookmarks/categories', { name: value })
        await loadBookmarkCategories()
        window.dispatchEvent(new Event('wb-bookmarks-changed'))
        navigate(`/bookmarks?category=${encodeURIComponent(created.name)}`)
      }
    } catch (error) {
      toast.error(apiError(error).message)
    }
  }

  const renameCheckin = async (targetId: number) => {
    const target = data.checkinTargets.find((item) => item.id === targetId)
    if (!target) return
    const value = await promptDialog({ title: '重命名打卡项目', label: '打卡项目名称', defaultValue: target.name, maxLength: 100, confirmText: '保存' })
    if (!value) return
    try {
      await http.patch(`/work-targets/${targetId}`, { name: value })
      await loadTargets()
      window.dispatchEvent(new Event('wb:checkins-changed'))
    } catch (error) {
      toast.error(apiError(error).message)
    }
  }

  const createTable = async () => {
    if (!newTable.name.trim()) { toast.warning('请填写表格名称'); return }
    setCreatingTable(true)
    try {
      const { data: created } = await http.post('/tables', { name: newTable.name.trim(), note: newTable.note, fields: [] })
      toast.success('已创建，接下来添加一列')
      setNewTableOpen(false)
      await loadTables()
      window.dispatchEvent(new Event('wb:tables-changed'))
      navigate(`/data/${created.id}`)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setCreatingTable(false)
    }
  }

  const bottomNav = [
    { key: 'checkin', label: '打卡', path: '/checkins', icon: EventAvailable },
    { key: 'todos', label: '待办', path: '/todos', icon: ChecklistRtl },
    { key: 'data', label: '表格', path: '/data', icon: TableChart },
    { key: 'more', label: '更多', path: '', icon: MoreHoriz },
  ]

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {!narrow ? <AppRail /> : null}
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
            <Tooltip title="新建">
              <IconButton size="small" aria-label="新建" onClick={(event) => setCreateAnchor(event.currentTarget)}><Add sx={{ fontSize: 26 }} /></IconButton>
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

      <Menu anchorEl={createAnchor} open={Boolean(createAnchor)} onClose={() => setCreateAnchor(null)}>
        {[
          { key: 'data', label: '新建表格' },
          { key: 'todos', label: '新建待办清单' },
          { key: 'notes', label: '新建笔记文件夹' },
          { key: 'memos', label: '新建便利贴分类' },
          { key: 'visualizations', label: '新建看板' },
          { key: 'checkin', label: '新建打卡项目' },
        ].map((item) => (
          <MenuItem key={item.key} onClick={() => void createForGroup(item.key)}>
            <ListItemIcon><Add fontSize="small" /></ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} slotProps={{ paper: { sx: { width: 'min(320px, 100vw)', display: 'flex', flexDirection: 'row' } } }}>
        <AppRail />
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <ModulePanel
            moduleKey={moduleKey || 'data'}
            data={data}
            onCollapse={() => setDrawerOpen(false)}
            onCreate={createForGroup}
            onRenameCheckin={renameCheckin}
            onNavigate={() => setDrawerOpen(false)}
          />
        </Box>
      </Drawer>

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

      <Dialog open={newTableOpen} onClose={() => setNewTableOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>新建表格</DialogTitle>
        <DialogContent>
          <FieldRow label="表格名称" required>
            <TextField fullWidth autoFocus value={newTable.name} placeholder="例如：商品台账" inputProps={{ maxLength: 100 }} onChange={(event) => setNewTable({ ...newTable, name: event.target.value })} />
          </FieldRow>
          <FieldRow label="说明">
            <TextField fullWidth multiline minRows={2} value={newTable.note} inputProps={{ maxLength: 2000 }} onChange={(event) => setNewTable({ ...newTable, note: event.target.value })} />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setNewTableOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={creatingTable} onClick={createTable}>创建</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
