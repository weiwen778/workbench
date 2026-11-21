import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Box, Tooltip, Typography } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, ChevronUp, MoreFilled } from '@/icons'
import { preloadPath } from '@/router/preload'
import { APP_NAV_ITEMS, appNavItem } from './app-nav'
import { activeGroupKey, type NavGroup } from './nav'
import type { SidebarMode } from './sidebar-order'

const CATEGORY_KEYS = new Set(['checkin', 'visualizations', 'data', 'todos', 'notes', 'memos', 'bookmarks'])

interface AppRailProps {
  mode: SidebarMode
  pinned: string[]
  groups: NavGroup[]
}

export default function AppRail({ mode, pinned, groups }: AppRailProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const wide = mode === 'wide'
  const [openKey, setOpenKey] = useState<string | null>(() => activeGroupKey(window.location.pathname, groups) || null)
  const [subExpanded, setSubExpanded] = useState(false)
  const activeGroup = activeGroupKey(location.pathname, groups) || null

  const items = useMemo(() => pinned.map((key) => appNavItem(key)).filter(Boolean), [pinned])
  const moreItems = useMemo(() => APP_NAV_ITEMS.filter((item) => !pinned.includes(item.key)), [pinned])
  const activeKey = items.find((item) => item && (location.pathname === item.path || location.pathname.startsWith(item.path + '/')))?.key || ''

  useEffect(() => {
    setOpenKey(activeGroup && CATEGORY_KEYS.has(activeGroup) ? activeGroup : null)
  }, [activeGroup])

  useEffect(() => {
    setSubExpanded(false)
  }, [openKey])

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
    width: wide ? '100%' : 40,
    minHeight: 38,
    px: wide ? 1.25 : 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: wide ? 'flex-start' : 'center',
    gap: wide ? 0.75 : 0,
    borderRadius: 1,
    cursor: 'pointer',
    userSelect: 'none',
    overflow: 'hidden',
    color: active ? 'text.primary' : 'text.secondary',
    bgcolor: active ? 'action.hover' : 'transparent',
    transition: 'background-color 150ms ease, color 150ms ease',
    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
  })

  const subItemSx = (active: boolean) => ({
    width: '100%', minHeight: 30, display: 'flex', alignItems: 'center', gap: 0.75,
    border: 0, borderRadius: 0.75, bgcolor: active ? 'action.hover' : 'transparent',
    color: active ? 'text.primary' : 'text.secondary', px: 1, py: 0.5,
    textAlign: 'left', cursor: 'pointer',
    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
  })

  const renderItem = (item: NonNullable<ReturnType<typeof appNavItem>>, subItems: NavGroup['items']) => {
    const Icon = item.icon
    const active = activeKey === item.key
    const hasSub = wide && CATEGORY_KEYS.has(item.key) && subItems.length > 0
    const activeSubIndex = subItems.findIndex((sub) => isSubActive(sub.path))
    const collapsedSubItems = activeSubIndex >= 4
      ? [...subItems.slice(0, 3), subItems[activeSubIndex]]
      : subItems.slice(0, 4)
    const visibleSubItems = subExpanded ? subItems : collapsedSubItems
    const hiddenCount = subItems.length - visibleSubItems.length
    const activate = () => {
      go(item.path)
      if (hasSub) setOpenKey((value) => (value === item.key ? null : item.key))
      else setOpenKey(null)
    }
    return (
      <Box key={item.key} sx={{ width: wide ? '100%' : 40 }}>
        <Tooltip title={wide ? '' : item.label} placement="right" arrow>
          <Box
            role="button"
            tabIndex={0}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            aria-expanded={hasSub ? openKey === item.key : undefined}
            onClick={activate}
            onMouseEnter={() => preloadPath(item.path)}
            onFocus={() => preloadPath(item.path)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }}
            sx={{ ...itemSx(active), ...(hasSub ? { pr: 1 } : {}) }}
          >
            <Icon sx={{ fontSize: 18, flexShrink: 0 }} />
            {wide ? (
              <Typography
                component="span"
                sx={{ fontSize: 13.5, lineHeight: 1.2, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: hasSub ? 1 : undefined, maxWidth: '100%' }}
              >
                {item.label}
              </Typography>
            ) : null}
            {hasSub ? (
              <ChevronRight sx={{
                fontSize: 15, flexShrink: 0, color: 'text.disabled',
                transition: 'transform 150ms ease', transform: openKey === item.key ? 'rotate(90deg)' : 'none',
                pointerEvents: 'none',
              }} />
            ) : null}
          </Box>
        </Tooltip>
        <AnimatePresence initial={false}>
          {wide && openKey === item.key && hasSub ? (
            <motion.div
              key={`${item.key}-subnav`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <Box
                aria-label={`${item.label}二级导航`}
                sx={{
                  width: 'auto', overflowX: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: '2px', py: 0.5, mt: 0.25, mb: 0.5,
                  pl: 2.75, pr: 0.25, borderLeft: 1, borderColor: 'divider', ml: 2.1, mr: 0.25,
                }}
              >
                {visibleSubItems.map((sub, index) => {
                  const active = isSubActive(sub.path)
                  return (
                    <motion.div
                      key={sub.path}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.14, delay: Math.min(index, 10) * 0.01 }}
                    >
                      <Box
                        component="button"
                        type="button"
                        onClick={(event) => { event.stopPropagation(); go(sub.path) }}
                        sx={subItemSx(active)}
                      >
                        <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: active ? 500 : 400 }}>{sub.label}</Typography>
                        {typeof sub.count === 'number' && sub.count > 0 ? (
                          <Typography component="span" sx={{ fontSize: 11.5, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>{sub.count}</Typography>
                        ) : null}
                      </Box>
                    </motion.div>
                  )
                })}
                {hiddenCount > 0 ? (
                  <Box
                    component="button"
                    type="button"
                    aria-expanded={subExpanded}
                    onClick={(event) => { event.stopPropagation(); setSubExpanded(true) }}
                    sx={subItemSx(false)}
                  >
                    <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>更多</Typography>
                    <Typography component="span" sx={{ fontSize: 11.5, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>{hiddenCount}</Typography>
                    <MoreFilled sx={{ fontSize: 14, color: 'text.disabled' }} />
                  </Box>
                ) : null}
                {subExpanded && subItems.length > 4 ? (
                  <Box
                    component="button"
                    type="button"
                    aria-expanded={subExpanded}
                    onClick={(event) => { event.stopPropagation(); setSubExpanded(false) }}
                    sx={subItemSx(false)}
                  >
                    <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>收起</Typography>
                    <ChevronUp sx={{ fontSize: 14, color: 'text.disabled' }} />
                  </Box>
                ) : null}
              </Box>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Box>
    )
  }

  const sectionSx = { px: 1.25, pt: 1.5, pb: 0.5, fontSize: 11, fontWeight: 500, color: 'text.secondary', letterSpacing: '0.01em' }

  return (
    <Box
      component="nav"
      aria-label="主导航"
      sx={{
        width: wide ? 264 : 72,
        flexShrink: 0,
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
        py: 1.25,
        transition: 'width 160ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box sx={{ width: '100%', px: wide ? 1.5 : 0, display: 'flex', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center' }}>
        <Box
          role="button"
          tabIndex={0}
          aria-label="回到首页"
          onClick={() => go('/checkins')}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go('/checkins') } }}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, cursor: 'pointer', borderRadius: 1, p: 0.5, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } }}
        >
          <Box
            component="img"
            src="/favicon.svg"
            alt="Nexus"
            sx={{ width: 32, height: 32, flexShrink: 0, display: 'block' }}
          />
          {wide ? (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>Nexus</Typography>
              <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.3 }}>个人工作台</Typography>
            </Box>
          ) : null}

        </Box>
      </Box>

      <Box sx={{ width: '100%', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', px: wide ? 0.75 : 0.5, pt: 1, display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25, scrollbarWidth: 'thin' }}>
        {wide ? <Typography sx={sectionSx}>工作台</Typography> : null}
        <Box data-nav-section="pinned" sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25 }}>
          {items.map((item) => {
            if (!item) return null
            const group = groups.find((entry) => entry.key === item.key)
            return renderItem(item, group?.items || [])
          })}
        </Box>
        {moreItems.length ? (
          <>
            {wide ? <Typography sx={sectionSx}>更多</Typography> : null}
            <Box data-nav-section="more" sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: wide ? 'stretch' : 'center', gap: 0.25 }}>
              {moreItems.map((item) => {
                const group = groups.find((entry) => entry.key === item.key)
                return renderItem(item, group?.items || [])
              })}
            </Box>
          </>
        ) : null}
      </Box>
    </Box>
  )
}
