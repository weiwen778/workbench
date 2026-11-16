import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Divider, FormControlLabel, Link, Stack, Switch, TextField, Typography,
} from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SaveIcon from '@mui/icons-material/Save'
import SendIcon from '@mui/icons-material/Send'
import { apiError, http } from '@/api/client'
import { toast } from '@/ui/feedback'
import { DataTable, Pager, type Column } from '@/ui/common'
import { Card } from '../SettingsSections'

interface FeedbackConfig {
  repo: string
  enabled: boolean
  labels: string[]
  configured: boolean
  masked_token: string
  decrypt_error?: string | null
  last_test_ok?: boolean | null
  last_test_message?: string | null
  last_tested_at?: string | null
}

interface Submission {
  id: number
  kind: string
  kind_label: string
  title: string
  status: string
  issue_number?: number | null
  issue_url?: string | null
  error?: string | null
  attempts: number
  has_logs: boolean
  created_at: string
  sent_at?: string | null
}

const STATUS_META: Record<string, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  sent: { label: '已提交', color: 'success' },
  failed: { label: '失败', color: 'error' },
  pending: { label: '提交中', color: 'warning' },
}

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export default function FeedbackSection() {
  const [config, setConfig] = useState<FeedbackConfig | null>(null)
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [labels, setLabels] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)

  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)

  const applyConfig = (data: FeedbackConfig) => {
    setConfig(data)
    setRepo(data.repo || '')
    setLabels((data.labels || []).join(', '))
    setEnabled(Boolean(data.enabled))
    setToken('')
  }

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await http.get('/feedback/config')
      applyConfig(data)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (targetPage = 1) => {
    setHistoryLoading(true)
    try {
      const { data } = await http.get('/feedback', { params: { page: targetPage } })
      setSubmissions(data.items)
      setTotal(data.total)
      setPage(targetPage)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { void loadConfig(); void loadHistory(1) }, [loadConfig, loadHistory])

  const save = async (options: { silent?: boolean; enable?: boolean } = {}) => {
    setSaving(true)
    setMessage('')
    try {
      const payload: Record<string, unknown> = {
        repo: repo.trim(),
        labels: labels.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean),
        enabled: options.enable ?? enabled,
      }
      if (token.trim()) payload.token = token.trim()
      const { data } = await http.put('/feedback/config', payload)
      applyConfig(data)
      if (!options.silent) {
        setMessageError(false)
        setMessage('配置已保存。可以在顶栏虫子图标里直接提交反馈。')
      }
      return data as FeedbackConfig
    } catch (error) {
      setMessageError(true)
      setMessage(apiError(error).message)
      return null
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setMessage('')
    try {
      const saved = await save({ silent: true })
      if (!saved) return
      const { data } = await http.post('/feedback/config/test')
      setMessageError(!data.ok)
      setMessage(data.message || (data.ok ? '连接成功' : '连接失败'))
      setConfig((prev) => prev ? { ...prev, last_test_ok: data.ok, last_test_message: data.message } : prev)
    } catch (error) {
      setMessageError(true)
      setMessage(apiError(error).message)
    } finally {
      setTesting(false)
    }
  }

  const retry = async (row: Submission) => {
    setRetrying(row.id)
    try {
      const { data } = await http.post(`/feedback/${row.id}/retry`)
      toast.success(data.status === 'sent' ? '已重新提交到 GitHub' : '重试完成，仍然失败')
      void loadHistory(page)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setRetrying(null)
    }
  }

  const columns: Column<Submission>[] = [
    {
      key: 'created_at', label: '时间', width: 156,
      render: (row) => <Typography sx={{ fontSize: 12 }}>{formatTime(row.created_at)}</Typography>,
    },
    { key: 'kind_label', label: '类型', width: 80, render: (row) => <Typography sx={{ fontSize: 12 }}>{row.kind_label}</Typography> },
    {
      key: 'title', label: '标题',
      render: (row) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.title}>{row.title}</Typography>
          {row.error ? <Typography sx={{ fontSize: 11, color: 'error.main', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.error}>{row.error}</Typography> : null}
          {row.has_logs ? <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>已附带日志</Typography> : null}
        </Box>
      ),
    },
    {
      key: 'status', label: '状态', width: 82,
      render: (row) => {
        const meta = STATUS_META[row.status] || { label: row.status, color: 'default' as const }
        return <Chip size="small" label={meta.label} color={meta.color} sx={{ height: 20, fontSize: 11 }} />
      },
    },
    {
      key: 'issue', label: 'Issue', width: 120,
      render: (row) => row.issue_url
        ? <Link href={row.issue_url} target="_blank" rel="noreferrer" sx={{ fontSize: 12 }}>#{row.issue_number} <OpenInNewIcon sx={{ fontSize: 13, verticalAlign: 'text-bottom' }} /></Link>
        : <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>—</Typography>,
    },
    {
      key: 'action', label: '操作', width: 76,
      render: (row) => row.status !== 'sent'
        ? <Button size="small" disabled={retrying === row.id} onClick={() => void retry(row)}>{retrying === row.id ? '重试中' : '重试'}</Button>
        : null,
    },
  ]

  return (
    <Stack spacing={2}>
      <Card>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>GitHub 反馈通道</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
          在 GitHub 创建一枚细粒度访问令牌，只授予目标仓库的 Issues 读写权限。令牌会加密保存在服务端，不会回传到浏览器。
        </Typography>
        {message ? <Alert severity={messageError ? 'error' : 'success'} sx={{ mb: 1.5 }} onClose={() => setMessage('')}>{message}</Alert> : null}
        {config?.decrypt_error ? <Alert severity="warning" sx={{ mb: 1.5 }}>{config.decrypt_error}</Alert> : null}
        <Stack spacing={1.5}>
          <TextField
            label="仓库" size="small" placeholder="例如 weiwen778/workbench" value={repo}
            onChange={(event) => setRepo(event.target.value)}
            helperText="格式为 owner/repo，提交的 Issue 会创建在这个仓库。" fullWidth
          />
          <TextField
            label="访问令牌" size="small" type="password" value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={config?.configured ? `已保存 · ${config.masked_token} · 留空保留原值` : 'github_pat_… 或 ghp_…'}
            helperText="设置 → Developer settings → Personal access tokens → Fine-grained tokens。"
            fullWidth autoComplete="new-password"
          />
          <TextField
            label="自动添加的标签" size="small" value={labels}
            onChange={(event) => setLabels(event.target.value)}
            placeholder="bug, enhancement（可留空）"
            helperText="逗号或空格分隔，最多 10 个。标签必须已在仓库中存在，否则提交时会自动忽略标签。"
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
            label={<Typography sx={{ fontSize: 13 }}>启用反馈通道</Typography>}
          />
          <Divider />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" size="small" startIcon={<SaveIcon />} disabled={saving || loading} onClick={() => void save()}>
              {saving ? '保存中…' : '保存配置'}
            </Button>
            <Button size="small" startIcon={<SendIcon />} disabled={testing || saving || !config?.configured} onClick={() => void test()}>
              {testing ? '测试中…' : '测试连接'}
            </Button>
            {config?.last_test_message ? (
              <Typography sx={{ fontSize: 12, color: config.last_test_ok ? 'success.main' : 'error.main', alignSelf: 'center' }}>
                {config.last_test_message}{config.last_tested_at ? ` · ${formatTime(config.last_tested_at)}` : ''}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </Card>

      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>最近的反馈</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>提交失败的记录可以重试，不会重复创建 Issue。</Typography>
          </Box>
          <Button size="small" onClick={() => void loadHistory(page)} disabled={historyLoading}>刷新</Button>
        </Stack>
        <DataTable columns={columns} rows={submissions} loading={historyLoading} rowKey={(row) => row.id} empty="还没有提交过反馈" maxHeight={360} />
        <Pager page={page} pageSize={20} total={total} onPage={(next) => void loadHistory(next)} showSize={false} />
      </Card>
    </Stack>
  )
}
