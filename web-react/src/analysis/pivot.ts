import { aggregate, display, type Field, type Row } from '@/table-core'

/**
 * Pure grouping/pivot computation shared by the analysis worker and its
 * synchronous fallback. Keeping it free of React and DOM makes it testable and
 * safe to run inside a worker.
 */
export interface AnalysisInput {
  kind: 'summary' | 'pivot'
  rows: Row[]
  fields: Field[]
  references: Record<string, { id: number; label: string }[]>
  group: string
  column: string
  value: string
  operation: string
}

export interface AnalysisOutput {
  headers: string[]
  data: Record<string, string | number>[]
  total: number
}

const EMPTY: AnalysisOutput = { headers: [], data: [], total: 0 }

export function computeAnalysis(input: AnalysisInput): AnalysisOutput {
  const { rows, fields, references, group, column, value, operation, kind } = input
  if (!group) return { ...EMPTY, total: rows.length }
  const groupField = fields.find((field) => field.key === group)
  if (!groupField) return { ...EMPTY, total: rows.length }
  const columnField = fields.find((field) => field.key === column)
  const label = (row: Row, field?: Field) => field ? display(field, row.data[field.key], references) || '（空）' : '全部'
  const groupKeys = Array.from(new Set(rows.map((row) => label(row, groupField))))

  if (kind === 'summary') {
    const data = groupKeys.map((key) => {
      const subset = rows.filter((row) => label(row, groupField) === key)
      return { key, value: aggregate(subset, value, operation), count: subset.length }
    })
    return { headers: ['分组', '结果', '行数'], data, total: rows.length }
  }

  const columnKeys = columnField ? Array.from(new Set(rows.map((row) => label(row, columnField)))) : ['合计']
  const data = groupKeys.map((key) => {
    const resultRow: Record<string, string | number> = { key }
    for (const columnKey of columnKeys) {
      const subset = rows.filter((row) => label(row, groupField) === key && (!columnField || label(row, columnField) === columnKey))
      resultRow[columnKey] = aggregate(subset, value, operation)
    }
    return resultRow
  })
  return { headers: ['分组', ...columnKeys], data, total: rows.length }
}
