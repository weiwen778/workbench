<template><div class="metrics-trend"><VChart class="metrics-chart" :option="option" :theme="session.theme==='dark'?'dark':undefined" autoresize :init-options="{renderer:'canvas'}" aria-label="CPU、内存、磁盘与网络最近趋势"/></div></template>
<script setup lang="ts">
import {computed} from 'vue'
import {use} from 'echarts/core'
import {CanvasRenderer} from 'echarts/renderers'
import {LineChart} from 'echarts/charts'
import {GridComponent,TooltipComponent,LegendComponent,AriaComponent} from 'echarts/components'
import VChart from 'vue-echarts'
import {session} from '@/stores/session'
use([CanvasRenderer,LineChart,GridComponent,TooltipComponent,LegendComponent,AriaComponent])
const props=defineProps<{history:any[]}>()
const option=computed<any>(()=>{const dark=session.theme==='dark',text=dark?'#b8bec8':'#606772',border=dark?'#3b4149':'#e2e6ec';return {backgroundColor:'transparent',animation:false,aria:{enabled:true},color:[session.themeColor,'#448361','#bd7a16','#9065b0','#c14c8a'],textStyle:{color:text},legend:{top:0,textStyle:{color:text}},tooltip:{trigger:'axis',renderMode:'richText',confine:true},grid:{left:48,right:52,top:42,bottom:32},xAxis:{type:'category',data:props.history.map(p=>new Date(p.timestamp*1000).toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})),axisLabel:{color:text,hideOverlap:true}},yAxis:[{type:'value',min:0,max:100,name:'使用率 %',axisLabel:{color:text},splitLine:{lineStyle:{color:border,type:'dashed'}}},{type:'value',name:'网络 KB/s',axisLabel:{color:text},splitLine:{show:false}}],series:[['CPU','cpu_percent',0],['内存','memory_percent',0],['磁盘','disk_percent',0],['网络接收','receive_bps',1],['网络发送','send_bps',1]].map(([name,key,axis])=>({type:'line',name,yAxisIndex:axis,showSymbol:false,connectNulls:false,data:props.history.map(p=>p[String(key)]===null?null:Number(p[String(key)])/(axis===1?1024:1))}))}})
</script>
<style scoped>.metrics-trend{height:260px;width:100%;min-width:0}.metrics-chart{width:100%;height:100%}</style>