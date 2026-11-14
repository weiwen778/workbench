import { Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Refresh } from '@/icons'
import { EmptyHint, LoadingBlock } from '@/ui/common'
import { relativeTime, StatusChip } from '@/feeds/shared'
import type { DataPanelsPayload, FeedEntry, RuleSource } from '@/feeds/api'

export interface DataPanelsProps {
  section: 'subscriptions' | 'alibaba' | '1688' | 'links'
  data: DataPanelsPayload | undefined
  loading: boolean
  onRefresh: () => void
  refreshing: boolean
}

const SECTION_TITLES: Record<DataPanelsProps['section'], string> = {
  subscriptions: '订阅文章',
  alibaba: '阿里国际站规则',
  '1688': '1688 规则',
  links: '常用平台入口',
}

export default function DataPanels({ section, data, loading, onRefresh, refreshing }: DataPanelsProps) {
  const navigate = useNavigate()

  const title = SECTION_TITLES[section]

  return (
    <Paper variant="outlined" sx={{ height: '100%', minHeight: 180, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 650 }}>{title}</Typography>
        <Box sx={{ flex: 1 }} />
        {section === 'links' ? null : <PanelStatus section={section} data={data} />}
        <Tooltip title={section === 'links' ? '刷新全部' : '刷新'}>
          <span>
            <IconButton size="small" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? <CircularProgress size={15} /> : <Refresh fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}>
        {loading && !data ? (
          <LoadingBlock text="正在读取…" />
        ) : section === 'subscriptions' ? (
          <SubscriptionsPanel data={data} navigate={navigate} />
        ) : section === 'links' ? (
          <LinksPanel data={data} />
        ) : (
          <RulesPanel section={section} data={data} />
        )}
      </Box>
    </Paper>
  )
}

function PanelStatus({ section, data }: { section: DataPanelsProps['section']; data: DataPanelsPayload | undefined }) {
  const rule = section === 'alibaba' || section === '1688'
    ? data?.rules.find((item) => item.key === `${section}-rules`)
    : undefined
  if (!rule && section !== 'subscriptions') return null
  const status = section === 'subscriptions' ? 'ok' : rule!.status
  const lastAt = section === 'subscriptions' ? undefined : rule!.last_success_at
  return (
    <Stack direction="row" spacing={0.6} alignItems="center">
      <StatusChip status={status} />
      {lastAt ? <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>{relativeTime(lastAt)}</Typography> : null}
    </Stack>
  )
}

function SubscriptionsPanel({ data, navigate }: { data: DataPanelsPayload | undefined; navigate: (path: string) => void }) {
  const items = data?.subscriptions.items || []
  if (!items.length) {
    return <EmptyHint>暂无订阅文章</EmptyHint>
  }
  return (
    <Stack spacing={0.5}>
      {items.map((entry) => (
        <SubscriptionRow key={entry.id} entry={entry} />
      ))}
      <Box sx={{ pt: 0.5, textAlign: 'center' }}>
        <Button size="small" onClick={() => navigate('/feeds?tab=subscriptions')}>查看全部</Button>
      </Box>
    </Stack>
  )
}

function SubscriptionRow({ entry }: { entry: FeedEntry }) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="flex-start"
      sx={{
        px: 0.75, py: 0.6, borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {!entry.read ? (
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'primary.main', mt: 0.9, flexShrink: 0 }} />
      ) : (
        <Box sx={{ width: 7, flexShrink: 0 }} />
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          component="a"
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            fontSize: 12.5, fontWeight: 550, lineHeight: 1.45, color: 'text.primary', textDecoration: 'none',
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            '&:hover': { color: 'primary.main', textDecoration: 'underline' },
          }}
        >
          {entry.title}
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.45 }}>
          {entry.subscription_title}
          <Box component="span" sx={{ color: 'text.disabled', mx: 0.5 }}>·</Box>
          {relativeTime(entry.published_at || entry.discovered_at)}
        </Typography>
      </Box>
    </Stack>
  )
}

function RulesPanel({ section, data }: { section: 'alibaba' | '1688'; data: DataPanelsPayload | undefined }) {
  const rule = data?.rules.find((item) => item.key === `${section}-rules`)
  if (!rule) {
    return <EmptyHint>上游暂无更新</EmptyHint>
  }
  const hasError = Boolean(rule.last_error)
  return (
    <Stack spacing={0.5}>
      {hasError ? (
        <Typography sx={{ fontSize: 11, color: 'warning.main', px: 0.5 }}>
          本次刷新失败，继续显示缓存：{rule.last_error}
        </Typography>
      ) : null}
      {rule.entries.length ? (
        rule.entries.map((entry, index) => (
          <RuleRow key={`${entry.title}-${index}`} entry={entry} />
        ))
      ) : (
        <EmptyHint>上游暂无更新</EmptyHint>
      )}
    </Stack>
  )
}

function RuleRow({ entry }: { entry: RuleSource['entries'][number] }) {
  return (
    <Stack
      spacing={0.25}
      sx={{
        px: 0.75, py: 0.6, borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Stack direction="row" spacing={0.5} alignItems="center">
        {entry.badge ? <Chip size="small" label={entry.badge} sx={{ height: 18, fontSize: 9.5 }} /> : null}
        <Typography
          component="a"
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            fontSize: 12.5, fontWeight: 550, lineHeight: 1.45, color: 'text.primary', textDecoration: 'none',
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            '&:hover': { color: 'primary.main', textDecoration: 'underline' },
          }}
        >
          {entry.title}
        </Typography>
        <ExternalLink sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
      </Stack>
      <Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>
        {relativeTime(entry.published_at)}
      </Typography>
      {entry.summary ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.summary}
        </Typography>
      ) : null}
    </Stack>
  )
}

function LinksPanel({ data }: { data: DataPanelsPayload | undefined }) {
  const links = data?.links || []
  if (!links.length) {
    return <EmptyHint>暂无平台入口</EmptyHint>
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1 }}>
      {links.map((link) => (
        <Paper
          key={link.key}
          variant="outlined"
          sx={{
            p: 1.25,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
            <Typography sx={{ fontSize: 13, fontWeight: 650 }}>{link.title}</Typography>
            {link.badge ? <Chip size="small" label={link.badge} sx={{ height: 18, fontSize: 9.5 }} /> : null}
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="outlined"
            endIcon={<ExternalLink fontSize="small" />}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开网站
          </Button>
        </Paper>
      ))}
    </Box>
  )
}
