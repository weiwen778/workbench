<template>
 <div class="condition-row">
  <el-select :model-value="modelValue.field" :aria-label="label+'字段'" placeholder="选择字段" filterable @change="changeField"><el-option v-for="f in fields" :key="f.key" :label="f.name" :value="f.key"/></el-select>
  <el-select :model-value="modelValue.op" :aria-label="label+'比较方式'" @change="set('op',$event)"><el-option v-for="op in operators" :key="op.value" :label="op.label" :value="op.value"/></el-select>
  <template v-if="!['empty','not_empty'].includes(modelValue.op)">
   <el-select v-if="field?.type==='select'" :model-value="modelValue.value" :aria-label="label+'比较值'" placeholder="选择选项" @change="set('value',$event)"><el-option v-for="o in field.options||[]" :key="o.id" :label="o.name" :value="o.id"/></el-select>
   <el-select v-else-if="field?.type==='checkbox'" :model-value="modelValue.value" :aria-label="label+'比较值'" @change="set('value',$event)"><el-option label="是（已勾选）" :value="true"/><el-option label="否（未勾选）" :value="false"/></el-select>
   <el-input v-else :model-value="String(modelValue.value??'')" :aria-label="label+'比较值'" :placeholder="field?.type==='date'?'YYYY-MM-DD':'填写比较值'" @update:model-value="set('value',$event)"/>
  </template>
 </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import type {ProgressCondition} from '@/dashboard'
const props=defineProps<{modelValue:ProgressCondition;fields:any[];label:string}>(),emit=defineEmits<{'update:modelValue':[ProgressCondition]}>()
const field=computed(()=>props.fields.find(f=>f.key===props.modelValue.field))
function set(key:string,value:any){emit('update:modelValue',{...props.modelValue,[key]:value})}
function changeField(key:string){const f=props.fields.find(f=>f.key===key);emit('update:modelValue',{field:key,op:'eq',value:f?.type==='checkbox'?true:f?.type==='select'?f.options?.[0]?.id||'':''})}
const operators=computed(()=>{
 const f=field.value
 const base=[{label:'等于',value:'eq'},{label:'为空',value:'empty'},{label:'不为空',value:'not_empty'}]
 if(f?.type==='checkbox')return base
 base.splice(1,0,{label:'不等于',value:'ne'})
 if(['number','formula','rollup','date'].includes(f?.type))base.splice(2,0,{label:'大于／晚于',value:'gt'},{label:'大于等于／不早于',value:'gte'},{label:'小于／早于',value:'lt'},{label:'小于等于／不晚于',value:'lte'})
 else if(f?.type!=='select')base.splice(2,0,{label:'包含',value:'contains'})
 return base
})
</script>
<style scoped>.condition-row{display:grid;grid-template-columns:minmax(100px,1fr) minmax(95px,.8fr) minmax(100px,1fr);gap:8px;width:100%}@media(max-width:600px){.condition-row{grid-template-columns:1fr 1fr}.condition-row>:last-child{grid-column:1/-1}}</style>