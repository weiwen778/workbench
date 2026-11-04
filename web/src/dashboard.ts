export interface DashboardWidget {
  id: string
  title: string
  kind: 'metric' | 'bar' | 'line' | 'pie' | 'progress'
  table_id: number
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  value_fields?: string[]
  value_field: string | null
  group_field: string | null
  date_field: string | null
  date_bucket: 'day' | 'week' | 'month'
  sort: 'value_desc' | 'label_asc'
  limit: number
  decimals: number
  unit: string
  wide: boolean
  progress?: ProgressConfig | null
}
export interface ProgressCondition { field:string; op:'eq'|'ne'|'contains'|'empty'|'not_empty'|'gt'|'gte'|'lt'|'lte'; value:string|boolean|number|null }
export interface ProgressConfig { mode:'tasks'|'quantity'; display:'bar'|'circle'; completed:ProgressCondition|null; actual_field:string|null; target_mode:'rows'|'field'|'fixed'; target_field:string|null; target_value:string; filters:ProgressCondition[]; due_field:string|null }
export interface ProgressValue { actual:string; target:string; percentage:string|null; remaining:string; rows:number; ignored_rows:number; completed_rows:number; overdue_rows:number; state:string;label?:string;filter?:Record<string,unknown> }
export interface DashboardBoard { id: number; name: string; version: number; widgets: DashboardWidget[]; updated_at: string }
export interface DashboardPoint { label: string; value: string | null; rows: number }
export interface DashboardResult {
  id: string; status: 'ok' | 'error'; message?: string; table_name?: string
  value?: string | null; points?: DashboardPoint[]; matched_rows?: number; numeric_rows?: number
  ignored_rows?: number; groups_total?: number; date_filter_applied?: boolean; date_filter_unavailable?: boolean
  series?: { field: string; name: string; points: DashboardPoint[]; ignored_rows?: number }[]
  progress?:ProgressValue; progress_groups?:ProgressValue[]; drilldown_filters?:Record<string,unknown>[]
  group_type?: string | null
}
export const chartLabels = { metric: '指标卡', bar: '柱状图', line: '折线图', pie: '饼图', progress:'任务进度' }
export const aggregationLabels = { count: '数一数有多少条记录', sum: '加起来（合计）', avg: '算平均值', min: '找最小值', max: '找最大值' }
export function formatDashboardNumber(value: string | number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: decimals })
}
