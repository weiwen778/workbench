import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import Star from '@mui/icons-material/Star'
import RssFeed from '@mui/icons-material/RssFeed'
import { Delete, Edit, MoreFilled, Plus, Refresh, Translate } from '@/icons'
import { apiError } from '@/api/client'
import { EmptyHint, LoadingBlock } from '@/ui/common'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { readTranslationPreferences } from '@/utils/translation-preferences'
import {
  addSubscription, deleteSubscription, getEntries, getSubscriptions, previewSubscription,
  refreshSubscriptions, translateTitles, updateEntry, updateSubscription,
  type FeedEntry, type Subscription, type SubscriptionPreview, type TranslationStatus,
} from '@/feeds/api'
import { dateTime, DividerDot, ExternalText, MetaLine, relativeTime, StatusChip } from '@/feeds/shared'

const PAGE_SIZE = 100
const POLL_TICKS = 9

function collectEntryTranslations(rows: FeedEntry[], current: Record<string, string>) {
  const next = { ...current }
  for (const row of rows) if (row.translation) next[row.title] = row.translation
  return next
}

export default function SubscriptionsPanel() {
  const navigate = useNavigate()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [total, setTotal] = useState(0)
  const [translation, setTranslation] = useState<TranslationStatus | null>(null)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<'all' | number>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [loadingSubs, setLoadingSubs] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState('')
  const [menu, setMenu] = useState<{ anchor: HTMLElement; sub: Subscription } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const pollTimer = useRef<number | null>(null)
  const pollTicks = useRef(0)
  const entriesRequest = useRef(0)

  const loadSubscriptions = useCallback(async (silent = false) => {
    if (!silent) setLoadingSubs(true)
    try {
      const result = await getSubscriptions()
      setSubs(result.items)
      setTranslation(result.translation)
      setSelected((current) => {
        if (current === 'all') return current
        return result.items.some((item) => item.id === current) ? current : 'all'
      })
      setError('')
    } catch (reason) {
      setError(apiError(reason).message)
    } finally {
      if (!silent) setLoadingSubs(false)
    }
  }, [])

  const loadEntries = useCallback(async (options: { append?: boolean; offset?: number; silent?: boolean } = {}) => {
    const offset = options.offset ?? 0
    const request = ++entriesRequest.current
    if (!options.append && !options.silent) setLoadingEntries(true)
    if (options.append) setLoadingMore(true)
    try {
      const result = await getEntries({
        subscription_id: selected === 'all' ? undefined : selected,
        unread: unreadOnly || undefined,
        favorite: favoriteOnly || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      if (request !== entriesRequest.current) return
      setEntries((current) => options.append ? [...current, ...result.items] : result.items)
      setTotal(result.total)
      setTranslations((current) => collectEntryTranslations(result.items, current))
      setError('')
    } catch (reason) {
      if (request === entriesRequest.current) setError(apiError(reason).message)
    } finally {
      if (request === entriesRequest.current) {
        if (!options.append && !options.silent) setLoadingEntries(false)
        if (options.append) setLoadingMore(false)
      }
    }
  }, [selected, unreadOnly, favoriteOnly])

  useEffect(() => { void loadSubscriptions() }, [loadSubscriptions])
  useEffect(() => { void loadEntries() }, [loadEntries])

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null }
    pollTicks.current = 0
  }, [])

  const startPolling = useCallback(() => {
    if (pollTimer.current) return
    pollTicks.current = 0
    pollTimer.current = window.setInterval(() => {
      pollTicks.current += 1
      void loadSubscriptions(true)
      void loadEntries({ silent: true })
      if (pollTicks.current >= POLL_TICKS) stopPolling()
    }, 1800)
  }, [loadEntries, loadSubscriptions, stopPolling])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const result = await refreshSubscriptions(undefined, false)
        if (alive && (result.started.length || result.joined.length)) startPolling()
      } catch { /* 缓存仍可用 */ }
    })()
    return () => { alive = false; stopPolling() }
  }, [startPolling, stopPolling])

  const selectedSub = selected === 'all' ? null : subs.find((item) => item.id === selected) || null
  const visibleMissing = useMemo(
    () => entries.filter((entry) => entry.language !== 'zh' && !translations[entry.title]).map((entry) => entry.title),
    [entries, translations],
  )

  const refresh = async (ids?: number[]) => {
    try {
      const result = await refreshSubscriptions(ids, true)
      if (result.started.length || result.joined.length) startPolling()
      else { await loadSubscriptions(true); await loadEntries({ silent: true }) }
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

  const patchEntry = async (entry: FeedEntry, patch: { read?: boolean; favorite?: boolean }) => {
    try {
      const updated = await updateEntry(entry.id, patch)
      setEntries((current) => {
        if ((unreadOnly && updated.read) || (favoriteOnly && !updated.favorite)) {
          return current.filter((item) => item.id !== updated.id)
        }
        return current.map((item) => item.id === updated.id ? updated : item)
      })
      setTranslations((current) => updated.translation ? { ...current, [updated.title]: updated.translation } : current)
      if (updated.read !== entry.read) {
        setSubs((current) => current.map((sub) => sub.id === updated.subscription_id
          ? { ...sub, unread_count: Math.max(0, sub.unread_count + (updated.read ? -1 : 1)) }
          : sub))
      }
    } catch (reason) {
      toast.error(apiError(reason).message)
    }
  }

  const rename = async (sub: Subscription) => {
    const value = await promptDialog({
      title: '重命名订阅', label: '订阅名称', defaultValue: sub.title, maxLength: 200, confirmText: '保存',
      validate: (text) => text.trim() ? true : '请填写订阅名称',
    })
    if (!value || value.trim() === sub.title) return
    try {
      const updated = await updateSubscription(sub.id, { title: value.trim() })
      setSubs((current) => current.map((item) => item.id === sub.id ? updated : item))
      toast.success('订阅名称已更新')
    } catch (reason) {
      toast.error(apiError(reason).message)
    }
  }

  const toggleEnabled = async (sub: Subscription) => {
    try {
      const updated = await updateSubscription(sub.id, { enabled: !sub.enabled })
      setSubs((current) => current.map((item) => item.id === sub.id ? updated : item))
      toast.success(updated.enabled ? '已启用订阅' : '已停用订阅，已有条目和收藏仍保留')
    } catch (reason) {
      toast.error(apiError(reason).message)
    }
  }

  const remove = async (sub: Subscription) => {
    const ok = await confirmDialog({
      title: '删除订阅', danger: true, confirmText: '删除',
      message: `确定删除「${sub.title}」吗？已收藏条目会保留，可在「收藏」筛选中回看。`,
    })
    if (!ok) return
    try {
      await deleteSubscription(sub.id)
      toast.success('订阅已删除，收藏条目仍保留')
      const wasSelected = selected === sub.id
      if (wasSelected) setSelected('all')
      await loadSubscriptions(true)
      if (!wasSelected) await loadEntries({ silent: true })
    } catch (reason) {
      toast.error(apiError(reason).message)
    }
  }

  const openAdd = () => {
    setAddOpen(true); setAddUrl(''); setAddTitle(''); setPreview(null); setAddError('')
  }

  const validateFeed = async () => {
    const value = addUrl.trim()
    if (!value) { setAddError('请先粘贴 RSS 或 Atom 地址'); return }
    setPreviewing(true); setAddError('')
    try {
      const result = await previewSubscription(value)
      setPreview(result)
      setAddUrl(result.url)
      if (!addTitle.trim()) setAddTitle(result.title)
    } catch (reason) {
      setPreview(null)
      setAddError(apiError(reason).message)
    } finally {
      setPreviewing(false)
    }
  }

  const saveSubscription = async () => {
    if (!preview) { setAddError('请先验证订阅地址'); return }
    setAdding(true); setAddError('')
    try {
      const created = await addSubscription(preview.url, addTitle.trim() || preview.title)
      setAddOpen(false)
      setSelected(created.id)
      await loadSubscriptions(true)
      toast.success('订阅已添加，正在拉取条目')
      startPolling()
      await refresh([created.id])
    } catch (reason) {
      setAddError(apiError(reason).message)
    } finally {
      setAdding(false)
    }
  }

  if (loadingSubs && !subs.length) return <LoadingBlock text="正在准备订阅…" />

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          {subs.filter((sub) => sub.enabled).length} 个启用 · 默认预置 Hacker News 和 OpenAI News
        </Typography>
        <Box sx={{ flex: 1 }} />
        {translation ? (
          <Chip
            size="small" variant="outlined" color={translation.configured ? 'success' : 'default'}
            label={translation.configured ? `标题翻译：${translation.provider_name}` : '标题翻译未配置'}
            onClick={!translation.configured ? () => navigate('/settings/translation') : undefined}
            sx={{ height: 22, fontSize: 10.5 }}
          />
        ) : null}
        <Button size="small" startIcon={<Plus fontSize="small" />} data-testid="feed-add-subscription" onClick={openAdd}>添加订阅</Button>
        <Button size="small" startIcon={<Refresh fontSize="small" />} data-testid="feed-refresh-all" onClick={() => void refresh()}>刷新全部</Button>
      </Stack>

      {!translation?.configured ? (
        <Alert severity="info" variant="outlined" sx={{ mx: 1.5, mt: 1, py: 0.2, fontSize: 12 }}
          action={<Button color="inherit" size="small" onClick={() => navigate('/settings/translation')}>翻译设置</Button>}>
          尚未启用翻译服务；英文原文、已读和收藏仍可正常使用。
        </Alert>
      ) : null}
      {translationError ? (
        <Alert severity="warning" variant="outlined" onClose={() => setTranslationError('')} sx={{ mx: 1.5, mt: 1, py: 0.2, fontSize: 12 }}>{translationError}</Alert>
      ) : null}
      {error ? <Alert severity="error" variant="outlined" sx={{ mx: 1.5, mt: 1, py: 0.2, fontSize: 12 }}>{error}</Alert> : null}

      <Box sx={{
        flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '270px minmax(0, 1fr)' },
        gap: 1.25, p: 1.25, overflow: 'hidden',
      }}>
        <Paper variant="outlined" sx={{ minWidth: 0, overflow: 'auto', alignSelf: 'start', maxHeight: { xs: 190, md: 'none' } }}>
          <Box sx={{ px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 650, flex: 1 }}>订阅源</Typography>
            <Tooltip title="刷新全部启用订阅"><span><IconButton size="small" aria-label="刷新全部订阅" onClick={() => void refresh()}><Refresh fontSize="small" /></IconButton></span></Tooltip>
          </Box>
          <Box
            role="button" tabIndex={0} onClick={() => setSelected('all')}
            onKeyDown={(event) => { if (event.key === 'Enter') setSelected('all') }}
            sx={{ px: 1.25, py: 0.8, cursor: 'pointer', bgcolor: selected === 'all' ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <RssFeed sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>全部来源</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{subs.reduce((sum, sub) => sum + sub.unread_count, 0)} 未读</Typography>
            </Stack>
          </Box>
          {subs.map((sub) => (
            <Box
              key={sub.id} role="button" tabIndex={0} onClick={() => setSelected(sub.id)}
              onKeyDown={(event) => { if (event.key === 'Enter') setSelected(sub.id) }}
              sx={{ px: 1.25, py: 0.8, borderTop: 1, borderColor: 'divider', cursor: 'pointer', bgcolor: selected === sub.id ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: sub.enabled ? (sub.status === 'error' || sub.status === 'stale' ? 'warning.main' : 'success.main') : 'text.disabled' }} />
                <Typography sx={{ fontSize: 12.5, fontWeight: selected === sub.id ? 650 : 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sub.title}>{sub.title}</Typography>
                {sub.unread_count ? <Chip size="small" label={sub.unread_count} sx={{ height: 18, minWidth: 20, fontSize: 10 }} /> : null}
                <IconButton size="small" aria-label={`管理 ${sub.title}`} onClick={(event) => { event.stopPropagation(); setMenu({ anchor: event.currentTarget, sub }) }} sx={{ p: 0.25 }}>
                  <MoreFilled sx={{ fontSize: 15 }} />
                </IconButton>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.2 }}>
                <MetaLine>{sub.enabled ? relativeTime(sub.last_success_at) || '等待更新' : '已停用'}{sub.entry_count ? ` · ${sub.entry_count} 条` : ''}</MetaLine>
                {sub.last_error ? <Typography sx={{ fontSize: 10, color: 'warning.main', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· 刷新失败</Typography> : null}
              </Stack>
            </Box>
          ))}
        </Paper>

        <Paper variant="outlined" sx={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.25, py: 0.9, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 650 }} noWrap>{selectedSub?.title || (favoriteOnly ? '收藏条目' : '全部来源')}</Typography>
              <MetaLine>
                {selectedSub
                  ? `${selectedSub.enabled ? '启用' : '停用'}${selectedSub.last_success_at ? ` · 最近成功 ${relativeTime(selectedSub.last_success_at)}` : ''}`
                  : `${total} 条${favoriteOnly ? '收藏' : ''}${unreadOnly ? '未读' : ''}`}
              </MetaLine>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant={unreadOnly ? 'contained' : 'outlined'} data-testid="feed-filter-unread" onClick={() => setUnreadOnly((value) => !value)}>未读</Button>
            <Button size="small" variant={favoriteOnly ? 'contained' : 'outlined'} data-testid="feed-filter-favorite" onClick={() => setFavoriteOnly((value) => !value)}>收藏</Button>
            {visibleMissing.length ? (
              <Button size="small" startIcon={<Translate fontSize="small" />} disabled={translating} onClick={() => void translate(visibleMissing)}>
                {translating ? '翻译中…' : '翻译可见'}
              </Button>
            ) : null}
            <Button size="small" startIcon={<Refresh fontSize="small" />} disabled={!selectedSub?.enabled} onClick={() => selectedSub && void refresh([selectedSub.id])}>刷新</Button>
          </Stack>

          {selectedSub?.last_error ? (
            <Alert severity="warning" variant="outlined" sx={{ mx: 1.25, mt: 0.75, py: 0.15, fontSize: 11.5 }}>
              本次刷新失败：{selectedSub.last_error}。已有条目和已保存状态仍保留。
            </Alert>
          ) : null}
          {selectedSub && !selectedSub.enabled ? (
            <Alert severity="info" variant="outlined" sx={{ mx: 1.25, mt: 0.75, py: 0.15, fontSize: 11.5 }}>
              该订阅已停用，不再拉取新内容；下方仍保留已有条目、已读和收藏。
            </Alert>
          ) : null}

          <Box className="scroll-area" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {loadingEntries ? <LoadingBlock text="正在读取条目…" /> : entries.length === 0 ? (
              <EmptyHint action={selectedSub?.enabled ? <Button size="small" onClick={() => void refresh([selectedSub.id])}>立即刷新</Button> : undefined}>
                {favoriteOnly ? '还没有收藏条目' : unreadOnly ? '没有未读条目' : selectedSub ? '等待首次拉取，或暂无新条目' : '还没有订阅条目'}
              </EmptyHint>
            ) : entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                translation={translations[entry.title] || entry.translation}
                translating={translating}
                onRead={(read) => void patchEntry(entry, { read })}
                onFavorite={() => void patchEntry(entry, { favorite: !entry.favorite })}
                onTranslate={() => void translate([entry.title])}
              />
            ))}
            {entries.length < total ? (
              <Box sx={{ p: 1.5, textAlign: 'center' }}>
                <Button size="small" disabled={loadingMore} onClick={() => void loadEntries({ append: true, offset: entries.length })}>
                  {loadingMore ? '加载中…' : `加载更多（${entries.length}/${total}）`}
                </Button>
              </Box>
            ) : null}
          </Box>
        </Paper>
      </Box>

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { if (menu) void rename(menu.sub); setMenu(null) }}><Edit fontSize="small" sx={{ mr: 1 }} />重命名</MenuItem>
        <MenuItem onClick={() => { if (menu) void refresh([menu.sub.id]); setMenu(null) }}><Refresh fontSize="small" sx={{ mr: 1 }} />立即刷新</MenuItem>
        <MenuItem onClick={() => { if (menu) void toggleEnabled(menu.sub); setMenu(null) }}>{menu?.sub.enabled ? '停用订阅' : '启用订阅'}</MenuItem>
        <Divider />
        <MenuItem onClick={() => { if (menu) void remove(menu.sub); setMenu(null) }} sx={{ color: 'error.main' }}><Delete fontSize="small" sx={{ mr: 1 }} />删除订阅</MenuItem>
      </Menu>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>添加 RSS / Atom 订阅</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth label="RSS 或 Atom 地址" value={addUrl} autoFocus
            placeholder="https://example.com/feed.xml"
            onChange={(event) => { setAddUrl(event.target.value); setPreview(null); setAddError('') }}
            helperText="只允许公开 HTTP/HTTPS 地址；不会把 Nexus 或平台账号交给来源。"
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="outlined" disabled={previewing} onClick={() => void validateFeed()}>
              {previewing ? '正在验证…' : '验证地址'}
            </Button>
            {preview ? <Chip size="small" color="success" label={`${preview.feed_kind.toUpperCase()} · ${preview.entry_count} 条`} /> : null}
          </Stack>
          {addError ? <Alert severity="error" sx={{ mt: 1.5, py: 0.25, fontSize: 12 }}>{addError}</Alert> : null}
          {preview ? (
            <Box sx={{ mt: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{preview.title}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>来源名称与可用条目已验证。添加后在后台拉取完整条目。</Typography>
              <Stack spacing={0.35} sx={{ mt: 1 }}>
                {preview.entries.slice(0, 5).map((entry) => (
                  <Typography key={`${entry.title}-${entry.url}`} sx={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    · {entry.title}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}
          <TextField
            fullWidth label="订阅名称（可选）" value={addTitle} sx={{ mt: 1.5 }}
            onChange={(event) => setAddTitle(event.target.value)} inputProps={{ maxLength: 200 }}
            placeholder={preview?.title || '例如：行业新闻'}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setAddOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={!preview || adding} onClick={() => void saveSubscription()}>
            {adding ? '正在添加…' : '添加订阅'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function EntryRow({
  entry, translation, translating, onRead, onFavorite, onTranslate,
}: {
  entry: FeedEntry
  translation?: string
  translating: boolean
  onRead: (read: boolean) => void
  onFavorite: () => void
  onTranslate: () => void
}) {
  const translatable = entry.language !== 'zh'
  return (
    <Box data-testid={`feed-entry-${entry.id}`} sx={{ px: 1.5, py: 1.05, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, opacity: entry.read ? 0.78 : 1 }}>
      <Box sx={{ pt: 0.35 }}>
        <Tooltip title={entry.read ? '标记为未读' : '标记为已读'}>
          <IconButton size="small" aria-label={entry.read ? '标记为未读' : '标记为已读'} onClick={() => onRead(!entry.read)} sx={{ p: 0.3 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: entry.read ? 'transparent' : 'primary.main', border: 1, borderColor: entry.read ? 'divider' : 'primary.main' }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" alignItems="flex-start" spacing={0.5}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <ExternalText href={entry.url} kind={entry.link_kind}>{entry.title}</ExternalText>
            {translation ? <Typography sx={{ fontSize: 11.8, color: 'text.secondary', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{translation}</Typography> : null}
          </Box>
          {translatable && !translation ? (
            <Tooltip title="翻译此标题"><span><IconButton size="small" aria-label="翻译此标题" disabled={translating} onClick={onTranslate} sx={{ p: 0.35 }}><Translate sx={{ fontSize: 15 }} /></IconButton></span></Tooltip>
          ) : null}
          <Tooltip title={entry.favorite ? '取消收藏' : '收藏'}>
            <IconButton size="small" aria-label={entry.favorite ? '取消收藏' : '收藏'} onClick={onFavorite} sx={{ p: 0.35, color: entry.favorite ? 'warning.main' : 'text.secondary' }}>
              {entry.favorite ? <Star sx={{ fontSize: 17 }} /> : <Star sx={{ fontSize: 17, opacity: 0.45 }} />}
            </IconButton>
          </Tooltip>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
          <MetaLine>{entry.subscription_title}{entry.subscription_deleted ? '（订阅已移除）' : ''}</MetaLine>
          <DividerDot />
          <MetaLine>{entry.published_at ? `发布 ${dateTime(entry.published_at)}` : `收录时间 ${relativeTime(entry.discovered_at)}`}</MetaLine>
          {entry.discussion_url ? <><DividerDot /><Typography component="a" href={entry.discussion_url} target="_blank" rel="noopener noreferrer" sx={{ fontSize: 11, color: 'primary.main', textDecoration: 'none' }}>讨论</Typography></> : null}
          {entry.favorite ? <Chip size="small" variant="outlined" label="已收藏" sx={{ height: 18, fontSize: 9.5 }} /> : null}
        </Stack>
        {entry.summary ? (
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.4, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {entry.summary}
          </Typography>
        ) : null}
      </Box>
    </Box>
  )
}
