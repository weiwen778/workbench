<template>
 <div class="progress-editor">
  <el-form-item label="进度怎么算？"><el-radio-group v-model="value.mode" @change="modeChanged"><el-radio-button value="tasks">按任务数量</el-radio-button><el-radio-button value="quantity">按数值累计</el-radio-button></el-radio-group></el-form-item>
  <el-form-item v-if="value.mode==='tasks'&&value.completed" label="哪些记录算完成？" required><ProgressConditionRow v-model="value.completed" :fields="conditionFields" label="完成条件"/></el-form-item>
  <el-form-item v-if="value.mode==='quantity'" label="完成量用哪一列？" required><el-select v-model="value.actual_field" aria-label="完成量列" placeholder="例如：已完成数量"><el-option v-for="f in numeric" :key="f.key" :value="f.key" :label="f.name"/></el-select></el-form-item>
  <div class="progress-editor-grid">
   <el-form-item label="目标怎么算？"><el-select v-model="value.target_mode" aria-label="目标计算方式"><el-option v-if="value.mode==='tasks'" label="统计范围内的任务总数" value="rows"/><el-option v-else label="汇总目标数量列" value="field"/><el-option label="手动填写固定目标" value="fixed"/></el-select></el-form-item>
   <el-form-item v-if="value.target_mode==='field'" label="目标量用哪一列？" required><el-select v-model="value.target_field" aria-label="目标量列"><el-option v-for="f in numeric" :key="f.key" :value="f.key" :label="f.name"/></el-select></el-form-item>
   <el-form-item v-if="value.target_mode==='fixed'" :label="grouped?'每个分组的固定目标':'固定目标'" required><el-input v-model="value.target_value" aria-label="固定目标" inputmode="decimal" placeholder="例如：100"/></el-form-item>
   <el-form-item label="展示样式"><el-radio-group v-model="value.display"><el-radio-button value="bar">进度条</el-radio-button><el-radio-button value="circle">圆环</el-radio-button></el-radio-group></el-form-item>
   <el-form-item v-if="value.mode==='tasks'" label="截止日期列（可选）"><el-select v-model="value.due_field" aria-label="截止日期列" clearable placeholder="用于统计逾期未完成项"><el-option v-for="f in dates" :key="f.key" :value="f.key" :label="f.name"/></el-select></el-form-item>
  </div>
  <p class="text-12 secondary progress-explanation">{{ value.mode==='tasks'?'完成率 = 符合完成条件的任务数 ÷ 目标任务数':'完成率 = 完成量合计 ÷ 目标量合计；空值、无效值和负数所在行不参与计算' }}。{{ value.target_mode==='fixed'&&grouped?'固定目标按每个分组设置，总目标为所有分组目标合计。':'' }}目标为零不计算百分比，超额完成显示真实比例。</p>
  <div class="scope-heading"><strong>统计哪些记录？</strong><el-button text :icon="Plus" :disabled="value.filters.length>=7||!conditionFields.length" @click="addFilter">添加筛选</el-button></div>
  <p v-if="!value.filters.length" class="text-12 secondary">统计全部有效记录；可按项目、负责人、状态等缩小范围。</p>
  <div v-for="(_,i) in value.filters" :key="i" class="scope-row"><ProgressConditionRow v-model="value.filters[i]" :fields="conditionFields" :label="`范围条件${i+1}`"/><el-button text :icon="Delete" :aria-label="`删除范围条件${i+1}`" @click="value.filters.splice(i,1)"/></div>
  <p v-if="value.filters.length" class="text-12 secondary">所有筛选条件需同时满足，最多 7 条；再叠加看板顶部的时间范围。</p>
 </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {Plus,Delete} from '@/icons'
import ProgressConditionRow from '@/components/ProgressConditionRow.vue'
import type {ProgressConfig} from '@/dashboard'
const props=defineProps<{fields:any[];grouped:boolean}>()
const value=defineModel<ProgressConfig>({required:true})
const numeric=computed(()=>props.fields.filter(f=>['number','formula','rollup'].includes(f.type))),dates=computed(()=>props.fields.filter(f=>f.type==='date')),conditionFields=computed(()=>props.fields.filter(f=>['short_text','long_text','number','formula','rollup','select','checkbox','date'].includes(f.type)))
function modeChanged(){value.value.target_mode=value.value.mode==='tasks'?'rows':'field';if(value.value.mode==='quantity'){value.value.due_field=null;value.value.actual_field||=numeric.value[0]?.key||null;value.value.target_field||=numeric.value[1]?.key||numeric.value[0]?.key||null}}
function addFilter(){if(value.value.filters.length>=7)return;const f=conditionFields.value[0];if(f)value.value.filters.push({field:f.key,op:'eq',value:f.type==='checkbox'?true:f.type==='select'?f.options?.[0]?.id||'':''})}
</script>
<style scoped>.progress-editor{padding:16px;background:var(--wb-surface-subtle);border-radius:8px;margin-bottom:20px}.progress-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.progress-explanation{line-height:1.8;margin:0 0 12px}.scope-heading{display:flex;align-items:center;justify-content:space-between;font-size:13px;border-top:1px solid var(--wb-border);padding-top:10px}.scope-row{display:flex;gap:4px;margin-top:8px;align-items:center}.scope-row>.condition-row{flex:1;min-width:0}@media(max-width:600px){.progress-editor-grid{grid-template-columns:1fr}}</style>