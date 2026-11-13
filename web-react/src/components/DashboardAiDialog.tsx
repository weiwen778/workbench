import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import { AutoAwesome } from '@/icons'
import { apiError, http } from '@/api/client'
import { toast } from '@/ui/feedback'
import DashboardChart from '@/components/DashboardChart'
import { chartLabels, type DashboardResult, type DashboardWidget } from '@/dashboard'

const EXAMPLES = [
  '每天新增记录的趋势',
  '各性别的人数占比',
  '每个地址有多少人',
  '各性别平均年龄',
  '按地址统计人数，同时对比平均年龄',
]

export default function DashboardAiDialog({
  open, tables, defaultTableId, dateParams, onClose, onAdd, onEdit,
}: {
  open: boolean
  tables: { id: number; name: string; kind?: string }[]
  defaultTableId?: number
  dateParams: Record<string, string>
  onClose: () => void
  onAdd: (widgets: DashboardWidget[]) => Promise<void> | void
  onEdit: (widget: DashboardWidget) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [tableId, setTableId] = useState<number | ''>('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<{ widget: DashboardWidget; reason: string }[]>([])
  const [previews, setPreviews] = useState<Record<string, DashboardResult | 'loading' | 'error'>>({})

  useEffect(() => {
    if (!open) return
    setPrompt(''); setError(''); setWarnings([]); setSuggestions([]); setPreviews({})
    setTableId(defaultTableId || '')
  }, [open, defaultTableId])

  const generate = async () => {
    if (!prompt.trim()) { setError('请先描述你想看到的数据'); return }
    setLoading(true); setError(''); setWarnings([]); setSuggestions([]); setPreviews({})
    try {
      const { data } = await http.post('/dashboards/ai/suggest', {
        prompt: prompt.trim(),
        table_id: tableId || undefined,
      }, { timeout: 90000 })
      const items = (data.widgets || []) as { widget: DashboardWidget; reason: string }[]
      setSuggestions(items)
      setWarnings(data.warnings || [])
      if (!items.length) setError('没有生成可用图表，请补充指标或分组方式后再试')
      setPreviews(Object.fromEntries(items.map((item) => [item.widget.id, 'loading' as const])))
      await Promise.all(items.map(async (item) => {
        try {
          const response = await http.post('/dashboards/preview', { widget: item.widget, ...dateParams }, { timeout: 60000 })
          setPreviews((prev) => ({ ...prev, [item.widget.id]: response.data }))
        } catch {
          setPreviews((prev) => ({ ...prev, [item.widget.id]: 'error' }))
        }
      }))
    } catch (err) {
      setError(apiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  const add = async (widgets: DashboardWidget[]) => {
    if (!widgets.length) return
    setAdding(true)
    try {
      await onAdd(widgets)
      toast.success(`已添加 ${widgets.length} 个图表`)
      onClose()
    } catch (err) {
      setError(apiError(err).message)
    } finally {
      setAdding(false)
    }
  }

  const kindLabel = (widget: DashboardWidget) => widget.kind === 'progress' ? '任务进度' : chartLabels[widget.kind]
  const aggShort: Record<string, string> = { count: '计数', sum: '合计', avg: '平均', min: '最小', max: '最大' }
  const tableName = (id: number) => tables.find((table) => table.id === id)?.name || '表格'

  return (
    <Dialog open={open} onClose={() => { if (!loading && !adding) onClose() }} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesome sx={{ fontSize: 18, color: 'primary.main' }} />
        AI 生成图表
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          label="你想看到什么数据？"
          value={prompt}
          placeholder="例如：我想看每天新增记录的趋势，以及各性别的人数占比"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void generate() } }}
        />
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {EXAMPLES.map((example) => (
            <Chip key={example} size="small" label={example} onClick={() => setPrompt(example)} variant="outlined" />
          ))}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <FormControl size="small" sx={{ width: { xs: '100%', sm: 220 } }}>
            <InputLabel shrink>优先使用的表格</InputLabel>
            <Select label="优先使用的表格" value={tableId} onChange={(event) => setTableId(Number(event.target.value) || '')}>
              <MenuItem value="">自动选择</MenuItem>
              {tables.map((table) => <MenuItem key={table.id} value={table.id}>{table.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', flex: 1 }}>
            会根据当前账号里的表格字段生成 1–4 个图表，添加前可逐张预览。
          </Typography>
          <Button size="small" variant="contained" startIcon={<AutoAwesome fontSize="small" />} disabled={loading || !prompt.trim()} onClick={() => void generate()}>
            {loading ? '生成中…' : '生成图表'}
          </Button>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {warnings.length ? (
          <Alert severity="warning">
            {warnings.map((warning, index) => <Typography key={index} sx={{ fontSize: 12 }}>{warning}</Typography>)}
          </Alert>
        ) : null}

        {loading && !suggestions.length ? (
          <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="center" sx={{ py: 6, color: 'text.secondary' }}>
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 13 }}>正在理解你的描述并生成图表配置…</Typography>
          </Stack>
        ) : null}

        {suggestions.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            {suggestions.map(({ widget, reason }) => {
              const preview = previews[widget.id]
              return (
                <Box key={widget.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Stack direction="row" alignItems="flex-start" spacing={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{widget.title}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.25 }}>
                        {kindLabel(widget)} · {tableName(widget.table_id)} · {aggShort[widget.aggregation] || widget.aggregation}{widget.unit ? `（${widget.unit}）` : ''}
                      </Typography>
                    </Box>
                    <Button size="small" onClick={() => onEdit(widget)}>调整</Button>
                    <Button size="small" variant="contained" disabled={adding} onClick={() => void add([widget])}>添加</Button>
                  </Stack>
                  {reason ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{reason}</Typography> : null}
                  <Box sx={{ minHeight: 160 }}>
                    {preview === 'loading' ? (
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 5, color: 'text.secondary' }}>
                        <CircularProgress size={15} /><Typography sx={{ fontSize: 12 }}>正在预览…</Typography>
                      </Stack>
                    ) : preview && preview !== 'error' ? (
                      <DashboardChart widget={widget} result={preview} />
                    ) : preview === 'error' ? (
                      <Typography sx={{ py: 5, textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>预览失败</Typography>
                    ) : null}
                  </Box>
                </Box>
              )
            })}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" disabled={adding || loading} onClick={onClose}>取消</Button>
        <Button size="small" variant="contained" disabled={adding || !suggestions.length} onClick={() => void add(suggestions.map((item) => item.widget))}>
          {adding ? '正在添加…' : `全部添加${suggestions.length ? `（${suggestions.length}）` : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
