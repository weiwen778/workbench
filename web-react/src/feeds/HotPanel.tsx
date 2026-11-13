import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import { Refresh, Translate } from '@/icons'
import { apiError } from '@/api/client'
import { toast } from '@/ui/feedback'
import { EmptyHint, LoadingBlock } from '@/ui/common'
import { readTranslationPreferences } from '@/utils/translation-preferences'
import {
  getHot, refreshHot, translateTitles, type HotEntry, type HotPayload, type HotSource,
} from '@/feeds/api'
import { dateTime, DividerDot, ExternalText, MetaLine, relativeTime, SourceLink, StatusChip } from '@/feeds/shared'

const VISIBLE_COUNT = 10

function collectTranslations(payload: HotPayload | null, current: Record<string, string>) {
  const next = { ...current }
  for (const section of payload?.sections || []) {
    for (const source of section.sources) {
      for (const entry of source.entries) {
        if (entry.translation && !next[entry.title]) next[entry.title] = entry.translation
      }
    }
  }
  return next
}

export default function HotPanel() {
  const navigate = useNavigate()
  const [data, setData] = useState<HotPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState('')
  const pollTimer = useRef<number | null>(null)
  const pollTicks = useRef(0)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const payload = await getHot()
      setData(payload)
      setTranslations((current) => collectTranslations(payload, current))
      setError('')
    } catch (reason) {
      if (!silent) setError(apiError(reason).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null }
    pollTicks.current = 0
  }, [])

  const startPolling = useCallback(() => {
    if (pollTimer.current) return
    pollTicks.current = 0
    pollTimer.current = window.setInterval(() => {
      pollTicks.current += 1
      void load(true)
      if (pollTicks.current >= 8) stopPolling()
    }, 1600)
  }, [load, stopPolling])

  useEffect(() => {
    let alive = true
    void (async () => {
      await load()
      if (!alive) return
      try {
        const result = await refreshHot(undefined, false)
        if (result.started.length || result.joined.length) startPolling()
      } catch { /* 首屏缓存仍可用 */ }
    })()
    return () => { alive = false; stopPolling() }
  }, [load, startPolling, stopPolling])

  const triggerRefresh = async (ids?: string[], force = true) => {
    try {
      const result = await refreshHot(ids, force)
      if (result.started.length) startPolling()
      else if (result.joined.length) startPolling()
      else void load(true)
    } catch (reason) {
      toast.error(apiError(reason).message)
    }
  }

  const translate = async (texts: string[]) => {
    const missing = [...new Set(texts.filter((text) => text && !translations[text]))]
    if (!missing.length || translating) return
    setTranslating(true)
    setTranslationError('')
    try {
      const provider = readTranslationPreferences().provider
      for (let index = 0; index < missing.length; index += 20) {
        const result = await translateTitles(missing.slice(index, index + 20), provider)
        setTranslations((current) => {
          const next = { ...current }
          for (const item of result.items) next[item.source_text] = item.target_text
          return next
        })
        if (result.error) {
          setTranslationError(result.error)
          toast.warning(result.error)
        }
      }
    } catch (reason) {
      const message = apiError(reason).message
      setTranslationError(message)
      toast.warning(message)
    } finally {
      setTranslating(false)
    }
  }

  const missingForSource = (source: HotSource) => {
    const entries = expanded.has(source.id) ? source.entries : source.entries.slice(0, VISIBLE_COUNT)
    return entries
      .filter((entry) => entry.language !== 'zh' && !translations[entry.title])
      .map((entry) => entry.title)
  }

  const translationStatus = data?.translation
  const totalMissing = useMemo(() => {
    if (!data) return 0
    return data.sections.flatMap((section) => section.sources)
      .flatMap((source) => missingForSource(source)).length
  }, [data, expanded, translations])

  if (loading && !data) return <LoadingBlock text="正在读取热榜缓存…" />
  if (error && !data) {
    return <EmptyHint action={<Button size="small" onClick={() => void load()}>重试</Button>}>{error}</EmptyHint>
  }

  return (
    <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.25, md: 1.5 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          每个来源保留平台原榜单顺序，不跨平台混排。
        </Typography>
        <Box sx={{ flex: 1 }} />
        {translationStatus ? (
          <Chip
            size="small" variant="outlined"
            color={translationStatus.configured ? 'success' : 'default'}
            label={translationStatus.configured ? `标题翻译：${translationStatus.provider_name}` : '标题翻译未配置'}
            onClick={!translationStatus.configured ? () => navigate('/settings/translation') : undefined}
            sx={{ fontSize: 10.5, height: 22 }}
          />
        ) : null}
        {totalMissing ? (
          <Button
            size="small" startIcon={<Translate fontSize="small" />} disabled={translating}
            onClick={() => void translate(data!.sections.flatMap((section) => section.sources).flatMap((source) => missingForSource(source)))}
          >
            {translating ? '翻译中…' : `翻译可见标题（${totalMissing}）`}
          </Button>
        ) : null}
        <Button size="small" variant="contained" data-testid="hot-refresh-all" startIcon={<Refresh fontSize="small" />} onClick={() => void triggerRefresh()}>
          刷新全部
        </Button>
      </Stack>

      {!translationStatus?.configured ? (
        <Alert
          severity="info" variant="outlined" sx={{ py: 0.25, fontSize: 12 }}
          action={<Button color="inherit" size="small" onClick={() => navigate('/settings/translation')}>翻译设置</Button>}
        >
          尚未启用翻译服务。英文原文和链接仍可正常使用；需要中文译文时可在设置中配置翻译服务。
        </Alert>
      ) : null}
      {translationError ? (
        <Alert severity="warning" variant="outlined" onClose={() => setTranslationError('')} sx={{ py: 0.25, fontSize: 12 }}>
          {translationError}
        </Alert>
      ) : null}

      {data?.sections.map((section) => (
        <Box key={section.key} component="section">
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 650 }}>{section.label}</Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{section.description}</Typography>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25, alignItems: 'start' }}>
            {section.sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                expanded={expanded.has(source.id)}
                translations={translations}
                translating={translating}
                onToggle={() => setExpanded((current) => {
                  const next = new Set(current)
                  if (next.has(source.id)) next.delete(source.id); else next.add(source.id)
                  return next
                })}
                onRefresh={() => void triggerRefresh([source.id])}
                onTranslate={() => void translate(missingForSource(source))}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function SourceCard({
  source, expanded, translations, translating, onToggle, onRefresh, onTranslate,
}: {
  source: HotSource
  expanded: boolean
  translations: Record<string, string>
  translating: boolean
  onToggle: () => void
  onRefresh: () => void
  onTranslate: () => void
}) {
  const refreshing = source.status === 'refreshing'
  const entries = expanded ? source.entries : source.entries.slice(0, VISIBLE_COUNT)
  const hasMissing = entries.some((entry) => entry.language !== 'zh' && !translations[entry.title])
  const provider = source.provider || source.provider_hint
  return (
    <Paper variant="outlined" data-testid={`hot-source-${source.id}`} sx={{ minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="flex-start" spacing={0.75} sx={{ px: 1.25, pt: 1.1, pb: 0.75 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: 14, fontWeight: 650 }}>{source.label}</Typography>
            <Chip size="small" variant="outlined" label={source.type_label} sx={{ height: 20, fontSize: 10 }} />
            <StatusChip status={source.status} />
          </Stack>
          <MetaLine>
            {source.platform} · 数据提供：{provider}
          </MetaLine>
          <MetaLine>
            {source.last_success_at ? <>最近成功 {relativeTime(source.last_success_at)}</> : '尚未成功抓取'}
            {source.last_error && source.last_attempt_at ? <><DividerDot />最近尝试 {relativeTime(source.last_attempt_at)}</> : null}
            {source.upstream_updated_at ? <><DividerDot />榜单更新 {dateTime(source.upstream_updated_at)}</> : null}
            {source.entry_count ? <><DividerDot />{source.entry_count} 条</> : null}
          </MetaLine>
          {source.provider_note ? <Typography sx={{ fontSize: 10.5, color: 'text.disabled', mt: 0.25 }}>{source.provider_note}</Typography> : null}
        </Box>
        <Tooltip title="刷新此来源">
          <span>
            <IconButton size="small" aria-label={`刷新 ${source.label}`} disabled={refreshing} onClick={onRefresh}>
              {refreshing ? <CircularProgress size={15} /> : <Refresh fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {source.last_error ? (
        <Alert severity={source.entries.length ? 'warning' : 'error'} variant="outlined" sx={{ mx: 1.25, mb: 0.75, py: 0.1, fontSize: 11.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <span>{source.entries.length ? `本次刷新失败，继续显示缓存：${source.last_error}` : source.last_error}</span>
            <SourceLink href={source.homepage} />
          </Stack>
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {entries.length ? (
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {entries.map((entry) => (
              <EntryRow key={`${source.id}-${entry.external_id || entry.title}`} entry={entry} translation={translations[entry.title] || entry.translation} />
            ))}
          </Box>
        ) : (
          <Box sx={{ px: 1.5, py: 3, textAlign: 'center', color: 'text.secondary', fontSize: 12 }}>
            {source.status === 'empty' ? '本批次暂无条目' : source.status === 'idle' ? '等待首次刷新' : '暂时没有可用条目'}
          </Box>
        )}
      </Box>

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.25, py: 0.75, borderTop: 1, borderColor: 'divider', mt: 'auto' }}>
        <SourceLink href={source.homepage} label="打开榜单" />
        <Box sx={{ flex: 1 }} />
        {hasMissing ? (
          <Button size="small" startIcon={<Translate fontSize="small" />} disabled={translating} onClick={onTranslate}>翻译可见</Button>
        ) : null}
        {source.entries.length > VISIBLE_COUNT ? (
          <Button size="small" onClick={onToggle}>{expanded ? '收起' : `展开全部（${source.entries.length}）`}</Button>
        ) : null}
      </Stack>
    </Paper>
  )
}

function EntryRow({ entry, translation }: { entry: HotEntry; translation?: string }) {
  return (
    <Box component="li" sx={{ display: 'flex', gap: 0.75, px: 1.25, py: 0.7, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      {entry.rank ? (
        <Box sx={{
          width: 24, minWidth: 24, height: 22, flexShrink: 0, mt: 0.1, borderRadius: 0.75,
          display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 650,
          whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          bgcolor: entry.rank <= 3 ? 'primary.main' : 'action.hover',
          color: entry.rank <= 3 ? 'primary.contrastText' : 'text.secondary',
        }}>
          {entry.rank}
        </Box>
      ) : null}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <ExternalText href={entry.url} kind={entry.link_kind}>{entry.title}</ExternalText>
        {translation ? (
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            {translation}
          </Typography>
        ) : null}
        {entry.summary ? (
          <Typography sx={{ fontSize: 10.5, color: 'text.disabled', mt: 0.2, lineHeight: 1.45, maxHeight: '1.45em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.summary}
          </Typography>
        ) : null}
        {entry.news?.length ? (
          <Stack spacing={0.1} sx={{ mt: 0.25 }}>
            {entry.news.slice(0, 2).map((news) => (
              <Typography key={`${news.title}-${news.url}`} sx={{ fontSize: 10.5, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                相关：{news.url ? <a href={news.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{news.title}</a> : news.title}
                {news.source ? <span style={{ color: 'var(--mui-palette-text-disabled)' }}> · {news.source}</span> : null}
              </Typography>
            ))}
          </Stack>
        ) : null}
        {entry.heat ? <Chip size="small" variant="outlined" label={`${entry.heat_label || '热度'} ${entry.heat}`} sx={{ height: 18, fontSize: 9.5, mt: 0.25 }} /> : null}
      </Box>
    </Box>
  )
}
