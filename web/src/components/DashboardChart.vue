<template>
  <div ref="root" class="dashboard-chart">
    <div v-if="result.status === 'error'" class="chart-empty error" role="alert">{{ result.message }}</div>
    <template v-else-if="widget.kind === 'metric'">
      <div class="metric-value"><strong>{{ format(result.value) }}</strong><span>{{ widget.unit }}</span></div>
      <div class="metric-caption">{{ aggregationLabels[widget.aggregation] }} · {{ result.matched_rows ?? 0 }} 条记录</div>
    </template>
    <div v-else-if="!points.length" class="chart-empty">暂无可统计的数据</div>
    <div v-else-if="widget.kind === 'pie' && points.some(p => p.number < 0)" class="chart-empty error">饼图不支持负数，请改用柱状图或折线图</div>
    <div v-else-if="widget.kind === 'pie' && pieTotal === 0" class="chart-empty">当前合计为 0，无法计算占比</div>
    <div v-else-if="widget.kind === 'pie'" class="pie-layout">
      <svg class="pie" viewBox="0 0 240 240" role="img" :aria-label="widget.title">
        <circle cx="120" cy="120" r="76" fill="none" stroke="var(--wb-border)" stroke-width="38" />
        <circle v-for="(point, i) in piePoints" :key="i" cx="120" cy="120" r="76" fill="none"
          :stroke="colors[i % colors.length]" stroke-width="38" :stroke-dasharray="`${point.length} ${circumference - point.length}`"
          :stroke-dashoffset="-point.offset" transform="rotate(-90 120 120)" tabindex="0"
          :aria-label="`${point.label}：${format(point.number)}${widget.unit}，${point.percent}%`">
          <title>{{ point.label }}：{{ format(point.number) }}{{ widget.unit }}（{{ point.percent }}%）</title>
        </circle>
        <text x="120" y="116" text-anchor="middle" class="pie-center">{{ format(pieTotal) }}</text>
        <text x="120" y="140" text-anchor="middle" class="axis-text">合计{{ widget.unit ? `（${widget.unit}）` : '' }}</text>
      </svg>
      <ul class="pie-legend">
        <li v-for="(point, i) in piePoints" :key="i" :title="point.label">
          <i :style="{ background: colors[i % colors.length] }" /><span class="legend-label">{{ point.label }}</span>
          <span>{{ point.percent }}%</span>
        </li>
      </ul>
    </div>
    <svg v-else :viewBox="`0 0 ${width} 280`" class="cartesian" role="img" :aria-label="widget.title">
      <g v-for="tick in ticks" :key="tick.value">
        <line :x1="left" :x2="width - right" :y1="tick.y" :y2="tick.y" stroke="var(--wb-border)" stroke-dasharray="3 4" />
        <text :x="left - 8" :y="tick.y + 4" text-anchor="end" class="axis-text">{{ compact(tick.value) }}</text>
      </g>
      <line :x1="left" :x2="width - right" :y1="y(0)" :y2="y(0)" stroke="var(--wb-text-tertiary)" />
      <template v-if="widget.kind === 'bar'">
        <rect v-for="(point, i) in points" :key="i" :x="x(i) - barWidth / 2" :y="Math.min(y(point.number), y(0))"
          :width="barWidth" :height="Math.max(1, Math.abs(y(point.number) - y(0)))" rx="3" tabindex="0"
          :fill="point.number < 0 ? 'var(--el-color-danger)' : 'var(--wb-primary)'"
          :aria-label="`${point.label}：${format(point.number)}${widget.unit}`">
          <title>{{ point.label }}：{{ format(point.number) }}{{ widget.unit }}</title>
        </rect>
      </template>
      <template v-else>
        <polyline :points="linePoints" fill="none" stroke="var(--wb-primary)" stroke-width="2.5" stroke-linejoin="round" />
        <circle v-for="(point, i) in points" :key="i" :cx="x(i)" :cy="y(point.number)" r="4" fill="var(--wb-primary)" tabindex="0"
          :aria-label="`${point.label}：${format(point.number)}${widget.unit}`">
          <title>{{ point.label }}：{{ format(point.number) }}{{ widget.unit }}</title>
        </circle>
      </template>
      <g v-for="(point, i) in points" :key="`label-${i}`">
        <text v-if="i % labelStep === 0 || i === points.length - 1" :x="x(i)" y="255" text-anchor="middle" class="axis-text">
          {{ shortLabel(point.label) }}<title>{{ point.label }}</title>
        </text>
      </g>
    </svg>
    <details v-if="widget.kind !== 'metric' && points.length" class="chart-values">
      <summary>查看数值</summary>
      <table><thead><tr><th>分组</th><th>{{ aggregationLabels[widget.aggregation] }}{{ widget.unit ? `（${widget.unit}）` : '' }}</th></tr></thead>
        <tbody><tr v-for="(point, i) in points" :key="i"><td>{{ point.label }}</td><td>{{ format(point.number) }}</td></tr></tbody>
      </table>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { aggregationLabels, formatDashboardNumber, type DashboardWidget, type DashboardResult } from '@/dashboard'
