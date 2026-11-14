import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer,
  IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import PushPin from '@mui/icons-material/PushPin'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Close, DragIndicator, Search, Setting } from '@/icons'
import {
  APP_NAV_GROUPS, APP_NAV_ITEMS, DEFAULT_PINNED_KEYS, MAX_PINNED, appNavItem, type AppNavItem,
} from './app-nav'

function matches(query: string, label: string) {
  return !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase())
}

export function NavAllDrawer({
  open, onClose, pinned, onTogglePin, onManage,
}: {
  open: boolean
  onClose: () => void
  pinned: string[]
  onTogglePin: (key: string) => void
  onManage: () => void
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
    <Drawer open={open} onClose={onClose} anchor="left" slotProps={{ paper: { sx: { width: 'min(340px, 100vw)', display: 'flex', flexDirection: 'column' } } }}>
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
            <Typography sx={{ px: 1.25, py: 0.75, fontSize: 11, fontWeight: 600, color: 'text.disabled' }}>{group.label}</Typography>
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
                    <Tooltip title={isPinned ? '从侧栏移除' : pinned.length >= MAX_PINNED ? `侧栏最多固定 ${MAX_PINNED} 个` : '固定到侧栏'}>
                      <span style={{ paddingRight: 4 }}>
                        <IconButton
                          size="small"
                          aria-label={isPinned ? `取消固定${item.label}` : `固定${item.label}`}
                          disabled={!isPinned && pinned.length >= MAX_PINNED}
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
        <Button size="small" onClick={() => { onClose(); onManage() }}>管理导航</Button>
      </Stack>
    </Drawer>
  )
}

function SortablePinnedRow({ item, onUnpin }: { item: AppNavItem; onUnpin: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  const Icon = item.icon
  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.7 : 1, position: 'relative',
      }}
      sx={{ display: 'flex', alignItems: 'center', minHeight: 38, gap: 1, px: 1.25, bgcolor: 'background.paper' }}
    >
      <Box
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        component="button"
        type="button"
        aria-label={`拖动${item.label}排序`}
        title="拖动排序"
        sx={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: 22, height: 22, p: 0, border: 0, borderRadius: 0.75, bgcolor: 'transparent',
          color: 'text.disabled', cursor: 'grab', touchAction: 'none',
          '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicator sx={{ fontSize: 17 }} />
      </Box>
      <Box sx={{ minWidth: 28, display: 'flex' }}><Icon sx={{ fontSize: 18 }} /></Box>
      <Typography sx={{ flex: 1, fontSize: 13 }}>{item.label}</Typography>
      <Button size="small" aria-label={`取消固定${item.label}`} onClick={onUnpin}>取消固定</Button>
    </Box>
  )
}

export function ManageNavDialog({
  open, onClose, pinned, onChange,
}: {
  open: boolean
  onClose: () => void
  pinned: string[]
  onChange: (keys: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const pinnedItems = pinned.map((key) => appNavItem(key)).filter((item): item is AppNavItem => Boolean(item))
  const available = APP_NAV_ITEMS.filter((item) => !pinned.includes(item.key) && matches(query, item.label))
  const groups = APP_NAV_GROUPS.map((group) => ({ ...group, items: available.filter((item) => item.group === group.key) })).filter((group) => group.items.length)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const unpin = (key: string) => onChange(pinned.filter((value) => value !== key))
  const pin = (key: string) => {
    if (pinned.length >= MAX_PINNED || pinned.includes(key)) return
    onChange([...pinned, key])
  }
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pinned.indexOf(String(active.id))
    const newIndex = pinned.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(pinned, oldIndex, newIndex))
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>管理导航</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
          固定项最多 {MAX_PINNED} 个；顺序和宽窄模式按账号保存在当前浏览器。
        </Typography>
        <TextField
          fullWidth size="small" value={query} placeholder="搜索模块"
          aria-label="搜索导航模块"
          onChange={(event) => setQuery(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 17 }} /></InputAdornment> }}
          sx={{ mb: 1.5 }}
        />
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>已固定</Typography>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pinned} strategy={verticalListSortingStrategy}>
            <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 2 }}>
              {pinnedItems.map((item) => (
                <SortablePinnedRow key={item.key} item={item} onUnpin={() => unpin(item.key)} />
              ))}
              {!pinnedItems.length ? <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>还没有固定项</Typography> : null}
            </List>
          </SortableContext>
        </DndContext>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>全部功能</Typography>
        <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 300, overflow: 'auto' }}>
          {groups.map((group) => (
            <Box key={group.key}>
              <Typography sx={{ px: 1.25, py: 0.75, fontSize: 11, color: 'text.disabled', bgcolor: 'action.hover' }}>{group.label}</Typography>
              {group.items.map((item) => {
                const Icon = item.icon
                const full = pinned.length >= MAX_PINNED
                return (
                  <ListItemButton key={item.key} disabled={full} aria-label={full ? `侧栏已满，无法固定${item.label}` : `固定${item.label}`} onClick={() => pin(item.key)} sx={{ minHeight: 38, gap: 1, px: 1.25 }}>
                    <ListItemIcon sx={{ minWidth: 28 }}><Icon sx={{ fontSize: 18 }} /></ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{full ? '已满' : '固定'}</Typography>
                  </ListItemButton>
                )
              })}
            </Box>
          ))}
          {!groups.length ? <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>没有可添加的模块</Typography> : null}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={() => onChange(DEFAULT_PINNED_KEYS)}>恢复默认</Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" onClick={onClose}>完成</Button>
      </DialogActions>
    </Dialog>
  )
}
