type CellKey = { rowId: number; key: string }

let editing: CellKey | null = null
let saving = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeTableCellEdit(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 0 = 非编辑中，1 = 编辑中，2 = 正在保存。 */
export function tableCellEditState(rowId: number, key: string): 0 | 1 | 2 {
  if (!editing || editing.rowId !== rowId || editing.key !== key) return 0
  return saving ? 2 : 1
}

export function startTableCellEdit(rowId: number, key: string) {
  if (saving) return
  editing = { rowId, key }
  saving = false
  emit()
}

export function stopTableCellEdit() {
  if (!editing && !saving) return
  editing = null
  saving = false
  emit()
}

export function setTableCellSaving(next: boolean) {
  if (saving === next) return
  saving = next
  emit()
}
