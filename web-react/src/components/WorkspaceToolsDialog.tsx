import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Dialog, DialogContent, DialogTitle, FormControl, InputLabel, LinearProgress,
  MenuItem, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { Refresh } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import { DataTable, Pager } from '@/ui/common'

const statuses: Record<string, string> = { queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消' }
const actions: Record<string, string> = { POST: '新增或执行', PUT: '更新', PATCH: '修改', DELETE: '删除' }

/** 任务中心与操作记录弹窗：从顶栏任务按钮或页面内按钮打开。 */
export default function WorkspaceToolsDialog({
  open, initialView = 'tasks', onClose,
}: {
  open: boolean
  initialView?: 'tasks' | 'activity'
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'tasks' | 'activity'>(initialView)
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')
  const [agentPending, setAgentPending] = useState(0)
  const sequence = useRef(0)

  useEffect(() => {
    if (!open) return
    setTab(initialView)
    setPage(1)
    setFailure('')
  }, [open, initialView])

  const load = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true); setFailure('')
    try {
      const endpoint = tab === 'activity' ? '/activity' : '/tasks'
      const { data } = await http.get(endpoint, { params: { page, q: keyword.trim() || undefined, status: status || undefined } })
      if (current !== sequence.current) return
      setItems(data.items || [])
      setTotal(data.total || 0)
      setAgentPending(data.agent_pending || 0)
    } catch (error) { if (current === sequence.current) setFailure(apiError(error).message) }
    finally { if (current === sequence.current) setLoading(false) }
  }, [tab, page, keyword, status])

  useEffect(() => {
    if (!open) return
    void load()
    // load 已包含 keyword；这里只跟随弹窗、分页、状态和标签变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, page, status])

  useEffect(() => {
    if (!open || tab !== 'activity') return
    const timer = window.setTimeout(() => { void load() }, 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, tab, open])

  useEffect(() => {
    if (!open || tab !== 'tasks') return
    const timer = window.setInterval(() => { if (!document.hidden && !loading) void load() }, 3000)
    return () => window.clearInterval(timer)
  }, [open, tab, load, loading])

  const go = (path: string) => { onClose(); navigate(path) }

  const jobAction = async (row: any, action: 'cancel' | 'retry') => {
    const ok = await confirmDialog({ title: '确认操作', confirmText: '确定', message: action === 'cancel' ? '确认取消这个任务？已完成的部分文件可能会保留。' : '确认重新提交任务？将创建一个新的后台任务。' })
    if (!ok) return
    try { await http.post(`/tasks/${row.id}/${action}`); await load() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const follow = (row: any) => {
    const path = row.path || ''
    if (path.includes('/agent')) { go('/settings/agents'); return }
    if (row.method === 'DELETE' || path.includes('/trash')) { go('/settings/trash'); return }
    const table = path.match(/\/tables\/(\d+)/)
    if (table) { go(`/data/${table[1]}`); return }
    if (path.includes('/notes')) { go('/notes'); return }
    setTab('tasks')
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" slotProps={{ paper: { sx: { maxHeight: '86vh' } } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, pb: 1, flexWrap: 'wrap' }}>
        <Tabs value={tab} onChange={(_, value) => { setTab(value); setPage(1) }} sx={{ minHeight: 34 }}>
          <Tab value="tasks" label="任务中心" />
          <Tab value="activity" label="操作记录" />
        </Tabs>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<Refresh fontSize="small" />} disabled={loading} onClick={() => void load()}>刷新</Button>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
        {failure ? <Alert severity="error">{failure}</Alert> : null}

        {tab === 'tasks' ? (
          <>
            {agentPending ? <Alert severity="info" action={<Button size="small" onClick={() => go('/settings/agents')}>前往暂存区</Button>}>有 {agentPending} 份 Agent 变更等待审核</Alert> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <FormControl size="small" sx={{ width: { xs: '100%', sm: 170 } }}>
                <InputLabel shrink>任务状态</InputLabel>
                <Select label="任务状态" displayEmpty value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
                  <MenuItem value="">全部状态</MenuItem>
                  {Object.entries(statuses).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </Select>
              </FormControl>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                后台执行，关闭后继续；失败可重试。
              </Typography>
            </Stack>
            <DataTable
              rows={items} loading={loading} empty="暂无后台任务" maxHeight="min(54vh, 520px)"
              columns={[
                { key: 'id', label: '编号', width: 70 },
                { key: 'title', label: '任务', width: 220, ellipsis: true },
                {
                  key: 'progress', label: '进度', width: 210,
                  render: (row) => (
                    <Box>
                      <LinearProgress variant="determinate" color={row.status === 'failed' ? 'error' : row.status === 'completed' ? 'success' : 'primary'} value={Math.min(100, Math.max(0, row.progress || 0))} sx={{ height: 6, borderRadius: 3, mb: 0.5 }} />
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{row.cancel_requested && row.status === 'running' ? '正在取消' : statuses[row.status]}{row.kind === 'export' ? ` · 已处理 ${row.processed} 行` : ''}</Typography>
                    </Box>
                  ),
                },
                { key: 'created_at', label: '提交时间', width: 170, render: (row) => new Date(row.created_at).toLocaleString('zh-CN', { hour12: false }) },
                {
                  key: 'actions', label: '结果与操作', width: 240,
                  render: (row) => (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center">
                      {row.error ? <Typography sx={{ fontSize: 12, color: 'error.main' }}>{row.error}</Typography> : null}
                      {row.result?.download_url ? <Button size="small" component="a" href={row.result.download_url}>下载结果</Button> : null}
                      {row.kind === 'import' && row.result?.result?.table_id ? <Button size="small" onClick={() => go(`/data/${row.result.result.table_id}`)}>打开导入表格</Button> : null}
                      {row.result?.verified ? <Typography sx={{ fontSize: 12, color: 'success.main' }}>备份校验通过</Typography> : null}
                      {['queued', 'running'].includes(row.status) ? <Button size="small" color="error" onClick={() => void jobAction(row, 'cancel')}>取消</Button> : null}
                      {['failed', 'cancelled'].includes(row.status) ? <Button size="small" onClick={() => void jobAction(row, 'retry')}>重试</Button> : null}
                    </Stack>
                  ),
                },
              ]}
            />
            <Pager page={page} pageSize={20} total={total} onPage={setPage} showSize={false} />
          </>
        ) : (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <TextField
                fullWidth size="small" label="筛选操作记录" value={keyword}
                placeholder="按操作人或请求路径筛选"
                onChange={(event) => { setKeyword(event.target.value); setPage(1) }}
                sx={{ maxWidth: 520 }}
              />
              <Button size="small" onClick={() => go('/settings/trash')}>回收站与恢复</Button>
            </Stack>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              仅记录成功操作；删除内容可在回收站恢复。
            </Typography>
            <DataTable
              rows={items} empty="暂无操作记录" maxHeight="min(54vh, 520px)"
              columns={[
                { key: 'created_at', label: '时间', width: 170, render: (row) => new Date(row.created_at).toLocaleString('zh-CN', { hour12: false }) },
                { key: 'actor', label: '操作人', width: 130 },
                { key: 'method', label: '操作', width: 150, render: (row) => `${actions[row.method] || row.method}${row.status === 202 ? '（已暂存或排队）' : ''}` },
                { key: 'path', label: '位置', width: 320, ellipsis: true },
                { key: 'view', label: '查看', width: 80, render: (row) => <Button size="small" onClick={() => follow(row)}>前往</Button> },
              ]}
            />
            <Pager page={page} pageSize={30} total={total} onPage={setPage} showSize={false} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
