<template>
  <div class="dashboard-chart">
    <div v-if="result.status === 'error'" class="chart-empty error" role="alert">{{ result.message }}</div>
    <template v-else-if="widget.kind === 'metric'">
      <div class="metric-value"><strong>{{ format(result.value) }}</strong><span>{{ widget.unit }}</span></div>
      <div class="metric-caption">{{ aggregationLabels[widget.aggregation] }} · {{ result.matched_rows ?? 0 }} 条记录</div>
    </template>
    <div v-else-if="!hasData" class="chart-empty">暂无可统计的数据</div>
    <div v-else-if="widget.kind === 'pie' && numbers.some(value => value < 0)" class="chart-empty error">饼图不支持负数，请改用柱状图或折线图</div>
    <div v-else-if="widget.kind === 'pie' && pieTotal === 0" class="chart-empty">当前合计为 0，无法计算占比</div>
    <template v-else>
      <VChart class="echarts-chart" :option="option" :theme="session.theme === 'dark' ? 'dark' : undefined" :init-options="{renderer:'canvas'}" autoresize :aria-label="widget.title" />
      <details class="chart-values">
        <summary>查看具体数值</summary>
        <table><thead><tr><th>日期／分类</th><th v-for="(series, si) in seriesData" :key="si">{{ series.name }}{{ widget.unit ? `（${widget.unit}）` : '' }}</th></tr></thead>
          <tbody><tr v-for="(label, i) in labels" :key="i"><td>{{ label }}</td><td v-for="(series, si) in seriesData" :key="si">{{ format(series.values[i]) }}</td></tr></tbody>
        </table>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import {use} from 'echarts/core'
import {CanvasRenderer} from 'echarts/renderers'
import {BarChart,LineChart,PieChart} from 'echarts/charts'
import {AriaComponent,DataZoomComponent,GridComponent,LegendComponent,TooltipComponent} from 'echarts/components'
import type {EChartsOption} from 'echarts'
import VChart from 'vue-echarts'
import {session} from '@/stores/session'
import {aggregationLabels,formatDashboardNumber,type DashboardWidget,type DashboardResult} from '@/dashboard'

