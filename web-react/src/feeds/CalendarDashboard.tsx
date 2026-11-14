import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Box, useMediaQuery, useTheme } from '@mui/material'
import { toast } from '@/ui/feedback'
import { apiError } from '@/api/client'
import { queryClient } from '@/query/client'
import CalendarGrid, { formatDateLocal } from '@/feeds/CalendarGrid'
import DataPanels from '@/feeds/DataPanels'
import { getCalendar, getDataPanels, refreshCommon, refreshSubscriptions } from '@/feeds/api'

type Section = 'subscriptions' | 'alibaba' | '1688' | 'links'

function monthGridRange(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41)
  return { start: formatDateLocal(start), end: formatDateLocal(end) }
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export default function CalendarDashboard() {
  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [refreshing, setRefreshing] = useState<Record<Section, boolean>>({
    subscriptions: false,
    alibaba: false,
    '1688': false,
    links: false,
  })

  const range = useMemo(() => monthGridRange(month), [month])

  const calendarQuery = useQuery({
    queryKey: ['feeds', 'calendar', range.start, range.end],
    queryFn: () => getCalendar(range.start, range.end),
  })

  const panelsQuery = useQuery({
    queryKey: ['feeds', 'data-panels'],
    queryFn: getDataPanels,
  })

  const calendarError = calendarQuery.error ? apiError(calendarQuery.error).message : null
  const panelsError = panelsQuery.error ? apiError(panelsQuery.error).message : null

  const invalidateLater = () => {
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['feeds', 'calendar'] })
      void queryClient.invalidateQueries({ queryKey: ['feeds', 'data-panels'] })
    }, 3000)
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['feeds', 'calendar'] })
      void queryClient.invalidateQueries({ queryKey: ['feeds', 'data-panels'] })
    }, 8000)
  }

  const refreshAll = useMutation({
    mutationFn: async () => {
      const [runsignup, alibaba, rules1688, subscriptions] = await Promise.all([
        refreshCommon('runsignup'),
        refreshCommon('alibaba-rules'),
        refreshCommon('1688-rules'),
        refreshSubscriptions(undefined, true),
      ])
      return { runsignup, alibaba, rules1688, subscriptions }
    },
    onMutate: () => {
      setRefreshing({ subscriptions: true, alibaba: true, '1688': true, links: true })
    },
    onSettled: () => {
      setRefreshing({ subscriptions: false, alibaba: false, '1688': false, links: false })
    },
    onSuccess: (result) => {
      const cooldowns = [
        { name: '赛事', value: result.runsignup },
        { name: '阿里规则', value: result.alibaba },
        { name: '1688 规则', value: result.rules1688 },
      ].filter((item) => item.value.reason === 'cooldown' && item.value.retry_after)
      if (cooldowns.length) {
        const messages = cooldowns.map((item) => `${item.name} 冷却中，请 ${item.value.retry_after} 秒后重试`)
        toast.warning(messages.join('；'))
      }
      invalidateLater()
    },
  })

  const handleCalendarRefresh = async () => {
    try {
      const result = await refreshCommon('runsignup')
      if (result.reason === 'cooldown' && result.retry_after) {
        toast.warning(`赛事数据冷却中，请 ${result.retry_after} 秒后重试`)
      }
      invalidateLater()
    } catch (reason) {
      toast.error(apiError(reason as Error).message)
    }
  }

  const handleSectionRefresh = async (section: Section) => {
    setRefreshing((current) => ({ ...current, [section]: true }))
    try {
      if (section === 'subscriptions') {
        await refreshSubscriptions(undefined, true)
      } else if (section === 'alibaba') {
        const result = await refreshCommon('alibaba-rules')
        if (result.reason === 'cooldown' && result.retry_after) {
          toast.warning(`阿里规则冷却中，请 ${result.retry_after} 秒后重试`)
        }
      } else if (section === '1688') {
        const result = await refreshCommon('1688-rules')
        if (result.reason === 'cooldown' && result.retry_after) {
          toast.warning(`1688 规则冷却中，请 ${result.retry_after} 秒后重试`)
        }
      } else if (section === 'links') {
        await refreshAll.mutateAsync()
        return
      }
      invalidateLater()
    } catch (reason) {
      toast.error(apiError(reason as Error).message)
    } finally {
      setRefreshing((current) => ({ ...current, [section]: false }))
    }
  }

  return (
    <Box
      className="scroll-area"
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        p: { xs: 1.25, md: 1.5 },
        display: isNarrow ? 'flex' : 'grid',
        flexDirection: isNarrow ? 'column' : undefined,
        gap: 1.5,
        ...(!isNarrow && {
          gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.9fr)',
          gridTemplateRows: 'minmax(0, 1.8fr) minmax(0, 0.9fr)',
          gridTemplateAreas: '"calendar calendar data1" "data2 data3 data4"',
        }),
      }}
    >
      <Box sx={{
        gridArea: isNarrow ? undefined : 'calendar',
        minHeight: 0,
        flex: isNarrow ? '0 0 auto' : undefined,
        height: isNarrow ? 'auto' : '100%',
        display: 'flex',
        ...(isNarrow && { '& > .MuiPaper-root': { height: 'auto' } }),
      }}>
        <CalendarGrid
          month={month}
          events={calendarQuery.data?.events || []}
          onMonthChange={setMonth}
          onRefresh={() => void handleCalendarRefresh()}
          status={calendarQuery.data?.status || 'idle'}
          loading={calendarQuery.isPending}
          error={calendarError}
        />
      </Box>
      <Box sx={{
        gridArea: isNarrow ? undefined : 'data1',
        minHeight: 0,
        flex: isNarrow ? '0 0 auto' : undefined,
        height: isNarrow ? 'auto' : '100%',
        display: 'flex',
      }}>
        <DataPanels
          section="subscriptions"
          data={panelsQuery.data}
          loading={panelsQuery.isPending}
          onRefresh={() => void handleSectionRefresh('subscriptions')}
          refreshing={refreshing.subscriptions}
          error={panelsError}
        />
      </Box>
      <Box sx={{
        gridArea: isNarrow ? undefined : 'data2',
        minHeight: 0,
        flex: isNarrow ? '0 0 auto' : undefined,
        height: isNarrow ? 'auto' : '100%',
        display: 'flex',
      }}>
        <DataPanels
          section="alibaba"
          data={panelsQuery.data}
          loading={panelsQuery.isPending}
          onRefresh={() => void handleSectionRefresh('alibaba')}
          refreshing={refreshing.alibaba}
          error={panelsError}
        />
      </Box>
      <Box sx={{
        gridArea: isNarrow ? undefined : 'data3',
        minHeight: 0,
        flex: isNarrow ? '0 0 auto' : undefined,
        height: isNarrow ? 'auto' : '100%',
        display: 'flex',
      }}>
        <DataPanels
          section="1688"
          data={panelsQuery.data}
          loading={panelsQuery.isPending}
          onRefresh={() => void handleSectionRefresh('1688')}
          refreshing={refreshing['1688']}
          error={panelsError}
        />
      </Box>
      <Box sx={{
        gridArea: isNarrow ? undefined : 'data4',
        minHeight: 0,
        flex: isNarrow ? '0 0 auto' : undefined,
        height: isNarrow ? 'auto' : '100%',
        display: 'flex',
      }}>
        <DataPanels
          section="links"
          data={panelsQuery.data}
          loading={panelsQuery.isPending}
          onRefresh={() => void handleSectionRefresh('links')}
          refreshing={refreshing.links}
          error={panelsError}
        />
      </Box>
    </Box>
  )
}
