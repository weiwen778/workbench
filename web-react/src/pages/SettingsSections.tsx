import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControlLabel, LinearProgress, MenuItem, Pagination, Paper, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { apiError, copyText, http } from '@/api/client'
import { confirmDialog, promptDialog, toast } from '@/ui/feedback'
import { DataTable, FieldRow, SectionTitle } from '@/ui/common'
import { CopyDocument } from '@/icons'
import { readTranslationPreferences, type TranslationPreferences } from '@/utils/translation-preferences'

export function Card({ children }: { children: React.ReactNode }) {
  return <Paper variant="outlined" sx={{ p: 2.5 }}>{children}</Paper>
}

/* ------------------------------- Agents ------------------------------- */

export function AgentsSection() {
  const [tokens, setTokens] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [changes, setChanges] = useState<any[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [changeStatus, setChangeStatus] = useState('pending')
  const [changePage, setChangePage] = useState(1)
  const [changeQuery, setChangeQuery] = useState('')
  const [changeTotal, setChangeTotal] = useState(0)
  const [changesLoading, setChangesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [secret, setSecret] = useState<any | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<any | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState<number | null>(null)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitIndices, setSplitIndices] = useState<number[]>([])
  const [splitting, setSplitting] = useState(false)
  const [form, setForm] = useState({ name: '', scopes: ['all:read', 'all:stage'], expires_in_days: 90 })
  const [creating, setCreating] = useState(false)

  const scopeOptions = [
    { key: 'all:read', label: '读取全部业务', hint: '表格、待办、笔记、便利贴、打卡、看板、网址等' },
    { key: 'all:stage', label: '全部业务写入（先暂存）', hint: '新增、修改、删除都会进入待审核，不会直接生效' },
    { key: 'todos:read', label: '只读取待办', hint: '适合只做提醒或汇总的 Agent' },
    { key: 'todos:write', label: '只写入待办（先暂存）', hint: '自动建待办、改状态，仍需你审核' },
    { key: 'tables:read', label: '只读取表格', hint: '报表、数据分析类 Agent' },
    { key: 'tables:write', label: '只写入表格（先暂存）', hint: '自动补数据、改记录，仍需你审核' },
  ] as const
  const grantLabels: Record<string, string> = Object.fromEntries(scopeOptions.map((item) => [item.key, item.label]))
  grantLabels['all:stage'] = '全部业务写入（先暂存）'
  const endpoint = `${window.location.origin}/api/v1/agent`

  const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未使用'
  const statusLabel: Record<string, string> = { pending: '待审核', applied: '已通过', rejected: '已驳回', split: '已拆分' }
  const statusColor: Record<string, 'warning' | 'success' | 'error' | 'default'> = { pending: 'warning', applied: 'success', rejected: 'error', split: 'default' }
  const daysLeft = (value: string) => Math.ceil((new Date(value).getTime() - Date.now()) / 86400000)

  const loadTokens = async () => {
    const { data } = await http.get('/agent-tokens')
    setTokens(data.items)
  }
  const loadActivity = async () => {
    const { data } = await http.get('/agent-activity')
    setActivity(data.items)
  }
  const loadChanges = async (status = changeStatus, page = changePage, query = changeQuery) => {
    setChangesLoading(true)
    try {
      const { data } = await http.get('/agent-changes', { params: { status, page, q: query.trim() || undefined } })
      setChanges(data.items || [])
      setChangeTotal(data.total || 0)
      setCounts(data.counts || {})
    } catch (error) { toast.error(apiError(error).message) }
    finally { setChangesLoading(false) }
  }
  const load = async () => {
    setLoading(true)
    try { await Promise.all([loadTokens(), loadActivity(), loadChanges()]) }
    catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { void loadChanges(changeStatus, changePage, changeQuery) }, [changeStatus, changePage])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void loadChanges(changeStatus, changePage, changeQuery)
      void loadActivity()
    }, 20000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeStatus, changePage])

  const createToken = async () => {
    if (!form.name.trim() || !form.scopes.length) { toast.warning('请填写 Agent 名称并选择至少一项权限'); return }
    setCreating(true)
    try {
      const { data } = await http.post('/agent-tokens', form)
      setSecret(data)
      setCreateOpen(false)
      setForm({ name: '', scopes: ['all:read', 'all:stage'], expires_in_days: 90 })
      await loadTokens()
    } catch (error) { toast.error(apiError(error).message) }
    finally { setCreating(false) }
  }

  const revoke = async (token: any) => {
    const ok = await confirmDialog({ title: '撤销令牌', danger: true, confirmText: '撤销', message: `撤销后「${token.name}」将无法继续访问工作台，正在运行的任务也会被拒绝。` })
    if (!ok) return
    try { await http.delete(`/agent-tokens/${token.id}`); toast.success('令牌已撤销'); await loadTokens() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const copyGuide = async () => {
    try {
      const { data } = await http.get('/agent-guide')
      const guide = data.guide.replaceAll('{{BASE_URL}}', window.location.origin)
      if (await copyText(guide)) toast.success('接入说明已复制，令牌请另行通过机密配置提供')
      else toast.error('复制失败，请重试')
    } catch (error) { toast.error(apiError(error).message) }
  }

  const copyEndpoint = async () => {
    if (await copyText(endpoint)) toast.success('接口地址已复制')
    else toast.error('复制失败，请手动选中复制')
  }

  const copyConfig = async () => {
    if (!secret) return
    const config = JSON.stringify({ base_url: endpoint, authorization: `Bearer ${secret.token}`, write_mode: 'staged', requires_user_merge: true }, null, 2)
    if (await copyText(config)) toast.success('配置已复制')
    else toast.error('复制失败，请手动复制令牌')
  }

  const openDetail = async (change: any) => {
    setDetailOpen(true); setDetail(null); setReviewNote(''); setDetailLoading(true)
    try {
      const { data } = await http.get(`/agent-changes/${change.id}`)
      setDetail(data)
    } catch (error) { toast.error(apiError(error).message); setDetailOpen(false) }
    finally { setDetailLoading(false) }
  }

  const refreshDetail = async () => {
    if (!detail) return
    setDetailLoading(true)
    try {
      const { data } = await http.post(`/agent-changes/${detail.id}/refresh`, { version: detail.version, note: reviewNote })
      setDetail(data)
      toast.success('已重新预览，请核对最新内容')
      await loadChanges()
    } catch (error) { toast.error(apiError(error).message) }
    finally { setDetailLoading(false) }
  }

  const review = async (change: any, action: 'approve' | 'reject', note = reviewNote) => {
    if (action === 'reject' && !note.trim()) {
      const value = await promptDialog({ title: '驳回变更', label: '驳回原因（可选）', confirmText: '驳回', maxLength: 500 })
      if (value === null) return
      note = value
    }
    setReviewing(change.id)
    try {
      if (action === 'approve') await http.post(`/agent-changes/${change.id}/merge`, { version: change.version, note }, { timeout: 180000 })
      else await http.post(`/agent-changes/${change.id}/reject`, { version: change.version, note })
      toast.success(action === 'approve' ? '已通过并合并' : '已驳回')
      setDetailOpen(false)
      await Promise.all([loadChanges(), loadActivity(), loadTokens()])
      window.dispatchEvent(new Event('wb:tables-changed'))
      window.dispatchEvent(new Event('wb:todos-changed'))
    } catch (error) {
      toast.error(apiError(error).message)
      await loadChanges()
    } finally { setReviewing(null) }
  }

  const splitSelected = async () => {
    if (!detail || !splitIndices.length) { toast.warning('请选择至少一个操作'); return }
    if (splitIndices.length >= (detail.preview?.length || 0)) { toast.warning('至少保留一个操作在原批次'); return }
    setSplitting(true)
    try {
      await http.post(`/agent-changes/${detail.id}/split`, { version: detail.version, indices: splitIndices })
      toast.success('已拆分为两个待审核批次')
      setSplitOpen(false)
      setDetailOpen(false)
      await Promise.all([loadChanges(), loadActivity()])
    } catch (error) { toast.error(apiError(error).message) }
    finally { setSplitting(false) }
  }

  const approveAll = async () => {
    const pending = changes.filter((change) => change.status === 'pending')
    if (!pending.length) return
    const ok = await confirmDialog({ title: '通过全部待审核变更', confirmText: `通过 ${pending.length} 份`, message: '会按列表顺序逐份合并。任意一份失败时会停下并保留未处理的部分，建议先查看详情。' })
    if (!ok) return
    let done = 0; let failed = 0
    for (const change of pending) {
      setReviewing(change.id)
      try { await http.post(`/agent-changes/${change.id}/merge`, { version: change.version, note: '' }, { timeout: 180000 }); done++ }
      catch { failed++; break }
    }
    setReviewing(null)
    toast[failed ? 'warning' : 'success'](`已通过 ${done} 份${failed ? '，后续有一份失败，请查看详情' : ''}`)
    await Promise.all([loadChanges(), loadActivity(), loadTokens()])
    window.dispatchEvent(new Event('wb:tables-changed'))
    window.dispatchEvent(new Event('wb:todos-changed'))
  }

  const pendingCount = counts.pending || changes.filter((change) => change.status === 'pending').length

  return (
    <>
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} gap={1.5}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>Agent 接入</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              读取即时生效；写入需人工确认。
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => void copyGuide()}>复制接入说明</Button>
            <Button size="small" variant="contained" onClick={() => setCreateOpen(true)}>创建令牌</Button>
          </Stack>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5, mt: 2 }}>
          {[
            { title: '创建令牌', text: '按需勾选权限，令牌只显示一次。' },
            { title: '交给 Agent', text: '复制接入说明，配置接口地址和令牌。' },
            { title: '审核合并', text: '写操作进入暂存区，核对后合并。' },
          ].map((step, index) => (
            <Box key={step.title} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: 'primary.main', fontFamily: '"IBM Plex Mono", monospace' }}>0{index + 1}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 0.5 }}>{step.title}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5, lineHeight: 1.7 }}>{step.text}</Typography>
            </Box>
          ))}
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace', bgcolor: 'action.hover', px: 1.25, py: 0.75, borderRadius: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {endpoint}
          </Typography>
          <Button size="small" onClick={() => void copyEndpoint()}>复制接口地址</Button>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>认证方式：Authorization: Bearer &lt;令牌&gt;</Typography>
        </Stack>
      </Card>

      <Card>
        <SectionTitle>
          访问令牌{tokens.length ? `（${tokens.length}）` : ''}
        </SectionTitle>
        {tokens.length ? (
          <DataTable
            rows={tokens} loading={loading} empty="还没有令牌" maxHeight={320} autoRowHeight
            columns={[
              {
                key: 'name', label: 'Agent', width: 190,
                render: (row) => (
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500 }} noWrap>{row.name}</Typography>
                    <Typography sx={{ fontSize: 10.5, color: 'text.disabled', fontFamily: '"IBM Plex Mono", monospace' }}>{row.prefix}…</Typography>
                  </Box>
                ),
              },
              { key: 'scopes', label: '权限', width: 260, render: (row) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.25 }}>
                  {row.scopes.map((scope: string) => <Chip key={scope} size="small" label={grantLabels[scope] || scope} />)}
                </Box>
              ) },
              {
                key: 'expires_at', label: '有效期', width: 150,
                render: (row) => {
                  const left = daysLeft(row.expires_at)
                  return (
                    <Box>
                      <Typography sx={{ fontSize: 12 }}>{time(row.expires_at)}</Typography>
                      {row.status === 'active' && left <= 7 ? <Typography sx={{ fontSize: 11, color: 'warning.main' }}>还剩 {left} 天</Typography> : null}
                    </Box>
                  )
                },
              },
              { key: 'last_used_at', label: '最近使用', width: 150, render: (row) => <Typography sx={{ fontSize: 12 }}>{time(row.last_used_at)}</Typography> },
              { key: 'status', label: '状态', width: 90, render: (row) => <Chip size="small" label={({ active: '有效', revoked: '已撤销', expired: '已过期' } as any)[row.status] || row.status} color={row.status === 'active' ? 'success' : 'default'} /> },
              { key: 'actions', label: '操作', width: 80, render: (row) => row.status === 'active' ? <Button size="small" color="error" onClick={() => void revoke(row)}>撤销</Button> : null },
            ]}
          />
        ) : (
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>还没有令牌。</Typography>
            <Button size="small" variant="contained" sx={{ mt: 1.25 }} onClick={() => setCreateOpen(true)}>创建第一个令牌</Button>
          </Box>
        )}
      </Card>

      <Card>
        <SectionTitle
          action={(
            <Stack direction="row" spacing={1} alignItems="center">
              {changeStatus === 'pending' && pendingCount > 1 ? <Button size="small" variant="contained" onClick={() => void approveAll()} disabled={Boolean(reviewing)}>全部通过</Button> : null}
              <Button size="small" onClick={() => void loadChanges()}>刷新</Button>
            </Stack>
          )}
        >
          Agent 暂存区{changeTotal ? `（${changeTotal}）` : ''}
        </SectionTitle>
        <Tabs value={changeStatus} onChange={(_, value) => { setChangeStatus(value); setChangePage(1) }} sx={{ mb: 1, minHeight: 34 }}>
          <Tab value="pending" label={`待审核${counts.pending ? `（${counts.pending}）` : ''}`} />
          <Tab value="applied" label={`已通过${counts.applied ? `（${counts.applied}）` : ''}`} />
          <Tab value="rejected" label={`已驳回${counts.rejected ? `（${counts.rejected}）` : ''}`} />
          <Tab value="all" label="全部" />
        </Tabs>
        <Stack direction="row" spacing={1} sx={{ mb: 1.25, mt: 0.75 }}>
          <TextField
            size="small" label="搜索暂存" placeholder="标题或 Agent 名称" value={changeQuery}
            onChange={(event) => setChangeQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { setChangePage(1); void loadChanges(changeStatus, 1, changeQuery) } }}
            sx={{ width: 260 }}
          />
          <Button size="small" onClick={() => { setChangePage(1); void loadChanges(changeStatus, 1, changeQuery) }}>搜索</Button>
        </Stack>

        {changesLoading && !changes.length ? <LinearProgress sx={{ my: 2 }} /> : null}
        {changes.length ? changes.map((change) => (
          <Box key={change.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, mb: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} flexWrap="wrap" useFlexGap>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>{change.title}</Typography>
                  <Chip size="small" label={statusLabel[change.status] || change.status} color={statusColor[change.status] || 'default'} />
                  {change.operation_count ? <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>{change.operation_count} 个操作</Typography> : null}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {change.agent_name || 'Agent'} · {time(change.created_at)}
                  {change.review_note ? ` · 备注：${change.review_note}` : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexShrink={0}>
                <Button size="small" onClick={() => void openDetail(change)}>查看详情</Button>
                {change.status === 'pending' ? (
                  <>
                    <Button size="small" variant="contained" disabled={reviewing === change.id} onClick={() => void review(change, 'approve')}>
                      {reviewing === change.id ? '处理中…' : '通过'}
                    </Button>
                    <Button size="small" color="error" disabled={reviewing === change.id} onClick={() => void review(change, 'reject')}>驳回</Button>
                  </>
                ) : null}
              </Stack>
            </Stack>
          </Box>
        )) : !changesLoading ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 2 }}>
            {changeStatus === 'pending' ? '暂无待审核变更。' : '没有符合条件的历史记录。'}
          </Typography>
        ) : null}
        {changeTotal > 20 ? (
          <Stack direction="row" justifyContent="center" sx={{ mt: 1 }}>
            <Pagination size="small" count={Math.ceil(changeTotal / 20)} page={changePage} onChange={(_, value) => setChangePage(value)} showFirstButton showLastButton />
          </Stack>
        ) : null}

        <Divider sx={{ my: 2 }} />
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.75 }}>最近的 Agent 活动</Typography>
        <DataTable
          rows={activity} maxHeight={240} empty="暂无 Agent 写入记录"
          columns={[
            { key: 'created_at', label: '时间', width: 150, render: (row) => time(row.created_at) },
            { key: 'agent_name', label: 'Agent', width: 130 },
            { key: 'method', label: '操作', width: 150, render: (row) => row.method === 'MERGE' ? '用户审核合并' : row.method },
            { key: 'path', label: '请求路径', width: 280, ellipsis: true },
          ]}
        />
      </Card>

      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>创建 Agent 令牌</DialogTitle>
        <DialogContent>
          <FieldRow label="Agent 名称" required><TextField fullWidth autoFocus value={form.name} inputProps={{ maxLength: 100 }} placeholder="例如：运营助手、报表 Agent" onChange={(event) => setForm({ ...form, name: event.target.value })} /></FieldRow>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>权限（只勾选需要的）</Typography>
          <Stack spacing={0.5} sx={{ mb: 1.5 }}>
            {scopeOptions.map((scope) => (
              <Box key={scope.key} sx={{ border: 1, borderColor: form.scopes.includes(scope.key) ? 'primary.main' : 'divider', borderRadius: 1, px: 1.25, py: 0.75 }}>
                <FormControlLabel
                  sx={{ m: 0, alignItems: 'flex-start' }}
                  control={<Checkbox size="small" sx={{ py: 0.25 }} checked={form.scopes.includes(scope.key)} onChange={(event) => setForm({ ...form, scopes: event.target.checked ? [...form.scopes, scope.key] : form.scopes.filter((item) => item !== scope.key) })} />}
                  label={(
                    <Box>
                      <Typography sx={{ fontSize: 12.5 }}>{scope.label}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{scope.hint}</Typography>
                    </Box>
                  )}
                />
              </Box>
            ))}
          </Stack>
          <FieldRow label="有效期">
            <Select fullWidth value={form.expires_in_days} onChange={(event) => setForm({ ...form, expires_in_days: Number(event.target.value) })}>
              {[7, 30, 90, 180, 365].map((days) => <MenuItem key={days} value={days}>{days} 天</MenuItem>)}
            </Select>
          </FieldRow>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>令牌只显示一次，请立即保存。</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" disabled={creating} onClick={() => setCreateOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={creating} onClick={() => void createToken()}>{creating ? '创建中…' : '创建令牌'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>保存 Agent 令牌</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>令牌只显示一次，请立即保存，不要提交到 Git。</Alert>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            <TextField fullWidth value={secret?.token || ''} inputProps={{ readOnly: true }} />
            <Button size="small" variant="contained" onClick={async () => { if (await copyText(secret?.token || '')) toast.success('令牌已复制'); else toast.error('复制失败，请手动选中复制') }}>复制</Button>
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>接口地址</Typography>
          <Typography sx={{ fontSize: 12, fontFamily: '"IBM Plex Mono", monospace', bgcolor: 'action.hover', px: 1.25, py: 0.75, borderRadius: 1, mb: 1.5 }}>{endpoint}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
            Agent 名称：{secret?.name} · 有效期至 {time(secret?.expires_at)} · 写入模式：先暂存，需人工合并。
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<CopyDocument fontSize="small" />} onClick={() => void copyGuide()}>复制接入说明</Button>
            <Button size="small" onClick={() => void copyConfig()}>复制配置</Button>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" variant="contained" onClick={() => setSecret(null)}>我已保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailOpen} onClose={() => !reviewing && setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
          变更详情
          {detail ? <Chip size="small" label={statusLabel[detail.status] || detail.status} color={statusColor[detail.status] || 'default'} /> : null}
        </DialogTitle>
        <DialogContent>
          {detailLoading && !detail ? <LinearProgress sx={{ my: 2 }} /> : null}
          {detail ? (
            <>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{detail.title}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
                {detail.agent_name || 'Agent'} · {time(detail.created_at)} · {detail.operation_count || detail.preview?.length || 0} 个操作
              </Typography>
              {detail.message ? <Alert severity={detail.status === 'pending' ? 'info' : detail.status === 'applied' ? 'success' : 'warning'} sx={{ mb: 1.5 }}>{detail.message}</Alert> : null}
              <Stack spacing={1}>
                {(detail.preview || []).map((op: any, index: number) => (
                  <Box key={index} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={op.method} />
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{op.summary || '变更'}</Typography>
                      {op.irreversible ? <Chip size="small" color="warning" label="合并时执行" /> : null}
                    </Stack>
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', fontFamily: '"IBM Plex Mono", monospace', mt: 0.25 }}>{op.path}</Typography>
                    {op.changes?.length ? (
                      <Box sx={{ mt: 0.75 }}>
                        {op.changes.map((change: any, changeIndex: number) => (
                          <Stack key={changeIndex} direction="row" spacing={1} sx={{ fontSize: 12, py: 0.25, flexWrap: 'wrap' }}>
                            <Typography sx={{ fontSize: 12, color: 'text.secondary', minWidth: 90 }}>{change.label}</Typography>
                            <Typography sx={{ fontSize: 12, color: 'text.disabled', textDecoration: 'line-through' }}>{change.before === null || change.before === undefined || change.before === '' ? '空' : String(change.before)}</Typography>
                            <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>→</Typography>
                            <Typography sx={{ fontSize: 12 }}>{change.after === null || change.after === undefined || change.after === '' ? '空' : String(change.after)}</Typography>
                          </Stack>
                        ))}
                      </Box>
                    ) : null}
                    {op.note ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>{op.note}</Typography> : null}
                  </Box>
                ))}
              </Stack>
              {detail.status === 'pending' ? (
                <TextField
                  fullWidth multiline minRows={2} label="审核备注（可选）" value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)} sx={{ mt: 1.5 }}
                />
              ) : null}
            </>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
          {detail?.status === 'pending' ? (
            <Button size="small" disabled={detailLoading || Boolean(reviewing)} onClick={() => void refreshDetail()}>重新预览</Button>
          ) : null}
          {detail?.status === 'pending' && (detail.preview?.length || 0) > 1 ? (
            <Button size="small" disabled={detailLoading || Boolean(reviewing)} onClick={() => { setSplitIndices([]); setSplitOpen(true) }}>拆分所选</Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => setDetailOpen(false)}>关闭</Button>
          {detail?.status === 'pending' ? (
            <>
              <Button size="small" color="error" disabled={Boolean(reviewing)} onClick={() => void review(detail, 'reject')}>驳回</Button>
              <Button size="small" variant="contained" disabled={Boolean(reviewing)} onClick={() => void review(detail, 'approve')}>
                {reviewing ? '处理中…' : '通过并合并'}
              </Button>
            </>
          ) : null}
        </DialogActions>
      </Dialog>
      <Dialog open={splitOpen} onClose={() => !splitting && setSplitOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>拆分暂存批次</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            勾选要拆到新批次的操作用于单独审核；原请求会标记为已拆分，不会作为完整批次合并。
          </Alert>
          <Stack spacing={0.5}>
            {(detail?.preview || []).map((op: any, index: number) => (
              <FormControlLabel
                key={index}
                control={<Checkbox checked={splitIndices.includes(index)} onChange={(event) => setSplitIndices((current) => event.target.checked ? [...current, index] : current.filter((item) => item !== index))} />}
                label={<Typography sx={{ fontSize: 12.5 }}>#{index + 1} · {op.summary || op.method || '变更'} <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>{op.path}</Typography></Typography>}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" disabled={splitting} onClick={() => setSplitOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={splitting || !splitIndices.length} onClick={() => void splitSelected()}>
            {splitting ? '拆分中…' : `拆分 ${splitIndices.length} 项`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/* --------------------------------- AI ---------------------------------- */

export function AiSection({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('glm-4v-flash')
  const [compare, setCompare] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [pending, setPending] = useState(false)
  const load = async () => {
    try {
      const { data } = await http.get('/ai/config')
      setConfigured(data.configured); setCompare(Boolean(data.compare_models)); setModel(data.default_model || 'glm-4v-flash')
    } catch (error) { notify(apiError(error).message, true) }
  }
  useEffect(() => { void load() }, [])
  const save = async () => {
    setPending(true)
    try {
      const { data } = await http.put('/ai/config', { api_key: apiKey || undefined, default_model: model, compare_models: compare })
      setConfigured(data.configured); setApiKey(''); notify('配置已保存')
    } catch (error) { notify(apiError(error).message, true) }
    finally { setPending(false) }
  }
  const clear = async () => {
    const ok = await confirmDialog({ title: '清除 AI 密钥', danger: true, confirmText: '清除', message: '清除后两个模型都需要重新配置密钥才能使用。' })
    if (!ok) return
    try { await http.delete('/ai/config'); setConfigured(false); setApiKey(''); notify('密钥已清除') }
    catch (error) { notify(apiError(error).message, true) }
  }
  return (
    <Card>
      <Alert severity="info" sx={{ mb: 2 }}>识别与看板 AI 共用此 Key，密钥加密存储；结果需确认后写入。</Alert>
      <FieldRow label="智谱 API Key"><TextField fullWidth type="password" autoComplete="new-password" value={apiKey} placeholder={configured ? '已保存，留空保留原密钥' : '输入 API Key'} disabled={pending} onChange={(event) => setApiKey(event.target.value)} /></FieldRow>
      <FieldRow label="默认识别模型">
        <Select fullWidth value={model} disabled={pending} onChange={(event) => setModel(event.target.value)}>
          <MenuItem value="glm-ocr">GLM-OCR（专业文字与表格识别）</MenuItem>
          <MenuItem value="glm-4v-flash">GLM-4V-Flash（视觉理解）</MenuItem>
        </Select>
      </FieldRow>
      <FormControlLabel control={<Checkbox checked={compare} disabled={pending} onChange={(event) => setCompare(event.target.checked)} />} label="识别时同时对比两个模型" />
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>PNG / JPG ≤ 8 MB，或粘贴文本；单次最多 50 条。</Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button size="small" variant="contained" disabled={pending} onClick={save}>保存配置</Button>
        <Button size="small" disabled={pending || !configured} onClick={clear}>清除密钥</Button>
      </Stack>
    </Card>
  )
}

/* ----------------------------- Translation ----------------------------- */

export function TranslationSection() {
  const [preferences, setPreferences] = useState<TranslationPreferences>(readTranslationPreferences)
  const [connections, setConnections] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({})
  const [models, setModels] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [bases, setBases] = useState<Record<string, string>>({})
  const fontFields = [{ key: 'shortSize', label: '100 字以内字号' }, { key: 'mediumSize', label: '101–500 字字号' }, { key: 'longSize', label: '超过 500 字字号' }] as const
  const providerMeta: Record<string, {
    fields: { key: string; label: string }[]
    required?: string[]
    model?: string
    modelPlaceholder?: string
    baseUrl?: string
    tag?: string
    help?: string
  }> = {
    baidu: { fields: [{ key: 'app_id', label: 'APP ID' }, { key: 'secret', label: '应用密钥' }], help: '百度翻译开放平台，单次上限按字节计算。' },
    youdao: { fields: [{ key: 'app_key', label: '应用 ID' }, { key: 'secret', label: '应用密钥' }], help: '有道智云翻译，单次上限按字符计算。' },
    deepseek: { fields: [{ key: 'api_key', label: 'API Key' }], model: 'deepseek-chat', tag: '大模型', help: 'Chat Completions 接口。' },
    zhipu: { fields: [{ key: 'api_key', label: 'API Key' }], required: [], model: 'glm-4-flash', tag: '免费', help: '可复用「AI 能力」的智谱 Key。' },
    openai: { fields: [{ key: 'api_key', label: 'API Key' }], model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1/chat/completions', tag: '通用', help: '兼容 OpenAI / DeepSeek / Moonshot / 硅基流动 / Ollama。' },
    deepl: { fields: [{ key: 'api_key', label: 'API Key' }], baseUrl: 'https://api-free.deepl.com/v2/translate', tag: '专业', help: '免费 Key 用 api-free；Pro 用 api。' },
    mymemory: { fields: [], required: [], tag: '免费', help: '无需密钥；单次约 500 字符。' },
    libretranslate: { fields: [{ key: 'api_key', label: 'API Key（可选）' }], required: ['base_url'], baseUrl: 'https://libretranslate.com', tag: '自建', help: '自建或公共实例；无 Key 可留空。' },
  }
  const savePreferences = (next: TranslationPreferences) => { setPreferences(next); localStorage.setItem('wb_translation_preferences', JSON.stringify(next)) }
  const load = async () => {
    setLoading(true)
    try {
      const { data } = await http.get('/translation-connections')
      setConnections(data.items)
      setDraft(Object.fromEntries(data.items.map((item: any) => [item.provider, {}])))
      setModels(Object.fromEntries(data.items.map((item: any) => [item.provider, item.model || ''])))
      setBases(Object.fromEntries(data.items.map((item: any) => [item.provider, item.base_url || ''])))
    } catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const perform = async (connection: any, kind: string, task: () => Promise<void>) => {
    if (busy[connection.provider]) return
    setBusy((prev) => ({ ...prev, [connection.provider]: kind }))
    setMessages((prev) => ({ ...prev, [connection.provider]: '' }))
    setFailed((prev) => ({ ...prev, [connection.provider]: false }))
    try { await task() }
    catch (error) { setFailed((prev) => ({ ...prev, [connection.provider]: true })); setMessages((prev) => ({ ...prev, [connection.provider]: apiError(error).message })) }
    finally { setBusy((prev) => ({ ...prev, [connection.provider]: '' })) }
  }
  const update = (connection: any, data: any) => setConnections((prev) => prev.map((item) => item.provider === connection.provider ? data : item))
  const save = (connection: any) => perform(connection, 'save', async () => {
    const meta = providerMeta[connection.provider] || { fields: [] }
    const config = Object.fromEntries(Object.entries(draft[connection.provider] || {}).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value))
    const base = (bases[connection.provider] || '').trim()
    if (base) config.base_url = base
    const required = meta.required ?? meta.fields.map((field) => field.key)
    if (!connection.configured && required.some((key) => !config[key])) {
      setFailed((prev) => ({ ...prev, [connection.provider]: true }))
      setMessages((prev) => ({ ...prev, [connection.provider]: '请填写完整凭据后保存' }))
      return
    }
    const { data } = await http.put(`/translation-connections/${connection.provider}`, {
      config: Object.keys(config).length ? config : undefined,
      model: meta.model ? ((models[connection.provider] || '').trim() || meta.model) : undefined,
    })
    setDraft((prev) => ({ ...prev, [connection.provider]: {} }))
    update(connection, data)
    setMessages((prev) => ({ ...prev, [connection.provider]: '配置已保存' + (!data.enabled ? '，可以开启右上方开关使用。' : '。') }))
  })
  return (
    <Stack spacing={2}>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.25 }}>翻译页面偏好</Typography>
        <FieldRow label="默认翻译服务">
          <Select fullWidth value={preferences.provider} onChange={(event) => savePreferences({ ...preferences, provider: event.target.value })}>
            {connections.map((connection) => <MenuItem key={connection.provider} value={connection.provider}>{connection.name}</MenuItem>)}
          </Select>
        </FieldRow>
        <FormControlLabel control={<Checkbox checked={preferences.autoSize} onChange={(event) => savePreferences({ ...preferences, autoSize: event.target.checked })} />} label="按字数自动调整字号" />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
          {fontFields.map((field) => (
            <Box key={field.key} sx={{ flex: 1 }}>
              <FieldRow label={field.label}>
                <TextField fullWidth size="small" type="number" value={preferences[field.key]} inputProps={{ min: 12, max: 40 }} onChange={(event) => savePreferences({ ...preferences, [field.key]: Math.max(12, Math.min(40, Number(event.target.value) || 12)) })} />
              </FieldRow>
            </Box>
          ))}
        </Stack>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>设置仅保存在当前浏览器。</Typography>
      </Card>

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{connections.filter((connection) => connection.enabled).length} 个服务已启用</Typography>
        <Button size="small" disabled={loading} onClick={() => void load()}>刷新状态</Button>
      </Stack>

      {connections.map((connection) => {
        const meta = providerMeta[connection.provider] || { fields: [] }
        return (
        <Card key={connection.provider}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{connection.name}</Typography>
                {meta.tag ? <Chip size="small" label={meta.tag} /> : null}
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                {connection.configured
                  ? connection.enabled
                    ? '已启用'
                    : connection.provider === 'zhipu' && !connection.masked?.api_key
                      ? '已复用 AI 能力里的智谱 Key，未启用'
                      : '已配置，未启用'
                  : '尚未配置'}
              </Typography>
            </Box>
            <Checkbox
              checked={Boolean(connection.enabled)} disabled={!connection.configured || Boolean(busy[connection.provider])}
              inputProps={{ 'aria-label': `启用${connection.name}` }}
              onChange={(event) => void perform(connection, 'toggle', async () => {
                const { data } = await http.put(`/translation-connections/${connection.provider}`, { enabled: event.target.checked })
                update(connection, data)
                setMessages((prev) => ({ ...prev, [connection.provider]: event.target.checked ? '服务已启用' : '服务已停用' }))
              })}
            />
          </Stack>
          {meta.help ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5, lineHeight: 1.7 }}>{meta.help}</Typography> : null}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
            {(meta.fields || []).map((field) => (
              <Box key={field.key} sx={{ flex: 1, minWidth: 200 }}>
                <FieldRow label={field.label}>
                  <TextField
                    fullWidth type="password" autoComplete="new-password" disabled={Boolean(busy[connection.provider])}
                    placeholder={connection.masked?.[field.key] ? '已保存 · 留空保留原值' : `输入${field.label}`}
                    value={draft[connection.provider]?.[field.key] || ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [connection.provider]: { ...prev[connection.provider], [field.key]: event.target.value } }))}
                  />
                </FieldRow>
              </Box>
            ))}
            {meta.model ? (
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <FieldRow label="模型">
                  <TextField
                    fullWidth value={models[connection.provider] || ''} placeholder={meta.model} inputProps={{ maxLength: 100 }}
                    disabled={Boolean(busy[connection.provider])}
                    onChange={(event) => setModels((prev) => ({ ...prev, [connection.provider]: event.target.value }))}
                  />
                </FieldRow>
              </Box>
            ) : null}
            {meta.baseUrl ? (
              <Box sx={{ flex: 1.4, minWidth: 260 }}>
                <FieldRow label="接口地址">
                  <TextField
                    fullWidth value={bases[connection.provider] || ''} placeholder={meta.baseUrl} inputProps={{ maxLength: 300 }}
                    disabled={Boolean(busy[connection.provider])}
                    onChange={(event) => setBases((prev) => ({ ...prev, [connection.provider]: event.target.value }))}
                  />
                </FieldRow>
              </Box>
            ) : null}
            {!meta.fields?.length && !meta.model && !meta.baseUrl ? (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', alignSelf: 'center' }}>无需凭据。</Typography>
            ) : null}
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>{connection.limits?.unit === 'byte' ? '单次字节上限' : '单次字符上限'} {connection.limits?.value}；测试会消耗额度。</Typography>
          {messages[connection.provider] ? <Typography sx={{ fontSize: 13, color: failed[connection.provider] ? 'error.main' : 'success.main', mb: 1 }}>{messages[connection.provider]}</Typography> : connection.last_test_message ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>最近测试：{connection.last_test_message}</Typography> : null}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button size="small" variant="contained" disabled={Boolean(busy[connection.provider])} onClick={() => void save(connection)}>保存配置</Button>
            <Button size="small" disabled={!connection.configured || Boolean(busy[connection.provider])} onClick={() => void perform(connection, 'test', async () => {
              const { data } = await http.post(`/translation-connections/${connection.provider}/test`)
              setMessages((prev) => ({ ...prev, [connection.provider]: data.message }))
              setFailed((prev) => ({ ...prev, [connection.provider]: !data.ok }))
            })}>连接测试</Button>
            <div className="spacer" />
            {meta.fields?.length ? (
            <Button size="small" color="error" disabled={!connection.configured || Boolean(busy[connection.provider])} onClick={async () => {
              const ok = await confirmDialog({ title: '清除翻译密钥', danger: true, confirmText: '清除并停用', message: `清除${connection.name}的已保存密钥并停用该服务？再次使用需要重新填写。` })
              if (!ok) return
              await perform(connection, 'clear', async () => {
                const { data } = await http.delete(`/translation-connections/${connection.provider}`)
                setDraft((prev) => ({ ...prev, [connection.provider]: {} }))
                setModels((prev) => ({ ...prev, [connection.provider]: data.model || '' }))
                setBases((prev) => ({ ...prev, [connection.provider]: data.base_url || '' }))
                update(connection, data)
                setMessages((prev) => ({ ...prev, [connection.provider]: '密钥已清除，服务已停用' }))
              })
            }}>清除密钥</Button>
            ) : null}
          </Stack>
        </Card>
      )})}
    </Stack>
  )
}

/* ------------------------------- System -------------------------------- */

export function SystemSection() {
  const navigate = useNavigate()
  const [backups, setBackups] = useState<any>({ items: [], enabled: false })
  const [failure, setFailure] = useState('')
  const [creating, setCreating] = useState(false)
  const [metrics, setMetrics] = useState<any>({})
  const [health, setHealth] = useState<any>({})

  const loadBackups = async () => {
    try { setBackups((await http.get('/backups')).data) }
    catch (error) { setFailure(apiError(error).message) }
  }
  const loadMetrics = async () => {
    try {
      const [metricsResponse, healthResponse] = await Promise.allSettled([http.get('/system/metrics', { timeout: 10000 }), http.get('/health', { timeout: 10000 })])
      if (metricsResponse.status === 'fulfilled') setMetrics(metricsResponse.value.data)
      if (healthResponse.status === 'fulfilled') setHealth(healthResponse.value.data)
    } catch { /* ignore */ }
  }
  useEffect(() => {
    void loadBackups(); void loadMetrics()
    const timer = window.setInterval(() => { if (!document.hidden) void loadMetrics() }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const bytes = (value: any) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
    const number = Math.max(0, Number(value))
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const index = number ? Math.max(0, Math.min(4, Math.floor(Math.log(number) / Math.log(1024)))) : 0
    return (number / 1024 ** index).toLocaleString('zh-CN', { maximumFractionDigits: index ? 1 : 0 }) + ' ' + units[index]
  }
  const percentage = (value: any) => value === null || value === undefined ? '—' : Number(value).toFixed(1) + '%'
  const latest = metrics.latest
  const clamped = (value: any) => Math.min(100, Math.max(0, Number(value) || 0))
  const createBackup = async () => {
    setCreating(true)
    try { await http.post('/backups'); toast.success('已加入后台备份队列，可在任务中心查看进度') }
    catch (error) { toast.error(apiError(error).message) }
    finally { setCreating(false) }
  }

  return (
    <>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} useFlexGap>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.75 }}>备份与恢复</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>包含数据库、附件与加密配置；恢复密钥需另行保存。</Typography>
          </Box>
          <Button size="small" variant="contained" disabled={creating} onClick={createBackup}>立即备份</Button>
        </Stack>
        {failure ? <Alert severity="error" sx={{ mt: 1.5 }}>{failure}</Alert> : null}
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 1.5 }}>{backups.enabled ? `每 ${backups.interval_hours} 小时备份，保留最近 ${backups.keep} 份。` : '自动备份已关闭。'} 进度见任务中心。</Typography>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" onClick={() => window.dispatchEvent(new Event('wb:open-tasks'))}>打开任务中心</Button>
          <Button size="small" component="a" href="/api/v1/backups/recovery-key">下载恢复密钥</Button>
          <Button size="small" onClick={() => void loadBackups()}>刷新备份列表</Button>
        </Stack>
        <Alert severity="info" sx={{ mt: 1.5 }}>备份与恢复密钥请存放在其他安全位置。</Alert>
        <DataTable
          rows={(backups.items || []) as any[]} empty="尚无完整备份" maxHeight={260} sx={{ mt: 1.5 }}
          columns={[
            { key: 'created_at', label: '创建时间', width: 180, render: (row: any) => new Date(row.created_at).toLocaleString('zh-CN') },
            { key: 'size', label: '大小', width: 100, render: (row: any) => `${(row.size / 1024 / 1024).toFixed(1)} MB` },
            { key: 'file_count', label: '附件数', width: 90 },
            {
              key: 'actions', label: '操作', width: 200,
              render: (row: any) => (
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" component="a" href={`/api/v1/backups/${row.id}/download`}>下载备份</Button>
                  <Button size="small" onClick={async () => { try { await http.post(`/backups/${row.id}/verify`); toast.success('已提交校验任务，请在任务中心查看结果') } catch (error) { toast.error(apiError(error).message) } }}>校验完整性</Button>
                </Stack>
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>运行状态</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>CPU、内存、磁盘与网络 · 每 {metrics.interval_seconds || 5} 秒自动刷新</Typography>
          </Box>
          <Button size="small" onClick={() => void loadMetrics()}>重新检查</Button>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider', fontSize: 12 }}>
          <span>工作台服务：{health.status === 'ok' ? '运行正常' : health.status ? '连接异常' : '检查中'}</span>
          <span>数据连接：{health.database === 'ok' ? '连接正常' : health.database ? '暂不可用' : '检查中'}</span>
        </Stack>
        {latest ? (
          <>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.25 }}>{latest.hostname} · {latest.environment} · 采样于 {latest.sampled_at ? new Date(latest.sampled_at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0,1fr))' }, gap: 1.5, mt: 1.5 }}>
              {[
                { label: 'CPU 使用率', value: latest.cpu?.percent, detail: `${latest.cpu?.capacity_cores || '—'} 个逻辑核心` },
                { label: '内存使用率', value: latest.memory?.percent, detail: `${bytes(latest.memory?.used)} / ${bytes(latest.memory?.total)}` },
                { label: '系统磁盘使用率', value: latest.disks?.[0]?.percent, detail: `可用 ${bytes(latest.disks?.[0]?.free)} / ${bytes(latest.disks?.[0]?.total)}` },
                { label: '网络实时速率', value: null, detail: `接收 ${bytes(latest.network?.receive_bps)}/s · 发送 ${bytes(latest.network?.send_bps)}/s` },
              ].map((tile) => (
                <Box key={tile.label} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.75, bgcolor: 'action.hover' }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{tile.label}</Typography>
                  <Typography sx={{ fontSize: 26, fontWeight: 650, my: 1 }}>{tile.value === null ? '—' : percentage(tile.value)}</Typography>
                  {tile.value !== null ? <LinearProgress variant="determinate" value={clamped(tile.value)} sx={{ height: 6, borderRadius: 3, mb: 1 }} /> : null}
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', overflowWrap: 'anywhere' }}>{tile.detail}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3, mt: 1.5, fontSize: 12 }}>
              {[
                ['系统运行时长', latest.uptime_seconds ? `${Math.floor(latest.uptime_seconds / 86400)} 天 ${Math.floor(latest.uptime_seconds / 3600) % 24} 小时` : '—'],
                ['系统负载（1 / 5 / 15 分钟）', latest.load_average?.map((n: number) => n.toFixed(2)).join(' / ') || '当前环境不提供系统负载'],
                ['交换空间 Swap', latest.swap ? `${bytes(latest.swap.used)} / ${bytes(latest.swap.total)}` : '当前环境暂不提供'],
                ['磁盘读 / 写速率', latest.disk_io ? `${bytes(latest.disk_io.read_bps)}/s · ${bytes(latest.disk_io.write_bps)}/s` : '—'],
              ].map(([label, value]) => (
                <Stack key={label} direction="row" justifyContent="space-between" sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
                  <Typography sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                </Stack>
              ))}
            </Box>
          </>
        ) : <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>正在准备首次服务器采样…</Typography>}
      </Card>

      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.75 }}>数据与隐私</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>数据保存在当前工作台；图片不上传；翻译内容会发送至启用的服务。</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => navigate('/settings/trash')}>打开回收站</Button>
          <Button size="small" onClick={() => navigate('/settings/translation')}>管理翻译服务</Button>
        </Stack>
      </Card>
    </>
  )
}
