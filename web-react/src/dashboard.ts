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
  colors?: string[]
  progress?: ProgressConfig | null
}

export interface ProgressCondition {
  field: string
  op: 'eq' | 'ne' | 'contains' | 'empty' | 'not_empty' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string | boolean | number | null
}

export interface ProgressConfig {
  mode: 'tasks' | 'quantity'
  display: 'bar' | 'circle'
  completed: ProgressCondition | null
  actual_field: string | null
  target_mode: 'rows' | 'field' | 'fixed'
  target_field: string | null
  target_value: string
  filters: ProgressCondition[]
  due_field: string | null
}

export interface ProgressValue {
  actual: string
  target: string
  percentage: string | null
  remaining: string
  rows: number
  ignored_rows: number
  completed_rows: number
  overdue_rows: number
  state: string
  label?: string
  filter?: Record<string, unknown>
}

export interface DashboardBoard {
  id: number
  name: string
  version: number
  widgets: DashboardWidget[]
  updated_at: string
}

export interface DashboardPoint { label: string; value: string | null; rows: number }

export interface DashboardResult {
  id: string
  status: 'ok' | 'error'
  message?: string
  table_name?: string
  value?: string | null
  points?: DashboardPoint[]
  matched_rows?: number
  numeric_rows?: number
  ignored_rows?: number
  groups_total?: number
  date_filter_applied?: boolean
  date_filter_unavailable?: boolean
  series?: { field: string; name: string; points: DashboardPoint[]; ignored_rows?: number }[]
  progress?: ProgressValue
  progress_groups?: ProgressValue[]
  drilldown_filters?: Record<string, unknown>[]
  group_type?: string | null
}

export const chartLabels: Record<string, string> = {
  metric: '指标卡', bar: '柱状图', line: '折线图', pie: '饼图', progress: '任务进度',
}

/** 图表默认配色：独立于工作台主题色，改主题色不会改变图表默认外观。 */
export const CHART_COLORS = ['#448361', '#d9730d', '#9065b0', '#c14c8a', '#cb912f', '#9f6b53', '#787774', '#3f7f9e']
export const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value)

function hslToHex(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 360) + 360) % 360
  const s = Math.max(0, Math.min(100, saturation)) / 100
  const l = Math.max(0, Math.min(100, lightness)) / 100
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  const hex = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0')
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`.toUpperCase()
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(a: string, b: string) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * 生成一组彼此可区分、在当前明暗主题下可读的随机图表颜色。
 * 色相从随机起点按黄金角铺开，饱和度和明度只做小幅抖动，避免出现荧光色或看不清的灰。
 * 黄色/黄绿色在浅色背景上天然偏亮，会继续压低明度直到满足 3:1 的图形对比度。
 */
export function randomChartColors(count: number, mode: 'light' | 'dark' = 'light') {
  const total = Math.max(1, Math.min(30, Math.round(count) || 1))
  const start = Math.random() * 360
  const step = 137.508
  const baseSaturation = mode === 'dark' ? 55 : 52
  const baseLightness = mode === 'dark' ? 64 : 42
  const background = mode === 'dark' ? '#171F22' : '#FFFFFF'
  return Array.from({ length: total }, (_, index) => {
    const hue = start + index * step + (Math.random() * 10 - 5)
    const saturation = baseSaturation + (Math.random() * 10 - 5)
    let lightness = baseLightness + (Math.random() * 8 - 4)
    let color = hslToHex(hue, saturation, lightness)
    while (contrastRatio(color, background) < 3 && (mode === 'dark' ? lightness < 82 : lightness > 18)) {
      lightness += mode === 'dark' ? 2 : -2
      color = hslToHex(hue, saturation, lightness)
    }
    return color
  })
}

export const aggregationLabels: Record<string, string> = {
  count: '数一数有多少条记录', sum: '加起来（合计）', avg: '算平均值', min: '找最小值', max: '找最大值',
}

export function formatDashboardNumber(value: string | number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: decimals })
}
