import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Box, Collapse, Divider, Tooltip, Typography, useTheme } from '@mui/material'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Settings } from '@mui/icons-material'
import GridView from '@mui/icons-material/GridView'
import { preloadPath } from '@/router/preload'
import { appNavItem } from './app-nav'
import { activeGroupKey, type NavGroup } from './nav'
import type { SidebarMode } from './sidebar-order'

const CATEGORY_KEYS = new Set(['checkin', 'visualizations', 'data', 'todos', 'notes', 'memos', 'bookmarks'])

interface AppRailProps {
  mode: SidebarMode
  pinned: string[]
  groups: NavGroup[]
  onToggleMode: () => void
  onOpenAll: () => void
}

export default function AppRail({ mode, pinned, groups, onToggleMode, onOpenAll }: AppRailProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const accent = theme.palette.primary.main
  const [openKey, setOpenKey] = useState<string | null>(() => activeGroupKey(window.location.pathname, groups) || null)
  const wide = mode === 'wide'
  const activeGroup = activeGroupKey(location.pathname, groups) || null

  const items = useMemo(() => pinned.map((key) => appNavItem(key)).filter(Boolean), [pinned])
  const activeKey = items.find((item) => item && (location.pathname === item.path || location.pathname.startsWith(item.path + '/')))?.key || ''

  useEffect(() => {
    setOpenKey(activeGroup && CATEGORY_KEYS.has(activeGroup) ? activeGroup : null)
  }, [activeGroup])

  const go = (path: string) => {
    preloadPath(path)
    navigate(path)
  }

  const isSubActive = (path: string) => {
    const [pathname, query] = path.split('?')
    if (location.pathname !== pathname) return false
    if (!query) return true
    const expected = new URLSearchParams(query)
    const current = new URLSearchParams(location.search)
    return Array.from(expected.entries()).every(([key, value]) => current.get(key) === value)
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

  const renderItem = (item: NonNullable<ReturnType<typeof appNavItem>>, subItems: NavGroup['items']) => {
    const Icon = item.icon
    const active = activeKey === item.key
    const hasSub = wide && CATEGORY_KEYS.has(item.key) && subItems.length > 0
    const activate = () => {
      go(item.path)
      if (hasSub) setOpenKey((value) => value === item.key ? null : item.key)
    }
    return (
      <Box
        key={item.key}
        role="button"
        tabIndex={0}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        aria-expanded={hasSub ? openKey === item.key : undefined}
        onClick={activate}
        onMouseEnter={() => preloadPath(item.path)}
        onFocus={() => preloadPath(item.path)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }}
        sx={{ ...itemSx(active), ...(hasSub ? { pr: 2.5 } : {}) }}
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
            flex: hasSub ? 1 : undefined,
          }}
        >
          {item.label}
        </Typography>
        {hasSub ? (
          <ChevronRight sx={{
            fontSize: 15, flexShrink: 0, color: active ? 'primary.contrastText' : 'text.disabled',
            transition: 'transform 160ms ease', transform: openKey === item.key ? 'rotate(90deg)' : 'none',
            pointerEvents: 'none',
          }} />
        ) : null}
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
      </Box>
      <Divider sx={{ width: wide ? 'calc(100% - 20px)' : 32, mb: 0.5 }} />

      <Box sx={{ width: '100%', px: wide ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.5 }}>
        {items.map((item) => {
          if (!item) return null
          const group = groups.find((entry) => entry.key === item.key)
          const subItems = group?.items || []
          const expanded = wide && openKey === item.key && CATEGORY_KEYS.has(item.key) && subItems.length > 0
          return (
            <Box key={`rail-${item.key}`} sx={{ width: '100%' }}>
              {renderItem(item, subItems)}
              {expanded ? (
                <Collapse in timeout={180}>
                  <Box
                    aria-label={`${item.label}二级导航`}
                    sx={{
                      width: '100%', maxHeight: 'min(300px, max(96px, calc(100vh - 520px)))', overflowY: 'auto',
                      mt: 0.25, mb: 0.5, pl: 2.75, pr: 0.5,
                      borderLeft: '1px solid', borderColor: 'divider',
                    }}
                  >
                    {subItems.map((sub) => {
                      const active = isSubActive(sub.path)
                      return (
                        <Box
                          key={sub.path}
                          component="button"
                          type="button"
                          onClick={(event) => { event.stopPropagation(); go(sub.path) }}
                          sx={{
                            width: '100%', minHeight: 26, display: 'flex', alignItems: 'center', gap: 0.75,
                            border: 0, borderRadius: 0.75, bgcolor: active ? 'action.selected' : 'transparent',
                            color: active ? 'primary.main' : 'text.secondary', px: 0.75, py: 0.25,
                            textAlign: 'left', cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                          }}
                        >
                          <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: active ? 600 : 400 }}>{sub.label}</Typography>
                          {typeof sub.count === 'number' && sub.count > 0 ? (
                            <Typography component="span" sx={{ fontSize: 10.5, color: 'text.disabled' }}>{sub.count}</Typography>
                          ) : null}
                        </Box>
                      )
                    })}
                  </Box>
                </Collapse>
              ) : null}
            </Box>
          )
        })}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }} />

      <Box sx={{ width: '100%', px: wide ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25 }}>
        {bottomItem('全部功能', <GridView sx={{ fontSize: wide ? 20 : 19 }} />, false, onOpenAll)}
      </Box>
      <Divider sx={{ width: wide ? 'calc(100% - 20px)' : 32, my: 0.5 }} />
      <Box sx={{ width: '100%', px: wide ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25 }}>
        {bottomItem('设置', <Settings sx={{ fontSize: wide ? 20 : 19 }} />, location.pathname.startsWith('/settings'), () => go('/settings'))}
        {bottomItem(
          wide ? '收起侧栏' : '展开侧栏',
          wide ? <ChevronLeft sx={{ fontSize: 19 }} /> : <ChevronRight sx={{ fontSize: 19 }} />,
          false,
          onToggleMode,
        )}
      </Box>
    </Box>
  )
}
