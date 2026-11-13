import { useEffect, useRef, useState } from 'react'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Drawer,
  FormControlLabel, IconButton, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import { Delete, Plus } from '@/icons'
import { apiError, http } from '@/api/client'
import { confirmDialog, toast } from '@/ui/feedback'
import { DataTable, FieldRow, SectionTitle } from '@/ui/common'

const fieldTypes = [
  { label: '短文本', value: 'short_text' }, { label: '长文本', value: 'long_text' },
  { label: '数字', value: 'number' }, { label: '日期', value: 'date' },
  { label: '单选', value: 'select' }, { label: '多选', value: 'multiselect' },
  { label: '勾选', value: 'checkbox' }, { label: '链接', value: 'url' }, { label: '附件', value: 'attachment' },
  { label: '公式', value: 'formula' },
]

export default function FieldManager({ open, tableId, fields, onClose, onUpdated }: {
  open: boolean
  tableId: number
  fields: any[]
  onClose: () => void
  onUpdated: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<{ name: string; type: string; required: boolean; default_value: any; options: { id: string; name: string }[]; expression: string }>({
    name: '', type: 'short_text', required: false, default_value: '', options: [], expression: '',
  })
  const formulaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (!open) setDialogOpen(false) }, [open])

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', type: 'short_text', required: false, default_value: '', options: [], expression: '' })
    setDialogOpen(true)
  }
  const openEdit = (row: any) => {
    setEditing(row)
    setForm({ name: row.name, type: row.type, required: Boolean(row.required), default_value: row.default_value ?? '', options: (row.options || []).map((option: any) => ({ id: option.id, name: option.name })), expression: row.config?.expression || '' })
    setDialogOpen(true)
  }

  const formulaPresets = () => {
    const usable = fields.filter((field) => field.key !== editing?.key)
    const numeric = usable.filter((field) => ['number', 'formula', 'rollup'].includes(field.type)).map((field) => field.name)
    const text = usable.filter((field) => ['short_text', 'long_text', 'select', 'multiselect'].includes(field.type)).map((field) => field.name)
    const dates = usable.filter((field) => field.type === 'date').map((field) => field.name)
    const presets: { label: string; expression: string }[] = []
    if (numeric.length >= 2) {
      const [a, b] = numeric
      presets.push(
        { label: '金额：相乘', expression: `ROUND({${a}} * {${b}}, 2)` },
        { label: '毛利额：相减', expression: `ROUND({${a}} - {${b}}, 2)` },
        { label: '毛利率 %', expression: `IF({${a}} = 0, 0, ROUND(({${a}} - {${b}}) / {${a}} * 100, 2))` },
      )
    }
    if (numeric.length >= 1) {
      const a = numeric[0]
      presets.push(
        { label: '空值补零', expression: `COALESCE({${a}}, 0)` },
        { label: '条件判断', expression: `IF({${a}} >= 100, "大单", "普通")` },
      )
    }
    if (dates.length >= 2) {
      const [start, end] = dates
      presets.push({ label: '日期差：天数', expression: `DATE_DIFF({${end}}, {${start}})` })
    }
    if (text.length >= 2) {
      const [a, b] = text
      presets.push({ label: '文字拼接', expression: `CONCAT({${a}}, {${b}})` })
    }
    return presets
  }

  const insertField = (name: string) => {
    const token = `{${name}}`
    const element = formulaRef.current
    const start = element?.selectionStart ?? form.expression.length
    const end = element?.selectionEnd ?? start
    const expression = form.expression.slice(0, start) + token + form.expression.slice(end)
    setForm({ ...form, expression })
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const save = async () => {
    if (!form.name.trim()) { toast.warning('请填写列名称'); return }
    const isFormula = form.type === 'formula'
    if (isFormula && !form.expression.trim()) { toast.warning('请填写公式'); return }
    setSaving(true)
    try {
      const options = ['select', 'multiselect'].includes(form.type)
        ? form.options.filter((option) => option.name.trim()).map((option, index) => ({ id: option.id || `opt_${Date.now()}_${index}`, name: option.name.trim() }))
        : null
      const config = isFormula ? { expression: form.expression.trim() } : undefined
      if (editing) {
        await http.patch(`/fields/${editing.id}`, {
          name: form.name.trim(), required: isFormula ? false : form.required,
          options: options ?? undefined, config,
        })
      } else {
        await http.post(`/tables/${tableId}/fields`, {
          name: form.name.trim(), type: form.type, required: isFormula ? false : form.required,
          default_value: isFormula ? null : form.default_value === '' ? null : form.default_value, options, config,
        })
      }
      setDialogOpen(false); toast.success('已保存'); onUpdated()
    } catch (error: any) {
      const details = error?.response?.data?.details
      if (details?.empty_count) toast.error(`有 ${details.empty_count} 行的这一列还是空的，请先补上再设为必填`)
      else if (details?.used) toast.error(`有 ${details.used} 行还在用要删掉的选项，请先改掉这些行`)
      else toast.error(apiError(error).message)
    } finally { setSaving(false) }
  }

  const removeField = async (row: any) => {
    try {
      await http.delete(`/fields/${row.id}`)
      toast.success('列已删除'); onUpdated()
    } catch (error: any) {
      const body = error?.response?.data
      if (body?.code === 'DELETE_CONFIRM_REQUIRED') {
        const ok = await confirmDialog({
          title: '确认删除列', danger: true, confirmText: '仍要删除',
          message: `这一列在 ${body.details.active} 行内容和回收站的 ${body.details.trashed} 行里有值。删除后这些值不再显示，该列不进回收站。`,
        })
        if (!ok) return
        try { await http.delete(`/fields/${row.id}`, { params: { confirm: true } }); toast.success('列已删除'); onUpdated() }
        catch (inner) { toast.error(apiError(inner).message) }
        return
      }
      toast.error(apiError(error).message)
    }
  }

  const move = async (index: number, offset: number) => {
    const target = index + offset
    if (target < 0 || target >= fields.length) return
    const current = fields[index], other = fields[target]
    try {
      await http.patch(`/fields/${current.id}`, { sort_order: other.sort_order })
      await http.patch(`/fields/${other.id}`, { sort_order: current.sort_order })
      onUpdated()
    } catch (error) { toast.error(apiError(error).message) }
  }

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 580 }, p: 2.5 } } }}>
        <SectionTitle>列设置</SectionTitle>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <Button size="small" variant="contained" startIcon={<Plus fontSize="small" />} disabled={fields.length >= 200} onClick={openAdd}>添加一列</Button>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {fields.length} / 200 列</Typography>
        </Stack>
        <DataTable
          rows={fields}
          maxHeight="calc(100vh - 180px)"
          columns={[
            { key: 'name', label: '列', width: 150, ellipsis: true },
            { key: 'type', label: '类型', width: 90, render: (row) => fieldTypes.find((type) => type.value === row.type)?.label || row.type },
            { key: 'required', label: '必填', width: 60, align: 'center', render: (row) => row.required ? '✓' : '—' },
            {
              key: 'actions', label: '操作', width: 210,
              render: (row, index) => (
                <Stack direction="row" spacing={0.2} flexWrap="nowrap">
                  <Button size="small" sx={{ px: 0.75 }} onClick={() => openEdit(row)}>编辑</Button>
                  <Button size="small" sx={{ px: 0.75 }} disabled={index === 0} onClick={() => void move(index, -1)}>上移</Button>
                  <Button size="small" sx={{ px: 0.75 }} disabled={index === fields.length - 1} onClick={() => void move(index, 1)}>下移</Button>
                  <Button size="small" sx={{ px: 0.75 }} color="error" onClick={() => void removeField(row)}>删除</Button>
                </Stack>
              ),
            },
          ]}
        />
      </Drawer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth={form.type === 'formula' ? 'sm' : 'xs'} fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>{editing ? '编辑列' : '添加一列'}</DialogTitle>
        <DialogContent>
          <FieldRow label="列名称" required><TextField fullWidth autoFocus value={form.name} inputProps={{ maxLength: 50 }} onChange={(event) => setForm({ ...form, name: event.target.value })} /></FieldRow>
          <FieldRow label="类型" hint={editing ? '已有内容的列不可换类型；请新建列后迁移' : undefined}>
            <Select fullWidth disabled={Boolean(editing)} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {fieldTypes.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
            </Select>
          </FieldRow>
          {form.type !== 'formula' ? <FormControlLabel control={<Checkbox checked={form.required} onChange={(event) => setForm({ ...form, required: event.target.checked })} />} label="必填" /> : null}
          {form.type === 'formula' ? (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>常用公式</Typography>
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mb: 1.25 }}>
                {formulaPresets().map((preset) => (
                  <Button key={preset.label} size="small" variant="outlined" sx={{ fontSize: 11.5 }} onClick={() => setForm({ ...form, expression: preset.expression })}>{preset.label}</Button>
                ))}
                {!formulaPresets().length ? <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>先添加数字、日期或文本列，也可以直接输入公式。</Typography> : null}
              </Stack>
              <TextField
                fullWidth multiline minRows={3} inputRef={formulaRef} label="公式" value={form.expression}
                placeholder="例如：ROUND({数量} * {单价}, 2)"
                onChange={(event) => setForm({ ...form, expression: event.target.value })}
                inputProps={{ maxLength: 1000 }}
              />
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.75, lineHeight: 1.7 }}>
                用 <code>{'{列名}'}</code> 引用列。支持 + - * /、比较、IF、ROUND、ABS、LEN、CONCAT、COALESCE、DATE_DIFF；计算列只读，结果随原列自动更新。
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.25, mb: 0.5 }}>插入列</Typography>
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ maxHeight: 96, overflowY: 'auto' }}>
                {fields.filter((field) => field.key !== editing?.key && field.type !== 'attachment').map((field) => (
                  <Button key={field.key} size="small" variant="text" sx={{ fontSize: 11.5 }} onClick={() => insertField(field.name)}>{field.name}</Button>
                ))}
              </Stack>
            </Box>
          ) : null}
          {['select', 'multiselect'].includes(form.type) ? (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>选项</Typography>
              {form.options.map((option, index) => (
                <Stack key={index} direction="row" spacing={1} sx={{ mb: 0.75 }}>
                  <TextField fullWidth size="small" value={option.name} placeholder="选项名称" inputProps={{ maxLength: 40 }} onChange={(event) => setForm({ ...form, options: form.options.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                  <IconButton size="small" onClick={() => setForm({ ...form, options: form.options.filter((_, itemIndex) => itemIndex !== index) })}><Delete fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<Plus fontSize="small" />} onClick={() => setForm({ ...form, options: [...form.options, { id: '', name: '' }] })}>添加选项</Button>
            </Box>
          ) : null}
          {!editing && form.type !== 'formula' ? (
            <FieldRow label="默认值（表格里已经有内容时，新增必填列要填默认值）">
              {['select', 'multiselect'].includes(form.type) ? (
                <Select fullWidth displayEmpty value={form.default_value ?? ''} onChange={(event) => setForm({ ...form, default_value: event.target.value })}>
                  <MenuItem value="">—</MenuItem>
                  {form.options.filter((option) => option.name).map((option) => <MenuItem key={option.name} value={option.id || option.name}>{option.name}</MenuItem>)}
                </Select>
              ) : form.type === 'checkbox' ? (
                <Checkbox checked={Boolean(form.default_value)} onChange={(event) => setForm({ ...form, default_value: event.target.checked })} />
              ) : (
                <TextField fullWidth value={form.default_value ?? ''} placeholder="可不填" onChange={(event) => setForm({ ...form, default_value: event.target.value })} />
              )}
            </FieldRow>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setDialogOpen(false)}>取消</Button>
          <Button size="small" variant="contained" disabled={saving} onClick={save}>保存</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
