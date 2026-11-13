import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer,
  FormControl, InputLabel, MenuItem, Paper, Popover, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { Divider } from '@mui/material'
import { Clock, Download, InfoFilled, Plus, Refresh, Setting, Upload } from '@/icons'
import { apiError, http } from '@/api/client'
import { DataTable, EmptyHint, FieldRow, Page, PageBody, PageToolbar, UploadDropzone } from '@/ui/common'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'

type Period = 'daily' | 'weekly' | 'monthly'

export default function CheckinPage() {
  const params = useParams()
  const navigate = useNavigate()
  const targetId = Number(params.targetId) || null
  const [period, setPeriod] = useState<Period>('daily')
  const [status, setStatus] = useState('all')
  const [groups, setGroups] = useState<any[]>([])
  const [targets, setTargets] = useState<any[]>([])
  const [stats, setStats] = useState({ completed: 0, total: 0, rate: null as number | null })
  const [range, setRange] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<Set<number>>(new Set())
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({})
  const [noteAnchor, setNoteAnchor] = useState<{ el: HTMLElement; item: any } | null>(null)

  const [manageOpen, setManageOpen] = useState(false)
  const [allTargets, setAllTargets] = useState<any[]>([])
  const [groupList, setGroupList] = useState<any[]>([])
  const [newTarget, setNewTarget] = useState({ name: '', platform: '' })
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingTarget, setCreatingTarget] = useState(false)
  const [targetEdit, setTargetEdit] = useState<{ id: number; name: string; platform: string } | null>(null)
  const [targetSaving, setTargetSaving] = useState(false)
  const [groupDelete, setGroupDelete] = useState<any | null>(null)
  const [moveGroupTo, setMoveGroupTo] = useState<number | ''>('')
  const [groupDeleting, setGroupDeleting] = useState(false)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyStatus, setHistoryStatus] = useState('all')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')

  const [importOpen, setImportOpen] = useState(false)
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState<any>(null)

  const viewActive = useRef(true)
  const requestVersion = useRef(0)
  useEffect(() => () => { viewActive.current = false }, [])

  const periodLabel = { daily: '今天', weekly: '本周', monthly: '本月' }[period]
  const periodUnit = { daily: '日', weekly: '周', monthly: '月' }[period]

  const refresh = useCallback(async (showLoading = false) => {
    const request = ++requestVersion.current
    if (showLoading) setLoading(true)
    try {
      const reqParams: Record<string, any> = { kind: 'all', period, status }
      if (targetId) reqParams.target_id = targetId
      const { data } = await http.get('/checkin-instances', { params: reqParams })
      if (!viewActive.current || request !== requestVersion.current) return
      setGroups(data.groups)
      setTargets(data.targets)
      setStats(data.statistics)
      setRange(`${data.period_start} ~ ${data.period_end}`)
      setNoteDraft((prev) => {
        const next = { ...prev }
        for (const group of data.groups) for (const item of group.items) if (next[item.id] === undefined) next[item.id] = item.note || ''
        return next
      })
    } catch (error) {
      if (viewActive.current && request === requestVersion.current) toast.error(apiError(error).message)
    } finally {
      if (viewActive.current && request === requestVersion.current) setLoading(false)
    }
  }, [period, status, targetId])

  useEffect(() => { void refresh(true) }, [refresh])

  const formatTime = (value: string) => value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
  const formatShort = (value: string) => {
    if (!value) return ''
    const date = new Date(value)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const toggle = async (item: any) => {
    if (item.locked || busy.has(item.id)) return
    setBusy((prev) => new Set(prev).add(item.id))
    try {
      if (item.completed) await http.post(`/checkin-instances/${item.id}/cancel`)
      else await http.post(`/checkin-instances/${item.id}/complete`, { note: (noteDraft[item.id] || '').trim() || null })
      await refresh()
    } catch (error) {
      toast.error(apiError(error).message)
      if (apiError(error).code === 'PERIOD_LOCKED') await refresh()
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  const saveNote = async (item: any) => {
    if (item.locked || busy.has(item.id)) return
    setBusy((prev) => new Set(prev).add(item.id))
    try {
      await http.patch(`/checkin-instances/${item.id}`, { note: (noteDraft[item.id] || '').trim() || null })
      setNoteAnchor(null)
      toast.success('备注已保存')
      await refresh()
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  const loadManage = async () => {
    try {
      const [targetsResponse, groupsResponse] = await Promise.all([
        http.get('/work-targets', { params: { include_archived: true } }),
        http.get('/checkin-groups'),
      ])
      setAllTargets(targetsResponse.data)
      setGroupList(groupsResponse.data)
      window.dispatchEvent(new Event('wb:checkins-changed'))
    } catch (error) { toast.error(apiError(error).message) }
  }

  useEffect(() => { if (manageOpen) void loadManage() }, [manageOpen])
  useEffect(() => { if (historyOpen) void loadHistory() }, [historyOpen])

  const createTarget = async () => {
    if (!newTarget.name.trim()) { toast.warning('请填写名称'); return }
    setCreatingTarget(true)
    try {
      await http.post('/work-targets', { kind: 'shop', name: newTarget.name.trim(), platform: newTarget.platform.trim() || null })
      setNewTarget({ name: '', platform: '' })
      toast.success('已添加')
      await loadManage(); await refresh()
    } catch (error) { toast.error(apiError(error).message) }
    finally { setCreatingTarget(false) }
  }

  const createGroup = async () => {
    if (!newGroupName.trim()) { toast.warning('请填写分类名称'); return }
    try {
      await http.post('/checkin-groups', { name: newGroupName.trim() })
      setNewGroupName('')
      await loadManage()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const saveTargetEdit = async () => {
    if (!targetEdit || !targetEdit.name.trim()) { toast.warning('请填写名称'); return }
    setTargetSaving(true)
    try {
      await http.patch(`/work-targets/${targetEdit.id}`, { name: targetEdit.name.trim(), platform: targetEdit.platform.trim() })
      setTargetEdit(null)
      await loadManage(); await refresh()
      toast.success('已修改')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setTargetSaving(false) }
  }

  const deleteTarget = async (row: any) => {
    const ok = await confirmDialog({
      title: '删除打卡项目', danger: true, confirmText: '删除',
      message: `删除「${row.name}」后将从列表移除并停止打卡，任务和历史记录保留。仅需暂时停用时可使用暂停。`,
    })
    if (!ok) return
    try {
      await http.delete(`/work-targets/${row.id}`)
      await loadManage(); await refresh()
      toast.success('已删除')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const renameGroup = async (row: any) => {
    const value = await promptDialog({ title: '重命名分类', label: '分类名称', defaultValue: row.name, maxLength: 100, confirmText: '保存' })
    if (!value) return
    try {
      await http.patch(`/checkin-groups/${row.id}`, { name: value, sort_order: row.sort_order })
      await loadManage(); await refresh()
      toast.success('已修改')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const confirmDeleteGroup = async () => {
    if (!groupDelete) return
    setGroupDeleting(true)
    try {
      await http.delete(`/checkin-groups/${groupDelete.id}`, { params: moveGroupTo ? { move_to: moveGroupTo } : {} })
      setGroupDelete(null)
      await loadManage(); await refresh()
      toast.success('分类已删除，关联任务已保留')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setGroupDeleting(false) }
  }

  const archive = async (row: any) => {
    const ok = await confirmDialog({
      title: '暂停打卡', confirmText: '暂停打卡',
      message: `暂停「${row.name}」后从日常清单里隐藏，不再生成新的打卡；已有记录保留，只能查看。`,
    })
    if (!ok) return
    try {
      await http.post(`/work-targets/${row.id}/archive`)
      await loadManage(); await refresh()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const restore = async (row: any) => {
    try {
      await http.post(`/work-targets/${row.id}/restore`)
      toast.success('已恢复，下一轮开始继续')
      await loadManage(); await refresh()
    } catch (error) { toast.error(apiError(error).message) }
  }

  const downloadTemplate = () => {
    const link = document.createElement('a')
    link.href = '/api/v1/checkin-imports/template?kind=shop'
    document.body.appendChild(link); link.click(); link.remove()
  }

  const onImportFile = async (file: File) => {
    setImportError(''); setImportResult(null)
    let parsed: any
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setImportError('这个文件不是有效的 JSON。常见原因是多了或少了逗号、引号没成对。建议重新下载模板再填。')
      return
    }
    try {
      const { data } = await http.post('/checkin-imports', parsed, { params: { kind: 'shop' } })
      setImportResult(data)
      toast.success('导入完成')
      await refresh(); await loadManage()
    } catch (error) {
      const info = apiError(error)
      const list = info.details?.errors
      setImportError(Array.isArray(list) && list.length
        ? `${info.message}\n${list.slice(0, 6).join('\n')}${list.length > 6 ? `\n…还有 ${list.length - 6} 处` : ''}`
        : info.message)
    }
  }

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const reqParams: Record<string, any> = { kind: 'all', period, status: historyStatus }
      if (historyFrom && historyTo) { reqParams.date_from = historyFrom; reqParams.date_to = historyTo }
      if (targetId) reqParams.target_id = targetId
      const { data } = await http.get('/checkin-instances/history', { params: reqParams })
      setHistoryItems(data.items); setHistoryTotal(data.total)
    } catch (error) { toast.error(apiError(error).message) }
    finally { setHistoryLoading(false) }
  }

  const emptyText = !targets.length
    ? '还没有打卡项目，先添加一个'
    : status === 'pending' ? '没有未完成的任务'
      : status === 'done' ? '这一轮还没有完成记录'
        : '当前没有要做的打卡'

  return (
    <Page sx={{ p: 1.5, gap: 1 }}>
      <PageToolbar sx={{ rowGap: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={period} onChange={(_, value) => value && setPeriod(value)}>
            <ToggleButton value="daily">今日</ToggleButton>
            <ToggleButton value="weekly">本周</ToggleButton>
            <ToggleButton value="monthly">本月</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          {!targetId ? (
            <FormControl size="small" sx={{ width: 190 }}>
              <InputLabel shrink>打卡项目</InputLabel>
              <Select label="打卡项目" displayEmpty value={targetId ?? ''} onChange={(event) => {
                const value = event.target.value
                navigate(value ? `/checkins/items/${value}` : '/checkins')
              }}>
                <MenuItem value="">全部打卡项目</MenuItem>
                {targets.map((target) => <MenuItem key={target.id} value={target.id}>{target.name}</MenuItem>)}
              </Select>
            </FormControl>
          ) : null}
          <FormControl size="small" sx={{ width: 120 }}>
            <InputLabel shrink>状态</InputLabel>
            <Select label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
              <MenuItem value="all">全部</MenuItem>
              <MenuItem value="pending">未完成</MenuItem>
              <MenuItem value="done">已完成</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{periodLabel} {range}</Typography>
          <Typography sx={{ fontSize: 13 }}>
            完成 <b>{stats.completed}</b> / {stats.total}
            <Box component="span" sx={{ color: 'text.secondary', fontSize: 12 }}>（完成率 {stats.rate === null ? '—' : `${stats.rate}%`}）</Box>
          </Typography>
        </Stack>
        <Box className="spacer" />
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button size="small" startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <Refresh fontSize="small" />} disabled={loading} onClick={() => void refresh(true)}>刷新</Button>
          <Button size="small" startIcon={<Clock fontSize="small" />} onClick={() => setHistoryOpen(true)}>历史</Button>
          <Button size="small" startIcon={<Upload fontSize="small" />} onClick={() => { setImportError(''); setImportResult(null); setImportOpen(true) }}>导入</Button>
          {targetId ? <Button size="small" onClick={() => navigate(`/checkins/targets/${targetId}`)}>资料与任务</Button> : null}
        </Stack>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
        <Button size="small" variant="contained" startIcon={<Setting fontSize="small" />} onClick={() => setManageOpen(true)}>管理打卡项目</Button>
      </PageToolbar>

      <PageBody>
        {loading && !groups.length ? <EmptyHint>加载中…</EmptyHint> : !groups.length ? (
          <EmptyHint action={!targets.length ? <Button size="small" variant="contained" onClick={() => setManageOpen(true)}>先添加打卡项目</Button> : null}>
            {emptyText}
          </EmptyHint>
        ) : (
          <Box sx={{ overflow: 'auto', minHeight: 0 }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              {groups.map((group, groupIndex) => (
                <Box key={group.group_id}>
                  <Stack
                    direction="row" spacing={1} alignItems="center"
                    sx={{ px: 2, py: 1, minHeight: 36, bgcolor: 'action.hover', borderTop: groupIndex ? 1 : 0, borderColor: 'divider' }}
                  >
                    <Typography sx={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.02em', flex: 1 }}>{group.group_name}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>{group.completed} / {group.total}</Typography>
                  </Stack>
                  {group.items.map((item: any) => (
                    <Box
                      key={item.id}
                      aria-busy={busy.has(item.id)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 56, py: 1, px: 2, borderTop: 1, borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <Checkbox
                        size="small"
                        checked={item.completed}
                        disabled={item.locked || busy.has(item.id)}
                        onChange={() => void toggle(item)}
                        sx={{ p: 0.5 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="body2" sx={{ fontSize: 13 }}>{item.title}</Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ display: { xs: 'none', sm: 'block' } }}>{item.target_name}</Typography>
                          {item.locked ? <Typography variant="caption" color="text.disabled">{item.lock_reason || '已结束'}</Typography> : null}
                          {item.description ? (
                            <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{item.description}</span>} placement="top-start">
                              <InfoFilled sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                            </Tooltip>
                          ) : null}
                        </Stack>
                        <Typography variant="caption" color="text.disabled" component="div" sx={{ mt: 0.25 }}>
                          {busy.has(item.id) ? '正在更新…'
                            : item.completed_at ? `完成于 ${formatTime(item.completed_at)}`
                              : `本${periodUnit}内完成一次`}
                          {item.note ? ` · 备注：${item.note}` : ''}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        sx={{ whiteSpace: 'nowrap', flexShrink: 0, color: 'text.secondary', minWidth: 0, px: 1 }}
                        disabled={item.locked || busy.has(item.id)}
                        onClick={(event) => {
                          setNoteDraft((prev) => ({ ...prev, [item.id]: item.note || '' }))
                          setNoteAnchor({ el: event.currentTarget, item })
                        }}
                      >
                        {item.note ? '改备注' : '备注'}
                      </Button>
                    </Box>
                  ))}
                </Box>
              ))}
            </Paper>
          </Box>
        )}
      </PageBody>

      <Popover
        open={Boolean(noteAnchor)}
        anchorEl={noteAnchor?.el}
        onClose={() => setNoteAnchor(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Box sx={{ width: 280, p: 1.5 }}>
          <Typography sx={{ fontSize: 13, mb: 1 }}>本次备注（可选）</Typography>
          <TextField
            fullWidth multiline minRows={3} label="本次备注（可选）" inputProps={{ maxLength: 2000 }}
            value={noteAnchor ? noteDraft[noteAnchor.item.id] || '' : ''}
            onChange={(event) => noteAnchor && setNoteDraft((prev) => ({ ...prev, [noteAnchor.item.id]: event.target.value }))}
          />
          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1 }}>
            <Button size="small" onClick={() => setNoteAnchor(null)}>取消</Button>
            <Button size="small" variant="contained" onClick={() => noteAnchor && void saveNote(noteAnchor.item)}>保存</Button>
          </Stack>
        </Box>
      </Popover>

      <Drawer anchor="right" open={manageOpen} onClose={() => setManageOpen(false)} slotProps={{ paper: { sx: { width: 'min(760px, 100vw)', p: 2.5 } } }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 2 }}>打卡项目与分类</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
          <TextField size="small" label="名称" value={newTarget.name} onChange={(event) => setNewTarget({ ...newTarget, name: event.target.value })} inputProps={{ maxLength: 100 }} sx={{ width: 180 }} />
          <TextField size="small" label="平台（可选）" value={newTarget.platform} onChange={(event) => setNewTarget({ ...newTarget, platform: event.target.value })} inputProps={{ maxLength: 100 }} sx={{ width: 170 }} />
          <Button size="small" variant="contained" disabled={creatingTarget} onClick={createTarget}>添加打卡项目</Button>
        </Stack>
        <DataTable
          rows={allTargets}
          empty="暂无打卡项目"
          columns={[
            { key: 'name', label: '名称', width: 150, ellipsis: true },
            { key: 'platform', label: '平台', width: 100, render: (row) => row.platform || '—' },
            { key: 'rules', label: '任务数', width: 80, align: 'center', render: (row) => row.rule_count },
            { key: 'status', label: '状态', width: 90, render: (row) => row.status === 'archived' ? '已暂停' : '使用中' },
            {
              key: 'actions', label: '操作', width: 250,
              render: (row) => (
                <Stack direction="row" spacing={0.2} flexWrap="wrap">
                  <Button size="small" onClick={() => setTargetEdit({ id: row.id, name: row.name, platform: row.platform || '' })}>修改</Button>
                  <Button size="small" onClick={() => { setManageOpen(false); navigate(`/checkins/targets/${row.id}`) }}>资料与任务</Button>
                  <Button size="small" color="error" onClick={() => void deleteTarget(row)}>删除</Button>
                  {row.status === 'active'
                    ? <Button size="small" onClick={() => void archive(row)}>暂停</Button>
                    : <Button size="small" onClick={() => void restore(row)}>恢复</Button>}
                </Stack>
              ),
            },
          ]}
          maxHeight={320}
        />

        <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 2, mb: 1 }}>分类</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField size="small" label="新分类名称" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} inputProps={{ maxLength: 100 }} sx={{ width: 200 }} />
          <Button size="small" startIcon={<Plus fontSize="small" />} onClick={createGroup}>添加分类</Button>
        </Stack>
        <DataTable
          rows={groupList}
          empty="暂无分类"
          columns={[
            { key: 'name', label: '分类', width: 180, ellipsis: true },
            { key: 'rules', label: '任务数', width: 90, align: 'center', render: (row) => row.rule_count },
            {
              key: 'actions', label: '操作', width: 150,
              render: (row) => (
                <Stack direction="row" spacing={0.2}>
                  <Button size="small" onClick={() => void renameGroup(row)}>重命名</Button>
                  <Button size="small" color="error" onClick={() => { setGroupDelete(row); setMoveGroupTo('') }}>删除</Button>
                </Stack>
              ),
            },
          ]}
        />
      </Drawer>

      <Dialog open={Boolean(targetEdit)} onClose={() => setTargetEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>修改打卡项目</DialogTitle>
        <DialogContent>
          <FieldRow label="名称" required>
            <TextField fullWidth autoFocus value={targetEdit?.name || ''} inputProps={{ maxLength: 100 }} onChange={(event) => setTargetEdit((prev) => prev ? { ...prev, name: event.target.value } : prev)} />
          </FieldRow>
          <FieldRow label="平台">
            <TextField fullWidth value={targetEdit?.platform || ''} inputProps={{ maxLength: 100 }} onChange={(event) => setTargetEdit((prev) => prev ? { ...prev, platform: event.target.value } : prev)} />
          </FieldRow>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setTargetEdit(null)}>取消</Button>
          <Button size="small" variant="contained" disabled={targetSaving} onClick={saveTargetEdit}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(groupDelete)} onClose={() => setGroupDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>删除分类</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13.5, mb: 1.5 }}>删除「{groupDelete?.name}」仅移除分类，任务和历史记录保留。</Typography>
          <FieldRow label="将关联任务移至">
            <Select fullWidth displayEmpty value={moveGroupTo} onChange={(event) => setMoveGroupTo(event.target.value as number)}>
              <MenuItem value="">有任务时必须选择接收分类</MenuItem>
              {groupList.filter((group) => group.id !== groupDelete?.id).map((group) => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
            </Select>
          </FieldRow>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>请先添加接收分类。</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setGroupDelete(null)}>取消</Button>
          <Button size="small" color="error" variant="contained" disabled={groupDeleting} onClick={confirmDeleteGroup}>删除分类</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>导入打卡项目</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.25 }}>
            可导入项目、分类和任务；同名项目或任务会跳过。
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
            <Button size="small" startIcon={<Download fontSize="small" />} onClick={downloadTemplate}>下载模板</Button>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>编辑后另存为 .json</Typography>
          </Stack>
          <UploadDropzone accept=".json,application/json" onFile={onImportFile} title="拖入 .json 文件或选择文件" hint="可先下载模板" />
          {importError ? <Alert severity="error" sx={{ mt: 1.25, whiteSpace: 'pre-wrap', fontSize: 13 }}>{importError}</Alert> : null}
          {importResult ? (
            <Alert severity="success" sx={{ mt: 1.25, fontSize: 13 }}>
              已导入 {importResult.created.targets} 个项目、{importResult.created.groups} 个分类、{importResult.created.rules} 个任务。
              {importResult.reused.targets || importResult.reused.groups ? `另有 ${importResult.reused.targets} 个项目、${importResult.reused.groups} 个分类本来就存在，直接沿用了。` : ''}
              {importResult.skipped_total ? ` 跳过 ${importResult.skipped_total} 个同名任务。` : ''}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button size="small" onClick={() => setImportOpen(false)}>关闭</Button></DialogActions>
      </Dialog>

      <Drawer anchor="right" open={historyOpen} onClose={() => setHistoryOpen(false)} slotProps={{ paper: { sx: { width: 'min(680px, 100vw)', p: 2.5 } } }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 2 }}>打卡历史</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <FormControl size="small" sx={{ width: 110 }}>
            <InputLabel shrink>状态</InputLabel>
            <Select label="状态" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
              <MenuItem value="all">全部</MenuItem><MenuItem value="pending">未完成</MenuItem><MenuItem value="done">已完成</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" type="date" label="起始日期" InputLabelProps={{ shrink: true }} value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} />
          <TextField size="small" type="date" label="结束日期" InputLabelProps={{ shrink: true }} value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} />
          <Button size="small" startIcon={<Refresh fontSize="small" />} onClick={() => void loadHistory()}>刷新</Button>
        </Stack>
        <DataTable
          rows={historyItems}
          loading={historyLoading}
          maxHeight="calc(100vh - 200px)"
          columns={[
            { key: 'period_start', label: '时间段', width: 96 },
            { key: 'target_name', label: '打卡项目', width: 110, ellipsis: true },
            { key: 'group_name', label: '分类', width: 90, ellipsis: true },
            { key: 'title', label: '任务', width: 160, ellipsis: true },
            { key: 'status', label: '状态', width: 80, render: (row) => row.completed ? '已完成' : '未完成' },
            { key: 'completed_at', label: '完成时间', width: 110, render: (row) => row.completed_at ? formatShort(row.completed_at) : '—' },
          ]}
        />
        {historyTotal > historyItems.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>共 {historyTotal} 条，当前显示 {historyItems.length} 条</Typography> : null}
      </Drawer>
    </Page>
  )
}
