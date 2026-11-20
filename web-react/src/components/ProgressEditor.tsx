import { Box, Button, IconButton, MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { Delete, Plus } from '@/icons'
import type { ProgressCondition, ProgressConfig } from '@/dashboard'

const operatorsFor = (type?: string) => {
  const base = [
    { label: '等于', value: 'eq' },
    { label: '为空', value: 'empty' },
    { label: '不为空', value: 'not_empty' },
  ]
  if (type === 'checkbox') return base
  base.splice(1, 0, { label: '不等于', value: 'ne' })
  if (['number', 'formula', 'rollup', 'date'].includes(type || '')) {
    base.splice(2, 0, { label: '大于／晚于', value: 'gt' }, { label: '大于等于／不早于', value: 'gte' }, { label: '小于／早于', value: 'lt' }, { label: '小于等于／不晚于', value: 'lte' })
  } else if (type !== 'select') {
    base.splice(2, 0, { label: '包含', value: 'contains' })
  }
  return base
}

export function ProgressConditionRow({ value, fields, label, onChange }: {
  value: ProgressCondition
  fields: any[]
  label: string
  onChange: (value: ProgressCondition) => void
}) {
  const field = fields.find((item) => item.key === value.field)
  const set = (key: string, next: any) => onChange({ ...value, [key]: next })
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(100px,1fr) minmax(95px,.8fr) minmax(100px,1fr)' }, gap: 1, width: '100%' }}>
      <Select size="small" displayEmpty value={value.field} onChange={(event) => {
        const key = event.target.value
        const next = fields.find((item) => item.key === key)
        onChange({ field: key, op: 'eq', value: next?.type === 'checkbox' ? true : '' })
      }} inputProps={{ 'aria-label': `${label}字段` }}>
        <MenuItem value="" disabled>选择字段</MenuItem>
        {fields.map((item) => <MenuItem key={item.key} value={item.key}>{item.name}</MenuItem>)}
      </Select>
      <Select size="small" value={value.op} onChange={(event) => set('op', event.target.value)} inputProps={{ 'aria-label': `${label}比较方式` }}>
        {operatorsFor(field?.type).map((op) => <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>)}
      </Select>
      {!['empty', 'not_empty'].includes(value.op) && value.field ? (
        field?.type === 'select' ? (
          <Select size="small" displayEmpty value={value.value ?? ''} onChange={(event) => set('value', event.target.value)} inputProps={{ 'aria-label': `${label}比较值` }}>
            <MenuItem value="" disabled>选择选项</MenuItem>
            {(field.options || []).map((option: any) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
          </Select>
        ) : field?.type === 'checkbox' ? (
          <Select size="small" value={String(value.value)} onChange={(event) => set('value', event.target.value === 'true')} inputProps={{ 'aria-label': `${label}比较值` }}>
            <MenuItem value="true">是（已勾选）</MenuItem>
            <MenuItem value="false">否（未勾选）</MenuItem>
          </Select>
        ) : (
          <TextField size="small" value={String(value.value ?? '')} placeholder={field?.type === 'date' ? 'YYYY-MM-DD' : '填写比较值'} onChange={(event) => set('value', event.target.value)} inputProps={{ 'aria-label': `${label}比较值` }} />
        )
      ) : <span />}
    </Box>
  )
}

export default function ProgressEditor({ value, fields, grouped, onChange }: {
  value: ProgressConfig
  fields: any[]
  grouped: boolean
  onChange: (value: ProgressConfig) => void
}) {
  const numeric = fields.filter((field) => ['number', 'formula', 'rollup'].includes(field.type))
  const dates = fields.filter((field) => field.type === 'date')
  const conditionFields = fields.filter((field) => ['short_text', 'long_text', 'number', 'formula', 'rollup', 'select', 'checkbox', 'date'].includes(field.type))
  const rank = (type: string) => type === 'checkbox' ? 0 : type === 'select' ? 1 : 2
  const currentCompletion = value.completed?.field ? fields.find((field) => field.key === value.completed?.field) : null
  const completionFields = fields
    .filter((field) => ['checkbox', 'select', 'short_text', 'long_text'].includes(field.type))
    .sort((a, b) => rank(a.type) - rank(b.type))
  if (currentCompletion && !completionFields.some((field) => field.key === currentCompletion.key)) completionFields.unshift(currentCompletion)
  const hasStatusField = fields.some((field) => ['checkbox', 'select'].includes(field.type))
  const completionIsText = ['short_text', 'long_text'].includes(currentCompletion?.type || '')
  const set = (patch: Partial<ProgressConfig>) => onChange({ ...value, ...patch })
  const addFilter = () => {
    if (value.filters.length >= 7) return
    const field = conditionFields[0]
    if (!field) return
    set({ filters: [...value.filters, { field: field.key, op: 'eq', value: field.type === 'checkbox' ? true : field.type === 'select' ? field.options?.[0]?.id || '' : '' }] })
  }
  return (
    <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1, mb: 2.5 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>进度怎么算？</Typography>
      <ToggleButtonGroup size="small" exclusive value={value.mode} onChange={(_, mode) => {
        if (!mode) return
        onChange({
          ...value, mode,
          target_mode: mode === 'tasks' ? 'rows' : 'field',
          due_field: mode === 'quantity' ? null : value.due_field,
          actual_field: mode === 'quantity' ? value.actual_field || numeric[0]?.key || null : value.actual_field,
          target_field: mode === 'quantity' ? value.target_field || numeric[1]?.key || numeric[0]?.key || null : value.target_field,
        })
      }} sx={{ mb: 1.5 }}>
        <ToggleButton value="tasks">按任务数量</ToggleButton>
        <ToggleButton value="quantity">按数值累计</ToggleButton>
      </ToggleButtonGroup>

      {value.mode === 'tasks' ? (
        <>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
            哪些记录算完成？<Box component="span" sx={{ color: 'error.main' }}> *</Box>
          </Typography>
          <ProgressConditionRow value={value.completed || { field: '', op: 'eq', value: null }} fields={completionFields} label="完成条件" onChange={(completed) => set({ completed })} />
          {!value.completed?.field ? <Typography sx={{ fontSize: 12, color: 'warning.main', mt: 0.75 }}>请选择完成条件后保存。</Typography> : null}
          {!hasStatusField ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>当前表格没有勾选或单选状态列；若无法补充状态列，建议改用「按数值累计」。</Typography> : null}
          {completionIsText ? <Typography sx={{ fontSize: 12, color: 'warning.main', mt: 0.75 }}>该列是文本列，请确认它的取值能可靠表示「完成」。</Typography> : null}
        </>
      ) : null}

      {value.mode === 'quantity' ? (
        <>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, mt: 1.5 }}>完成量用哪一列？</Typography>
          <Select fullWidth size="small" displayEmpty value={value.actual_field ?? ''} onChange={(event) => set({ actual_field: event.target.value })} inputProps={{ 'aria-label': '完成量列' }}>
            <MenuItem value="" disabled>例如：已完成数量</MenuItem>
            {numeric.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
          </Select>
        </>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>目标怎么算？</Typography>
          <Select fullWidth size="small" value={value.target_mode} onChange={(event) => set({ target_mode: event.target.value as any })} inputProps={{ 'aria-label': '目标计算方式' }}>
            {value.mode === 'tasks' ? <MenuItem value="rows">统计范围内的任务总数</MenuItem> : <MenuItem value="field">汇总目标数量列</MenuItem>}
            <MenuItem value="fixed">手动填写固定目标</MenuItem>
          </Select>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>展示样式</Typography>
          <ToggleButtonGroup size="small" exclusive value={value.display} onChange={(_, display) => display && set({ display })}>
            <ToggleButton value="bar">进度条</ToggleButton>
            <ToggleButton value="circle">圆环</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Stack>

      {value.target_mode === 'field' ? (
        <>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, mt: 1.5 }}>目标量用哪一列？</Typography>
          <Select fullWidth size="small" displayEmpty value={value.target_field ?? ''} onChange={(event) => set({ target_field: event.target.value })} inputProps={{ 'aria-label': '目标量列' }}>
            <MenuItem value="" disabled>选择数字列</MenuItem>
            {numeric.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
          </Select>
        </>
      ) : null}
      {value.target_mode === 'fixed' ? (
        <>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, mt: 1.5 }}>{grouped ? '每个分组的固定目标' : '固定目标'}</Typography>
          <TextField fullWidth size="small" value={value.target_value} placeholder="例如：100" inputProps={{ inputMode: 'decimal', 'aria-label': '固定目标' }} onChange={(event) => set({ target_value: event.target.value })} />
        </>
      ) : null}
      {value.mode === 'tasks' ? (
        <>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, mt: 1.5 }}>截止日期列（可选）</Typography>
          <Select fullWidth size="small" displayEmpty value={value.due_field ?? ''} onChange={(event) => set({ due_field: event.target.value || null })} inputProps={{ 'aria-label': '截止日期列' }}>
            <MenuItem value="">不用截止日期</MenuItem>
            {dates.map((field) => <MenuItem key={field.key} value={field.key}>{field.name}</MenuItem>)}
          </Select>
        </>
      ) : null}

      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5, lineHeight: 1.8 }}>
        {value.mode === 'tasks' ? '完成率 = 完成任务数 ÷ 目标任务数' : '完成率 = 完成量 ÷ 目标量；无效值不计入'}。
        {value.target_mode === 'fixed' && grouped ? '固定目标按分组合计。' : ''}目标为零时不计百分比。
      </Typography>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ borderTop: 1, borderColor: 'divider', pt: 1.25, mt: 1.25 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>统计哪些记录？</Typography>
        <Button size="small" startIcon={<Plus fontSize="small" />} disabled={value.filters.length >= 7 || !conditionFields.length} onClick={addFilter}>添加筛选</Button>
      </Stack>
      {!value.filters.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>统计全部有效记录。</Typography> : null}
      {value.filters.map((condition, index) => (
        <Stack key={index} direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
          <ProgressConditionRow
            value={condition} fields={conditionFields} label={`范围条件${index + 1}`}
            onChange={(next) => set({ filters: value.filters.map((item, itemIndex) => itemIndex === index ? next : item) })}
          />
          <IconButton size="small" aria-label={`删除范围条件${index + 1}`} onClick={() => set({ filters: value.filters.filter((_, itemIndex) => itemIndex !== index) })}><Delete fontSize="small" /></IconButton>
        </Stack>
      ))}
      {value.filters.length ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>条件需同时满足，最多 7 条。</Typography> : null}
    </Box>
  )
}
