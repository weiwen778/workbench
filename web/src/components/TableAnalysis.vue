<template>
 <div class="analysis">
  <div class="analysis-controls"><el-select v-model="settings.group" placeholder="分组列" clearable @change="changed" style="width:140px"><el-option v-for="f in fields" :key="f.key" :label="f.name" :value="f.key"/></el-select><el-select v-if="kind==='pivot'" v-model="settings.column" placeholder="透视列" clearable @change="changed" style="width:140px"><el-option v-for="f in fields" :key="f.key" :label="f.name" :value="f.key"/></el-select><el-select v-model="settings.operation" @change="changed" style="width:115px"><el-option v-for="o in operations" :key="o.value" :label="o.label" :value="o.value"/></el-select><el-select v-if="settings.operation!=='count'" v-model="settings.value" placeholder="数值列" @change="changed" style="width:140px"><el-option v-for="f in numeric" :key="f.key" :label="f.name" :value="f.key"/></el-select><span class="text-12 secondary">点击汇总项联动明细</span><el-button v-if="selection" text size="small" @click="$emit('select',null)">清除联动</el-button></div>
  <div v-if="tooLarge" class="empty-hint">透视结果超过 50 列或 1000 个分组，请先筛选原始数据。</div>
  <div v-else-if="settings.operation !== 'count' && !settings.value" class="empty-hint">请选择要计算的数值列。</div>
  <div v-else ref="host" class="analysis-table" role="region" aria-label="汇总与透视表，点击数值查看关联明细" tabindex="0" />
  <div class="analysis-summary" role="status">{{ groups.size }} 个分组 · 合计 {{ aggregate(rows,settings.value,settings.operation) }}</div>
 </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onMounted,onBeforeUnmount,reactive,ref,watch} from 'vue'
import * as VTable from '@visactor/vtable'
import {aggregate,display,type Field,type Row} from '@/table-core'
import {session} from '@/stores/session'
const props=defineProps<{rows:Row[];fields:Field[];references:Record<string,any[]>;kind:string;config:any;selection:any}>(),emit=defineEmits(['update:config','select'])
const settings=reactive({group:'',column:'',value:'',operation:'count'}),operations=[['count','记录数'],['sum','求和'],['avg','平均值'],['min','最小值'],['max','最大值']].map(([value,label])=>({value,label}))
watch(()=>props.config,c=>Object.assign(settings,{group:c?.group||c?.row||'',column:c?.column||'',value:c?.value||'',operation:c?.operation||'count'}),{immediate:true,deep:true})
const numeric=computed(()=>props.fields.filter(f=>['number','formula','rollup'].includes(f.type))),groupField=computed(()=>props.fields.find(f=>f.key===settings.group)),columnField=computed(()=>props.fields.find(f=>f.key===settings.column))
function label(row:Row,field:Field|undefined){return field?display(field,row.data[field.key],props.references)||'（空）':'全部'}
const records=computed(()=>props.rows.map(row=>({_group:label(row,groupField.value),_column:label(row,columnField.value),_value:row.data[settings.value],_row:row})))
const groups=computed(()=>new Set(records.value.map(row=>row._group))),columns=computed(()=>new Set(records.value.map(row=>row._column)))
const tooLarge=computed(()=>(props.kind==='pivot'&&columns.value.size>50)||groups.value.size>1000)
const host=ref<HTMLElement>();let table:VTable.PivotTable|undefined,observer:ResizeObserver|undefined,active=true
function options(){
 const style=getComputedStyle(document.documentElement),text=style.getPropertyValue('--wb-text').trim(),bg=style.getPropertyValue('--wb-surface').trim(),subtle=style.getPropertyValue('--wb-surface-subtle').trim(),border=style.getPropertyValue('--wb-border').trim()
 return {
  records:records.value,rows:[{dimensionKey:'_group',title:groupField.value?.name||'全部数据',width:160}],
  columns:props.kind==='pivot'?[{dimensionKey:'_column',title:columnField.value?.name||'全部'}]:[],
  indicators:[{indicatorKey:'_value',title:operations.find(op=>op.value===settings.operation)?.label||'合计',width:120}],
  dataConfig:{aggregationRules:[{indicatorKey:'_value',field:'_value',aggregationType:VTable.TYPES.AggregationType.CUSTOM,
   // The grid handles grouping/rendering; retain Decimal.js for financial precision.
   aggregationFun:(_values:any[],items:any[])=>aggregate(items.map(item=>item._row),settings.value,settings.operation)}],
   totals:{row:{showSubTotals:false,showGrandTotals:true,grandTotalLabel:'总计'},column:{showSubTotals:false,showGrandTotals:props.kind==='pivot',grandTotalLabel:'合计'}}},
  widthMode:'adaptive',defaultRowHeight:32,defaultHeaderRowHeight:32,
  theme:VTable.themes.DEFAULT.extends({bodyStyle:{color:text,bgColor:bg,borderColor:border},headerStyle:{color:text,bgColor:subtle,borderColor:border},rowHeaderStyle:{color:text,bgColor:subtle,borderColor:border},cornerHeaderStyle:{color:text,bgColor:subtle,borderColor:border}}),
 } as VTable.TYPES.PivotTableConstructorOptions
}
function dimensionValue(paths:unknown[],key:string){return (paths as {dimensionKey:string;value:unknown}[]).find(path=>path.dimensionKey===key)?.value}
async function render(){await nextTick();if(!active)return;if(!host.value){table?.release();table=undefined;return}
 if(table){table.updateOption(options());return}
 table=new VTable.PivotTable(host.value,options())
 table.on('click_cell',event=>{
  if(!table)return
  const paths=table.getCellHeaderPaths(event.col,event.row)
  const group=dimensionValue(paths.rowHeaderPaths || [],'_group')
  const column=dimensionValue(paths.colHeaderPaths || [],'_column')
  if(group===undefined||group==='总计'){emit('select',null);return}
  emit('select',{group:String(group),column:column===undefined||column==='合计'?null:String(column)})
 })
 observer?.disconnect();observer=new ResizeObserver(()=>table?.resize());observer.observe(host.value)
}
watch([records,()=>props.kind,()=>session.theme,()=>session.themeColor],render,{deep:true})
watch(()=>props.selection,selection=>{if(!selection)table?.clearSelected()})
function changed(){emit('select',null);emit('update:config',props.kind==='pivot'?{row:settings.group,column:settings.column,value:settings.value,operation:settings.operation}:{group:settings.group,value:settings.value,operation:settings.operation});void render()}
onMounted(render)
onBeforeUnmount(()=>{active=false;observer?.disconnect();table?.release()})
</script>
<style scoped>
.analysis{display:flex;flex-direction:column;min-height:180px;max-height:45%;border-bottom:1px solid var(--wb-border)}
.analysis-controls{display:flex;align-items:center;gap:8px;padding:8px;flex-wrap:wrap}
.analysis-table{height:220px;min-height:100px;min-width:0;overflow:hidden}
.analysis-summary{padding:5px 10px;font-size:12px;color:var(--wb-text-secondary)}
</style>
