import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, IconButton, InputLabel,
  MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { Check, ChevronDown, Delete, Picture, Upload } from '@/icons'
import { apiError, http } from '@/api/client'
import { toast } from '@/ui/feedback'
import type { Field } from '@/table-core'

const WRITABLE = ['short_text', 'long_text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url']

function modelName(model: string) {
  return ({ 'glm-ocr': 'GLM-OCR', 'glm-4v-flash': 'GLM-4V-Flash', 'glm-4-flash': 'GLM-4-Flash', rules: '本地快速识别' } as Record<string, string>)[model] || model
}

function durationText(ms?: number) {
  if (!ms && ms !== 0) return ''
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} 秒`
}

/** AI 填表：上传图片或粘贴乱文本，识别成当前表格字段，人工核对后写入。 */
export default function AiTableFill({
  open, tableId, initialText = '', onClose, onSaved,
}: {
  open: boolean
  tableId: number
  initialText?: string
  onClose: () => void
  onSaved: () => void
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'image' | 'text'>('image')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [model, setModel] = useState('glm-4v-flash')
  const [compare, setCompare] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [allFields, setAllFields] = useState<Field[]>([])
  const [selected, setSelected] = useState(0)
  const [rows, setRows] = useState<Record<string, any>[]>([])

  useEffect(() => {
    if (!open) return
    setMode(initialText ? 'text' : 'image'); setFile(null); setPreview(''); setText(initialText); setResults([]); setRows([]); setAllFields([]); setError(''); setSelected(0)
    void (async () => {
      try {
        const { data } = await http.get('/ai/config')
        setConfigured(Boolean(data.configured))
        setModel(data.default_model || 'glm-4v-flash')
        setCompare(Boolean(data.compare_models))
        if (!data.configured) setError('还没有配置智谱 API Key，请先到设置 → AI 能力中完成配置。')
      } catch { /* 配置读取失败时仍允许尝试识别 */ }
    })()
  }, [open, initialText])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  useEffect(() => {
    if (!open) return
    const onPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || [])
      const imageItem = items.find((item) => item.type.startsWith('image/'))
      if (!imageItem) return
      const pasted = imageItem.getAsFile()
      if (!pasted) return
      event.preventDefault()
      if (!['image/png', 'image/jpeg'].includes(pasted.type)) { setError('请粘贴 PNG 或 JPG 图片'); return }
      if (pasted.size > 8 * 1024 * 1024) { setError('图片不能超过 8 MB'); return }
      if (preview) URL.revokeObjectURL(preview)
      setMode('image')
      setFile(pasted)
      setPreview(URL.createObjectURL(pasted))
      setError(''); setResults([]); setRows([])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open, preview])

  const pickFile = (next: File | null) => {
    if (!next) return
    if (!['image/png', 'image/jpeg'].includes(next.type)) { setError('请选择 PNG 或 JPG 图片'); return }
    if (next.size > 8 * 1024 * 1024) { setError('图片不能超过 8 MB'); return }
    if (preview) URL.revokeObjectURL(preview)
    setFile(next); setPreview(URL.createObjectURL(next)); setError(''); setResults([]); setRows([])
  }

  const applyResult = (result: any, index: number) => {
    if (!result) return
    setSelected(index)
    setRows((result.records || []).map((row: any) => ({ ...row })))
    setError(result.error || '')
  }

  const useResult = (index: number) => applyResult(results[index], index)

  const recognize = async () => {
    if (mode === 'image' && !file) { setError('请先选择一张图片'); return }
    if (mode === 'text' && !text.trim()) { setError('请先粘贴需要识别的文本'); return }
    setBusy(true); setError(''); setResults([]); setRows([])
    try {
      const response = mode === 'image' ? await (() => {
        const form = new FormData()
        form.append('image', file as File)
        form.append('model', model)
        form.append('compare', String(compare))
        return http.post(`/tables/${tableId}/ai/extract`, form, { timeout: 120000 })
      })() : await http.post(`/tables/${tableId}/ai/extract-text`, { text: text.trim() }, { timeout: 120000 })
      const data = response.data
      setAllFields(data.fields || [])
      setResults(data.results || [])
      const index = (data.results || []).findIndex((result: any) => result.records?.length)
      if (index >= 0) applyResult(data.results[index], index)
      else setError(data.results?.[0]?.error || '没有识别到可写入当前表格的数据')
    } catch (err) {
      setError(apiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const updateValue = (index: number, key: string, value: any) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }

  const removeRow = (index: number) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))

  const confirm = async () => {
    const result = results[selected]
    if (!result?.draft_id) { setError('请先识别数据'); return }
    const payload = rows.filter((row) => Object.values(row).some((value) => Array.isArray(value) ? value.length : value !== '' && value !== null && value !== undefined))
    if (!payload.length) { setError('没有可写入的记录'); return }
    setSaving(true); setError('')
    try {
      const { data } = await http.post(`/tables/${tableId}/ai/drafts/${result.draft_id}/confirm`, { records: payload }, { timeout: 60000 })
      toast.success(data.already_applied ? '这批数据已经写入过了' : `已写入 ${data.record_ids?.length || payload.length} 条记录`)
      onSaved(); onClose()
    } catch (err) {
      setError(apiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const writableFields = allFields.filter((field) => WRITABLE.includes(field.type))
  const selectedResult = results[selected]
  const canConfirm = rows.length > 0 && Boolean(selectedResult?.draft_id) && !busy && !saving

  return (
    <Dialog open={open} onClose={() => { if (!saving && !busy) onClose() }} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>AI 填入表格</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        <ToggleButtonGroup
          size="small" exclusive value={mode}
          onChange={(_, value) => { if (!value) return; setMode(value); setError(''); setResults([]); setRows([]) }}
          sx={{ alignSelf: 'flex-start' }}
        >
          <ToggleButton value="image"><Picture fontSize="small" sx={{ mr: 0.75 }} />图片识别</ToggleButton>
          <ToggleButton value="text"><Typography sx={{ fontSize: 12.5 }}>乱文本识别</Typography></ToggleButton>
        </ToggleButtonGroup>

        {mode === 'image' ? (
          <Box
            onDragOver={(event) => { event.preventDefault() }}
            onDrop={(event) => { event.preventDefault(); pickFile(event.dataTransfer.files?.[0] || null) }}
            sx={{
              border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1.5,
              p: preview ? 1 : 3, textAlign: 'center', bgcolor: 'action.hover',
            }}
          >
            {preview ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
                <Box component="img" src={preview} alt="待识别图片" sx={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 1, bgcolor: 'background.paper' }} />
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography sx={{ fontSize: 13 }} noWrap>{file?.name}</Typography>
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>图片仅用于本次识别。</Typography>
                </Box>
                <Button size="small" component="label" startIcon={<Upload fontSize="small" />} disabled={busy}>
                  更换图片
                  <input type="file" hidden accept="image/png,image/jpeg" onChange={(event) => { pickFile(event.target.files?.[0] || null); event.target.value = '' }} />
                </Button>
              </Stack>
            ) : (
              <>
                <Picture sx={{ fontSize: 32, color: 'text.disabled' }} />
                <Typography sx={{ fontSize: 13, mt: 1 }}>拖入截图、按 Ctrl / ⌘ + V 粘贴，或选择图片</Typography>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.5 }}>PNG / JPG · ≤ 8 MB</Typography>
                <Button size="small" variant="contained" component="label" startIcon={<Upload fontSize="small" />} sx={{ mt: 1.5 }}>
                  选择图片
                  <input type="file" hidden accept="image/png,image/jpeg" onChange={(event) => { pickFile(event.target.files?.[0] || null); event.target.value = '' }} />
                </Button>
              </>
            )}
          </Box>
        ) : (
          <TextField
            fullWidth multiline minRows={5} maxRows={10} label="粘贴杂乱文本" value={text}
            placeholder="例如：张三是一名居住在广东省中山市的男士，联系电话为 123123123123，邮箱为 12313123@qq.com；档案创建于 2034 年 2 月 3 日。"
            onChange={(event) => { setText(event.target.value); setResults([]); setRows([]); setError('') }}
          />
        )}

        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {mode === 'image' ? (
            <>
              <FormControl size="small" sx={{ width: 190 }}>
                <InputLabel shrink>识别模型</InputLabel>
                <Select label="识别模型" value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
                  <MenuItem value="glm-4v-flash">GLM-4V-Flash（视觉理解）</MenuItem>
                  <MenuItem value="glm-ocr">GLM-OCR（文字与表格）</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Checkbox size="small" checked={compare} disabled={busy} onChange={(event) => setCompare(event.target.checked)} />}
                label={<Typography sx={{ fontSize: 12.5 }}>同时对比两个模型</Typography>}
              />
            </>
          ) : (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>GLM-4-Flash，自动匹配当前字段。</Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<Check fontSize="small" />} disabled={busy || (mode === 'image' ? !file : !text.trim())} onClick={() => void recognize()}>
            {busy ? '正在识别…' : '开始识别'}
          </Button>
        </Stack>

        {!configured ? (
          <Alert severity="warning" action={<Button size="small" onClick={() => { onClose(); navigate('/settings/ai') }}>去配置</Button>}>
            尚未配置智谱 API Key。
          </Alert>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        {busy ? (
          <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="center" sx={{ py: 5, color: 'text.secondary' }}>
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 13 }}>{mode === 'image' ? '正在读取图片中的字段…' : '正在理解这段文本…'}</Typography>
          </Stack>
        ) : null}

        {results.length > 1 && !busy ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {results.map((result, index) => (
              <Box key={`${result.model}-${index}`} sx={{
                flex: 1, border: 1, borderRadius: 1, p: 1.25,
                borderColor: selected === index ? 'primary.main' : 'divider',
                bgcolor: selected === index ? 'action.selected' : 'transparent',
              }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{modelName(result.model)}</Typography>
                  {result.duration_ms ? <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{(result.duration_ms / 1000).toFixed(2)} 秒</Typography> : null}
                  <Box sx={{ flex: 1 }} />
                  {result.records?.length ? (
                    <Button size="small" disabled={selected === index} onClick={() => useResult(index)}>{selected === index ? '正在核对' : '使用此结果'}</Button>
                  ) : null}
                </Stack>
                {result.error ? <Typography sx={{ fontSize: 12, color: 'error.main', mt: 0.5 }}>{result.error}</Typography> : null}
              </Box>
            ))}
          </Stack>
        ) : null}

        {(selectedResult?.warnings?.length || 0) > 0 && !busy ? (
          <Alert severity="warning" sx={{ '& ul': { m: 0, pl: 2 } }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>需要留意</Typography>
            <Box component="ul">{selectedResult.warnings.map((warning: string, index: number) => <li key={index}><Typography sx={{ fontSize: 12 }}>{warning}</Typography></li>)}</Box>
          </Alert>
        ) : null}

        {rows.length > 0 && !busy ? (
          <Stack spacing={1.25}>
            <Stack direction="row" alignItems="center">
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>核对数据</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>{rows.length} 条待确认，可直接修改</Typography>
              {selectedResult ? (
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled', ml: 'auto' }}>
                  {modelName(selectedResult.model)}{selectedResult.duration_ms || selectedResult.duration_ms === 0 ? ` · ${durationText(selectedResult.duration_ms)}` : ''}
                </Typography>
              ) : null}
            </Stack>
            {rows.map((row, index) => (
              <Box key={index} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>第 {index + 1} 条</Typography>
                  <Box sx={{ flex: 1 }} />
                  <IconButton size="small" aria-label={`删除第 ${index + 1} 条`} onClick={() => removeRow(index)}><Delete sx={{ fontSize: 15 }} /></IconButton>
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
                  {writableFields.map((field) => {
                    const value = row[field.key]
                    const label = `${field.name}${field.required ? ' *' : ''}`
                    if (field.type === 'checkbox') {
                      return (
                        <FormControlLabel
                          key={field.key}
                          control={<Checkbox size="small" checked={Boolean(value)} onChange={(event) => updateValue(index, field.key, event.target.checked)} />}
                          label={<Typography sx={{ fontSize: 12.5 }}>{label}</Typography>}
                        />
                      )
                    }
                    if (field.type === 'select' || field.type === 'multiselect') {
                      return (
                        <FormControl key={field.key} size="small" fullWidth>
                          <InputLabel shrink>{label}</InputLabel>
                          <Select
                            label={label}
                            multiple={field.type === 'multiselect'}
                            value={field.type === 'multiselect' ? (Array.isArray(value) ? value : []) : (value ?? '')}
                            onChange={(event) => updateValue(index, field.key, event.target.value)}
                          >
                            {field.type === 'select' ? <MenuItem value=""><em>不填写</em></MenuItem> : null}
                            {(field.options || []).map((option) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
                          </Select>
                        </FormControl>
                      )
                    }
                    return (
                      <TextField
                        key={field.key}
                        size="small"
                        fullWidth
                        label={label}
                        type={field.type === 'date' ? 'date' : 'text'}
                        multiline={field.type === 'long_text'}
                        minRows={field.type === 'long_text' ? 2 : undefined}
                        value={value ?? ''}
                        inputProps={field.type === 'number' ? { inputMode: 'decimal' } : undefined}
                        onChange={(event) => updateValue(index, field.key, event.target.value)}
                      />
                    )
                  })}
                </Box>
              </Box>
            ))}

            {selectedResult?.raw_text ? (
              <Accordion disableGutters>
                <AccordionSummary expandIcon={<ChevronDown fontSize="small" />}>
                  <Typography sx={{ fontSize: 12.5 }}>查看原始识别文本</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'text.secondary', fontFamily: '"IBM Plex Mono", monospace', maxHeight: 220, overflow: 'auto' }}>
                    {selectedResult.raw_text}
                  </Box>
                </AccordionDetails>
              </Accordion>
            ) : null}
          </Stack>
        ) : null}

        {!rows.length && !busy && !error ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 13 }}>识别结果待确认。</Typography>
            <Typography sx={{ fontSize: 11.5, mt: 0.5 }}>自动匹配字段、选项和日期格式</Typography>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" disabled={saving} onClick={onClose}>取消</Button>
        <Button size="small" variant="contained" disabled={!canConfirm} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined} onClick={() => void confirm()}>
          {saving ? '正在写入…' : rows.length ? `确认写入 ${rows.length} 条` : '确认写入'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
