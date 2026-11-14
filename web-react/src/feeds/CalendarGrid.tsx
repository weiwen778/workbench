import { useMemo, useState } from 'react'
import {
  Alert, Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { ArrowLeft, ArrowRight, ExternalLink, Refresh } from '@/icons'
import { LoadingBlock } from '@/ui/common'
import { StatusChip } from '@/feeds/shared'
import type { CalendarEvent } from '@/feeds/api'

export interface CalendarGridProps {
  month: Date
  events: CalendarEvent[]
  onMonthChange: (next: Date) => void
  onRefresh: () => void
  status: string
  loading: boolean
  error?: string | null
}

export function formatDateLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export default function CalendarGrid({ month, events, onMonthChange, onRefresh, status, loading, error }: CalendarGridProps) {
  const [dialogDate, setDialogDate] = useState<string | null>(null)

  const theme = useTheme()
  const today = useMemo(() => formatDateLocal(new Date()), [])

  const { year, monthIndex, cells } = useMemo(() => {
    const y = month.getFullYear()
    const m = month.getMonth()
    const first = new Date(y, m, 1)
    const offset = (first.getDay() + 6) % 7
    const start = new Date(y, m, 1 - offset)
    const days: Date[] = []
    for (let i = 0; i < 42; i++) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
    }
    return { year: y, monthIndex: m, cells: days }
  }, [month])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const list = map.get(event.date) || []
      list.push(event)
      map.set(event.date, list)
    }
    return map
  }, [events])

  const handlePrev = () => onMonthChange(new Date(year, monthIndex - 1, 1))
  const handleNext = () => onMonthChange(new Date(year, monthIndex + 1, 1))
  const handleToday = () => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

  const dialogEvents = dialogDate ? (eventsByDate.get(dialogDate) || []) : []

  const hasEvents = events.length > 0

  return (
    <Paper variant="outlined" sx={{ height: '100%', minHeight: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CalendarHeader
        year={year} monthIndex={monthIndex}
        status={status} onPrev={handlePrev} onNext={handleNext} onToday={handleToday} onRefresh={onRefresh}
      />
      <Typography sx={{ px: 1.25, pb: 0.5, fontSize: 11, color: 'text.secondary' }}>
        RunSignup 覆盖因国家而异，部分国家暂无赛事
      </Typography>
      {error && hasEvents ? (
        <Alert severity="error" variant="outlined" sx={{ mx: 1.25, mb: 0.75, py: 0.25, fontSize: 11.5 }}>
          {error}
        </Alert>
      ) : null}
      {loading && !hasEvents ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingBlock text="正在读取日历…" />
        </Box>
      ) : error && !hasEvents ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
          <Alert severity="error" sx={{ fontSize: 12 }}>加载失败：{error}</Alert>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: 1, borderColor: 'divider' }}>
            {WEEKDAYS.map((day) => (
              <Box key={day} sx={{ py: 0.6, textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'text.secondary', bgcolor: 'action.hover' }}>
                {day}
              </Box>
            ))}
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, 1fr)' }}>
            {cells.map((date) => {
              const dateStr = formatDateLocal(date)
              const isCurrentMonth = date.getMonth() === monthIndex
              const isToday = dateStr === today
              const dayEvents = eventsByDate.get(dateStr) || []
              const visible = dayEvents.slice(0, 2)
              const overflow = dayEvents.length - visible.length
              return (
                <Box
                  key={dateStr}
                  onClick={() => dayEvents.length > 0 && setDialogDate(dateStr)}
                  sx={{
                    minHeight: 0,
                    p: 0.5,
                    borderRight: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.3,
                    cursor: dayEvents.length > 0 ? 'pointer' : 'default',
                    bgcolor: isToday ? 'action.selected' : 'background.paper',
                    '&:nth-of-type(7n)': { borderRight: 0 },
                    '&:nth-of-type(n+36)': { borderBottom: 0 },
                    opacity: isCurrentMonth ? 1 : 0.45,
                    '&:hover': dayEvents.length > 0 ? { bgcolor: 'action.hover' } : undefined,
                  }}
                >
                  <Typography sx={{ fontSize: 11.5, fontWeight: isToday ? 700 : 500, color: isToday ? 'primary.main' : 'text.primary' }}>
                    {date.getDate()}
                  </Typography>
                  <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                    {visible.map((event, index) => (
                      <Tooltip key={`${event.kind}-${index}`} title={event.title} disableHoverListener={event.title.length <= 18}>
                        <Chip
                          size="small"
                          label={event.kind === 'race' && event.country ? `${event.country} · ${event.title}` : event.title}
                          sx={{
                            height: 18,
                            fontSize: 9.5,
                            borderRadius: 0.75,
                            bgcolor: event.kind === 'holiday' ? alpha(theme.palette.warning.main, 0.14) : alpha(theme.palette.primary.main, 0.12),
                            color: event.kind === 'holiday' ? theme.palette.warning.dark : theme.palette.primary.dark,
                            borderColor: 'transparent',
                            '& .MuiChip-label': { px: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                          }}
                        />
                      </Tooltip>
                    ))}
                  </Box>
                  {overflow > 0 ? (
                    <Typography sx={{ fontSize: 10, color: 'text.secondary', textAlign: 'right' }}>+{overflow}</Typography>
                  ) : null}
                </Box>
              )
            })}
          </Box>
        </>
      )}

      <Dialog open={Boolean(dialogDate)} onClose={() => setDialogDate(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          {dialogDate ? `${dialogDate.replace(/-/g, '/')} 共 ${dialogEvents.length} 条` : ''}
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          <Stack spacing={1}>
            {dialogEvents.map((event, index) => (
              <Stack key={`${event.kind}-${index}`} spacing={0.25}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip
                    size="small"
                    label={event.kind === 'race' ? '赛事' : '节日'}
                    sx={{ height: 18, fontSize: 9.5 }}
                    color={event.kind === 'race' ? 'primary' : 'warning'}
                  />
                  <Typography
                    component="a"
                    href={event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ fontSize: 13.5, fontWeight: 550, color: 'text.primary', textDecoration: 'none', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                  >
                    {event.title}
                  </Typography>
                  <ExternalLink sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
                </Stack>
                {event.kind === 'race' ? (
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {event.country ? `${event.country}` : ''}
                    {event.city ? ` · ${event.city}` : ''}
                    {event.distance ? ` · ${event.distance}` : ''}
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </DialogContent>
      </Dialog>
    </Paper>
  )
}

function CalendarHeader({
  year, monthIndex, status, onPrev, onNext, onToday, onRefresh,
}: {
  year: number
  monthIndex: number
  status: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onRefresh: () => void
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1 }}>
      <Typography sx={{ fontSize: 16, fontWeight: 650 }}>{year}年{monthIndex + 1}月</Typography>
      <Stack direction="row" spacing={0.25}>
        <Tooltip title="上月">
          <IconButton size="small" onClick={onPrev}><ArrowLeft fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="今天">
          <IconButton size="small" onClick={onToday}><Typography sx={{ fontSize: 11, fontWeight: 600 }}>今</Typography></IconButton>
        </Tooltip>
        <Tooltip title="下月">
          <IconButton size="small" onClick={onNext}><ArrowRight fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flex: 1 }} />
      <StatusChip status={status} />
      <Tooltip title="刷新赛事">
        <IconButton size="small" onClick={onRefresh}><Refresh fontSize="small" /></IconButton>
      </Tooltip>
    </Stack>
  )
}
