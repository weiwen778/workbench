import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
  IconButton, InputLabel, LinearProgress, MenuItem, Select, Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import { Divider } from '@mui/material'
import Star from '@mui/icons-material/Star'
import { CopyDocument, Delete, Direction, DocumentCopy, Favorite, Keyboard, Promotion, Refresh, Search, Switch } from '@/icons'
import { apiError, copyText, http } from '@/api/client'
import { Page, PageToolbar, EmptyHint } from '@/ui/common'
import { confirmDialog, toast } from '@/ui/feedback'
import { readTranslationPreferences, translationFont, type TranslationPreferences } from '@/utils/translation-preferences'

const panelBorder = (theme: any) => theme.palette.mode === 'dark' ? '#36474B' : '#D3DCD9'
const panelSx = {
  border: 1,
  borderColor: panelBorder,
  borderRadius: 1.5,
  bgcolor: 'background.paper',
  boxShadow: (theme: any) => theme.palette.mode === 'dark' ? 'none' : '0 1px 2px rgba(26,36,38,0.05)',
}
const separatorSx = { borderColor: panelBorder }

function relativeTime(value?: string) {
  if (!value) return ''
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: '翻译', keys: ['Ctrl / ⌘', 'Enter'] },
  { label: '翻译并复制译文', keys: ['Ctrl / ⌘', 'Shift', 'Enter'] },
  { label: '聚焦原文', keys: ['Alt / ⌥', '1'] },
  { label: '粘贴到原文', keys: ['Alt / ⌥', 'P'] },
  { label: '清空原文', keys: ['Alt / ⌥', 'X'] },
  { label: '交换语言', keys: ['Alt / ⌥', 'S'] },
  { label: '复制译文', keys: ['Alt / ⌥', 'C'] },
  { label: '收藏译文', keys: ['Alt / ⌥', 'B'] },
  { label: '关闭弹窗', keys: ['Esc'] },
]

function Keycap({ children }: { children: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 24, height: 24, px: 0.75,
        border: 1, borderColor: 'divider', borderBottomWidth: 2, borderRadius: 0.75,
        bgcolor: 'action.hover', color: 'text.secondary', fontFamily: 'inherit', fontSize: 11.5, lineHeight: 1,
      }}
    >
      {children}
    </Box>
  )
}

