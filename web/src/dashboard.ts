export interface DashboardWidget {
  id: string
  title: string
  kind: 'metric' | 'bar' | 'line' | 'pie'
  table_id: number
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  value_field: string | null
  group_field: string | null
  date_field: string | null
  date_bucket: 'day' | 'week' | 'month'
  sort: 'value_desc' | 'label_asc'
  limit: number
  decimals: number
  unit: string
  wide: boolean
}
export interface DashboardBoard { id: number; name: string; version: number; widgets: DashboardWidget[]; updated_at: string }
export interface DashboardPoint { label: string; value: string | null; rows: number }
export interface DashboardResult {
  id: string; status: 'ok' | 'error'; message?: string; table_name?: string
  value?: string | null; points?: DashboardPoint[]; matched_rows?: number; numeric_rows?: number
  ignored_rows?: number; groups_total?: number; date_filter_applied?: boolean; date_filter_unavailable?: boolean
  group_type?: string | null
}
export const chartLabels = { metric: '指标卡', bar: '柱状图', line: '折线图', pie: '饼图' }
export const aggregationLabels = { count: '记录数', sum: '求和', avg: '平均值', min: '最小值', max: '最大值' }
export function formatDashboardNumber(value: string | number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: decimals })
}
