import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Box, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import PushPin from '@mui/icons-material/PushPin'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DragIndicator } from '@/icons'
import { apiError, http } from '@/api/client'
import { toast } from '@/ui/feedback'
import { useSession } from '@/session'

type Target = { id: number; name: string; sort_order: number }

function readFavorites(key: string): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'number') : []
  } catch {
    return []
  }
}

async function persistOrder(targets: Target[]) {
  for (const [index, target] of targets.entries()) {
    if (target.sort_order !== index) await http.patch(`/work-targets/${target.id}`, { sort_order: index })
  }
}

function SortableTarget({ target, favorite, active, onOpen, onFavorite, onPin }: {
  target: Target
  favorite: boolean
  active: boolean
  onOpen: () => void
  onFavorite: () => void
  onPin: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: target.id })
  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.65 : 1, position: 'relative',
      }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.25, minHeight: 29, borderRadius: 0.75,
        bgcolor: isDragging ? 'background.paper' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        component="button"
        type="button"
        aria-label={`拖动${target.name}排序`}
        title="拖动排序"
        sx={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: 18, height: 22, p: 0, border: 0, borderRadius: 0.5, bgcolor: 'transparent',
          color: 'text.disabled', cursor: 'grab', touchAction: 'none',
          '&:hover': { color: 'text.secondary' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicator sx={{ fontSize: 15 }} />
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        sx={{
          flex: 1, minWidth: 0, border: 0, bgcolor: 'transparent', p: 0, textAlign: 'left',
          cursor: 'pointer', color: active ? 'primary.main' : 'text.primary',
        }}
      >
        <Typography noWrap sx={{ fontSize: 11.5, fontWeight: active ? 600 : 400, lineHeight: 1.4 }}>{target.name}</Typography>
      </Box>
      <Tooltip title={favorite ? '取消收藏' : '收藏'}>
        <IconButton
          size="small"
          aria-label={favorite ? `取消收藏${target.name}` : `收藏${target.name}`}
          onClick={onFavorite}
          sx={{ width: 20, height: 20, p: 0.25, color: favorite ? 'warning.main' : 'text.disabled' }}
        >
          {favorite ? <Star sx={{ fontSize: 14 }} /> : <StarBorder sx={{ fontSize: 14 }} />}
        </IconButton>
      </Tooltip>
      <Tooltip title="置顶">
        <IconButton
          size="small"
          aria-label={`置顶${target.name}`}
          onClick={onPin}
          sx={{ width: 20, height: 20, p: 0.25, color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
        >
          <PushPin sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

export default function CheckinSubnav({ open }: { open: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const [targets, setTargets] = useState<Target[]>([])
  const [favorites, setFavorites] = useState<number[]>([])
  const userKey = String(session.user?.id || 'guest')
  const favoriteKey = `wb_checkin_favorites_${userKey}`
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async () => {
    try {
      const { data } = await http.get('/work-targets')
      setTargets(Array.isArray(data) ? data : [])
    } catch {
      // Sidebar shortcuts should stay quiet when the checkin API is unavailable.
    }
  }, [])

  useEffect(() => {
    setFavorites(readFavorites(favoriteKey))
  }, [favoriteKey])

  useEffect(() => {
    if (!open) return
    void load()
    const refresh = () => void load()
    window.addEventListener('wb:checkin-targets-changed', refresh)
    return () => window.removeEventListener('wb:checkin-targets-changed', refresh)
  }, [load, open])

  const toggleFavorite = (id: number) => {
    const next = favorites.includes(id) ? favorites.filter((value) => value !== id) : [...favorites, id]
    setFavorites(next)
    localStorage.setItem(favoriteKey, JSON.stringify(next))
  }

  const reorder = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = targets.findIndex((target) => target.id === active.id)
    const newIndex = targets.findIndex((target) => target.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(targets, oldIndex, newIndex)
    setTargets(next)
    try {
      await persistOrder(next)
    } catch (error) {
      toast.error(apiError(error).message)
      await load()
    }
  }

  const pin = async (target: Target) => {
    if (targets[0]?.id === target.id) return
    const next = [target, ...targets.filter((item) => item.id !== target.id)]
    setTargets(next)
    try {
      await persistOrder(next)
    } catch (error) {
      toast.error(apiError(error).message)
      await load()
    }
  }

  const activeId = Number(location.pathname.match(/^\/checkins\/targets\/(\d+)/)?.[1] || 0)

  return (
    <Collapse in={open} timeout={180} unmountOnExit>
      <Box
        aria-label="打卡项目二级导航"
        sx={{
          width: '100%', maxHeight: 'min(286px, max(96px, calc(100vh - 520px)))', overflowY: 'auto', mt: 0.25, mb: 0.5,
          pl: 1.25, pr: 0.5, borderLeft: '1px solid', borderColor: 'divider',
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void reorder(event)}>
          <SortableContext items={targets.map((target) => target.id)} strategy={verticalListSortingStrategy}>
            {targets.map((target) => (
              <SortableTarget
                key={target.id}
                target={target}
                favorite={favorites.includes(target.id)}
                active={target.id === activeId}
                onOpen={() => navigate(`/checkins/targets/${target.id}`)}
                onFavorite={() => toggleFavorite(target.id)}
                onPin={() => void pin(target)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {!targets.length ? <Typography sx={{ py: 1, fontSize: 11, color: 'text.disabled' }}>还没有打卡项目</Typography> : null}
      </Box>
    </Collapse>
  )
}
