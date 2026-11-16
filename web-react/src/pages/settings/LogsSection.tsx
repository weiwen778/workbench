import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, Divider, Drawer, FormControlLabel, MenuItem,
  Select, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import DownloadIcon from '@mui/icons-material/Download'
import RefreshIcon from '@mui/icons-material/Refresh'
import { apiError, http } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import { DataTable, Pager, type Column } from '@/ui/common'
import { Card } from '../SettingsSections'

interface LogRow {
  id: number
  created_at: string
  level: string
  source: string
  logger: string
  message: string
  stack?: string | null
  path?: string | null
  method?: string | null
  status?: number | null
  duration_ms?: number | null
  request_id?: string | null
  user_id?: number | null
  context?: Record<string, unknown> | null
}

interface Summary {
  hours: number
  counts: Record<string, number>
  total: number
  dropped: number
  retention_days: number
}

const LEVEL_LABEL: Record<string, string> = {
  DEBUG: '调试', INFO: '信息', WARNING: '警告', ERROR: '错误', CRITICAL: '严重',
}
const LEVEL_COLOR: Record<string, 'default' | 'info' | 'warning' | 'error'> = {
  DEBUG: 'default', INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'error',
}
const SOURCE_LABEL: Record<string, string> = {
  backend: '后端', request: '请求', job: '后台任务', frontend: '前端',
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default function LogsSection() {
  const [level, setLevel] = useState('')
  const [source, setSource] = useState('')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [tail, setTail] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [detail, setDetail] = useState<LogRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (targetPage: number, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await http.get('/logs', {
        params: {
          page: targetPage,
          page_size: pageSize,
          level: level || undefined,
          source: source || undefined,
          q: appliedQuery || undefined,
          from: from || undefined,
          to: to || undefined,
        },
      })
      setRows(data.items)
      setTotal(data.total)
    } catch (error) {
      if (!silent) toast.error(apiError(error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [pageSize, level, source, appliedQuery, from, to])

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await http.get('/logs/summary')
      setSummary(data)
    } catch { /* 概览失败不打断列表 */ }
  }, [])

  useEffect(() => { void load(page) }, [load, page])
  useEffect(() => { void loadSummary() }, [loadSummary])

  useEffect(() => {
    if (!tail) return
    const timer = window.setInterval(() => { void load(1, true) }, 2000)
    return () => window.clearInterval(timer)
  }, [tail, load])

  const toggleTail = () => {
    setTail((value) => {
      if (!value) setPage(1)
      return !value
    })
  }

  const resetAndReload = (apply?: () => void) => {
    apply?.()
    setPage(1)
  }

  const openDetail = async (row: LogRow) => {
    setDetail(row)
    setDetailLoading(true)
    try {
      const { data } = await http.get(`/logs/${row.id}`)
      setDetail(data)
    } catch (error) {
      toast.error(apiError(error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const exportLogs = (format: 'csv' | 'json') => {
    const params = new URLSearchParams({ format })
    if (level) params.set('level', level)
    if (source) params.set('source', source)
    if (appliedQuery) params.set('q', appliedQuery)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const link = document.createElement('a')
    link.href = `/api/v1/logs/export?${params.toString()}`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: '清空运行日志',
      message: '会删除当前所有运行日志，操作不可撤销。已提交到 GitHub 的反馈正文不受影响。',
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return
    try {
      const { data } = await http.delete('/logs')
      toast.success(`已清理 ${data.removed} 条日志`)
      setPage(1)
      void load(1)
      void loadSummary()
    } catch (error) {
      toast.error(apiError(error).message)
    }
  }

  const columns = useMemo<Column<LogRow>[]>(() => [
    {
      key: 'created_at', label: '时间', width: 156,
      render: (row) => <Typography sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatTime(row.created_at)}</Typography>,
    },
    {
      key: 'level', label: '级别', width: 66,
      render: (row) => <Chip size="small" label={LEVEL_LABEL[row.level] || row.level} color={LEVEL_COLOR[row.level] || 'default'} sx={{ height: 20, fontSize: 11 }} />,
    },
    {
      key: 'source', label: '来源', width: 74,
      render: (row) => <Typography sx={{ fontSize: 12 }}>{SOURCE_LABEL[row.source] || row.source}</Typography>,
    },
    {
      key: 'message', label: '内容',
      render: (row) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.message}>
            {row.message}
          </Typography>
          {row.path ? (
            <Typography sx={{ fontSize: 11, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.method || ''} {row.path}{row.status ? ` · ${row.status}` : ''}{row.duration_ms != null ? ` · ${row.duration_ms}ms` : ''}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    {
      key: 'request_id', label: '请求 ID', width: 110,
      render: (row) => <Typography sx={{ fontSize: 11, fontFamily: '"IBM Plex Mono", monospace', color: 'text.secondary' }}>{row.request_id || '—'}</Typography>,
    },
  ], [])

  return (
    <Stack spacing={2}>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap" useFlexGap>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>运行日志</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              {summary
                ? `近 ${summary.hours} 小时 ${summary.total} 条 · 错误 ${summary.counts.error || 0} · 警告 ${summary.counts.warning || 0} · 保留 ${summary.retention_days} 天`
                : '正在加载概览…'}
              {summary?.dropped ? ` · 队列丢弃 ${summary.dropped} 条` : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <FormControlLabel
              control={<Switch size="small" checked={tail} onChange={toggleTail} />}
              label={<Typography sx={{ fontSize: 12 }}>实时尾随</Typography>}
            />
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => { void load(page); void loadSummary() }} disabled={loading}>刷新</Button>
            <Button size="small" startIcon={<DownloadIcon />} onClick={() => exportLogs('csv')}>CSV</Button>
            <Button size="small" startIcon={<DownloadIcon />} onClick={() => exportLogs('json')}>JSON</Button>
            <Button size="small" color="error" startIcon={<DeleteSweepIcon />} onClick={() => void clearAll()}>清空</Button>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Select size="small" value={level} displayEmpty sx={{ minWidth: 108, height: 34, fontSize: 13 }}
            onChange={(event) => resetAndReload(() => setLevel(event.target.value))}>
            <MenuItem value="">全部级别</MenuItem>
            {Object.entries(LEVEL_LABEL).map(([key, label]) => <MenuItem key={key} value={key.toLowerCase()}>{label}</MenuItem>)}
          </Select>
          <Select size="small" value={source} displayEmpty sx={{ minWidth: 108, height: 34, fontSize: 13 }}
            onChange={(event) => resetAndReload(() => setSource(event.target.value))}>
            <MenuItem value="">全部来源</MenuItem>
            {Object.entries(SOURCE_LABEL).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </Select>
          <TextField
            size="small" placeholder="搜索消息、路径或记录器" value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') resetAndReload(() => setAppliedQuery(query.trim())) }}
            sx={{ minWidth: 240, flex: 1 }}
            InputProps={{ sx: { height: 34, fontSize: 13 } }}
          />
          <Button size="small" onClick={() => resetAndReload(() => setAppliedQuery(query.trim()))}>搜索</Button>
          <TextField
            size="small" type="datetime-local" label="开始" value={from}
            onChange={(event) => resetAndReload(() => setFrom(event.target.value))}
            InputLabelProps={{ shrink: true }} sx={{ width: 190 }} inputProps={{ style: { fontSize: 12 } }}
          />
          <TextField
            size="small" type="datetime-local" label="结束" value={to}
            onChange={(event) => resetAndReload(() => setTo(event.target.value))}
            InputLabelProps={{ shrink: true }} sx={{ width: 190 }} inputProps={{ style: { fontSize: 12 } }}
          />
          {(level || source || appliedQuery || from || to) ? (
            <Button size="small" onClick={() => resetAndReload(() => {
              setLevel(''); setSource(''); setQuery(''); setAppliedQuery(''); setFrom(''); setTo('')
            })}>重置筛选</Button>
          ) : null}
        </Stack>
      </Card>

      <Card>
        {tail ? <Alert severity="info" sx={{ mb: 1.5 }}>实时尾随中：每 2 秒刷新最新 50 条，翻到其他页会自动回到第一页。</Alert> : null}
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(row) => row.id}
          onRowClick={(row) => void openDetail(row)}
          empty="还没有符合条件的日志"
          maxHeight="calc(100vh - 380px)"
        />
        <Pager
          page={page} pageSize={pageSize} total={total}
          onPage={(next) => { setPage(next); if (tail) setTail(false) }}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
        />
      </Card>

      <Drawer anchor="right" open={Boolean(detail)} onClose={() => setDetail(null)}>
        <Box sx={{ width: { xs: '100vw', sm: 600 }, p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {detail ? (
            <>
              <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={LEVEL_LABEL[detail.level] || detail.level} color={LEVEL_COLOR[detail.level] || 'default'} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{formatTime(detail.created_at)}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{SOURCE_LABEL[detail.source] || detail.source} · {detail.logger}</Typography>
                </Stack>
                <Tooltip title="关闭"><Button size="small" onClick={() => setDetail(null)}>关闭</Button></Tooltip>
              </Stack>
              <Divider />
              {detailLoading ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>加载详情…</Typography> : null}
              <Box sx={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 0.75, fontSize: 12 }}>
                <Typography sx={{ color: 'text.secondary' }}>请求</Typography>
                <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', wordBreak: 'break-all' }}>{detail.method || ''} {detail.path || '—'}</Typography>
                <Typography sx={{ color: 'text.secondary' }}>状态 / 耗时</Typography>
                <Typography>{detail.status ?? '—'} / {detail.duration_ms != null ? `${detail.duration_ms}ms` : '—'}</Typography>
                <Typography sx={{ color: 'text.secondary' }}>请求 ID</Typography>
                <Typography sx={{ fontFamily: '"IBM Plex Mono", monospace', wordBreak: 'break-all' }}>{detail.request_id || '—'}</Typography>
                <Typography sx={{ color: 'text.secondary' }}>用户 ID</Typography>
                <Typography>{detail.user_id ?? '—'}</Typography>
              </Box>
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>消息</Typography>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {detail.message}
              </Box>
              {detail.stack ? (
                <>
                  <Typography sx={{ fontSize: 12, fontWeight: 600 }}>堆栈</Typography>
                  <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto' }}>
                    {detail.stack}
                  </Box>
                </>
              ) : null}
              {detail.context ? (
                <>
                  <Typography sx={{ fontSize: 12, fontWeight: 600 }}>附加上下文</Typography>
                  <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}>
                    {JSON.stringify(detail.context, null, 2)}
                  </Box>
                </>
              ) : null}
            </>
          ) : null}
        </Box>
      </Drawer>
    </Stack>
  )
}
