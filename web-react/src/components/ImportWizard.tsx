import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import { apiError, http } from '@/api/client'
import { DataTable, FieldRow, UploadDropzone } from '@/ui/common'
import { toast } from '@/ui/feedback'

const fieldTypes = [
  { label: '短文本', value: 'short_text' }, { label: '长文本', value: 'long_text' },
  { label: '数字', value: 'number' }, { label: '日期', value: 'date' },
  { label: '单选', value: 'select' }, { label: '多选', value: 'multiselect' },
  { label: '勾选', value: 'checkbox' }, { label: '链接', value: 'url' },
]

function requestId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function ImportWizard({ open, tableId, existingFields, onClose, onDone }: {
  open: boolean
  tableId?: number
  existingFields?: any[]
  onClose: () => void
  onDone?: (tableId: number) => void
}) {
  const [step, setStep] = useState<'upload' | 'preview'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<any>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [sheet, setSheet] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [sample, setSample] = useState<string[][]>([])
  const [rowCount, setRowCount] = useState(0)
  const [fields, setFields] = useState<any[]>([])
  const [existing, setExisting] = useState<any[]>([])
  const [tableName, setTableName] = useState('')
  const [choices, setChoices] = useState<Record<string, string | null>>({})
  const [drafts, setDrafts] = useState<any[]>([])
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [errors, setErrors] = useState<any[]>([])
  const [errorText, setErrorText] = useState('')
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (open) return
    setStep('upload'); setFile(null); setJob(null); setErrors([]); setErrorText(''); setTableName(''); setHeaders([]); setSample([]); setRowCount(0); setExisting([]); setDrafts([]); setChoices({}); setMapping({})
  }, [open])

  const uploadPreview = async (selected: File, sheetName = '') => {
    const form = new FormData()
    form.append('file', selected)
    if (tableId) form.append('table_id', String(tableId))
    if (sheetName) form.append('sheet', sheetName)
    try {
      const { data } = await http.post('/imports/preview', form)
      setJob(data); setSheets(data.sheets); setSheet(data.sheet); setHeaders(data.headers)
      setSample(data.sample); setRowCount(data.row_count); setTableName(data.table_name)
      setFields(data.fields || []); setExisting(data.existing_fields?.length ? data.existing_fields : existingFields || [])
      setDrafts(data.new_fields || [])
      setMapping(data.mapping || {})
      const nextChoices: Record<string, string | null> = {}
      ;(data.headers as string[]).forEach((_, index) => {
        const value = data.mapping?.[String(index)]
        nextChoices[String(index)] = value && String(value).startsWith('new_') ? '__new__' : value || null
      })
      setChoices(nextChoices)
      setStep('preview')
    } catch (error) { setErrorText(apiError(error).message) }
  }

  const payload = () => {
    if (tableId) {
      const map: Record<string, string | null> = {}
      const newFields: any[] = []
      headers.forEach((header, index) => {
        const choice = choices[String(index)]
        if (choice === '__new__') {
          const draft = drafts.find((item) => item.column === index)
          if (draft) { map[String(index)] = draft.key; newFields.push({ ...draft, name: (draft.name || header).trim() || header }) }
          else map[String(index)] = null
        } else map[String(index)] = choice || null
      })
      return { mapping: map, new_fields: newFields }
    }
    return {
      mapping: { ...mapping }, table_name: tableName,
      fields: fields.map((field, index) => ({ key: field.key || `col_${index}`, name: field.name, type: field.type, required: Boolean(field.required), options: field.options || [] })),
    }
  }

  const validate = async () => {
    setChecking(true); setErrors([])
    try {
      const { data } = await http.post(`/imports/${job.id}/draft`, payload())
      setErrors(data.errors || [])
      if (!(data.errors || []).length) toast.success('检查通过，可以导入了')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setChecking(false) }
  }

  const confirm = async () => {
    setConfirming(true)
    try {
      await http.post(`/imports/${job.id}/draft`, payload())
      await http.post(`/imports/${job.id}/confirm-tasks`, undefined, { headers: { 'Idempotency-Key': requestId() } })
      toast.success('已提交后台导入，可在任务中心查看进度和结果')
      const targetId = tableId || job.table_id
      onClose()
      if (targetId) onDone?.(targetId)
      window.dispatchEvent(new Event('wb:open-tasks'))
    } catch (error: any) {
      const body = error?.response?.data
      if (body?.details?.errors) setErrors(body.details.errors)
      toast.error(apiError(error).message)
    } finally { setConfirming(false) }
  }

  return (
    <Dialog open={open} onClose={() => !confirming && onClose()} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{tableId ? '导入到当前表格' : '从文件新建表格'}</DialogTitle>
      <DialogContent>
        {step === 'upload' ? (
          <>
            <UploadDropzone
              accept=".xlsx,.xls,.csv,.json"
              title="把 Excel、CSV 或 JSON 文件拖到这里，或点一下选择"
              hint="支持 .xlsx / .xls / .csv / .json；最多 1 万行、200 列，第一行当标题行"
              onFile={(selected) => { setFile(selected); setErrorText(''); void uploadPreview(selected) }}
            />
            {errorText ? <Alert severity="error" sx={{ mt: 1 }}>{errorText}</Alert> : null}
          </>
        ) : (
          <>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
              {sheets.length > 1 ? (
                <>
                  <FormControl size="small" sx={{ width: 180 }}>
                    <InputLabel shrink>工作表</InputLabel>
                    <Select label="工作表" value={sheet} onChange={(event) => { const name = event.target.value; setSheet(name); if (file) void uploadPreview(file, name) }}>
                      {sheets.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
                    </Select>
                  </FormControl>
                </>
              ) : null}
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {rowCount} 行</Typography>
              <div className="spacer" />
              <Button size="small" onClick={() => setStep('upload')}>重新选择文件</Button>
            </Stack>

            {!tableId ? (
              <FieldRow label="新表格名称" required><TextField fullWidth value={tableName} inputProps={{ maxLength: 100 }} onChange={(event) => setTableName(event.target.value)} /></FieldRow>
            ) : <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>同名列自动对应；其余新建字段，类型可手动调整。</Typography>}

            <DataTable
              rows={headers.map((header, index) => ({ col: String(index), header, sample: sample[0]?.[index] || '', index }))}
              rowKey={(row) => row.col}
              maxHeight={320}
              columns={tableId ? [
                { key: 'header', label: 'Excel 列', width: 140, ellipsis: true },
                { key: 'sample', label: '示例内容', width: 160, ellipsis: true },
                {
                  key: 'target', label: '导入到', width: 180,
                  render: (row) => (
                    <Select size="small" displayEmpty value={choices[row.col] ?? ''} onChange={(event) => setChoices({ ...choices, [row.col]: event.target.value || null })} sx={{ width: '100%' }}>
                      <MenuItem value="">忽略此列</MenuItem>
                      {existing.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}（{fieldTypes.find((type) => type.value === field.type)?.label || field.type}）</MenuItem>)}
                      <MenuItem value="__new__">创建为新字段</MenuItem>
                    </Select>
                  ),
                },
                {
                  key: 'newname', label: '新字段名', width: 130,
                  render: (row) => choices[row.col] === '__new__' ? (
                    <TextField size="small" value={drafts.find((item) => item.column === Number(row.col))?.name || ''} inputProps={{ maxLength: 50 }} onChange={(event) => setDrafts(drafts.map((item) => item.column === Number(row.col) ? { ...item, name: event.target.value } : item))} />
                  ) : <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>—</Typography>,
                },
                {
                  key: 'newtype', label: '类型', width: 120,
                  render: (row) => choices[row.col] === '__new__' ? (
                    <Select size="small" value={drafts.find((item) => item.column === Number(row.col))?.type || 'short_text'} onChange={(event) => setDrafts(drafts.map((item) => item.column === Number(row.col) ? { ...item, type: event.target.value } : item))} sx={{ width: '100%' }}>
                      {fieldTypes.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  ) : <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>—</Typography>,
                },
              ] : [
                { key: 'header', label: 'Excel 列', width: 140, ellipsis: true },
                {
                  key: 'name', label: '列名', width: 160,
                  render: (row) => <TextField size="small" value={fields[row.index]?.name ?? row.header} inputProps={{ maxLength: 50 }} onChange={(event) => setFields(fields.map((field, index) => index === row.index ? { ...field, name: event.target.value } : field))} />,
                },
                {
                  key: 'type', label: '类型', width: 140,
                  render: (row) => (
                    <Select size="small" value={fields[row.index]?.type || 'short_text'} onChange={(event) => setFields(fields.map((field, index) => index === row.index ? { ...field, type: event.target.value } : field))} sx={{ width: '100%' }}>
                      {fieldTypes.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  ),
                },
                {
                  key: 'required', label: '必填', width: 70, align: 'center',
                  render: (row) => <Checkbox size="small" checked={Boolean(fields[row.index]?.required)} onChange={(event) => setFields(fields.map((field, index) => index === row.index ? { ...field, required: event.target.checked } : field))} />,
                },
              ]}
            />

            {errors.length ? (
              <Alert severity="error" sx={{ mt: 1.25, fontSize: 12.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>发现 {errors.length} 处问题，这次一行都不会导入</Typography>
                <Box sx={{ maxHeight: 150, overflow: 'auto' }}>
                  {errors.slice(0, 50).map((error, index) => <div key={index}>第 {error.row} 行 · {error.column}：{error.message}</div>)}
                </Box>
              </Alert>
            ) : null}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose}>取消</Button>
        {step === 'preview' ? <Button size="small" disabled={checking} onClick={validate}>检查</Button> : null}
        {step === 'preview' ? <Button size="small" variant="contained" disabled={confirming} onClick={confirm}>确认导入</Button> : null}
      </DialogActions>
    </Dialog>
  )
}
