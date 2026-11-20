import { useSyncExternalStore } from 'react'
import { Link } from '@mui/material'
import { Check } from '@/icons'
import { display, type Field } from '@/table-core'
import TableCellEditor from '@/components/TableCellEditor'
import {
  startTableCellEdit, stopTableCellEdit, subscribeTableCellEdit, tableCellEditState,
} from '@/components/table-edit-store'

const nonEditableTypes = new Set(['attachment', 'multiselect', 'reference', 'formula', 'lookup', 'rollup'])

/**
 * 单个单元格。编辑状态从模块级 store 订阅，双击时只有当前单元格重渲染，
 * 不会让 TableView 重建 columns 或重渲染整页。
 */
export default function TableCell({
  field, row, onSave, onOpenAttachment,
}: {
  field: Field
  row: any
  onSave: (row: any, field: Field, value: any) => void
  onOpenAttachment: (id: number) => void
}) {
  const editState = useSyncExternalStore(
    subscribeTableCellEdit,
    () => tableCellEditState(row.id, field.key),
  )
  const value = row.data[field.key]

  if (editState) {
    return (
      <TableCellEditor
        field={field}
        initialValue={value ?? (field.type === 'checkbox' ? false : '')}
        disabled={editState === 2}
        onSave={(next) => onSave(row, field, next)}
        onCancel={stopTableCellEdit}
      />
    )
  }

  if (field.type === 'attachment' && value) {
    return <Link component="button" onClick={(event) => { event.stopPropagation(); onOpenAttachment(value) }} underline="none">查看附件</Link>
  }
  if (field.type === 'url' && value) {
    return <Link href={value} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{value}</Link>
  }

  const content = field.type === 'checkbox'
    ? (value ? <Check sx={{ fontSize: 16, color: 'primary.main' }} /> : '否')
    : display(field, value)
  return (
    <span
      className="wb-table-cell-text"
      title={typeof content === 'string' && content ? `${content}（双击编辑）` : '双击编辑'}
      style={nonEditableTypes.has(field.type) ? { cursor: 'default' } : undefined}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (!nonEditableTypes.has(field.type)) startTableCellEdit(row.id, field.key)
      }}
    >
      {content}
    </span>
  )
}
