import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Link, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import BugReportIcon from '@mui/icons-material/BugReport'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { apiError, http } from '@/api/client'

interface FeedbackConfig {
  repo: string
  enabled: boolean
  configured: boolean
}

interface LogItem {
  id: number
  created_at: string
  level: string
  message: string
  path?: string | null
}

interface Submission {
  id: number
  status: string
  issue_number?: number | null
  issue_url?: string | null
  error?: string | null
  attempts: number
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

export default function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [kind, setKind] = useState<'bug' | 'feature'>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [config, setConfig] = useState<FeedbackConfig | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Submission | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError('')
    void (async () => {
      try {
        const [configResponse, logsResponse] = await Promise.all([
          http.get('/feedback/config'),
          http.get('/logs', { params: { level: 'error', page_size: 20 } }),
        ])
        setConfig(configResponse.data)
        const items: LogItem[] = logsResponse.data.items || []
        setLogs(items)
        setSelected(new Set(items.map((item) => item.id)))
      } catch {
        // 配置读取失败时仍然允许打开手动反馈入口
      }
    })()
  }, [open])

  const manualUrl = useMemo(() => {
    const repo = config?.repo?.trim()
    if (!repo) return ''
    const prefix = kind === 'bug' ? '[Bug] ' : '[需求] '
    const text = `${body}\n\n---\n- 页面：${window.location.pathname}${window.location.search}\n- 地址：${window.location.href}\n- 浏览器：${navigator.userAgent}\n- 视口：${window.innerWidth}x${window.innerHeight}`
    return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(prefix + title)}&body=${encodeURIComponent(text)}`
  }, [config, kind, title, body])

  const toggleSelected = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const submit = async () => {
    if (!title.trim()) {
      setError('请先填写标题')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { data } = await http.post('/feedback', {
        kind,
        title: title.trim(),
        body: body.trim(),
        include_logs: includeLogs && selected.size > 0,
        log_ids: includeLogs && selected.size > 0 ? [...selected] : undefined,
        route: `${window.location.pathname}${window.location.search}`,
        url: window.location.href,
        user_agent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      })
      setResult(data)
      if (data.status === 'sent') {
        setTitle('')
        setBody('')
      }
    } catch (caught) {
      const shape = apiError(caught)
      setError(shape.message)
      if (shape.code === 'FEEDBACK_NOT_CONFIGURED') {
        setConfig((prev) => prev ? { ...prev, enabled: false } : prev)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async () => {
    if (!result) return
    setSubmitting(true)
    try {
      const { data } = await http.post(`/feedback/${result.id}/retry`)
      setResult(data)
      if (data.status !== 'sent') setError(data.error || '重试后仍然失败')
    } catch (caught) {
      setError(apiError(caught).message)
    } finally {
      setSubmitting(false)
    }
  }

  const openSettings = () => {
    onClose()
    navigate('/settings/feedback')
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <BugReportIcon fontSize="small" />
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>反馈问题或提需求</Typography>
        </Stack>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
          提交后会直接创建到 {config?.repo ? `${config.repo} 的 GitHub Issue` : '配置的 GitHub 仓库'}，并自动附带当前环境和勾选的日志。
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {result?.status === 'sent' ? (
          <Stack spacing={2} sx={{ py: 2 }}>
            <Alert severity="success">
              已提交到 GitHub{result.issue_number ? `，Issue #${result.issue_number}` : ''}。
            </Alert>
            {result.issue_url ? (
              <Link href={result.issue_url} target="_blank" rel="noreferrer" sx={{ fontSize: 13 }}>
                {result.issue_url} <OpenInNewIcon sx={{ fontSize: 14, verticalAlign: 'text-bottom' }} />
              </Link>
            ) : null}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={onClose}>完成</Button>
              <Button onClick={() => setResult(null)}>再提交一条</Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.75}>
            {config && !config.configured ? (
              <Alert severity="warning">
                还没有配置 GitHub 反馈通道，提交无法自动创建 Issue。
                <Button size="small" onClick={openSettings} sx={{ ml: 1 }}>去设置</Button>
              </Alert>
            ) : null}
            {config && config.configured && !config.enabled ? (
              <Alert severity="warning">
                反馈通道当前未启用，启用后才能自动提交。
                <Button size="small" onClick={openSettings} sx={{ ml: 1 }}>去开启</Button>
              </Alert>
            ) : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
            {result?.status === 'failed' ? (
              <Alert severity="warning" action={<Button size="small" onClick={() => void retry()} disabled={submitting}>重试</Button>}>
                已保存到本地，但提交 GitHub 失败：{result.error || '未知错误'}
              </Alert>
            ) : null}

            <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_, value) => value && setKind(value)}>
              <ToggleButton value="bug"><BugReportIcon sx={{ fontSize: 17, mr: 0.75 }} />Bug 反馈</ToggleButton>
              <ToggleButton value="feature"><LightbulbIcon sx={{ fontSize: 17, mr: 0.75 }} />需求建议</ToggleButton>
            </ToggleButtonGroup>

            <TextField
              label="标题" size="small" value={title} onChange={(event) => setTitle(event.target.value)}
              placeholder={kind === 'bug' ? '例如：任务列表切换后白屏' : '例如：希望看板支持按标签筛选'}
              inputProps={{ maxLength: 200 }} fullWidth autoFocus
            />
            <TextField
              label="详细描述" multiline minRows={4} maxRows={10} value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="发生了什么、你期望是什么、可以怎样复现。截图暂时需要手动贴到 Issue 里。"
              inputProps={{ maxLength: 8000 }} fullWidth
            />

            <Box>
              <FormControlLabel
                control={<Checkbox size="small" checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} />}
                label={<Typography sx={{ fontSize: 13 }}>附带最近的错误日志（{logs.length} 条）</Typography>}
              />
              <Collapse in={includeLogs && logs.length > 0}>
                <Stack spacing={0.5} sx={{ maxHeight: 170, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, p: 1 }}>
                  {logs.map((item) => (
                    <Stack key={item.id} direction="row" spacing={0.75} alignItems="flex-start">
                      <Checkbox
                        size="small" checked={selected.has(item.id)}
                        onChange={(event) => toggleSelected(item.id, event.target.checked)}
                        sx={{ p: 0.25 }}
                      />
                      <Chip size="small" label="错误" color="error" sx={{ height: 18, fontSize: 10, mt: 0.35 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{formatTime(item.created_at)}</Typography>
                        <Typography sx={{ fontSize: 11.5, wordBreak: 'break-word' }}>{item.message}</Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Collapse>
              {includeLogs && !logs.length ? (
                <Typography sx={{ fontSize: 12, color: 'text.secondary', ml: 4 }}>最近没有错误日志，将只提交文字和环境信息。</Typography>
              ) : null}
            </Box>

            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
              自动附带：页面 {window.location.pathname} · 视口 {window.innerWidth}×{window.innerHeight} · 浏览器标识和当前时间。
            </Typography>
          </Stack>
        )}
      </DialogContent>
      {result?.status === 'sent' ? null : (
        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          {manualUrl ? (
            <Button size="small" href={manualUrl} target="_blank" rel="noreferrer" startIcon={<OpenInNewIcon />}>
              在 GitHub 打开
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="contained" onClick={() => void submit()} disabled={submitting || !title.trim()}>
            {submitting ? '提交中…' : '提交到 GitHub'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
