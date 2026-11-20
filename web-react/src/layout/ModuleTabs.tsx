import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Box, Button, ListItemText, Menu, MenuItem, Typography,
} from '@mui/material'
import { Check, ChevronDown } from '@/icons'
import { buildGroups, type SidebarData } from './nav'
import { preloadPath } from '@/router/preload'

/** 单侧边栏布局：模块内的清单/表格/分类用下拉菜单切换。 */
export default function ModuleTabs({
  moduleKey, data,
}: {
  moduleKey: string
  data: SidebarData
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const groups = useMemo(() => buildGroups(data), [data])
  const group = groups.find((item) => item.key === moduleKey)
  if (!group) return null

  const isActive = (path: string) => {
    const [pathname, search = ''] = path.split('?')
    if (location.pathname !== pathname) return false
    const wanted = new URLSearchParams(search)
    const current = new URLSearchParams(location.search)
    return ['category', 'uncategorized'].every((key) => (wanted.get(key) || '') === (current.get(key) || ''))
  }
  const go = (path: string) => { preloadPath(path); navigate(path) }

  const showAll = group.key !== 'todos'
  const activeItem = group.items.find((item) => isActive(item.path))
  const label = activeItem?.label || (showAll ? '全部' : '选择清单')

  return (
    <Box
      component="nav"
      aria-label={`${group.label}导航`}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, minHeight: 46, px: 1.5, flexShrink: 0,
        bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
      }}
    >
      <Button
        size="small"
        variant="outlined"
        onClick={(event) => setAnchor(event.currentTarget)}
        endIcon={<ChevronDown fontSize="small" />}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        sx={{
          minWidth: 200, maxWidth: 340, justifyContent: 'space-between', color: 'text.primary',
          borderColor: 'divider', bgcolor: 'background.paper',
          '& .MuiButton-endIcon': { ml: 1, mr: 0 },
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Box>
      </Button>
      <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
        {group.items.length ? `${group.items.length} 个${({
          data: '表格', visualizations: '看板', todos: '清单', checkin: '打卡项目',
          notes: '文件夹', memos: '分类', bookmarks: '分类',
        } as Record<string, string>)[group.key] || '项目'}` : ''}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 260, maxHeight: 420 } } }}
      >
        {showAll ? (
          <MenuItem selected={!activeItem} onClick={() => { setAnchor(null); go(group.path) }}>
            <ListItemText primary="全部" primaryTypographyProps={{ fontSize: 13 }} />
            {!activeItem ? <Check sx={{ fontSize: 16, color: 'primary.main' }} /> : null}
          </MenuItem>
        ) : null}
        {group.items.map((item) => {
          const active = isActive(item.path)
          return (
            <MenuItem key={item.path} selected={active} onClick={() => { setAnchor(null); go(item.path) }}>
              <ListItemText primary={item.label} primaryTypographyProps={{ noWrap: true, fontSize: 13 }} />
              {item.count ? (
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontFamily: '"IBM Plex Mono", monospace', ml: 1.5 }}>
                  {item.count}
                </Typography>
              ) : null}
              {active ? <Check sx={{ fontSize: 16, color: 'primary.main', ml: 1 }} /> : null}
            </MenuItem>
          )
        })}
        {!group.items.length ? <MenuItem disabled>暂无项目</MenuItem> : null}
      </Menu>
    </Box>
  )
}
