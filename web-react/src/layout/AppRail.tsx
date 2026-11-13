import { useState, useTransition } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Avatar, Box, Divider, Menu, MenuItem, useTheme,
} from '@mui/material'
import {
  ChecklistRtl, EventAvailable, Image, Insights, Logout, MenuBook, Person, Settings,
  StickyNote2, SwapHoriz, TableChart, Translate,
} from '@mui/icons-material'
import LinkIcon from '@mui/icons-material/Link'
import PaletteIcon from '@mui/icons-material/Palette'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import BrushIcon from '@mui/icons-material/Brush'
import NewspaperIcon from '@mui/icons-material/Newspaper'
import DescriptionIcon from '@mui/icons-material/Description'
import { logout, useSession } from '@/session'
import { preloadPath } from '@/router/preload'

const mainItems = [
  { key: 'checkin', label: '打卡', path: '/checkins', icon: EventAvailable },
  { key: 'data', label: '表格', path: '/data', icon: TableChart },
  { key: 'todos', label: '待办', path: '/todos', icon: ChecklistRtl },
  { key: 'notes', label: '笔记', path: '/notes', icon: MenuBook },
  { key: 'memos', label: '便利贴', path: '/memos', icon: StickyNote2 },
  { key: 'visualizations', label: '看板', path: '/visualizations', icon: Insights },
  { key: 'feeds', label: '信息聚合', path: '/feeds', icon: NewspaperIcon },
  { key: 'docs', label: '文档工作台', path: '/docs', icon: DescriptionIcon },
  { key: 'bookmarks', label: '网址', path: '/bookmarks', icon: LinkIcon },
  { key: 'translate', label: '翻译', path: '/translate', icon: Translate },
  { key: 'images', label: '图片处理', path: '/images', icon: Image },
  { key: 'convert', label: '格式转换', path: '/convert', icon: SwapHoriz },
  { key: 'color', label: '取色对比', path: '/color', icon: PaletteIcon },
  { key: 'codes', label: '二维码条码', path: '/codes', icon: QrCode2Icon },
  { key: 'whiteboards', label: '白板', path: '/whiteboards', icon: BrushIcon },
]

export default function AppRail() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const theme = useTheme()
  const accent = theme.palette.primary.main
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null)
  const [, startTransition] = useTransition()

  const go = (path: string) => {
    preloadPath(path)
    startTransition(() => navigate(path))
  }

  const activeKey = mainItems.find((item) => location.pathname === item.path || location.pathname.startsWith(item.path + '/'))?.key || ''

  const railItem = (item: typeof mainItems[number], active: boolean) => {
    const Icon = item.icon
    return (
      <Box
        key={item.key}
        role="button"
        tabIndex={0}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => go(item.path)}
        onMouseEnter={() => preloadPath(item.path)}
        onFocus={() => preloadPath(item.path)}
        onKeyDown={(event) => { if (event.key === 'Enter') go(item.path) }}
        sx={{
          width: 72, minHeight: 54, py: 0.75, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 0.35,
          borderRadius: 1.5, cursor: 'pointer', userSelect: 'none',
          color: active ? 'primary.contrastText' : 'text.secondary',
          bgcolor: active ? accent : 'transparent',
          '&:hover': { bgcolor: active ? accent : 'action.hover', color: active ? 'primary.contrastText' : 'text.primary' },
        }}
      >
        <Icon sx={{ fontSize: 20 }} />
        <Box component="span" sx={{ fontSize: 10.5, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{item.label}</Box>
      </Box>
    )
  }

  return (
    <Box
      component="nav"
      aria-label="主导航"
      sx={{
        width: 84, flexShrink: 0,
        bgcolor: theme.palette.mode === 'dark' ? '#11181B' : '#FBFCFB',
        borderRight: 1, borderColor: 'divider',
        display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 0.5,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-label="回到首页"
        onClick={() => go('/checkins')}
        onKeyDown={(event) => { if (event.key === 'Enter') go('/checkins') }}
        sx={{
          width: 34, height: 34, mb: 0.5, display: 'grid', placeItems: 'center', cursor: 'pointer',
          borderRadius: 1.5, overflow: 'hidden',
          '& img': { width: '100%', height: '100%', objectFit: 'contain' },
        }}
      >
        <Box component="img" src="/favicon.svg?v=20261031-notion" alt="Nexus 图标" />
      </Box>
      <Divider sx={{ width: 32, mb: 0.5 }} />

      <Box sx={{ flex: 1, minHeight: 0, width: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        {mainItems.map((item) => railItem(item, activeKey === item.key))}
      </Box>

      <Divider sx={{ width: 32, my: 0.5 }} />

      <Box
        role="button"
        tabIndex={0}
        aria-label="设置"
        onClick={() => go('/settings')}
        onKeyDown={(event) => { if (event.key === 'Enter') go('/settings') }}
        sx={{
          width: 72, minHeight: 54, py: 0.75, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 0.35, borderRadius: 1.5, cursor: 'pointer',
          color: location.pathname.startsWith('/settings') ? 'primary.contrastText' : 'text.secondary',
          bgcolor: location.pathname.startsWith('/settings') ? accent : 'transparent',
          '&:hover': { bgcolor: location.pathname.startsWith('/settings') ? accent : 'action.hover' },
        }}
      >
        <Settings sx={{ fontSize: 20 }} />
        <Box component="span" sx={{ fontSize: 10.5, lineHeight: 1.2 }}>设置</Box>
      </Box>
      <Box
        role="button"
        tabIndex={0}
        aria-label="账号"
        onClick={(event) => setUserAnchor(event.currentTarget)}
        onKeyDown={(event) => { if (event.key === 'Enter') setUserAnchor(event.currentTarget) }}
        sx={{ width: 72, minHeight: 54, py: 0.75, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.4, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Avatar sx={{ width: 24, height: 24, fontSize: 12, bgcolor: `${accent}20`, color: accent }}>
          {session.user?.username?.slice(0, 1).toUpperCase()}
        </Avatar>
        <Box component="span" sx={{ fontSize: 10.5, lineHeight: 1.2, color: 'text.secondary' }}>账号</Box>
      </Box>

      <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <MenuItem disabled>
          <Person fontSize="small" sx={{ mr: 1 }} />
          {session.user?.username}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setUserAnchor(null); go('/settings') }}>
          <Settings fontSize="small" sx={{ mr: 1 }} />
          设置
        </MenuItem>
        <MenuItem onClick={async () => { setUserAnchor(null); await logout(); navigate('/login', { replace: true }) }}>
          <Logout fontSize="small" sx={{ mr: 1 }} />
          退出登录
        </MenuItem>
      </Menu>
    </Box>
  )
}
