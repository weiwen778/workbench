import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import PushPin from '@mui/icons-material/PushPin'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useSession } from '@/session'
import { DragIndicator, Search } from '@/icons'
import { APP_NAV_GROUPS, APP_NAV_ITEMS, APP_NAV_KEYS, DEFAULT_PINNED_KEYS, appNavItem, type AppNavItem } from '@/layout/app-nav'
import {
  SIDEBAR_MODE_EVENT, SIDEBAR_ORDER_EVENT,
  readPinnedKeys, readSidebarMode, writePinnedKeys, writeSidebarMode, type SidebarMode,
} from '@/layout/sidebar-order'
import { Card } from '../SettingsSections'

function matches(query: string, label: string) {
  return !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase())
}

function SortablePinnedRow({ item, onOpen, onUnpin }: {
  item: AppNavItem
  onOpen: () => void
  onUnpin: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  const Icon = item.icon
  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.7 : 1, position: 'relative',
      }}
      sx={{ display: 'flex', alignItems: 'center', minHeight: 40, gap: 0.5, px: 0.5, bgcolor: 'background.paper' }}
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
          width: 24, height: 24, p: 0, border: 0, borderRadius: 0.75, bgcolor: 'transparent',
          color: 'text.disabled', cursor: 'grab', touchAction: 'none',
          '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicator sx={{ fontSize: 17 }} />
      </Box>
      <ListItemButton aria-label={`打开${item.label}`} onClick={onOpen} sx={{ flex: 1, minWidth: 0, minHeight: 38, gap: 1, px: 1, borderRadius: 1 }}>
        <ListItemIcon sx={{ minWidth: 28 }}><Icon sx={{ fontSize: 18 }} /></ListItemIcon>
        <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
      </ListItemButton>
      <Button size="small" aria-label={`取消固定${item.label}`} onClick={onUnpin} sx={{ flexShrink: 0 }}>取消固定</Button>
    </Box>
  )
}

export default function NavigationSection() {
  const session = useSession()
  const navigate = useNavigate()
  const userId = session.user?.id
  const [mode, setMode] = useState<SidebarMode>(() => readSidebarMode(userId))
  const [pinned, setPinned] = useState<string[]>(() => readPinnedKeys(userId, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))
  const [query, setQuery] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const sync = () => {
      setMode(readSidebarMode(userId))
      setPinned(readPinnedKeys(userId, DEFAULT_PINNED_KEYS, APP_NAV_KEYS))
    }
    sync()
    window.addEventListener(SIDEBAR_ORDER_EVENT, sync)
    window.addEventListener(SIDEBAR_MODE_EVENT, sync)
    return () => {
      window.removeEventListener(SIDEBAR_ORDER_EVENT, sync)
      window.removeEventListener(SIDEBAR_MODE_EVENT, sync)
    }
  }, [userId])

  const pinnedItems = pinned.map((key) => appNavItem(key)).filter((item): item is AppNavItem => Boolean(item))
  const pinnedMatch = pinnedItems.some((item) => matches(query, item.label))
  const groups = useMemo(() => APP_NAV_GROUPS.map((group) => ({
    ...group,
    items: APP_NAV_ITEMS.filter((item) => item.group === group.key && !pinned.includes(item.key) && matches(query, item.label)),
  })).filter((group) => group.items.length), [pinned, query])

  const changeMode = (next: SidebarMode | null) => {
    if (!next) return
    setMode(next)
    writeSidebarMode(userId, next)
  }
  const changePinned = (keys: string[]) => {
    setPinned(keys)
    writePinnedKeys(userId, keys)
  }
  const latestPinned = () => readPinnedKeys(userId, DEFAULT_PINNED_KEYS, APP_NAV_KEYS)
  const pin = (key: string) => {
    const current = latestPinned()
    if (current.includes(key)) return
    changePinned([...current, key])
  }
  const unpin = (key: string) => changePinned(latestPinned().filter((value) => value !== key))
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const current = latestPinned()
    const oldIndex = current.indexOf(String(active.id))
    const newIndex = current.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    changePinned(arrayMove(current, oldIndex, newIndex))
  }
  const reset = () => {
    setMode('narrow')
    writeSidebarMode(userId, 'narrow')
    changePinned([...DEFAULT_PINNED_KEYS])
  }

  return (
    <Stack spacing={2}>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>侧栏宽度</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>宽版显示图标和文字，窄版只显示图标。设置按账号保存在当前浏览器。</Typography>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, value: SidebarMode | null) => changeMode(value)}>
          <ToggleButton value="narrow">窄版</ToggleButton>
          <ToggleButton value="wide">宽版</ToggleButton>
        </ToggleButtonGroup>
      </Card>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap" sx={{ mb: 1.5 }}>
          <div>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>全部功能</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              已固定 {pinned.length} 个，点击模块可打开，图钉可固定到侧栏。
            </Typography>
          </div>
          <Button size="small" onClick={reset}>恢复默认</Button>
        </Stack>

        <TextField
          fullWidth size="small" value={query} placeholder="搜索功能"
          inputProps={{ 'aria-label': '搜索功能' }}
          onChange={(event) => setQuery(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 17 }} /></InputAdornment> }}
          sx={{ mb: 1.5 }}
        />

        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>已固定</Typography>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pinned} strategy={verticalListSortingStrategy}>
            <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 2 }}>
              {pinnedItems.map((item) => (
                <SortablePinnedRow
                  key={item.key}
                  item={item}
                  onOpen={() => navigate(item.path)}
                  onUnpin={() => unpin(item.key)}
                />
              ))}
              {!pinnedItems.length ? <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>还没有固定项</Typography> : null}
            </List>
          </SortableContext>
        </DndContext>

        {groups.map((group) => (
          <Box key={group.key} sx={{ mb: 1 }}>
            <Typography sx={{ px: 1.25, py: 0.75, fontSize: 12, color: 'text.disabled' }}>{group.label}</Typography>
            <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <Box key={item.key} sx={{ display: 'flex', alignItems: 'center' }}>
                    <ListItemButton aria-label={`打开${item.label}`} onClick={() => navigate(item.path)} sx={{ flex: 1, minHeight: 38, gap: 1, px: 1.25, borderRadius: 1 }}>
                      <ListItemIcon sx={{ minWidth: 28 }}><Icon sx={{ fontSize: 19 }} /></ListItemIcon>
                      <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
                    </ListItemButton>
                    <Tooltip title="固定到侧栏">
                      <IconButton size="small" aria-label={`固定${item.label}`} onClick={() => pin(item.key)} sx={{ mr: 0.5 }}>
                        <PushPin sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )
              })}
            </List>
          </Box>
        ))}
        {!groups.length && !query.trim() ? (
          <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>全部模块都已固定</Typography>
        ) : null}
        {!groups.length && query.trim() && !pinnedMatch ? (
          <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>没有匹配的功能</Typography>
        ) : null}
      </Card>
    </Stack>
  )
}
