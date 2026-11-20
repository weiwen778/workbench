import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import StaggerList, { StaggerItem } from '@/motion/components/StaggerList'
import LiftCard from '@/motion/components/LiftCard'
import { MoreFilled, Plus } from '@/icons'
import { apiError, http } from '@/api/client'
import { EmptyHint, FieldRow, ModuleToolbar, Page, PageBody } from '@/ui/common'
import { confirmDialog, toast } from '@/ui/feedback'
import CategoryManager from '@/components/CategoryManager'

type Item = { id: number; url: string; title: string; icon_url: string; category: string; description: string }

export default function BookmarksPage() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const queryCategory = new URLSearchParams(location.search).get('category') || '__all'

  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [saving, setSaving] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form, setForm] = useState({ url: '', title: '', icon_url: '', category: '', description: '' })
  const [urlError, setUrlError] = useState('')
  const [iconErrors, setIconErrors] = useState<Record<number, boolean>>({})
  const [results, setResults] = useState<Record<number, string>>({})
  const [menu, setMenu] = useState<{ el: HTMLElement; item: Item } | null>(null)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const parseSequence = useRef(0)

  const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
  const favicon = (url: string) => { try { return new URL('/favicon.ico', url).href } catch { return '' } }
  // 站名首字：跳过「【」、引号、数字符号等装饰性前缀，避免回退图标显示成一个括号
  const initial = (title: string) => {
    const stripped = (title || '').replace(/^[^\p{L}\p{N}]+/u, '')
    return (stripped.slice(0, 1) || (title || '').slice(0, 1)).toUpperCase()
  }
  const shortResult = (value: string) => {
    const ms = value.match(/(\d+) ms/)
    return ms ? `${ms[1]} ms · 未确认` : value.includes('HTTP') ? value : value.includes('失败') ? '未确认' : value
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsResponse, categoriesResponse] = await Promise.all([http.get('/bookmarks'), http.get('/bookmarks/categories')])
      setItems(itemsResponse.data); setCategories(categoriesResponse.data)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = items.filter((item) => {
    const inCategory = queryCategory === '__all' || (queryCategory === '__none' ? !item.category : item.category === queryCategory)
    const keyword = query.trim().toLowerCase()
    const matches = !keyword || [item.title, item.url, item.description].some((value) => (value || '').toLowerCase().includes(keyword))
    return inCategory && matches
  })

  const normalizeUrl = () => {
    let value = form.url.trim()
    if (value && !/^[a-z][a-z\d+.-]*:/i.test(value)) value = 'https://' + value
    setForm((prev) => ({ ...prev, url: value }))
    return value
  }

  const validUrl = (raw: string) => {
    try {
      const url = new URL(raw)
      const host = url.hostname
      return (url.protocol === 'http:' || url.protocol === 'https:')
        && !url.username && !url.password
        && host.includes('.') && !host.startsWith('.') && !host.endsWith('.') && !host.includes('..')
    } catch { return false }
  }

  const urlMessage = (raw: string) => {
    if (!raw.trim()) return '请输入网址'
    return '请输入有效的 HTTP 或 HTTPS 网址，且不要包含账号密码'
  }

  const validateUrl = (raw: string) => {
    if (!validUrl(raw)) { setUrlError(urlMessage(raw)); return false }
    setUrlError('')
    return true
  }

  const openForm = (item?: Item) => {
    parseSequence.current++
    setParsing(false)
    setUrlError('')
    setEditing(item || null)
    setForm(item
      ? { url: item.url, title: item.title, icon_url: item.icon_url || '', category: item.category, description: item.description }
      : { url: '', title: '', icon_url: '', category: queryCategory.startsWith('__') ? '' : queryCategory, description: '' })
    setDialog(true)
  }

  const focusOpened = useRef<number | null>(null)
  useEffect(() => {
    if (!focusId) return
    const id = Number(focusId)
    const item = items.find((entry) => entry.id === id)
    if (item && focusOpened.current !== id) {
      focusOpened.current = id
      openForm(item)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, items])

  const parseTitle = async (manual = true) => {
    const target = normalizeUrl()
    if (!validateUrl(target)) { if (manual) toast.warning(urlMessage(target)); return }
    const initialTitle = form.title
    const sequence = ++parseSequence.current
    setParsing(true)
    try {
      const { data } = await http.post('/bookmarks/metadata', { url: target })
      if (sequence !== parseSequence.current) return
      setForm((prev) => {
        if (prev.url !== target) return prev
        const nextTitle = prev.title === initialTitle && (manual || !prev.title || prev.title === new URL(target).hostname) ? data.title : prev.title
        return { ...prev, icon_url: data.icon_url || '', title: nextTitle }
      })
    } catch {
      if (sequence === parseSequence.current) setForm((prev) => prev.title ? prev : { ...prev, title: new URL(target).hostname })
    } finally { if (sequence === parseSequence.current) setParsing(false) }
  }

  const save = async () => {
    const target = normalizeUrl()
    if (!validateUrl(target)) return
    setSaving(true)
    try {
      if (editing) await http.put(`/bookmarks/${editing.id}`, form)
      else await http.post('/bookmarks', form)
      setDialog(false); await load(); window.dispatchEvent(new Event('wb-bookmarks-changed')); toast.success('已保存')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setSaving(false) }
  }

  const openLink = (item: Item) => { if (validUrl(item.url)) window.open(item.url, '_blank', 'noopener,noreferrer') }

  const probe = async (item: Item) => {
    const started = performance.now()
    try {
      const response = await fetch(item.url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000) })
      const ms = Math.round(performance.now() - started)
      setResults((prev) => ({ ...prev, [item.id]: response.type === 'opaque' ? `收到响应 ${ms} ms · 状态不可读取` : `HTTP ${response.status} · ${ms} ms` }))
    } catch { setResults((prev) => ({ ...prev, [item.id]: '检测失败或受浏览器限制' })) }
  }

  const testAll = async () => {
    setTesting(true)
    const list = [...filtered]
    setResults((prev) => { const next = { ...prev }; list.forEach((item) => { next[item.id] = '等待检测' }); return next })
    let index = 0
    try {
      await Promise.all(Array.from({ length: Math.min(5, list.length) }, async () => {
        while (index < list.length) {
          const item = list[index++]
          setResults((prev) => ({ ...prev, [item.id]: '检测中…' }))
          await probe(item)
        }
      }))
      toast.info(`已完成 ${list.length} 个网址的检测`)
    } finally { setTesting(false) }
  }

  const action = async (command: string, item: Item) => {
    setMenu(null)
    if (command === 'open') { openLink(item); return }
    if (command === 'test') { setTesting(true); try { await probe(item) } finally { setTesting(false) }; return }
    if (command === 'edit') { openForm(item); return }
    const ok = await confirmDialog({ title: '删除网址', danger: true, confirmText: '删除', message: `确定删除“${item.title}”吗？` })
    if (!ok) return
    try { await http.delete(`/bookmarks/${item.id}`); await load(); window.dispatchEvent(new Event('wb-bookmarks-changed')); toast.success('已删除') }
    catch (error) { toast.error(apiError(error).message) }
  }

  const openAll = () => {
    if (filtered.length > 20) { toast.warning('当前列表超过 20 个网址，请先选择分类或搜索缩小范围'); return }
    let blocked = 0
    for (const item of filtered) {
      if (!validUrl(item.url)) continue
      const win = window.open('', '_blank')
      if (win) { win.opener = null; win.location.href = item.url } else blocked++
    }
    if (blocked) toast.warning(`${blocked} 个窗口被浏览器拦截，请允许本站弹窗后重试`)
  }

  return (
    <Page variant="bleed">
      <ModuleToolbar
        sx={{ px: 2.5, py: 1.25, borderBottom: 1, borderColor: 'divider', rowGap: 1, flexShrink: 0 }}
        info={<Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{filtered.length} 个网址</Typography>}
        filters={<TextField size="small" value={query} placeholder="搜索网址" onChange={(event) => setQuery(event.target.value)} sx={{ width: { xs: '100%', sm: 250 } }} />}
        onRefresh={() => void load()}
        refreshLabel="刷新网址列表"
        refreshDisabled={loading}
        more={(
          <>
            <Tooltip title="更多">
              <IconButton size="small" aria-label="更多网址操作" onClick={(event) => setMoreAnchor(event.currentTarget)}><MoreFilled fontSize="small" /></IconButton>
            </Tooltip>
            <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
              <CategoryManager
                resource="bookmarks" onChanged={load}
                trigger={(open) => <MenuItem onClick={() => { setMoreAnchor(null); open() }}>管理分类</MenuItem>}
              />
              <MenuItem disabled={!filtered.length || testing} onClick={() => { setMoreAnchor(null); void testAll() }}>{testing ? '检测中…' : '一键测速'}</MenuItem>
              <MenuItem disabled={!filtered.length} onClick={() => { setMoreAnchor(null); openAll() }}>全部打开</MenuItem>
            </Menu>
          </>
        )}
        primary={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => openForm()}>添加网址</Button>}
      />

      <PageBody sx={{ overflow: 'auto' }}>
        {!filtered.length && !loading ? <EmptyHint>{items.length ? '没有找到匹配的网址' : '暂无网址'}</EmptyHint> : null}

        <StaggerList sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 1.5, p: 2.5, alignContent: 'start' }}>
        {filtered.map((item) => (
          <StaggerItem key={item.id} sx={{ display: 'flex', minWidth: 0 }}>
          <LiftCard variant="outlined" sx={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, p: 2,
            '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer" title={item.description || item.url} sx={{ display: 'flex', alignItems: 'center', gap: '13px', flex: 1, minWidth: 0, textDecoration: 'none', color: 'text.primary' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '9px', bgcolor: 'action.selected', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 18, fontWeight: 600 }}>
                {!iconErrors[item.id] ? (
                  <Box component="img" src={item.icon_url || favicon(item.url)} alt="" referrerPolicy="no-referrer" onError={() => setIconErrors((prev) => ({ ...prev, [item.id]: true }))} sx={{ width: 26, height: 26, objectFit: 'contain' }} />
                 ) : initial(item.title)}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{domain(item.url)}</Typography>
              </Box>
            </Box>
            <Box sx={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0, gap: 0.4, maxWidth: 105 }}>
              <IconButton size="small" aria-label="网址操作" onClick={(event) => setMenu({ el: event.currentTarget, item })} sx={{ fontSize: 18 }}>···</IconButton>
              {results[item.id] ? <Typography sx={{ fontSize: 11, lineHeight: '15px', color: 'text.secondary', whiteSpace: 'nowrap' }} title={results[item.id]}>{shortResult(results[item.id])}</Typography> : null}
            </Box>
          </LiftCard>
          </StaggerItem>
        ))}
        </StaggerList>
      </PageBody>

      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem disabled={testing} onClick={() => menu && void action('test', menu.item)}>测速</MenuItem>
        <MenuItem divider onClick={() => menu && void action('edit', menu.item)}>编辑</MenuItem>
        <MenuItem onClick={() => menu && void action('delete', menu.item)}>删除</MenuItem>
      </Menu>

      <Dialog open={dialog} onClose={() => setDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{editing ? '编辑网址' : '添加网址'}</DialogTitle>
        <DialogContent>
          <FieldRow label="网址">
            <TextField
              fullWidth label="网址" value={form.url} placeholder="https://example.com"
              error={Boolean(urlError)} helperText={urlError || undefined}
              onChange={(event) => { setForm({ ...form, url: event.target.value }); if (urlError) setUrlError('') }}
              onBlur={() => { const target = normalizeUrl(); if (validateUrl(target)) void parseTitle(false) }}
            />
          </FieldRow>
          <Box sx={{ mb: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="stretch">
              <TextField fullWidth label="名称" value={form.title} inputProps={{ maxLength: 200 }} placeholder="留空时使用域名" onChange={(event) => setForm({ ...form, title: event.target.value })} />
              <Button size="small" disabled={parsing} onClick={() => void parseTitle(true)} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>解析名称和图标</Button>
            </Stack>
          </Box>
          <FieldRow label="分类">
            <TextField fullWidth label="分类" value={form.category} placeholder="选择或输入新分类" onChange={(event) => setForm({ ...form, category: event.target.value })} inputProps={{ list: 'bookmark-categories' }} />
          </FieldRow>
          <datalist id="bookmark-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          <FieldRow label="备注">
            <TextField fullWidth multiline minRows={2} label="备注" value={form.description} inputProps={{ maxLength: 500 }} placeholder="可选" onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </FieldRow>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setDialog(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={saving} onClick={save}>保存</Button>
        </DialogActions>
      </Dialog>
    </Page>
  )
}
