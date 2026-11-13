import type { ReactNode } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import { ExternalLink, Link } from '@/icons'

export function relativeTime(value?: string | null) {
  if (!value) return ''
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function dateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function linkText(kind: string) {
  if (kind === 'search') return '搜索详情'
  if (kind === 'topic') return '查看话题'
  return '阅读原文'
}

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  ok: 'success', refreshing: 'info', stale: 'warning', error: 'error',
  empty: 'default', idle: 'default', disabled: 'default',
}

const STATUS_LABELS: Record<string, string> = {
  ok: '已更新', refreshing: '刷新中', stale: '显示缓存', error: '暂不可用',
  empty: '暂无条目', idle: '等待更新', disabled: '已停用',
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return (
    <Chip
      size="small" variant="outlined" color={STATUS_COLORS[status] || 'default'}
      label={label || STATUS_LABELS[status] || status}
      sx={{ height: 22, fontSize: 10.5 }}
    />
  )
}

export function MetaLine({ children }: { children: ReactNode }) {
  return (
    <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.5 }}>
      {children}
    </Typography>
  )
}

export function ExternalText({ href, children, kind = 'article' }: { href?: string; children: ReactNode; kind?: string }) {
  if (!href) {
    return <Typography component="span" sx={{ fontSize: 13.5, fontWeight: 550, lineHeight: 1.5 }}>{children}</Typography>
  }
  return (
    <Stack direction="row" spacing={0.4} alignItems="baseline" sx={{ minWidth: 0 }}>
      <Typography
        component="a" href={href} target="_blank" rel="noopener noreferrer"
        sx={{
          fontSize: 13.5, fontWeight: 550, lineHeight: 1.5, color: 'text.primary', textDecoration: 'none',
          overflowWrap: 'anywhere', '&:hover': { color: 'primary.main', textDecoration: 'underline' },
        }}
      >
        {children}
      </Typography>
      <ExternalLink sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
      {kind !== 'article' ? <Chip size="small" variant="outlined" label={linkText(kind)} sx={{ height: 18, fontSize: 9.5 }} /> : null}
    </Stack>
  )
}

export function SourceLink({ href, label = '打开来源' }: { href?: string; label?: string }) {
  if (!href) return null
  return (
    <Typography
      component="a" href={href} target="_blank" rel="noopener noreferrer"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: 11, color: 'primary.main', textDecoration: 'none' }}
    >
      <Link sx={{ fontSize: 13 }} />{label}
    </Typography>
  )
}

export function DividerDot() {
  return <Box component="span" sx={{ color: 'text.disabled', mx: 0.5 }}>·</Box>
}
