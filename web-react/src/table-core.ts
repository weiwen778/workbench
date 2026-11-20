import Decimal from 'decimal.js'

export type Field = { id: number; key: string; name: string; type: string; required?: boolean; options?: { id: string; name: string }[]; config?: Record<string, any> }
export type Row = { id: number; data: Record<string, any>; version: number; computed_errors?: Record<string, string>; created_at?: string; updated_at?: string }
export type Filter = { field: string; op: string; value: any }
export type NumberFormat = 'auto' | 'number' | 'money' | 'percent' | 'integer' | 'text'

export const computedTypes = new Set(['formula', 'lookup', 'rollup'])

const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const percentName = /(率|占比|百分比)/
const moneyName = /(净销售额|销售额|金额|毛利额|利润额|成本|费用|佣金|运费|推广费|收入|支出|客单价|单价|价格|价)/
const integerName = /(数量|件数|人数|次数|天数|库存|单数|条数|笔数)/
const derivedName = /(净销售额|净额|毛利额|毛利率|利润|利润率|投产比|转化率|客单价|占比|环比|同比|差额)/

export function isNumericValue(value: any): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && numericPattern.test(value.trim())
}

/** 列名像派生值（净额、利润、率、比等），却是普通数字列时，需要提示它不会自动重算。 */
export function isLikelyStaticDerived(field: Field): boolean {
  return field.type === 'number' && derivedName.test(field.name)
}

export function resolveNumberFormat(field: Field): NumberFormat {
  const explicit = field.config?.format
  if (explicit === 'text' || explicit === 'number' || explicit === 'money' || explicit === 'percent' || explicit === 'integer') return explicit
  if (!['number', ...computedTypes].includes(field.type)) return 'text'
  if (percentName.test(field.name)) return 'percent'
  if (integerName.test(field.name)) return 'integer'
  if (moneyName.test(field.name)) return 'money'
  return 'number'
}

/** 数字列右对齐，文本列左对齐。公式列可能返回文本，但绝大多数场景仍是数字。 */
export function valueAlign(field: Field): 'left' | 'right' {
  return ['number', ...computedTypes].includes(field.type) ? 'right' : 'left'
}

function groupInteger(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function decimalText(raw: string, digits: number, fixed: boolean): string {
  try {
    const value = new Decimal(raw).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP)
    if (!value.isFinite()) return raw
    let text = value.toFixed(digits)
    if (!fixed && digits > 0) text = text.replace(/0+$/, '').replace(/\.$/, '')
    const negative = text.startsWith('-')
    if (negative) text = text.slice(1)
    const [integer, fraction] = text.split('.')
    return `${negative ? '-' : ''}${groupInteger(integer)}${fraction ? `.${fraction}` : ''}`
  } catch {
    return raw
  }
}

export function formatNumeric(value: any, format: NumberFormat): string {
  const raw = String(value).trim()
  if (!numericPattern.test(raw)) return String(value)
  if (format === 'percent') return `${decimalText(raw, 2, false)}%`
  if (format === 'money') return decimalText(raw, 2, true)
  if (format === 'integer') return decimalText(raw, 0, false)
  if (format === 'text') return raw
  return decimalText(raw, 2, false)
}

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
  const format = resolveNumberFormat(field)
  if (format !== 'text' && isNumericValue(value)) return formatNumeric(value, format)
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
