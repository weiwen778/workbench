import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Button, Drawer, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { http, apiError } from '@/api/client'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { SectionTitle } from '@/ui/common'

export default function CategoryManager({ resource, onChanged, buttonSx }: {
  resource: 'memos' | 'bookmarks'
  onChanged?: () => void
  buttonSx?: any
}) {
  const label = resource === 'memos' ? '便利贴' : '网址'
  const navigate = useNavigate()
  const route = useLocation()
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setNames((await http.get(`/${resource}/categories`)).data) }
    finally { setLoading(false) }
  }

  const openDrawer = async () => {
    setOpen(true)
    try { await load() } catch (error) { toast.error(apiError(error).message) }
  }

  const valid = (name: string) => Boolean(name.trim()) && name.trim().length <= 80
    && !['未分类', '__all', '__none', '__uncategorized__'].includes(name.trim())

  const changed = async (oldName?: string, nextName?: string) => {
    window.dispatchEvent(new Event(resource === 'memos' ? 'wb:memos-changed' : 'wb-bookmarks-changed'))
    const params = new URLSearchParams(route.search)
    if (oldName && params.get('category') === oldName) {
      params.delete('category')
      if (nextName) params.set('category', nextName)
      else if (resource === 'memos') params.set('uncategorized', '1')
      else params.set('category', '__none')
      navigate({ pathname: route.pathname, search: params.toString() }, { replace: true })
    }
    await load()
    onChanged?.()
  }

  const create = async () => {
    if (busy) return
    if (!valid(newName)) { toast.warning('请输入 1–80 个字的有效分类名称'); return }
    setBusy(true)
    try {
      await http.post(`/${resource}/categories`, { name: newName.trim() })
      setNewName('')
      await changed()
      toast.success('分类已添加')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setBusy(false) }
  }

  const rename = async (name: string) => {
    const value = await promptDialog({ title: '重命名分类', label: '分类名称', defaultValue: name, maxLength: 80, confirmText: '保存' })
    if (!value || !valid(value)) return
    setBusy(true)
    try {
      const { data } = await http.patch(`/${resource}/categories/manage`, { original_name: name, name: value })
      await changed(name, data.name)
      toast.success('分类已修改')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setBusy(false) }
  }

  const remove = async (name: string) => {
    const ok = await confirmDialog({ title: '删除分类', danger: true, confirmText: '删除', message: `删除分类「${name}」？分类下的${label}会移到未分类，内容保留。` })
    if (!ok) return
    setBusy(true)
    try {
      await http.delete(`/${resource}/categories/manage`, { params: { name } })
      await changed(name)
      toast.success('分类已删除，内容已保留')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <Button size="small" onClick={openDrawer} sx={buttonSx}>管理分类</Button>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: 'min(520px, 100vw)', p: 2.5 } } }}>
        <SectionTitle>{label}分类管理</SectionTitle>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <TextField fullWidth size="small" label="新分类名称" value={newName} inputProps={{ maxLength: 80 }} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create() }} />
          <Button size="small" variant="contained" disabled={busy} onClick={create}>添加分类</Button>
        </Stack>
        <Table size="small">
          <TableHead><TableRow><TableCell>分类</TableCell><TableCell width={150}>操作</TableCell></TableRow></TableHead>
          <TableBody>
            {names.map((name) => (
              <TableRow key={name}>
                <TableCell sx={{ fontSize: 13 }}>{name}</TableCell>
                <TableCell>
                  <Button size="small" disabled={busy} onClick={() => void rename(name)}>重命名</Button>
                  <Button size="small" color="error" disabled={busy} onClick={() => void remove(name)}>删除</Button>
                </TableCell>
              </TableRow>
            ))}
            {!names.length ? <TableRow><TableCell colSpan={2} align="center" sx={{ color: 'text.secondary', py: 3, fontSize: 13 }}>{loading ? '加载中…' : '暂无分类'}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>删除分类后，内容移到未分类。</Typography>
      </Drawer>
    </>
  )
}
