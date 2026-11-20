import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemButton, ListItemText, Menu, MenuItem,
  Paper, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, Avatar,
} from '@mui/material'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'
import GridView from '@mui/icons-material/GridView'
import ViewList from '@mui/icons-material/ViewList'
import { Collection, Delete, MoreFilled, Plus, Search, Upload } from '@/icons'
import { apiError, http } from '@/api/client'
import { EmptyHint, FieldRow, ModuleToolbar, Page, PageBody } from '@/ui/common'
import { promptDialog, toast } from '@/ui/feedback'
import ImportWizard from '@/components/ImportWizard'
import DeleteTableDialog from '@/components/DeleteTableDialog'

const fieldTypes = [
  { label: '短文本', value: 'short_text' }, { label: '长文本', value: 'long_text' },
  { label: '数字', value: 'number' }, { label: '日期', value: 'date' },
  { label: '单选', value: 'select' }, { label: '多选', value: 'multiselect' },
  { label: '勾选', value: 'checkbox' }, { label: '链接', value: 'url' }, { label: '附件', value: 'attachment' },
]

type SortKey = 'updated' | 'name' | 'records'
type ViewMode = 'cards' | 'list'

function readIds(key: string): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'number') : []
  } catch { return [] }
}

function relativeTime(value?: string) {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return '—'
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export default function TablesPage() {
  const navigate = useNavigate()
  const [tables, setTables] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem('wb_table_view') === 'list' ? 'list' : 'cards'))
  const [favorites, setFavorites] = useState<number[]>(() => readIds('wb_table_favorites'))
  const [recent, setRecent] = useState<number[]>(() => readIds('wb_table_recent'))
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const [menuTable, setMenuTable] = useState<any | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingTable, setDeletingTable] = useState<any | null>(null)
  const [form, setForm] = useState<{ name: string; note: string; fields: { name: string; type: string }[] }>({ name: '', note: '', fields: [] })

  const load = useCallback(async () => {
    setLoading(true)
    try { setTables((await http.get('/tables')).data) }
    catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const remember = (id: number) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((item) => item !== id)].slice(0, 5)
      localStorage.setItem('wb_table_recent', JSON.stringify(next))
      return next
    })
  }

  const setViewMode = (next: ViewMode) => {
    setView(next)
    localStorage.setItem('wb_table_view', next)
  }

  const openTable = (row: any) => {
    remember(row.id)
    navigate(`/data/${row.id}`)
  }

  const toggleFavorite = (id: number) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      localStorage.setItem('wb_table_favorites', JSON.stringify(next))
      return next
    })
  }

  const createTable = async () => {
    if (!form.name.trim()) { toast.warning('请填写表格名称'); return }
    setCreating(true)
    try {
      const { data } = await http.post('/tables', {
        name: form.name.trim(), note: form.note,
        fields: form.fields.filter((field) => field.name.trim()).map((field) => ({ name: field.name.trim(), type: field.type })),
      })
      setCreateOpen(false); setForm({ name: '', note: '', fields: [] })
      window.dispatchEvent(new Event('wb:tables-changed'))
      openTable(data)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setCreating(false) }
  }

  const rename = async (row: any) => {
    const value = await promptDialog({ title: '重命名表格', label: '表格名称', defaultValue: row.name, maxLength: 100, confirmText: '保存' })
    if (!value) return
    try { await http.patch(`/tables/${row.id}`, { name: value }); await load(); window.dispatchEvent(new Event('wb:tables-changed')) }
    catch (error) { toast.error(apiError(error).message) }
  }

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const rows = tables.filter((table) => {
      if (!keyword) return true
      const haystack = [table.name, table.note, ...(table.fields_preview || []).map((field: any) => field.name)].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
    rows.sort((a, b) => {
      if (sort === 'name') return String(a.name).localeCompare(String(b.name), 'zh-CN')
      if (sort === 'records') return (b.record_count || 0) - (a.record_count || 0)
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    })
    return [...rows].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)))
  }, [tables, query, sort, favorites])

  const recentTables = recent.map((id) => tables.find((table) => table.id === id)).filter(Boolean).slice(0, 5)
  const totalRecords = tables.reduce((sum, table) => sum + (table.record_count || 0), 0)
  const latest = tables.reduce((value, table) => {
    if (!table.updated_at) return value
    return !value || new Date(table.updated_at) > new Date(value) ? table.updated_at : value
  }, '' as string)

  const empty = !tables.length && !loading
  const noResults = Boolean(tables.length) && !visible.length && !loading

  const fieldChips = (row: any) => (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {(row.fields_preview || []).slice(0, 3).map((field: any) => (
        <Chip key={field.name} size="small" variant="outlined" label={field.name} sx={{ height: 20, fontSize: 10.5 }} />
      ))}
      {(row.field_count || 0) > 3 ? <Chip size="small" variant="outlined" label={`+${row.field_count - 3}`} sx={{ height: 20, fontSize: 10.5 }} /> : null}
      {!row.fields_preview?.length ? <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>还没有列</Typography> : null}
    </Stack>
  )

  return (
    <Page variant="dense">
      <ModuleToolbar
        info={(
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            {tables.length} 张表格 · {totalRecords} 条数据{latest ? ` · 最近更新 ${relativeTime(latest)}` : ''}
          </Typography>
        )}
        filters={!empty ? (
          <>
            <TextField
              size="small" placeholder="搜索表格名称、说明或字段" value={query}
              onChange={(event) => setQuery(event.target.value)}
              InputProps={{ startAdornment: <Search sx={{ fontSize: 16, mr: 0.75, color: 'text.secondary' }} /> }}
              sx={{ width: { xs: '100%', sm: 230 } }}
            />
            <Select size="small" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} sx={{ width: 126 }} inputProps={{ 'aria-label': '表格排序' }}>
              <MenuItem value="updated">最近更新</MenuItem>
              <MenuItem value="name">按名称</MenuItem>
              <MenuItem value="records">按数据量</MenuItem>
            </Select>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, value) => value && setViewMode(value)}>
              <ToggleButton value="cards" aria-label="卡片视图"><GridView sx={{ fontSize: 17 }} /></ToggleButton>
              <ToggleButton value="list" aria-label="列表视图"><ViewList sx={{ fontSize: 17 }} /></ToggleButton>
            </ToggleButtonGroup>
            <Button size="small" startIcon={<Upload fontSize="small" />} onClick={() => setImportOpen(true)}>导入</Button>
          </>
        ) : null}
        onRefresh={!empty ? () => void load() : undefined}
        refreshLabel="刷新表格列表"
        refreshDisabled={loading}
        more={!empty ? (
          <Tooltip title="更多">
            <IconButton size="small" aria-label="更多表格操作" onClick={(event) => setMoreAnchor(event.currentTarget)}><MoreFilled fontSize="small" /></IconButton>
          </Tooltip>
        ) : null}
        primary={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => setCreateOpen(true)}>新建表格</Button>}
      />

      <PageBody sx={{ overflow: 'auto', pt: 0.75 }}>
        {recentTables.length ? (
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>最近打开</Typography>
            {recentTables.map((table: any) => (
              <Chip key={table.id} size="small" label={table.name} onClick={() => openTable(table)} sx={{ height: 23 }} />
            ))}
          </Stack>
        ) : null}

        {empty ? (
          view === 'cards' ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0,1fr))' }, gap: 1.5, maxWidth: 720 }}>
              {[
                { title: '新建空白表格', desc: '自定义列与字段。', icon: <Plus sx={{ fontSize: 22 }} />, action: () => setCreateOpen(true) },
                { title: '从 Excel 导入', desc: 'xlsx / xls / csv', icon: <Upload sx={{ fontSize: 22 }} />, action: () => setImportOpen(true) },
              ].map((item) => (
                <Paper key={item.title} variant="outlined" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'pointer', transition: 'border-color .15s', '&:hover': { borderColor: 'primary.main' } }} onClick={item.action}>
                  <Box sx={{ width: 38, height: 38, borderRadius: 1.25, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: 'action.selected' }}>{item.icon}</Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{item.title}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.7 }}>{item.desc}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'primary.main', mt: 0.5 }}>开始 →</Typography>
                </Paper>
              ))}
            </Box>
          ) : (
            <List sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', py: 0, maxWidth: 720 }}>
              {[
                { title: '新建空白表格', desc: '自定义列与字段。', icon: <Plus sx={{ fontSize: 16 }} />, action: () => setCreateOpen(true) },
                { title: '从 Excel 导入', desc: 'xlsx / xls / csv', icon: <Upload sx={{ fontSize: 16 }} />, action: () => setImportOpen(true) },
              ].map((item, index) => (
                <ListItem key={item.title} divider={index === 0} disablePadding>
                  <ListItemButton onClick={item.action} sx={{ gap: 1.25, px: 1.75, py: 1.25 }}>
                    <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, bgcolor: 'primary.main', flexShrink: 0 }} />
                    <Avatar variant="rounded" sx={{ width: 30, height: 30, bgcolor: 'action.selected', color: 'primary.main' }}>{item.icon}</Avatar>
                    <ListItemText primary={item.title} secondary={item.desc} primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600 }} secondaryTypographyProps={{ fontSize: 11.5 }} sx={{ my: 0 }} />
                    <Typography sx={{ fontSize: 12, color: 'primary.main', flexShrink: 0 }}>开始 →</Typography>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )
        ) : view === 'cards' ? (
           <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))', lg: 'repeat(3, minmax(0,1fr))', xl: 'repeat(4, minmax(0,1fr))' }, gap: 1.5, alignContent: 'start' }}>
            {visible.map((row) => {
              const favorite = favorites.includes(row.id)
              return (
                <Paper
                  key={row.id}
                  variant="outlined"
                  role="button"
                  tabIndex={0}
                  aria-label={`打开表格 ${row.name}`}
                  onClick={() => openTable(row)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTable(row) } }}
                  sx={{
                    p: 2, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 172, minWidth: 0,
                    borderRadius: 1.5, cursor: 'pointer', transition: 'border-color .15s, box-shadow .15s',
                    '&:hover': { borderColor: 'primary.main', boxShadow: '0 4px 14px rgba(26,36,38,0.06)' },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 1, display: 'grid', placeItems: 'center', bgcolor: 'action.selected', color: 'primary.main' }}>
                      <Collection sx={{ fontSize: 17 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }} noWrap>{row.name}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.25, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', lineHeight: 1.55 }}>
                        {row.note || '暂无说明'}
                      </Typography>
                    </Box>
                    <Tooltip title={favorite ? '取消收藏' : '收藏'}>
                      <IconButton size="small" aria-label={favorite ? '取消收藏' : '收藏'} onClick={(event) => { event.stopPropagation(); toggleFavorite(row.id) }}>
                        {favorite ? <Star sx={{ fontSize: 16, color: '#C9A25B' }} /> : <StarBorder sx={{ fontSize: 16, color: 'text.disabled' }} />}
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); setMenuAnchor(event.currentTarget); setMenuTable(row) }}>
                      <MoreFilled sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Stack>

                  {fieldChips(row)}

                  <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 'auto' }}>
                    {row.field_count || 0} 列 · {row.record_count || 0} 条 · {relativeTime(row.updated_at)}
                  </Typography>
                </Paper>
              )
            })}
          </Box>
        ) : (
          <List sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', py: 0 }}>
            {loading ? (
              <ListItem><ListItemText primary="加载中…" primaryTypographyProps={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }} /></ListItem>
            ) : !visible.length ? (
              <ListItem><ListItemText primary={`没有匹配「${query}」的表格`} primaryTypographyProps={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }} /></ListItem>
            ) : visible.map((row) => {
              const favorite = favorites.includes(row.id)
              return (
                <ListItem key={row.id} divider disablePadding sx={{ '&:last-child': { borderBottom: 0 } }}>
                  <ListItemButton onClick={() => openTable(row)} sx={{ gap: 1.25, px: 1.75, py: 1.25, alignItems: 'center' }}>
                    <Box sx={{ width: 3, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, bgcolor: 'primary.main', flexShrink: 0 }} />
                    <Avatar variant="rounded" sx={{ width: 30, height: 30, bgcolor: 'action.selected', color: 'primary.main' }}>
                      <Collection sx={{ fontSize: 16 }} />
                    </Avatar>
                    <ListItemText
                      primary={<>{row.name}{favorite ? ' ★' : ''}</>}
                      secondary={row.note || '暂无说明'}
                      primaryTypographyProps={{ fontSize: 13.5, fontWeight: 600, noWrap: true }}
                      secondaryTypographyProps={{ fontSize: 11.5, noWrap: true }}
                      sx={{ minWidth: 0, my: 0 }}
                    />
                    <Box sx={{ flexShrink: 0, display: { xs: 'none', md: 'block' } }}>{fieldChips(row)}</Box>
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexShrink: 0, display: { xs: 'none', sm: 'flex' } }}>
                      <Typography component="span" sx={{ fontSize: 11.5, color: 'text.secondary' }}>{row.field_count || 0} 列 · {row.record_count || 0} 条</Typography>
                      <Typography component="span" sx={{ fontSize: 11.5, color: 'text.disabled' }}>{relativeTime(row.updated_at)}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }} onClick={(event) => event.stopPropagation()}>
                      <Tooltip title={favorite ? '取消收藏' : '收藏'}>
                        <IconButton size="small" aria-label={favorite ? '取消收藏' : '收藏'} onClick={() => toggleFavorite(row.id)}>
                          {favorite ? <Star sx={{ fontSize: 16, color: '#C9A25B' }} /> : <StarBorder sx={{ fontSize: 16, color: 'text.disabled' }} />}
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" aria-label="更多操作" onClick={(event) => { setMenuAnchor(event.currentTarget); setMenuTable(row) }}>
                        <MoreFilled sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Stack>
                  </ListItemButton>
                </ListItem>
              )
            })}
          </List>
        )}

        {noResults && view === 'cards' ? (
          <Box sx={{ py: 6 }}>
            <EmptyHint action={<Button size="small" onClick={() => setQuery('')}>清除搜索</Button>}>没有匹配「{query}」的表格</EmptyHint>
          </Box>
        ) : null}
      </PageBody>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { if (menuTable) void rename(menuTable); setMenuAnchor(null) }}>重命名</MenuItem>
        <MenuItem divider onClick={() => { if (menuTable) { setDeletingTable(menuTable); setDeleteOpen(true) } setMenuAnchor(null) }} sx={{ color: 'error.main' }}>删除表格</MenuItem>
      </Menu>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => { setMoreAnchor(null); navigate('/docs?module=sheet') }}>在文档工作簿中打开</MenuItem>
      </Menu>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>新建表格</DialogTitle>
        <DialogContent>
          <FieldRow label="表格名称" required><TextField fullWidth autoFocus value={form.name} inputProps={{ maxLength: 100 }} placeholder="例如：商品台账" onChange={(event) => setForm({ ...form, name: event.target.value })} /></FieldRow>
          <FieldRow label="说明"><TextField fullWidth multiline minRows={2} value={form.note} inputProps={{ maxLength: 2000 }} onChange={(event) => setForm({ ...form, note: event.target.value })} /></FieldRow>
          <FieldRow label="初始的列（可选，创建后也能再加）">
            <Box>
              {form.fields.map((field, index) => (
                <Stack key={index} direction="row" spacing={1} sx={{ mb: 1 }}>
                  <TextField fullWidth size="small" value={field.name} placeholder="列名" inputProps={{ maxLength: 50 }} onChange={(event) => setForm({ ...form, fields: form.fields.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                  <Select size="small" value={field.type} onChange={(event) => setForm({ ...form, fields: form.fields.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })} sx={{ width: 120 }}>
                    {fieldTypes.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                  </Select>
                  <IconButton size="small" onClick={() => setForm({ ...form, fields: form.fields.filter((_, itemIndex) => itemIndex !== index) })}><Delete fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<Plus fontSize="small" />} onClick={() => setForm({ ...form, fields: [...form.fields, { name: '', type: 'short_text' }] })}>添加一列</Button>
            </Box>
          </FieldRow>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setCreateOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={creating} onClick={createTable}>创建并打开</Button>
        </DialogActions>
      </Dialog>

      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} onDone={(id) => { void load(); remember(id); navigate(`/data/${id}`) }} />
      <DeleteTableDialog
        open={deleteOpen}
        table={deletingTable}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          if (deletingTable) {
            setRecent((prev) => { const next = prev.filter((id) => id !== deletingTable.id); localStorage.setItem('wb_table_recent', JSON.stringify(next)); return next })
            setFavorites((prev) => { const next = prev.filter((id) => id !== deletingTable.id); localStorage.setItem('wb_table_favorites', JSON.stringify(next)); return next })
          }
          void load()
        }}
      />
    </Page>
  )
}
