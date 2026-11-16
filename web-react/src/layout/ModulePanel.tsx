import { useMemo, useState, useTransition } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Box, IconButton, List, ListItemButton, ListItemText, Stack, TextField, Tooltip,
  Typography,
} from '@mui/material'
import { Add, ChevronLeft, Edit, Search } from '@mui/icons-material'
import { buildGroups, type SidebarData } from './nav'
import { preloadPath } from '@/router/preload'

export default function ModulePanel({
  moduleKey, data, onCollapse, onCreate, onRenameCheckin, onNavigate,
}: {
  moduleKey: string
  data: SidebarData
  onCollapse: () => void
  onCreate: (key: string) => void
  onRenameCheckin: (targetId: number) => void
  onNavigate: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [, startTransition] = useTransition()
  const go = (path: string) => {
    preloadPath(path)
    startTransition(() => navigate(path))
    onNavigate()
  }
  const groups = useMemo(() => buildGroups(data), [data])
  const group = groups.find((item) => item.key === moduleKey)
  if (!group) return null

  const normalized = query.trim().toLowerCase()
  const items = normalized ? group.items.filter((item) => item.label.toLowerCase().includes(normalized)) : group.items
  // 侧边栏不再限制展示数量：筛选状态之外一律渲染全部项目
  const visible = items

  const isActive = (path: string) => {
    const [pathname, search = ''] = path.split('?')
    if (location.pathname !== pathname) return false
    const wanted = new URLSearchParams(search)
    const current = new URLSearchParams(location.search)
    return ['category', 'uncategorized'].every((key) => (wanted.get(key) || '') === (current.get(key) || ''))
  }

  return (
    <Box
      component="aside"
      aria-label={`${group.label}导航`}
      sx={{
        width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
        bgcolor: (theme) => theme.palette.mode === 'dark' ? '#141D20' : '#FBFCFB',
        borderRight: 1, borderColor: 'divider',
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 1.5, minHeight: 44 }}>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>{group.label}</Typography>
        <Tooltip title={group.createLabel}>
          <IconButton size="small" aria-label={group.createLabel} onClick={() => onCreate(group.key)}><Add fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="收起面板">
          <IconButton size="small" aria-label="收起面板" onClick={onCollapse}><ChevronLeft fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>
      {group.items.length > 8 ? (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <TextField
            fullWidth
            value={query}
            placeholder="筛选"
            aria-label="筛选导航项目"
            InputProps={{ startAdornment: <Search sx={{ fontSize: 16, mr: 0.75, color: 'text.secondary' }} /> }}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Box>
      ) : null}
      <List dense disablePadding sx={{ flex: 1, overflow: 'auto', px: 0.75, pb: 1 }}>
        {visible.map((item) => (
          <ListItemButton
            key={item.path}
            selected={isActive(item.path)}
            onClick={() => go(item.path)}
            onMouseEnter={() => preloadPath(item.path)}
            onFocus={() => preloadPath(item.path)}
            sx={{ minHeight: 30, py: 0.15 }}
          >
            <ListItemText primary={item.label} primaryTypographyProps={{ noWrap: true, fontSize: 13 }} />
            {item.count ? <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>{item.count}</Typography> : null}
            {item.targetId ? (
              <Tooltip title="重命名">
                <IconButton size="small" aria-label={`重命名${item.label}`} onClick={(event) => { event.stopPropagation(); onRenameCheckin(item.targetId!) }}>
                  <Edit sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            ) : null}
          </ListItemButton>
        ))}
        {!items.length ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 1 }}>{query ? '没有匹配项' : '暂无项目'}</Typography> : null}
      </List>
    </Box>
  )
}
