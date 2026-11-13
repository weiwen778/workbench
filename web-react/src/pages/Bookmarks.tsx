import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { Divider } from '@mui/material'
import { Plus } from '@/icons'
import { apiError, http } from '@/api/client'
import { EmptyHint, FieldRow, Page, PageBody, PageToolbar } from '@/ui/common'
import { confirmDialog, toast } from '@/ui/feedback'
import CategoryManager from '@/components/CategoryManager'

type Item = { id: number; url: string; title: string; icon_url: string; category: string; description: string }

export default function BookmarksPage() {
  const location = useLocation()
  const navigate = useNavigate()
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
  const [iconErrors, setIconErrors] = useState<Record<number, boolean>>({})
  const [results, setResults] = useState<Record<number, string>>({})
  const [menu, setMenu] = useState<{ el: HTMLElement; item: Item } | null>(null)
  const parseSequence = useRef(0)

  const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
  const favicon = (url: string) => { try { return new URL('/favicon.ico', url).href } catch { return '' } }
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
    try { const url = new URL(raw); return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password }
    catch { return false }
  }

  const openForm = (item?: Item) => {
    parseSequence.current++
    setParsing(false)
    setEditing(item || null)
    setForm(item
      ? { url: item.url, title: item.title, icon_url: item.icon_url || '', category: item.category, description: item.description }
      : { url: '', title: '', icon_url: '', category: queryCategory.startsWith('__') ? '' : queryCategory, description: '' })
    setDialog(true)
  }

  const parseTitle = async (manual = true) => {
    const target = normalizeUrl()
    if (!validUrl(target)) { if (manual) toast.warning('请先输入有效网址'); return }
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
    if (!validUrl(target)) { toast.warning('请输入有效的 HTTP 或 HTTPS 网址，且不要包含账号密码'); return }
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
    <Page sx={{ p: 0, gap: 0 }}>
      <PageToolbar sx={{ px: 2.5, py: 1.25, borderBottom: 1, borderColor: 'divider', rowGap: 1, flexShrink: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={query} placeholder="搜索网址" onChange={(event) => setQuery(event.target.value)} sx={{ width: 250 }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{filtered.length} 个网址</Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <CategoryManager resource="bookmarks" onChanged={load} />
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Tooltip title="检测当前电脑到网站的响应耗时；部分网站无法读取状态"><span><Button size="small" disabled={!filtered.length || testing} onClick={() => void testAll()}>{testing ? '检测中…' : '一键测速'}</Button></span></Tooltip>
          <Button size="small" disabled={!filtered.length} onClick={openAll}>全部打开</Button>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Button size="small" variant="contained" onClick={() => openForm()}>＋ 添加网址</Button>
      </PageToolbar>

      <PageBody sx={{ overflow: 'auto' }}>
        {!filtered.length && !loading ? <EmptyHint>{items.length ? '没有找到匹配的网址' : '暂无网址'}</EmptyHint> : null}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 1.5, p: 2.5, alignContent: 'start' }}>
        {filtered.map((item) => (
          <Card key={item.id} variant="outlined" sx={{
            display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, p: 2,
            '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer" title={item.description || item.url} sx={{ display: 'flex', alignItems: 'center', gap: '13px', flex: 1, minWidth: 0, textDecoration: 'none', color: 'text.primary' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '9px', bgcolor: 'action.selected', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 18, fontWeight: 600 }}>
                {!iconErrors[item.id] ? (
                  <Box component="img" src={item.icon_url || favicon(item.url)} alt="" referrerPolicy="no-referrer" onError={() => setIconErrors((prev) => ({ ...prev, [item.id]: true }))} sx={{ width: 26, height: 26, objectFit: 'contain' }} />
                ) : item.title.slice(0, 1).toUpperCase()}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{domain(item.url)}</Typography>
              </Box>
            </Box>
            <Box sx={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0, gap: 0.4, maxWidth: 105 }}>
              <IconButton size="small" aria-label="网址操作" onClick={(event) => setMenu({ el: event.currentTarget, item })} sx={{ fontSize: 18 }}>···</IconButton>
              {results[item.id] ? <Typography sx={{ fontSize: 10, lineHeight: '14px', color: 'text.secondary', whiteSpace: 'nowrap' }} title={results[item.id]}>{shortResult(results[item.id])}</Typography> : null}
            </Box>
          </Card>
        ))}
        </Box>
      </PageBody>

      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => menu && void action('open', menu.item)}>打开网站 ↗</MenuItem>
        <MenuItem disabled={testing} onClick={() => menu && void action('test', menu.item)}>测速</MenuItem>
        <MenuItem divider onClick={() => menu && void action('edit', menu.item)}>编辑</MenuItem>
        <MenuItem onClick={() => menu && void action('delete', menu.item)}>删除</MenuItem>
      </Menu>

      <Dialog open={dialog} onClose={() => setDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{editing ? '编辑网址' : '添加网址'}</DialogTitle>
        <DialogContent>
          <FieldRow label="网址">
            <TextField fullWidth label="网址" value={form.url} placeholder="https://example.com" onChange={(event) => setForm({ ...form, url: event.target.value })} onBlur={() => { const target = normalizeUrl(); if (target && validUrl(target)) void parseTitle(false) }} />
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
