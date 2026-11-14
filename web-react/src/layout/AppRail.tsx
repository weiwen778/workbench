import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Avatar, Box, Divider, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Typography, useTheme,
} from '@mui/material'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Logout, Person, Settings, Tune } from '@mui/icons-material'
import GridView from '@mui/icons-material/GridView'
import { logout, useSession } from '@/session'
import { preloadPath } from '@/router/preload'
import { appNavItem } from './app-nav'
import type { SidebarMode } from './sidebar-order'

interface AppRailProps {
  mode: SidebarMode
  pinned: string[]
  onToggleMode: () => void
  onOpenAll: () => void
  onManage: () => void
}

export default function AppRail({ mode, pinned, onToggleMode, onOpenAll, onManage }: AppRailProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const theme = useTheme()
  const accent = theme.palette.primary.main
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null)
  const wide = mode === 'wide'

  const items = useMemo(() => pinned.map((key) => appNavItem(key)).filter(Boolean), [pinned])
  const activeKey = items.find((item) => item && (location.pathname === item.path || location.pathname.startsWith(item.path + '/')))?.key || ''

  const go = (path: string) => {
    preloadPath(path)
    navigate(path)
  }

  const itemSx = (active: boolean) => ({
    width: wide ? '100%' : 72,
    minHeight: wide ? 36 : 44,
    px: wide ? 1.25 : 0,
    py: wide ? 0.25 : 0.35,
    display: 'flex',
    flexDirection: wide ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: wide ? 'flex-start' : 'center',
    gap: wide ? 1 : 0.25,
    borderRadius: 1,
    cursor: 'pointer',
    userSelect: 'none',
    overflow: 'hidden',
    color: active ? 'primary.contrastText' : 'text.secondary',
    bgcolor: active ? accent : 'transparent',
    transition: 'width 160ms ease, min-height 160ms ease, padding 160ms ease, background-color 120ms ease',
    '&:hover': { bgcolor: active ? accent : 'action.hover', color: active ? 'primary.contrastText' : 'text.primary' },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
  })

  const renderItem = (item: NonNullable<ReturnType<typeof appNavItem>>) => {
    const Icon = item.icon
    const active = activeKey === item.key
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
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(item.path) } }}
        sx={itemSx(active)}
      >
        <Icon sx={{ fontSize: wide ? 20 : 19, flexShrink: 0 }} />
        <Typography
          component="span"
          sx={{
            fontSize: wide ? 13 : 10,
            lineHeight: 1.15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
        >
          {item.label}
        </Typography>
      </Box>
    )
  }

  const bottomItem = (label: string, icon: ReactNode, active: boolean, onClick: () => void) => (
    <Box
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}
      sx={itemSx(active)}
    >
      {icon}
      <Typography component="span" sx={{ fontSize: wide ? 13 : 10, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{label}</Typography>
    </Box>
  )

  useEffect(() => {
    setUserAnchor(null)
  }, [location.pathname])

  return (
    <Box
      component="nav"
      aria-label="主导航"
      sx={{
        width: wide ? 208 : 84,
        flexShrink: 0,
        bgcolor: theme.palette.mode === 'dark' ? '#11181B' : '#FBFCFB',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
        py: 1,
        gap: 0.5,
        transition: 'width 160ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', height: 44, px: wide ? 1.25 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Tooltip title="回到首页">
          <Box
            role="button"
            tabIndex={0}
            aria-label="回到首页"
            onClick={() => go('/checkins')}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go('/checkins') } }}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, cursor: 'pointer', borderRadius: 1.5 }}
          >
            <Box
              component="img"
              src="/favicon.svg?v=20261031-notion"
              alt="Nexus 图标"
              sx={{ display: 'block', width: wide ? 30 : 28, height: wide ? 30 : 28, flexShrink: 0, objectFit: 'contain' }}
            />
            <Typography
              component="span"
              sx={{
                ml: wide ? 1 : 0,
                maxWidth: wide ? 88 : 0,
                opacity: wide ? 1 : 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                transition: 'max-width 160ms ease, margin-left 160ms ease, opacity 120ms ease',
              }}
            >
              Nexus
            </Typography>
          </Box>
        </Tooltip>
        <Tooltip title={wide ? '收起侧栏' : '展开侧栏'}>
          <IconButton
            size="small"
            aria-label={wide ? '收起侧栏' : '展开侧栏'}
            aria-expanded={wide}
            onClick={onToggleMode}
            sx={{
              position: 'absolute', top: '50%', right: wide ? 8 : 2, transform: 'translateY(-50%)',
              width: wide ? 27 : 22, height: wide ? 27 : 22,
              border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.secondary',
              transition: 'width 160ms ease, height 160ms ease, background-color 120ms ease',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            {wide ? <ChevronLeft sx={{ fontSize: 17 }} /> : <ChevronRight sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
      </Box>
      <Divider sx={{ width: wide ? 'calc(100% - 20px)' : 32, mb: 0.5 }} />

      <Box sx={{ width: '100%', px: wide ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.5 }}>
        {items.map((item) => item ? renderItem(item) : null)}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }} />

      <Box sx={{ width: '100%', px: wide ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25 }}>
        {bottomItem('全部功能', <GridView sx={{ fontSize: wide ? 20 : 19 }} />, false, onOpenAll)}
      </Box>
      <Divider sx={{ width: wide ? 'calc(100% - 20px)' : 32, my: 0.5 }} />
      <Box sx={{ width: '100%', px: wide ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25 }}>
        {bottomItem('设置', <Settings sx={{ fontSize: wide ? 20 : 19 }} />, location.pathname.startsWith('/settings'), () => go('/settings'))}
        <Box
          role="button"
          tabIndex={0}
          aria-label="账号"
          onClick={(event) => setUserAnchor(event.currentTarget)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setUserAnchor(event.currentTarget) } }}
          sx={itemSx(false)}
        >
          <Avatar sx={{ width: 23, height: 23, fontSize: 12, bgcolor: `${accent}20`, color: accent }}>
            {session.user?.username?.slice(0, 1).toUpperCase()}
          </Avatar>
          <Typography component="span" sx={{ fontSize: wide ? 13 : 10, lineHeight: 1.15, color: 'text.secondary', whiteSpace: 'nowrap' }}>账号</Typography>
        </Box>
      </Box>

      <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <MenuItem disabled>
          <ListItemIcon><Person fontSize="small" /></ListItemIcon>
          <ListItemText>{session.user?.username}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setUserAnchor(null); onManage() }}>
          <ListItemIcon><Tune fontSize="small" /></ListItemIcon>
          <ListItemText>管理导航</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setUserAnchor(null); go('/settings') }}>
          <ListItemIcon><Settings fontSize="small" /></ListItemIcon>
          <ListItemText>设置</ListItemText>
        </MenuItem>
        <MenuItem onClick={async () => { setUserAnchor(null); await logout(); navigate('/login', { replace: true }) }}>
          <ListItemIcon><Logout fontSize="small" /></ListItemIcon>
          <ListItemText>退出登录</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}
