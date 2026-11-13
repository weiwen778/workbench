import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Drawer,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import { Paperclip, Upload } from '@/icons'
import { apiError, http } from '@/api/client'
import { toast } from '@/ui/feedback'
import AttachmentPreview from './AttachmentPreview'

const READONLY = ['formula', 'lookup', 'rollup']

export default function RecordDrawer({
  open, tableId, fields, record, onClose, onSaved,
}: {
  open: boolean
  tableId: number
  fields: any[]
  record: any | null
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<Record<string, any>>({})
  const [fileInfo, setFileInfo] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [version, setVersion] = useState<number | null>(null)
  const [preview, setPreview] = useState<any | null>(null)

  useEffect(() => {
    if (!open) return
    setConflict(false)
    setVersion(record?.version ?? null)
    const next: Record<string, any> = {}
    const info: Record<string, any> = {}
    for (const field of fields) {
      const raw = record?.data?.[field.key]
      next[field.key] = field.type === 'multiselect' ? (Array.isArray(raw) ? [...raw] : [])
        : field.type === 'checkbox' ? raw === true
          : raw ?? field.default_value ?? ''
      if (field.type === 'attachment' && raw) {
        http.get(`/files/${raw}`).then(({ data: file }) => setFileInfo((prev) => ({ ...prev, [field.key]: file }))).catch(() => setFileInfo((prev) => ({ ...prev, [field.key]: null })))
      }
    }
    setData(next); setFileInfo(info)
  }, [open, record, fields])

  const uploadFile = async (file: File, field: any) => {
    if (uploading || saving) return
    setUploading(field.key)
    const form = new FormData(); form.append('file', file)
    try {
      const { data: uploaded } = await http.post('/files', form)
      setData((prev) => ({ ...prev, [field.key]: uploaded.id }))
      setFileInfo((prev) => ({ ...prev, [field.key]: uploaded }))
      toast.success('附件已上传，保存后生效')
    } catch (error) { toast.error(apiError(error).message) }
    finally { setUploading(null) }
  }

  const buildPayload = () => {
    const payload: Record<string, any> = {}
    for (const field of fields) {
      if (READONLY.includes(field.type)) continue
      const value = data[field.key]
      payload[field.key] = value === '' || value === undefined ? null : value
    }
    return payload
  }

  const save = async (force = false) => {
    if (uploading || saving) return
    setSaving(true)
    try {
      if (record) {
        const body: Record<string, any> = { data: buildPayload() }
        if (!force) body.version = version
        const { data: saved } = await http.put(`/records/${record.id}`, body)
        setVersion(saved.version)
      } else {
        await http.post(`/tables/${tableId}/records`, { data: buildPayload() })
      }
      toast.success('已保存'); setConflict(false); onSaved(); onClose()
    } catch (error: any) {
      if (error?.response?.status === 409 && error.response.data?.code === 'VERSION_CONFLICT') {
        setConflict(true)
        setVersion(error.response.data.details?.current_version ?? version)
        toast.warning('这一行已经在别处被改过，请确认后再保存')
      } else toast.error(apiError(error).message)
    } finally { setSaving(false) }
  }

  const reloadLatest = async () => {
    if (!record) return
    try {
      const { data: latest } = await http.get(`/records/${record.id}`)
      setVersion(latest.version)
      const next: Record<string, any> = {}
      for (const field of fields) {
        const raw = latest.data?.[field.key]
        next[field.key] = field.type === 'multiselect' ? (Array.isArray(raw) ? [...raw] : []) : (raw ?? '')
      }
      setData(next); setConflict(false); toast.success('已载入最新内容')
    } catch (error) { toast.error(apiError(error).message) }
  }

  return (
    <Drawer anchor="right" open={open} onClose={() => !saving && onClose()} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 } } } }}>
      <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 2 }}>{record ? '编辑这一行' : '添加一行'}</Typography>
        <Box sx={{ flex: 1, overflow: 'auto', pt: 1.25, mt: -1.25 }}>
          {fields.map((field) => {
            const value = data[field.key]
            const externalLabel = READONLY.includes(field.type) || field.type === 'checkbox' || field.type === 'attachment'
            const label = <>{field.name}{field.required ? <Box component="span" sx={{ color: 'error.main' }}> *</Box> : null}</>
            return (
              <Box key={field.key} sx={{ mb: 1.5 }}>
                {externalLabel ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>{label}</Typography> : null}
                {READONLY.includes(field.type) ? (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{record?.computed_errors?.[field.key] || (Array.isArray(value) ? value.join('、') : value) || '保存后自动计算'}</Typography>
                ) : field.type === 'reference' ? (
                  <FormControl fullWidth>
                    <InputLabel shrink required={field.required}>{field.name}</InputLabel>
                    <Select label={field.name} fullWidth multiple={field.config?.multiple} value={field.config?.multiple ? (value || []) : (value ?? '')} onChange={(event) => setData({ ...data, [field.key]: event.target.value })} displayEmpty>
                      <MenuItem value="">—</MenuItem>
                      {(record?.references?.[field.key] || []).map((option: any) => <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                ) : field.type === 'short_text' ? (
                  <TextField fullWidth label={label} value={value ?? ''} inputProps={{ maxLength: 500 }} onChange={(event) => setData({ ...data, [field.key]: event.target.value })} />
                ) : field.type === 'long_text' ? (
                  <TextField fullWidth multiline minRows={4} label={label} value={value ?? ''} inputProps={{ maxLength: 20000 }} onChange={(event) => setData({ ...data, [field.key]: event.target.value })} />
                ) : field.type === 'number' ? (
                  <TextField fullWidth label={label} value={value ?? ''} inputProps={{ inputMode: 'decimal' }} placeholder="例如：12.50" onChange={(event) => setData({ ...data, [field.key]: event.target.value })} />
                ) : field.type === 'date' ? (
                  <TextField fullWidth type="date" label={label} value={value ?? ''} onChange={(event) => setData({ ...data, [field.key]: event.target.value })} InputLabelProps={{ shrink: true }} />
                ) : field.type === 'select' ? (
                  <FormControl fullWidth>
                    <InputLabel shrink required={field.required}>{field.name}</InputLabel>
                    <Select label={field.name} fullWidth displayEmpty value={value ?? ''} onChange={(event) => setData({ ...data, [field.key]: event.target.value })}>
                      <MenuItem value="">—</MenuItem>
                      {(field.options || []).map((option: any) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                ) : field.type === 'multiselect' ? (
                  <FormControl fullWidth>
                    <InputLabel shrink required={field.required}>{field.name}</InputLabel>
                    <Select label={field.name} fullWidth multiple value={value || []} onChange={(event) => setData({ ...data, [field.key]: event.target.value })} renderValue={(selected) => (selected as string[]).map((id) => (field.options || []).find((option: any) => option.id === id)?.name || id).join('、')}>
                      {(field.options || []).map((option: any) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                ) : field.type === 'checkbox' ? (
                  <FormControlLabel control={<Checkbox checked={Boolean(value)} onChange={(event) => setData({ ...data, [field.key]: event.target.checked })} />} label="" />
                ) : field.type === 'url' ? (
                  <TextField fullWidth label={label} value={value ?? ''} placeholder="https://" onChange={(event) => setData({ ...data, [field.key]: event.target.value })} />
                ) : field.type === 'attachment' ? (
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    {value ? (
                      <>
                        <Paperclip sx={{ fontSize: 16 }} />
                        <Button size="small" onClick={async () => { try { setPreview((await http.get(`/files/${value}`)).data) } catch (error) { toast.error(apiError(error).message) } }}>
                          {fileInfo[field.key]?.name || `附件 #${value}`}
                        </Button>
                        <Button size="small" onClick={() => { setData({ ...data, [field.key]: '' }); setFileInfo(({ [field.key]: _, ...rest }) => rest) }}>替换</Button>
                      </>
                    ) : (
                      <>
                        <Button size="small" component="label" startIcon={<Upload fontSize="small" />} disabled={Boolean(uploading) || saving}>
                          选择文件
                          <input type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file, field); event.target.value = '' }} />
                        </Button>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>单文件，最大 20 MB</Typography>
                      </>
                    )}
                  </Stack>
                ) : (
                  <TextField fullWidth label={label} value={value ?? ''} onChange={(event) => setData({ ...data, [field.key]: event.target.value })} />
                )}
              </Box>
            )
          })}
          {conflict ? (
            <Alert severity="warning" sx={{ mb: 1.5 }} action={
              <Stack direction="row" spacing={0.5}>
                <Button size="small" onClick={() => void reloadLatest()}>换成最新的</Button>
                <Button size="small" color="warning" onClick={() => void save(true)}>按我填的保存</Button>
              </Stack>
            }>此行已在别处更新，当前内容保留。</Alert>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" disabled={saving || Boolean(uploading)} onClick={onClose}>取消</Button>
          <Button size="small" variant="contained" disabled={saving || Boolean(uploading)} onClick={() => void save()}>{uploading ? '附件上传中…' : '保存'}</Button>
        </Stack>
      </Box>
      <AttachmentPreview open={Boolean(preview)} file={preview} onClose={() => setPreview(null)} />
    </Drawer>
  )
}
