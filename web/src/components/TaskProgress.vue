<template>
 <div v-if="result.progress" class="task-progress">
  <div class="progress-main" :class="{'is-circle':widget.progress?.display==='circle'}">
   <el-progress v-if="widget.progress?.display==='circle'" type="circle" :width="144" :stroke-width="10" :percentage="clamped(result.progress)" :color="color"><template #default><span class="circle-percent">{{ percent(result.progress) }}</span></template></el-progress>
   <div class="progress-numbers"><div class="progress-caption">{{ result.progress.state==='empty'?'暂无任务':result.progress.state==='no_target'?'暂无有效目标':result.progress.state==='complete'?'目标已完成':widget.progress?.mode==='tasks'?'任务完成进度':'数量完成进度' }}</div><div class="progress-count"><strong>{{ format(result.progress.actual) }}</strong><span>/ {{ format(result.progress.target) }} {{ unit }}</span></div><div class="progress-context">{{ result.progress.percentage===null?'目标为零，暂不计算完成率':`剩余 ${format(result.progress.remaining)} ${unit}` }}<span v-if="widget.progress?.mode==='tasks'&&widget.progress.due_field"> · 逾期未完成 {{ result.progress.overdue_rows }} 项</span></div></div>
   <span v-if="widget.progress?.display!=='circle'" class="progress-percent">{{ percent(result.progress) }}</span>
  </div>
  <el-progress v-if="widget.progress?.display!=='circle'" :percentage="clamped(result.progress)" :stroke-width="12" :show-text="false" :color="color"/>
  <div v-if="result.progress_groups?.length" class="progress-groups"><div v-for="(g,i) in result.progress_groups" :key="i" class="progress-group"><button class="group-label" @click="open(g)"><span>{{ g.label }}</span><span class="group-numbers">{{ format(g.actual) }} / {{ format(g.target) }} {{ unit }} · {{ percent(g) }} <el-icon><Direction/></el-icon></span></button><el-progress :percentage="clamped(g)" :stroke-width="7" :show-text="false" :color="color"/></div></div>
  <el-button text size="small" class="progress-source" :icon="Collection" @click="open()">查看来源记录</el-button>
 </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {Collection,Direction} from '@/icons'
import {session} from '@/stores/session'
import {formatDashboardNumber,type DashboardWidget,type DashboardResult,type ProgressValue} from '@/dashboard'
const props=defineProps<{widget:DashboardWidget;result:DashboardResult}>(),router=useRouter()
const unit=computed(()=>props.widget.unit||(props.widget.progress?.mode==='tasks'?'项':'')),color=computed(()=>session.themeColor)
const format=(v:string)=>formatDashboardNumber(v,props.widget.decimals)
const percent=(p:ProgressValue)=>p.percentage===null?'—':formatDashboardNumber(p.percentage,1)+'%'
const clamped=(p:ProgressValue)=>Math.max(0,Math.min(100,Number(p.percentage)||0))
function open(group?:ProgressValue){router.push({path:`/data/${props.widget.table_id}`,query:{filters:JSON.stringify([...(props.result.drilldown_filters||[]),...(group?.filter?[group.filter]:[])])}})}
</script>
<style scoped>
.task-progress{padding-top:12px}.progress-main{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:14px}.progress-main.is-circle{justify-content:flex-start}.progress-caption{font-size:12px;color:var(--wb-text-secondary);margin-bottom:8px}.progress-count{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-variant-numeric:tabular-nums}.progress-count strong{font-size:30px;font-weight:650;line-height:1.2}.progress-count span{font-size:14px;color:var(--wb-text-secondary)}.progress-percent{font-size:25px;font-weight:600;color:var(--wb-primary);white-space:nowrap}.circle-percent{font-size:24px;font-weight:600;color:var(--wb-text)}.progress-context{font-size:12px;color:var(--wb-text-secondary);margin-top:8px;line-height:1.7}.progress-groups{display:grid;gap:16px;border-top:1px solid var(--wb-border);padding-top:18px;margin-top:22px}.group-label{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;border:0;background:transparent;padding:0 0 7px;font:inherit;text-align:left;color:var(--wb-text);cursor:pointer;font-size:13px}.group-label:hover{color:var(--wb-primary)}.group-label>span:first-child{overflow-wrap:anywhere;min-width:0}.group-numbers{display:flex;gap:6px;align-items:center;flex-shrink:0;font-size:12px;color:var(--wb-text-secondary)}.progress-source{margin-top:14px}.progress-source:focus-visible,.group-label:focus-visible{outline:2px solid var(--wb-primary);outline-offset:3px}@media(max-width:450px){.progress-main.is-circle{flex-direction:column;text-align:center}.group-label{flex-wrap:wrap}.group-numbers{flex-shrink:1}.progress-count{justify-content:inherit}}
</style>