// Register only the chart types and interactions used by the dashboard.
use([CanvasRenderer,BarChart,LineChart,PieChart,AriaComponent,DataZoomComponent,GridComponent,LegendComponent,TooltipComponent])
const props=defineProps<{widget:DashboardWidget;result:DashboardResult}>()
const labels=computed(()=>(props.result.points || []).map(point=>point.label))
const seriesData=computed(()=>(props.result.series?.length ? props.result.series : [{name:aggregationLabels[props.widget.aggregation],points:props.result.points || []}]).map(series=>({
  name:series.name,
  values:series.points.map(point=>point.value === null || !Number.isFinite(Number(point.value)) ? null : Number(point.value)),
})))
const numbers=computed(()=>seriesData.value.flatMap(series=>series.values.filter((value):value is number=>value !== null)))
const hasData=computed(()=>numbers.value.length>0)
const pieTotal=computed(()=>numbers.value.reduce((sum,value)=>sum+value,0))
const format=(value:string|number|null|undefined)=>formatDashboardNumber(value,props.widget.decimals)
const compact=(value:number)=>Math.abs(value)>=1e8 ? `${formatDashboardNumber(value/1e8,1)}亿` : Math.abs(value)>=1e4 ? `${formatDashboardNumber(value/1e4,1)}万` : formatDashboardNumber(value,1)
const shortLabel=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(2) : Array.from(value).length>8 ? Array.from(value).slice(0,7).join('')+'…' : value
const option=computed<EChartsOption>(()=>{
  // These reactive reads also refresh colors when the user changes appearance.
  const dark=session.theme === 'dark'
  const primary=session.themeColor
  const style=getComputedStyle(document.documentElement)
  const text=style.getPropertyValue('--wb-text-secondary').trim() || (dark?'#b1b1b1':'#5d646f')
  const border=style.getPropertyValue('--wb-border').trim() || (dark?'#41464e':'#d9dde3')
  const zoom=labels.value.length>12
  const common:EChartsOption={
    backgroundColor:'transparent',
    color:[style.getPropertyValue('--wb-primary').trim() || primary,'#448361','#d9730d','#9065b0','#c14c8a','#cb912f','#9f6b53','#787774'],
    textStyle:{fontFamily:style.fontFamily,color:text},
    animation:false,
    aria:{enabled:true},
    legend:{type:'scroll',top:0,left:'center',textStyle:{color:text}},
    // Native rich-text tooltips avoid interpreting source labels as HTML.
    tooltip:{trigger:props.widget.kind === 'pie'?'item':'axis',renderMode:'richText',confine:true,
      valueFormatter:value=>`${format(typeof value === 'number' || typeof value === 'string' ? value : null)}${props.widget.unit}`},
  }
  if(props.widget.kind === 'pie')return {
    ...common,
    series:[{type:'pie',radius:['35%','65%'],center:['50%','56%'],avoidLabelOverlap:true,
      label:{show:true,formatter:'{d}%',color:text},
      labelLine:{length:10,length2:8},
      data:labels.value.flatMap((name,index)=>{
        const value=seriesData.value[0]?.values[index]
        return value === null || value === undefined ? [] : [{name,value}]
      }),
      emphasis:{focus:'self'},
    }],
  }
  return {
    ...common,
    grid:{top:58,left:12,right:20,bottom:zoom?64:18,containLabel:true},
    xAxis:{type:'category',data:labels.value,boundaryGap:props.widget.kind === 'bar',
      axisLabel:{formatter:shortLabel,color:text,hideOverlap:true},axisLine:{lineStyle:{color:border}},axisTick:{alignWithLabel:true}},
    yAxis:{type:'value',name:props.widget.unit,nameTextStyle:{color:text},
      axisLabel:{formatter:compact,color:text},splitLine:{lineStyle:{color:border,type:'dashed'}}},
    dataZoom:zoom?[{type:'inside',xAxisIndex:0,filterMode:'none'},{type:'slider',xAxisIndex:0,height:18,bottom:8,filterMode:'none'}]:[],
    series:seriesData.value.map((series,index)=>({
      id:`series-${index}`,name:series.name,type:props.widget.kind === 'bar'?'bar':'line',
      data:series.values,yAxisIndex:0,connectNulls:false,
      ...(props.widget.kind === 'bar'?{barMaxWidth:40}:{symbolSize:7,showSymbol:true}),
      emphasis:{focus:'series'},
    })),
  }
})
</script>

<style scoped>
.dashboard-chart { width:100%;min-width:0;container-type:inline-size; }
.echarts-chart { width:100%;height:320px;min-width:0; }
.metric-value { display:flex;align-items:baseline;gap:8px;padding-top:14px;overflow-wrap:anywhere; }
.metric-value strong { font-size:clamp(24px,11cqw,40px);white-space:nowrap;line-height:1.3;font-weight:600;font-variant-numeric:tabular-nums; }
.metric-value span,.metric-caption { color:var(--wb-text-secondary);font-size:12px; }
.metric-caption { margin-top:10px; }
.chart-empty { min-height:130px;display:grid;place-items:center;color:var(--wb-text-tertiary);padding:20px;text-align:center;font-size:13px; }
.error { color:var(--el-color-danger); }
.chart-values { overflow-x:auto;font-size:12px;margin-top:5px;color:var(--wb-text-secondary); }
.chart-values summary { cursor:pointer; }
.chart-values table { width:100%;border-collapse:collapse;margin-top:8px; }
.chart-values td,.chart-values th { border-bottom:1px solid var(--wb-border);text-align:right;padding:6px;overflow-wrap:anywhere; }
.chart-values td:first-child,.chart-values th:first-child { text-align:left; }
</style>