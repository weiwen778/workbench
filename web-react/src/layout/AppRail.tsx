import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Box, Divider, Tooltip, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Settings } from '@mui/icons-material'
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
}

export default function AppRail({ mode, pinned, groups, onToggleMode }: AppRailProps) {
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
    width: wide ? '100%' : 82,
    minHeight: wide ? 38 : 48,
    px: wide ? 1.3 : 0,
    py: wide ? 0.26 : 0.42,
    display: 'flex',
    flexDirection: wide ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: wide ? 'flex-start' : 'center',
    gap: wide ? 1.05 : 0.32,
    borderRadius: 1.05,
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
        title={item.label}
        aria-current={active ? 'page' : undefined}
        aria-expanded={hasSub ? openKey === item.key : undefined}
        onClick={activate}
        onMouseEnter={() => preloadPath(item.path)}
        onFocus={() => preloadPath(item.path)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }}
        sx={{ ...itemSx(active), ...(hasSub ? { pr: 2.6 } : {}) }}
      >
        <Icon sx={{ fontSize: wide ? 21 : 20, flexShrink: 0 }} />
        <Typography
          component="span"
          sx={{
            fontSize: wide ? 13.65 : 12.6,
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
            fontSize: 15.8, flexShrink: 0, color: active ? 'primary.contrastText' : 'text.disabled',
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
      title={label}
      onClick={onClick}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}
      sx={itemSx(active)}
    >
      {icon}
      <Typography component="span" sx={{ fontSize: wide ? 13.65 : 12.6, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{label}</Typography>
    </Box>
  )

  return (
    <Box
      component="nav"
      aria-label="主导航"
      sx={{
        width: wide ? 240 : 101,
        flexShrink: 0,
        bgcolor: theme.palette.mode === 'dark' ? '#11181B' : '#FBFCFB',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
        py: 1.05,
        gap: 0.53,
        transition: 'width 160ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%', height: 46, px: wide ? 1.3 : 0.53, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Tooltip title="回到首页">
          <Box
            role="button"
            tabIndex={0}
            aria-label="回到首页"
            onClick={() => go('/checkins')}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go('/checkins') } }}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, cursor: 'pointer', borderRadius: 1.5 }}
          >
            {!wide ? (
              <Box
                component="img"
                src="/favicon.svg?v=20261031-notion"
                alt="Nexus 图标"
                sx={{ display: 'block', width: 41, height: 41, flexShrink: 0, objectFit: 'contain' }}
              />
            ) : (
              <Typography
                component="span"
                sx={{
                  maxWidth: 120,
                  opacity: 1,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                }}
              >
                Nexus
              </Typography>
            )}
          </Box>
        </Tooltip>
      </Box>
      <Divider sx={{ width: wide ? 'calc(100% - 21px)' : 34, mb: 0.53 }} />

      <Box sx={{ width: '100%', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', px: wide ? 0.79 : 0.53, pb: 0.53, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.53, scrollbarWidth: 'thin' }}>
        {items.map((item) => {
          if (!item) return null
          const group = groups.find((entry) => entry.key === item.key)
          const subItems = group?.items || []
          const expanded = wide && openKey === item.key && CATEGORY_KEYS.has(item.key) && subItems.length > 0
          return (
            <Box key={`rail-${item.key}`} sx={{ width: '100%' }}>
              {renderItem(item, subItems)}
              <AnimatePresence initial={false}>
                {expanded ? (
                  <motion.div
                    key={`${item.key}-subnav`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <Box
                      aria-label={`${item.label}二级导航`}
                      sx={{
                        width: '100%', maxHeight: 'min(42vh, 357px)', overflowY: 'auto', overflowX: 'hidden',
                        display: 'flex', flexDirection: 'column', gap: '3.2px', py: 0.26,
                        mt: 0.26, mb: 0.53, pl: 2.6, pr: 0.53,
                        borderLeft: '1px solid', borderColor: 'divider',
                      }}
                    >
                      {subItems.map((sub, index) => {
                        const active = isSubActive(sub.path)
                        return (
                          <motion.div
                            key={sub.path}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.16, delay: Math.min(index, 10) * 0.012 }}
                          >
                            <Box
                              component="button"
                              type="button"
                              onClick={(event) => { event.stopPropagation(); go(sub.path) }}
                              sx={{
                                width: '100%', minHeight: 29, display: 'flex', alignItems: 'center', gap: 0.79,
                                border: 0, borderRadius: 0.79, bgcolor: active ? 'action.selected' : 'transparent',
                                color: active ? 'primary.main' : 'text.secondary', px: 0.79, py: 0.53,
                                textAlign: 'left', cursor: 'pointer',
                                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                              }}
                            >
                              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12.6, fontWeight: active ? 600 : 400 }}>{sub.label}</Typography>
                              {typeof sub.count === 'number' && sub.count > 0 ? (
                                <Typography component="span" sx={{ fontSize: 12.1, color: 'text.disabled' }}>{sub.count}</Typography>
                              ) : null}
                            </Box>
                          </motion.div>
                        )
                      })}
                    </Box>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </Box>
          )
        })}
      </Box>

      <Divider sx={{ width: wide ? 'calc(100% - 21px)' : 34, my: 0.53 }} />
      <Box sx={{ width: '100%', px: wide ? 0.79 : 0.53, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.26 }}>
        {bottomItem('设置', <Settings sx={{ fontSize: wide ? 21 : 20 }} />, location.pathname.startsWith('/settings'), () => go('/settings'))}
        {bottomItem(
          wide ? '收起侧栏' : '展开侧栏',
          wide ? <ChevronLeft sx={{ fontSize: 20 }} /> : <ChevronRight sx={{ fontSize: 20 }} />,
          false,
          onToggleMode,
        )}
      </Box>
    </Box>
  )
}