export default function TranslatePage() {
  const navigate = useNavigate()
  const [preferences] = useState<TranslationPreferences>(readTranslationPreferences)
  const [connections, setConnections] = useState<any[]>([])
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([])
  const [provider, setProvider] = useState(preferences.provider)
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('en')
  const [sourceText, setSourceText] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')
  const [favorites, setFavorites] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyProvider, setHistoryProvider] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [detail, setDetail] = useState<any | null>(null)
  const [detailTab, setDetailTab] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const requestSeq = useRef(0)
  const historyTimer = useRef<number | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)

  const currentConn = connections.find((connection) => connection.provider === provider)
  const enabledConnections = connections.filter((connection) => connection.enabled && connection.configured)
  const currentReady = Boolean(currentConn?.enabled && currentConn?.configured)
  const supportedLangs: { code: string; name: string }[] = currentConn?.languages?.length ? currentConn.languages : languages
  const langNames = Object.fromEntries(languages.map((language) => [language.code, language.name]))
  const limits = currentConn?.limits || { unit: 'char', value: 4000 }
  const used = limits.unit === 'byte' ? new TextEncoder().encode(sourceText).length : sourceText.length
  const overLimit = used > limits.value
  const usagePercent = Math.min(100, Math.round((used / Math.max(1, limits.value)) * 100))
  const favoriteKeys = new Set(favorites.map((item) => `${item.source_text}\u0000${item.target_text}`))
  const isFavorite = (item: any) => favoriteKeys.has(`${item.source_text}\u0000${item.target_text}`)
  const resultFavorited = result ? isFavorite(result) : false
  const langText = (code: string) => code === 'auto' ? '自动检测' : langNames[code] || code
  const formatTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''

  const loadConnections = useCallback(async () => {
    try {
      const { data } = await http.get('/translation-connections')
      setConnections(data.items); setLanguages(data.languages || [])
      if (!data.items.find((connection: any) => connection.provider === provider && connection.enabled && connection.configured)) {
        const first = data.items.find((connection: any) => connection.enabled && connection.configured)
        if (first) setProvider(first.provider)
      }
    } catch (error) { toast.error(apiError(error).message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadHistory = useCallback(async (target = page) => {
    try {
      const params: Record<string, any> = { page: target, page_size: pageSize }
      if (historyQuery.trim()) params.q = historyQuery.trim()
      if (historyProvider) params.provider = historyProvider
      const { data } = await http.get('/translation-history', { params })
      setHistory(data.items); setHistoryTotal(data.total); setPage(target)
    } catch (error) { toast.error(apiError(error).message) }
  }, [page, historyQuery, historyProvider])

  const loadFavorites = async () => {
    try { setFavorites((await http.get('/translation-favorites')).data.items) }
    catch (error) { toast.error(apiError(error).message) }
  }

  useEffect(() => {
    void loadConnections(); void loadFavorites(); void loadHistory(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const codes = supportedLangs.map((language) => language.code)
    if (!codes.length) return
    if (sourceLang !== 'auto' && !codes.includes(sourceLang)) setSourceLang('auto')
    if (!codes.includes(targetLang)) setTargetLang(codes.find((code) => code !== sourceLang) || codes[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, connections])

  const swap = () => {
    if (sourceLang === 'auto') {
      const next = targetLang
      setSourceLang(next)
      setTargetLang(supportedLangs.map((language) => language.code).find((code) => code !== next) || next)
    } else {
      const previous = sourceLang
      setSourceLang(targetLang)
      setTargetLang(previous)
    }
  }

  const changeSourceLang = (value: string) => {
    setSourceLang(value)
    if (value !== 'auto' && value === targetLang) {
      const other = supportedLangs.find((language) => language.code !== value)
      if (other) setTargetLang(other.code)
    }
  }

  const translate = async (copyAfter = false) => {
    if (translating) return
    const text = sourceText.trim()
    if (!text) { toast.warning('请输入需要翻译的内容'); return }
    if (!currentReady) { setError('当前翻译服务未启用，请先在设置 → 翻译服务中启用或切换到其他服务。'); return }
    if (overLimit) { toast.warning('内容超过这个服务的上限，请缩短后再翻（不会自动截断）'); return }
    if (sourceLang === targetLang) { toast.warning('两边语言不能一样'); return }
    setTranslating(true); setError('')
    const sequence = ++requestSeq.current
    try {
      const { data } = await http.post('/translations', { provider, source_text: text, source_lang: sourceLang, target_lang: targetLang })
      if (sequence !== requestSeq.current) return
      setResult(data)
      await loadHistory(1)
      if (copyAfter) {
        if (await copyText(data.target_text)) toast.success('已翻译并复制译文')
        else toast.warning('翻译完成，但浏览器不允许自动复制，请手动复制')
      }
    } catch (error) { if (sequence === requestSeq.current) setError(apiError(error).message) }
    finally { if (sequence === requestSeq.current) setTranslating(false) }
  }

  const pasteSource = async () => {
    try { setSourceText(await navigator.clipboard.readText()); toast.success('已粘贴剪贴板内容') }
    catch { toast.warning('浏览器不让读剪贴板，请用 Ctrl+V 或长按粘贴') }
  }

  const copyResult = async () => {
    if (!result) return
    if (await copyText(result.target_text)) toast.success('已复制译文')
    else toast.warning('浏览器不让自动复制，请手动选中复制')
  }

  const saveFavorite = async (item: any) => {
    try {
      await http.post('/translation-favorites', {
        source_text: item.source_text || '', target_text: item.target_text || '',
        source_lang: item.source_lang || 'auto', target_lang: item.target_lang || 'en',
        provider: item.provider, model: item.model || null,
      })
      toast.success('已收藏'); await loadFavorites()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const removeFavorite = async (item: any) => {
    const ok = await confirmDialog({ title: '移除收藏', danger: true, confirmText: '移除', message: '从收藏里移除这条记录？' })
    if (!ok) return
    try { await http.delete(`/translation-favorites/${item.id}`); toast.success('已移除'); await loadFavorites() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const removeHistory = async (item: any) => {
    const ok = await confirmDialog({ title: '删除记录', danger: true, confirmText: '删除', message: '删除这条翻译记录？删除后不可恢复。' })
    if (!ok) return
    try {
      await http.delete(`/translation-history/${item.id}`)
      toast.success('已删除')
      await loadHistory(history.length === 1 && page > 1 ? page - 1 : page)
    } catch (error) { toast.error(apiError(error).message) }
  }

  const clearHistory = async () => {
    const ok = await confirmDialog({ title: '清空翻译历史', danger: true, confirmText: '全部删除', message: `删除全部 ${historyTotal} 条翻译历史？收藏不受影响，删除后不可恢复。` })
    if (!ok) return
    try { await http.delete('/translation-history'); toast.success('历史已清空'); await loadHistory(1) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const openDetail = async (item: any) => {
    try { setDetail((await http.get(`/translation-history/${item.id}`)).data); setDetailTab(0) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const copyTextValue = async (value: string, label: string) => {
    if (await copyText(value)) toast.success(`已复制${label}`)
    else toast.warning('浏览器不让自动复制，请手动选中')
  }

  const shortcutsRef = useRef<(event: KeyboardEvent) => void>(() => {})
  shortcutsRef.current = (event) => {
    if (event.isComposing) return
    // 有弹窗时交给弹窗处理（Esc 关闭等）
    if (document.querySelector('.MuiDialog-root')) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter') {
      if (event.defaultPrevented) return
      event.preventDefault()
      void translate(event.shiftKey)
      return
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    switch (event.code) {
      case 'KeyP': event.preventDefault(); void pasteSource(); break
      case 'KeyC': if (result) { event.preventDefault(); void copyResult() } break
      case 'KeyB': if (result && !resultFavorited) { event.preventDefault(); void saveFavorite(result) } break
      case 'KeyS': event.preventDefault(); swap(); break
      case 'KeyX': event.preventDefault(); setSourceText(''); setError(''); sourceRef.current?.focus(); break
      case 'Digit1': event.preventDefault(); sourceRef.current?.focus(); break
      default: break
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcutsRef.current(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const rows = (items: any[], kind: 'favorite' | 'history') => items.map((item) => {
    const alreadyFavorite = kind === 'favorite' || isFavorite(item)
    return (
      <Box key={item.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', borderBottom: 1, ...separatorSx, py: 1.25, '&:hover': { bgcolor: 'action.hover' } }}>
        <Box
          sx={{ flex: 1, minWidth: 0, cursor: kind === 'history' ? 'pointer' : 'default' }}
          onClick={kind === 'history' ? () => void openDetail(item) : undefined}
        >
          <Typography sx={{ fontSize: 13 }} noWrap>{item.source_text}</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Direction sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>{item.target_text}</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
            <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }} noWrap>{item.provider_name}</Typography>
            {kind === 'history' ? <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }} noWrap>{langText(item.source_lang)} → {langText(item.target_lang)}</Typography> : null}
            <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }} noWrap>{relativeTime(item.created_at)}</Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.25} alignItems="center">
          {kind === 'history' ? <Button size="small" onClick={() => void openDetail(item)}>详情</Button> : null}
          {alreadyFavorite ? (
            <Tooltip title="已收藏"><Box component="span" sx={{ display: 'flex', mx: 1 }}><Star sx={{ fontSize: 16, color: '#C9A25B' }} /></Box></Tooltip>
          ) : (
            <Tooltip title="收藏"><IconButton size="small" aria-label="收藏" onClick={() => void saveFavorite(item)}><Favorite sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          )}
          <Tooltip title="复制译文（Alt+C）"><IconButton size="small" aria-label="复制译文" onClick={() => void copyTextValue(item.target_text, '译文')}><CopyDocument sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          <Tooltip title={kind === 'favorite' ? '移除收藏' : '删除'}>
            <IconButton size="small" aria-label={kind === 'favorite' ? '移除收藏' : '删除'} onClick={() => kind === 'favorite' ? void removeFavorite(item) : void removeHistory(item)}>
              <Delete sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    )
  })

  return (
    <Page sx={{ gap: 1 }}>
      <PageToolbar sx={{ rowGap: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ width: 138 }}>
            <InputLabel shrink>原文语言</InputLabel>
            <Select label="原文语言" value={sourceLang} onChange={(event) => changeSourceLang(event.target.value)}>
              <MenuItem value="auto">自动检测</MenuItem>
              {supportedLangs.map((language) => <MenuItem key={language.code} value={language.code}>{language.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Tooltip title="交换语言（Alt+S）">
            <IconButton size="small" aria-label="交换语言" onClick={swap}><Switch sx={{ fontSize: 18 }} /></IconButton>
          </Tooltip>
          <FormControl size="small" sx={{ width: 138 }}>
            <InputLabel shrink>译文语言</InputLabel>
            <Select label="译文语言" value={targetLang} onChange={(event) => setTargetLang(event.target.value)}>
              {supportedLangs.map((language) => <MenuItem key={language.code} value={language.code}>{language.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            size="small" variant="contained" startIcon={translating ? <CircularProgress size={13} color="inherit" /> : <Promotion fontSize="small" />}
            disabled={translating || !currentReady || overLimit || !sourceText.trim()} onClick={() => void translate()}
          >
            {translating ? '翻译中…' : '翻译'}
          </Button>
          <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>Ctrl / ⌘ + Enter</Typography>
          <Tooltip title="查看快捷键">
            <IconButton size="small" aria-label="查看快捷键" onClick={() => setShortcutsOpen(true)}><Keyboard sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
        </Stack>
      </PageToolbar>

      <Stack spacing={1}>
        {connections.length && !enabledConnections.length ? (
          <Alert severity="warning" action={<Button size="small" onClick={() => navigate('/settings/translation')}>去启用</Button>}>
            还没有启用翻译服务，请先在设置中配置并启用至少一个服务。
          </Alert>
        ) : null}
        {currentConn && !currentReady && enabledConnections.length > 0 ? (
          <Alert severity="warning" action={<Button size="small" onClick={() => navigate('/settings/translation')}>去启用</Button>}>
            「{currentConn.name}」{currentConn.configured ? '已停用' : '尚未配置'}，启用后才能翻译。
          </Alert>
        ) : null}
        {error ? (
          <Alert severity="error" action={sourceText.trim() && currentReady ? <Button size="small" onClick={() => void translate()}>重试</Button> : undefined}>
            {error}
          </Alert>
        ) : null}
      </Stack>

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1, flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 220, ...panelSx }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 0.75, borderBottom: 1, ...separatorSx }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography sx={{ fontSize: 13 }}>原文</Typography>
              {sourceText ? (
                <Tooltip title="复制原文">
                  <IconButton size="small" aria-label="复制原文" onClick={() => void copyTextValue(sourceText, '原文')}><CopyDocument sx={{ fontSize: 15 }} /></IconButton>
                </Tooltip>
              ) : null}
            </Stack>
            <Typography sx={{ fontSize: 12, color: overLimit ? 'error.main' : 'text.secondary' }}>{used} / {limits.value} {limits.unit === 'byte' ? '字节' : '字符'}</Typography>
          </Stack>
          {sourceText ? <LinearProgress variant="determinate" value={usagePercent} color={overLimit ? 'error' : usagePercent >= 80 ? 'warning' : 'primary'} sx={{ height: 2 }} /> : null}
          <TextField
            inputRef={sourceRef}
            fullWidth multiline value={sourceText} placeholder="输入或粘贴需要翻译的内容，Ctrl / Command + Enter 开始翻译"
            onChange={(event) => { setSourceText(event.target.value); if (error) setError('') }}
            onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void translate(event.shiftKey) } }}
            sx={{ flex: 1, '& .MuiInputBase-root': { height: '100%', alignItems: 'flex-start', fontSize: translationFont(sourceText, preferences), lineHeight: 1.65 }, '& fieldset': { border: 0 } }}
          />
          <Stack direction="row" spacing={0.5} sx={{ px: 1, py: 0.5, borderTop: 1, ...separatorSx }}>
            <Button size="small" startIcon={<DocumentCopy fontSize="small" />} title="粘贴剪贴板内容（Alt+P）" onClick={() => void pasteSource()}>粘贴</Button>
            <Button size="small" startIcon={<Delete fontSize="small" />} title="清空原文（Alt+X）" onClick={() => { setSourceText(''); setError(''); sourceRef.current?.focus() }}>清空原文</Button>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 220, ...panelSx }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 0.75, borderBottom: 1, ...separatorSx }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography sx={{ fontSize: 13 }}>译文</Typography>
              {result ? (
                <Tooltip title="复制译文（Alt+C）">
                  <IconButton size="small" aria-label="复制译文" onClick={() => void copyResult()}><CopyDocument sx={{ fontSize: 15 }} /></IconButton>
                </Tooltip>
              ) : null}
            </Stack>
            {result ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{result.provider_name} · {result.duration_ms} ms</Typography> : null}
          </Stack>
          <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, fontSize: translationFont(result?.target_text || '', preferences), lineHeight: 1.7 }}>
            {result ? (
              <Typography sx={{ fontSize: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.target_text}</Typography>
            ) : (
              <Box sx={{ height: '100%', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', textAlign: 'center' }}>
                <Typography sx={{ fontSize: 13 }}>{translating ? '正在翻译…' : '译文会显示在这里'}</Typography>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 0.75 }}>Ctrl / ⌘ + Enter 翻译</Typography>
              </Box>
            )}
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ px: 1, py: 0.5, borderTop: 1, ...separatorSx }}>
            <Button size="small" startIcon={<Favorite fontSize="small" />} title="收藏译文（Alt+B）" disabled={!result || resultFavorited} onClick={() => result && !resultFavorited && void saveFavorite(result)}>{resultFavorited ? '已收藏' : '收藏'}</Button>
            <Button size="small" startIcon={<CopyDocument fontSize="small" />} title="复制译文（Alt+C）" disabled={!result} onClick={() => void copyResult()}>复制译文</Button>
            <Button size="small" startIcon={<Delete fontSize="small" />} disabled={!result} onClick={() => setResult(null)}>清空译文</Button>
          </Stack>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0,1fr)' }, gap: 1, flex: { xs: 'none', lg: 1 }, minHeight: { lg: 220 } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 200, ...panelSx }}>
          <Stack direction="row" justifyContent="space-between" sx={{ px: 1.5, py: 0.75, borderBottom: 1, ...separatorSx }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>收藏</Typography><Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {favorites.length} 条</Typography>
          </Stack>
          <Box sx={{ flex: 1, overflow: 'auto', px: 1.5 }}>
            {favorites.length ? rows(favorites, 'favorite') : <EmptyHint action={<Button size="small" onClick={() => sourceRef.current?.focus()}>去翻译</Button>}>还没有收藏</EmptyHint>}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 200, ...panelSx }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.5, py: 1.25, borderBottom: 1, ...separatorSx, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>历史</Typography>
            <TextField
              size="small" value={historyQuery} placeholder="搜索原文或译文" sx={{ width: 190 }}
              onChange={(event) => { setHistoryQuery(event.target.value); if (historyTimer.current) window.clearTimeout(historyTimer.current); historyTimer.current = window.setTimeout(() => void loadHistory(1), 300) }}
              InputProps={{ startAdornment: <Search sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} /> }}
            />
            <FormControl size="small" sx={{ width: 150 }}>
              <InputLabel shrink>服务</InputLabel>
              <Select label="服务" displayEmpty value={historyProvider} onChange={(event) => { setHistoryProvider(event.target.value); window.setTimeout(() => void loadHistory(1), 0) }}>
                <MenuItem value="">全部服务</MenuItem>
                {connections.map((connection) => <MenuItem key={connection.provider} value={connection.provider}>{connection.name}</MenuItem>)}
              </Select>
            </FormControl>
            <Button size="small" onClick={() => void loadHistory(page)}><Refresh fontSize="small" /></Button>
            <div className="spacer" />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {historyTotal} 条</Typography>
            <Tooltip title="清空全部历史">
              <span>
                <IconButton size="small" aria-label="清空翻译历史" disabled={!historyTotal} onClick={() => void clearHistory()}>
                  <Delete sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, overflow: 'auto', px: 1.5 }}>
            {history.length ? rows(history, 'history') : <EmptyHint>{historyQuery ? '没有匹配的历史记录' : '还没有翻译记录'}</EmptyHint>}
          </Box>
          {historyTotal > pageSize ? (
            <Stack direction="row" justifyContent="center" spacing={1} sx={{ py: 0.75 }}>
              <Button size="small" disabled={page <= 1} onClick={() => void loadHistory(page - 1)}>上一页</Button>
              <Typography sx={{ fontSize: 12, alignSelf: 'center' }}>{page} / {Math.ceil(historyTotal / pageSize)}</Typography>
              <Button size="small" disabled={page >= Math.ceil(historyTotal / pageSize)} onClick={() => void loadHistory(page + 1)}>下一页</Button>
            </Stack>
          ) : null}
        </Box>
      </Box>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>翻译详情</DialogTitle>
        <DialogContent>
          {detail ? (
            <>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
                {detail.provider_name}{detail.model ? ' · ' + detail.model : ''} · {langText(detail.source_lang)} → {langText(detail.target_lang)} · {formatTime(detail.created_at)}
              </Typography>
              <Tabs value={detailTab} onChange={(_, value) => setDetailTab(value)} sx={{ mb: 1 }}>
                <Tab label={`原文（${langText(detail.source_lang)}）`} />
                <Tab label={`译文（${langText(detail.target_lang)}）`} />
              </Tabs>
              <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.8 }}>
                {detailTab === 0 ? detail.source_text : detail.target_text}
              </Box>
            </>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => detail && void copyTextValue(detail.source_text, '原文')}>复制原文</Button>
          <Button size="small" variant="contained" onClick={() => detail && void copyTextValue(detail.target_text, '译文')}>复制译文</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>翻译快捷键</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>在页面任意位置生效，输入框内也可以使用。</Typography>
          <Stack spacing={0.75}>
            {SHORTCUTS.map((item) => (
              <Stack key={item.label} direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ py: 0.5 }}>
                <Typography sx={{ fontSize: 12.5 }}>{item.label}</Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {item.keys.map((key) => <Keycap key={key}>{key}</Keycap>)}
                </Stack>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" variant="contained" onClick={() => setShortcutsOpen(false)}>知道了</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}
