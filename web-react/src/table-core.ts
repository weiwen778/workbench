import Decimal from 'decimal.js'

export type Field = { id: number; key: string; name: string; type: string; required?: boolean; options?: { id: string; name: string }[]; config?: Record<string, any> }
export type Row = { id: number; data: Record<string, any>; version: number; computed_errors?: Record<string, string>; created_at?: string; updated_at?: string }
export type Filter = { field: string; op: string; value: any }

export const computedTypes = new Set(['formula', 'lookup', 'rollup'])

export function display(field: Field, value: any, refs: Record<string, { id: number; label: string }[]> = {}): string {
  if (value === null || value === undefined) return ''
  if (field.type === 'reference') {
    const map = new Map((refs[field.key] || []).map((item) => [item.id, item.label]))
    return (Array.isArray(value) ? value : [value]).map((item) => map.get(item) || `#${item}`).join('、')
  }
  if (field.type === 'select' || field.type === 'multiselect') {
    const map = new Map((field.options || []).map((item) => [item.id, item.name]))
    return (Array.isArray(value) ? value : [value]).map((item) => map.get(item) || item).join('、')
  }
  if (field.type === 'checkbox') return value ? '是' : '否'
  if (Array.isArray(value)) return value.join('、')
  if (field.type === 'attachment') return `附件 #${value}`
  return String(value)
}

export function toTSV(rows: any[][]) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? '')
    return /[\t\n\r"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
  }).join('\t')).join('\n')
}

export function csvCell(value: any): string {
  const raw = String(value ?? '')
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())
  const safe = /^\s*[=+@-]/.test(raw) && !numeric ? "'" + raw : raw
  return '"' + safe.replace(/"/g, '""') + '"'
}

export function aggregate(rows: Row[], key: string, operation: string): string {
  if (operation === 'count') return String(rows.length)
  const values: Decimal[] = []
  for (const row of rows) {
    const value = row.data[key]
    if (value == null || value === '') continue
    try { const number = new Decimal(value); if (number.isFinite()) values.push(number) } catch { /* ignore */ }
  }
  if (!values.length) return '—'
  const sum = values.reduce((a, b) => a.add(b), new Decimal(0))
  let result: Decimal
  if (operation === 'sum') result = sum
  else if (operation === 'avg') result = sum.div(values.length)
  else {
    // Loop instead of spreading: large groups would otherwise exceed the
    // engine's argument limit and fail inside the worker.
    result = values[0]
    for (let index = 1; index < values.length; index += 1) {
      result = operation === 'min' ? Decimal.min(result, values[index]) : Decimal.max(result, values[index])
    }
  }
  return result.toDecimalPlaces(6).toFixed()
}