const props = defineProps<{ widget: DashboardWidget; result: DashboardResult }>()
const root = ref<HTMLElement>()
const width = ref(600)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(entries => { width.value = Math.max(260, entries[0].contentRect.width) })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
const points = computed(() => (props.result.points || []).filter(p => p.value !== null && Number.isFinite(Number(p.value))).map(p => ({ ...p, number: Number(p.value) })))
const colors = ['#39776f', '#5a8ec9', '#d6a04e', '#8a70b3', '#d17786', '#55a79f', '#9baf6c', '#8492a6']
const circumference = 2 * Math.PI * 76
const pieTotal = computed(() => points.value.reduce((total, p) => total + p.number, 0))
const piePoints = computed(() => {
  let offset = 0
  return points.value.map(p => {
    const length = pieTotal.value > 0 ? p.number / pieTotal.value * circumference : 0
    const result = { ...p, length, offset, percent: pieTotal.value > 0 ? (100 * p.number / pieTotal.value).toFixed(1) : '0.0' }
    offset += length
    return result
  })
})
const left = 58, right = 18, top = 16, plotHeight = 216
const minimum = computed(() => Math.min(0, ...points.value.map(p => p.number)))
const maximum = computed(() => Math.max(0, ...points.value.map(p => p.number)) || (minimum.value === 0 ? 1 : 0))
const span = computed(() => maximum.value - minimum.value || 1)
const y = (value: number) => top + (maximum.value - value) / span.value * plotHeight
const x = (i: number) => left + (i + 0.5) / Math.max(1, points.value.length) * (width.value - left - right)
const barWidth = computed(() => Math.max(3, Math.min(50, (width.value - left - right) / Math.max(1, points.value.length) * 0.64)))
const ticks = computed(() => Array.from({ length: 5 }, (_, i) => { const value = minimum.value + span.value * i / 4; return { value, y: y(value) } }))
const linePoints = computed(() => points.value.map((p, i) => `${x(i)},${y(p.number)}`).join(' '))
const labelStep = computed(() => Math.max(1, Math.ceil(points.value.length / Math.max(2, Math.floor(width.value / 80)))))
const format = (value: string | number | null | undefined) => formatDashboardNumber(value, props.widget.decimals)
const compact = (value: number) => Math.abs(value) >= 1e8 ? `${formatDashboardNumber(value / 1e8, 1)}亿` : Math.abs(value) >= 1e4 ? `${formatDashboardNumber(value / 1e4, 1)}万` : formatDashboardNumber(value, 1)
const shortLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(2) : Array.from(value).length > 8 ? Array.from(value).slice(0, 7).join('') + '…' : value
</script>

<style scoped>
.dashboard-chart { width: 100%; min-width: 0; }
.metric-value { display: flex; align-items: baseline; gap: 8px; padding-top: 14px; overflow-wrap: anywhere; }
.metric-value strong { font-size: clamp(28px, 3vw, 40px); line-height: 1.3; font-weight: 600; font-variant-numeric: tabular-nums; }
.metric-value span, .metric-caption { color: var(--wb-text-secondary); font-size: 12px; }
.metric-caption { margin-top: 10px; }
.chart-empty { min-height: 130px; display: grid; place-items: center; color: var(--wb-text-tertiary); padding: 20px; text-align: center; font-size: 13px; }
.error { color: var(--el-color-danger); }
.cartesian { width: 100%; display: block; }
.axis-text { fill: var(--wb-text-tertiary); font-size: 11px; }
.pie-layout { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; }
.pie { width: 230px; max-width: 100%; flex: 0 1 230px; }
.pie-center { fill: var(--wb-text); font-size: 20px; font-weight: 600; }
.pie-legend { padding: 0; margin: 0; list-style: none; flex: 1 1 150px; max-height: 220px; overflow-y: auto; }
.pie-legend li { display: flex; align-items: center; gap: 7px; font-size: 12px; padding: 5px 0; }
.pie-legend i { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
.legend-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.chart-values { font-size: 12px; margin-top: 5px; color: var(--wb-text-secondary); }
.chart-values summary { cursor: pointer; }
.chart-values table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.chart-values td, .chart-values th { border-bottom: 1px solid var(--wb-border); text-align: left; padding: 6px; overflow-wrap: anywhere; }
.chart-values td:last-child, .chart-values th:last-child { text-align: right; }
svg [tabindex]:hover, svg [tabindex]:focus { opacity: .7; outline: none; }
</style>
