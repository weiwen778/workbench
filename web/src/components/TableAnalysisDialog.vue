<template>
 <el-dialog :model-value="modelValue" title="汇总与透视" width="min(1100px,96vw)" top="5vh" @update:model-value="$emit('update:modelValue',$event)" @opened="load" destroy-on-close>
  <el-alert v-if="failure" type="error" :title="failure" :closable="false" />
  <div v-loading="loading" class="analysis-dialog-body">
   <template v-if="source">
    <p class="text-12 secondary">基于整张表的 {{ source.records.length }} 行数据，不只当前页；点击透视表数值，下方显示对应明细。</p>
    <el-radio-group v-model="kind" size="small"><el-radio-button value="summary">分组汇总</el-radio-button><el-radio-button value="pivot">交叉透视</el-radio-button></el-radio-group>
    <TableAnalysis :rows="source.records" :fields="source.fields" :references="source.references" :kind="kind" :config="config" :selection="selection" @update:config="config=$event" @select="selection=$event" />
    <p class="text-12 secondary">{{ selection ? '选中汇总项的明细' : '全部明细' }} · {{ matching.length }} 行</p>
    <el-table :data="matching.slice((page-1)*50,page*50)" height="240" size="small"><el-table-column v-for="field in source.fields" :key="field.key" :label="field.name" min-width="120" show-overflow-tooltip><template #default="{row}">{{ display(field,row.data[field.key],source.references) }}</template></el-table-column></el-table>
    <el-pagination v-model:current-page="page" :total="matching.length" :page-size="50" layout="total,prev,pager,next" />
   </template>
  </div>
 </el-dialog>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {http,apiError} from '@/api/client'
import {display,type Row,type Field} from '@/table-core'
import TableAnalysis from '@/components/TableAnalysis.vue'
const props=defineProps<{modelValue:boolean;tableId:number}>()
defineEmits<{(e:'update:modelValue',value:boolean):void}>()
const source=ref<any>(null),failure=ref(''),loading=ref(false),kind=ref('pivot'),config=ref<any>({}),selection=ref<any>(null),page=ref(1)
let sequence=0
async function load(){const current=++sequence;loading.value=true;failure.value='';source.value=null;selection.value=null;config.value={};try{const {data}=await http.get(`/tables/${props.tableId}/workspace`);if(current===sequence&&props.modelValue)source.value=data}catch(e){if(current===sequence)failure.value=apiError(e).message}finally{if(current===sequence)loading.value=false}}
watch(()=>props.modelValue,open=>{if(!open){sequence++;source.value=null;loading.value=false}})
watch(kind,()=>{selection.value=null})
watch([selection,config,kind],()=>{page.value=1},{deep:true})
const matching=computed(()=>{
 if(!source.value)return []
 if(!selection.value)return source.value.records
 const fields=source.value.fields as Field[],group=fields.find(f=>f.key===(config.value.group||config.value.row)),column=fields.find(f=>f.key===config.value.column)
 const label=(row:Row,field:Field|undefined)=>field?display(field,row.data[field.key],source.value.references)||'（空）':'全部'
 return source.value.records.filter((row:Row)=>label(row,group)===selection.value.group&&(selection.value.column===null||label(row,column)===selection.value.column))
})
</script>
<style scoped>.analysis-dialog-body{min-height:180px}.analysis-dialog-body :deep(.analysis){max-height:none;margin-top:10px}.analysis-dialog-body :deep(.analysis-table){height:220px;flex-shrink:0}</style>