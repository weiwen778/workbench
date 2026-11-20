import { useRef, useState } from 'react'
import { Checkbox, MenuItem, Select, TextField } from '@mui/material'
import type { Field } from '@/table-core'

/**
 * 单元格编辑器。编辑值保存在组件内部，避免每次按键都把父级 TableView
 * 重新渲染一遍；提交/取消由父级决定何时关闭编辑器。
 */
export default function TableCellEditor({
  field, initialValue, disabled, onSave, onCancel,
}: {
  field: Field
  initialValue: any
  disabled: boolean
  onSave: (value: any) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState<any>(initialValue)
  const cancelled = useRef(false)

  if (field.type === 'checkbox') {
    return (
      <Checkbox
        size="small"
        checked={Boolean(initialValue)}
        disabled={disabled}
        onChange={(event) => onSave(event.target.checked)}
        sx={{ p: 0.25 }}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <Select
        autoFocus
        size="small"
        value={initialValue ?? ''}
        disabled={disabled}
        onChange={(event) => onSave(event.target.value)}
        sx={{ minWidth: 110, height: 30 }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onCancel()
        }}
      >
        <MenuItem value="">—</MenuItem>
        {(field.options || []).map((option) => <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>)}
      </Select>
    )
  }

  const commit = () => {
    if (cancelled.current) return
    onSave(value === '' ? null : value)
  }

  return (
    <TextField
      autoFocus
      fullWidth
      size="small"
      disabled={disabled}
      type={field.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      placeholder={field.type === 'date' ? 'YYYY-MM-DD' : ''}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLElement).blur() }
        if (event.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
      inputProps={{ inputMode: field.type === 'number' ? 'decimal' : undefined }}
      sx={{ height: '100%', minHeight: 0, '& .MuiInputBase-root': { height: '100%', minHeight: 0, fontSize: 13 }, '& .MuiInputBase-input': { paddingTop: 0, paddingBottom: 0, height: '100%', boxSizing: 'border-box' } }}
    />
  )
}
