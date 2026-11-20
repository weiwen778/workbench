import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Divider, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import SpringDrawer from '@/motion/components/SpringDrawer'
import PushPin from '@mui/icons-material/PushPin'
import { Close, Search, Setting } from '@/icons'
import { APP_NAV_GROUPS, APP_NAV_ITEMS } from './app-nav'

function matches(query: string, label: string) {
  return !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase())
}

export function NavAllDrawer({
  open, onClose, pinned, onTogglePin,
}: {
  open: boolean
  onClose: () => void
  pinned: string[]
  onTogglePin: (key: string) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const groups = useMemo(() => APP_NAV_GROUPS.map((group) => ({
    ...group,
    items: APP_NAV_ITEMS.filter((item) => item.group === group.key && matches(query, item.label)),
  })).filter((group) => group.items.length), [query])

  return (
    <SpringDrawer open={open} onClose={onClose} anchor="left" slotProps={{ paper: { sx: { width: 'min(374px, 100vw)', display: 'flex', flexDirection: 'column' } } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, minHeight: 52 }}>
        <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600 }}>全部功能</Typography>
        <IconButton size="small" aria-label="关闭全部功能" onClick={onClose}><Close fontSize="small" /></IconButton>
      </Stack>
      <Divider />
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <TextField
          fullWidth size="small" value={query} placeholder="搜索功能"
          aria-label="搜索功能"
          onChange={(event) => setQuery(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 17 }} /></InputAdornment> }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1 }}>
        {groups.map((group) => (
          <Box key={group.key} sx={{ mb: 1 }}>
            <Typography sx={{ px: 1.25, py: 0.75, fontSize: 12, fontWeight: 600, color: 'text.disabled' }}>{group.label}</Typography>
            <List dense disablePadding>
              {group.items.map((item) => {
                const Icon = item.icon
                const isPinned = pinned.includes(item.key)
                return (
                  <Box key={item.key} sx={{ display: 'flex', alignItems: 'center' }}>
                    <ListItemButton onClick={() => go(item.path)} sx={{ flex: 1, minHeight: 38, gap: 1, px: 1.25, borderRadius: 1 }} aria-label={`打开${item.label}`}>
                      <ListItemIcon sx={{ minWidth: 28 }}><Icon sx={{ fontSize: 19 }} /></ListItemIcon>
                      <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
                    </ListItemButton>
                    <Tooltip title={isPinned ? '从侧栏移除' : '固定到侧栏'}>
                      <span style={{ paddingRight: 4 }}>
                        <IconButton
                          size="small"
                          aria-label={isPinned ? `取消固定${item.label}` : `固定${item.label}`}
                          onClick={() => onTogglePin(item.key)}
                        >
                          <PushPin sx={{ fontSize: 16, color: isPinned ? 'primary.main' : 'text.disabled' }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                )
              })}
            </List>
          </Box>
        ))}
        {!groups.length ? <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>没有匹配的功能</Typography> : null}
      </Box>
      <Divider />
      <Stack direction="row" spacing={0.5} sx={{ p: 1 }}>
        <Button size="small" startIcon={<Setting fontSize="small" />} onClick={() => { onClose(); navigate('/settings') }}>设置</Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => { onClose(); navigate('/settings/navigation') }}>管理导航</Button>
      </Stack>
    </SpringDrawer>
  )
}
