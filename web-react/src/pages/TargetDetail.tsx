import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, MenuItem, Select,
  Stack, TextField, Typography,
} from '@mui/material'
import { ArrowLeft, Plus } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import { DataTable, FieldRow, LoadingBlock, ModuleToolbar, Page, PageBody } from '@/ui/common'

export default function TargetDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const targetId = Number(params.id)
  const [target, setTarget] = useState<any | null>(null)
  const [rules, setRules] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', platform: '', note: '' })
  const [ruleOpen, setRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<any | null>(null)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [ruleForm, setRuleForm] = useState({ title: '', group_id: '' as number | '', period: 'daily', description: '' })
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<any[]>([])

  const periodText = (value: string) => ({ daily: '每天', weekly: '每周', monthly: '每月' } as Record<string, string>)[value] || value
  const formatTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: detail }, { data: ruleList }, { data: groupList }] = await Promise.all([
        http.get(`/work-targets/${targetId}`), http.get(`/work-targets/${targetId}/rules`), http.get('/checkin-groups'),
      ])
      setTarget(detail); setForm({ name: detail.name, platform: detail.platform || '', note: detail.note || '' })
      setRules(ruleList); setGroups(groupList)
      window.dispatchEvent(new Event('wb:checkins-changed'))
    } catch (error) { toast.error(apiError(error).message) }
    finally { setLoading(false) }
  }, [targetId])

  useEffect(() => { void loadAll() }, [loadAll])

  const saveTarget = async () => {
    setSaving(true)
    try {
      await http.patch(`/work-targets/${targetId}`, { name: form.name.trim(), platform: form.platform.trim() || null, note: form.note })
      toast.success('资料已保存'); await loadAll()
    } catch (error) { toast.error(apiError(error).message) }
    finally { setSaving(false) }
  }

  const archiveTarget = async () => {
    const ok = await confirmDialog({ title: '暂停打卡', confirmText: '暂停打卡', message: '暂停后从日常清单里隐藏，不再生成新的打卡；已有记录保留，只能查看。' })
    if (!ok) return
    try { await http.post(`/work-targets/${targetId}/archive`); await loadAll() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const restoreTarget = async () => {
    try { await http.post(`/work-targets/${targetId}/restore`); toast.success('已恢复'); await loadAll() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const openRule = (rule?: any) => {
    if (!groups.length) { toast.warning('请先在打卡页添加分类'); return }
    setEditingRule(rule || null)
    setRuleForm({ title: rule?.title || '', group_id: rule?.group_id || groups[0]?.id || '', period: rule?.pending_period || rule?.effective_period || 'daily', description: rule?.description || '' })
    setRuleOpen(true)
  }

  const saveRule = async () => {
    if (!ruleForm.title.trim() || !ruleForm.group_id) { toast.warning('请填写标题并选择分类'); return }
    setRuleSaving(true)
    try {
      if (editingRule) {
        const { data } = await http.patch(`/checkin-rules/${editingRule.id}`, { title: ruleForm.title.trim(), group_id: ruleForm.group_id, period: ruleForm.period, description: ruleForm.description })
        if (data.period_change?.pending) toast.success(`已保存，${data.period_change.effective_from} 起按新频率执行`)
        else { window.dispatchEvent(new Event('wb:checkins-changed')); toast.success('已保存') }
      } else {
        await http.post(`/work-targets/${targetId}/rules`, { group_id: ruleForm.group_id, title: ruleForm.title.trim(), period: ruleForm.period, description: ruleForm.description })
        toast.success('已添加，马上出现在这一轮里')
      }
      setRuleOpen(false); await loadAll()
    } catch (error) { toast.error(apiError(error).message) }
    finally { setRuleSaving(false) }
  }

  const disableRule = async (rule: any) => {
    const ok = await confirmDialog({ title: '停用任务', danger: true, confirmText: '停用', message: '停用后不再生成新的打卡任务，已有记录按原来的频率保留。' })
    if (!ok) return
    try { await http.delete(`/checkin-rules/${rule.id}`); await loadAll() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const enableRule = async (rule: any) => {
    try { await http.patch(`/checkin-rules/${rule.id}`, { active: true }); await loadAll() }
    catch (error) { toast.error(apiError(error).message) }
  }

  const openVersions = async (rule: any) => {
    setVersionsOpen(true)
    try { setVersions((await http.get(`/checkin-rules/${rule.id}/versions`)).data) }
    catch (error) { toast.error(apiError(error).message) }
  }

  return (
    <Page>
      <ModuleToolbar
        info={(
          <>
            <Button size="small" startIcon={<ArrowLeft fontSize="small" />} onClick={() => navigate(`/checkins/items/${targetId}`)}>返回打卡</Button>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{target?.name || '资料'}</Typography>
            {target?.status === 'archived' ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary', border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.75 }}>已暂停</Typography> : null}
          </>
        )}
        onRefresh={() => void loadAll()}
        refreshLabel="刷新资料与任务"
        primary={<Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} onClick={() => openRule()}>添加任务</Button>}
      />

      <PageBody sx={{ overflow: 'auto' }}>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, mb: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1.25 }}>资料</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Box sx={{ flex: 1 }}><FieldRow label="名称"><TextField fullWidth value={form.name} inputProps={{ maxLength: 100 }} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FieldRow></Box>
            <Box sx={{ flex: 1 }}><FieldRow label="平台"><TextField fullWidth value={form.platform} placeholder="只是资料，不保存平台密码" inputProps={{ maxLength: 100 }} onChange={(event) => setForm({ ...form, platform: event.target.value })} /></FieldRow></Box>
          </Stack>
          <FieldRow label="备注"><TextField fullWidth multiline minRows={2} value={form.note} inputProps={{ maxLength: 2000 }} onChange={(event) => setForm({ ...form, note: event.target.value })} /></FieldRow>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" disabled={saving} onClick={saveTarget}>保存资料</Button>
            {target?.status === 'active' ? <Button size="small" onClick={archiveTarget}>暂停</Button> : <Button size="small" onClick={restoreTarget}>恢复</Button>}
          </Stack>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1.25 }}>打卡任务</Typography>
          <DataTable
            rows={rules} loading={loading} empty="还没有打卡任务"
            columns={[
              { key: 'title', label: '任务', width: 180, ellipsis: true },
              { key: 'group_name', label: '分类', width: 110 },
              {
                key: 'period', label: '频率', width: 110,
                render: (row) => <span>{periodText(row.effective_period)}{row.pending_period ? <Typography component="span" sx={{ fontSize: 11, color: 'warning.main', ml: 0.5 }}>待生效</Typography> : null}</span>,
              },
              { key: 'active', label: '状态', width: 80, render: (row) => row.active ? '启用' : '已停用' },
              {
                key: 'actions', label: '操作', width: 220,
                render: (row) => (
                  <Stack direction="row" spacing={0.25}>
                    <Button size="small" onClick={() => openRule(row)}>编辑</Button>
                    <Button size="small" onClick={() => void openVersions(row)}>改动历史</Button>
                    {row.active ? <Button size="small" onClick={() => void disableRule(row)}>停用</Button> : <Button size="small" onClick={() => void enableRule(row)}>启用</Button>}
                  </Stack>
                ),
              },
            ]}
          />
          {!rules.length && !loading ? <Box sx={{ textAlign: 'center', py: 2 }}><Button size="small" variant="contained" onClick={() => openRule()}>添加第一个任务</Button></Box> : null}
        </Box>
      </PageBody>

      <Dialog open={ruleOpen} onClose={() => setRuleOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{editingRule ? '编辑任务' : '添加任务'}</DialogTitle>
        <DialogContent>
          <FieldRow label="标题" required><TextField fullWidth autoFocus value={ruleForm.title} inputProps={{ maxLength: 200 }} onChange={(event) => setRuleForm({ ...ruleForm, title: event.target.value })} /></FieldRow>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <FieldRow label="分类" required>
                <Select fullWidth value={ruleForm.group_id} displayEmpty onChange={(event) => setRuleForm({ ...ruleForm, group_id: event.target.value as number })}>
                  <MenuItem value="" disabled>选择分类</MenuItem>
                  {groups.map((group) => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
                </Select>
              </FieldRow>
            </Box>
            <Box sx={{ flex: 1 }}>
              <FieldRow label="频率">
                <Select fullWidth value={ruleForm.period} onChange={(event) => setRuleForm({ ...ruleForm, period: event.target.value })}>
                  <MenuItem value="daily">每天</MenuItem><MenuItem value="weekly">每周</MenuItem><MenuItem value="monthly">每月</MenuItem>
                </Select>
              </FieldRow>
            </Box>
          </Stack>
          <FieldRow label="任务说明"><TextField fullWidth multiline minRows={3} value={ruleForm.description} inputProps={{ maxLength: 5000 }} onChange={(event) => setRuleForm({ ...ruleForm, description: event.target.value })} /></FieldRow>
          {editingRule && ruleForm.period !== editingRule.effective_period ? (
            <Alert severity="info">从 {editingRule.period_change_starts?.[ruleForm.period]} 起按{periodText(ruleForm.period)}频率执行。</Alert>
          ) : editingRule?.pending_period ? (
            <Alert severity="info">保存后取消待生效的频率修改。</Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setRuleOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={ruleSaving} onClick={saveRule}>保存</Button>
        </DialogActions>
      </Dialog>

      <Drawer anchor="right" open={versionsOpen} onClose={() => setVersionsOpen(false)} slotProps={{ paper: { sx: { width: 'min(480px, 100vw)', p: 2.5 } } }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1.5 }}>任务改动历史</Typography>
        {versions.length ? versions.map((version) => (
          <Box key={version.id} sx={{ pb: 1.5, mb: 1.5, borderBottom: 1, borderColor: 'divider', borderLeft: 3, borderLeftColor: 'primary.main', pl: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{formatTime(version.created_at)}</Typography>
            <Typography sx={{ fontSize: 13 }}><b>{version.title}</b> · {version.group_name} · {periodText(version.period)}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{version.change_summary || '修改'}</Typography>
            {version.description ? <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{version.description}</Typography> : null}
          </Box>
        )) : <LoadingBlock text="暂无改动历史" />}
      </Drawer>
    </Page>
  )
}
