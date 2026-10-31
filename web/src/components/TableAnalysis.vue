<template>
 <div class="analysis">
  <div class="analysis-controls"><el-select v-model="settings.group" placeholder="分组列" clearable @change="changed" style="width:140px"><el-option v-for="f in fields" :key="f.key" :label="f.name" :value="f.key"/></el-select><el-select v-if="kind==='pivot'" v-model="settings.column" placeholder="透视列" clearable @change="changed" style="width:140px"><el-option v-for="f in fields" :key="f.key" :label="f.name" :value="f.key"/></el-select><el-select v-model="settings.operation" @change="changed" style="width:115px"><el-option v-for="o in operations" :key="o.value" :label="o.label" :value="o.value"/></el-select><el-select v-if="settings.operation!=='count'" v-model="settings.value" placeholder="数值列" @change="changed" style="width:140px"><el-option v-for="f in numeric" :key="f.key" :label="f.name" :value="f.key"/></el-select><span class="text-12 secondary">点击汇总项联动明细</span><el-button v-if="selection" text size="small" @click="$emit('select',null)">清除联动</el-button></div>
  <div v-if="tooLarge" class="empty-hint">透视结果超过 50 列或 1000 个分组，请先筛选原始数据。</div>
  <div v-else class="analysis-table"><table><thead><tr><th>{{ groupField?.name||'全部数据' }}</th><template v-if="kind==='pivot'"><th v-for="c in columns" :key="c">{{ c }}</th></template><th>合计</th></tr></thead><tbody><tr v-for="g in groups" :key="g.key" :class="{selected:selection?.group===g.key}"><th><button @click="$emit('select',{group:g.key,column:null})">{{ g.label }}</button></th><template v-if="kind==='pivot'"><td v-for="c in columns" :key="c"><button @click="$emit('select',{group:g.key,column:c})">{{ value(g.rows.filter(r=>columnLabel(r)===c)) }}</button></td></template><td><button @click="$emit('select',{group:g.key,column:null})">{{ value(g.rows) }}</button></td></tr><tr class="total"><th>总计</th><template v-if="kind==='pivot'"><td v-for="c in columns" :key="c">{{ value(rows.filter(r=>columnLabel(r)===c)) }}</td></template><td>{{ value(rows) }}</td></tr></tbody></table></div>
 </div>
</template>
<script setup lang="ts">
import {computed,reactive,watch} from 'vue'
import {aggregate,display,type Field,type Row} from '@/table-core'
const props=defineProps<{rows:Row[];fields:Field[];references:Record<string,any[]>;kind:string;config:any;selection:any}>(),emit=defineEmits(['update:config','select'])
const settings=reactive({group:'',column:'',value:'',operation:'count'}),operations=[['count','记录数'],['sum','求和'],['avg','平均值'],['min','最小值'],['max','最大值']].map(([value,label])=>({value,label}))
watch(()=>props.config,c=>Object.assign(settings,{group:c?.group||c?.row||'',column:c?.column||'',value:c?.value||'',operation:c?.operation||'count'}),{immediate:true,deep:true})
const numeric=computed(()=>props.fields.filter(f=>['number','formula','rollup'].includes(f.type))),groupField=computed(()=>props.fields.find(f=>f.key===settings.group)),columnField=computed(()=>props.fields.find(f=>f.key===settings.column))
function columnLabel(r:Row){return columnField.value?display(columnField.value,r.data[columnField.value.key],props.references)||'（空）':'全部'}
const columns=computed(()=>[...new Set(props.rows.map(columnLabel))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true})))
const groups=computed(()=>{const map=new Map<string,Row[]>();for(const r of props.rows){const key=groupField.value?display(groupField.value,r.data[groupField.value.key],props.references)||'（空）':'全部';if(!map.has(key))map.set(key,[]);map.get(key)!.push(r)}return [...map].map(([key,rows])=>({key,label:key,rows}))})
const tooLarge=computed(()=>columns.value.length>50||groups.value.length>1000)
function value(rows:Row[]){return settings.operation!=='count'&&!settings.value?'请选择数值列':aggregate(rows,settings.value,settings.operation)}
function changed(){emit('select',null);emit('update:config',props.kind==='pivot'?{row:settings.group,column:settings.column,value:settings.value,operation:settings.operation}:{group:settings.group,value:settings.value,operation:settings.operation})}
</script>
<style scoped>
.analysis{display:flex;flex-direction:column;min-height:140px;max-height:45%;border-bottom:1px solid var(--wb-border)}.analysis-controls{display:flex;align-items:center;gap:8px;padding:8px;flex-wrap:wrap}.analysis-table{overflow:auto;min-height:60px}table{border-collapse:collapse;min-width:100%;font-size:13px}th,td{padding:7px 12px;border:1px solid var(--wb-border);text-align:right;white-space:nowrap}th:first-child{text-align:left}thead{background:var(--wb-surface-subtle);position:sticky;top:0}button{background:none;border:0;color:inherit;cursor:pointer;font:inherit;padding:0}.selected{background:var(--el-color-primary-light-9)}.total{font-weight:600;background:var(--wb-surface-subtle)}
</style>
