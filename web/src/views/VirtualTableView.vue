<template>
 <div class="page virtual-table-view">
  <div class="page-toolbar"><el-tag size="small" effect="plain">虚拟表 · 只读</el-tag><span class="text-12 secondary">{{ modeLabels[table.virtual_config?.mode]||'组合数据' }}<template v-if="result"> · {{ filtered.length }} / {{ result.total }} 行</template></span><span class="spacer"/><el-button :loading="loading" @click="load">刷新数据</el-button><el-button @click="router.push(`/data/${table.id}/virtual/edit`)">编辑组合规则</el-button><el-button type="primary" @click="router.push({path:'/visualizations',query:{table:table.id}})">用于数据可视化</el-button><el-button :disabled="!result||!!failure" @click="exportCSV">导出 CSV</el-button></div>
  <div class="virtual-body">
   <el-alert v-if="failure" :title="failure" type="error" :closable="false" show-icon><span>请检查来源表或编辑组合规则后重新读取。</span></el-alert>
   <template v-else-if="result">
    <div class="virtual-sources"><span class="text-12 secondary">来源</span><router-link v-for="s in result.sources" :key="s.alias" :to="`/data/${s.table_id}`">{{ s.name }} <span class="text-12 muted">{{ s.rows }} 行</span></router-link><span class="spacer"/><span class="text-12 muted">更新于 {{ new Date(result.generated_at).toLocaleTimeString('zh-CN') }}</span></div>
    <el-alert v-for="w in result.warnings" :key="w" :title="w" type="warning" :closable="false"/>
    <div class="virtual-query"><el-input v-model="search" placeholder="搜索虚拟表结果" clearable :prefix-icon="Search"/><span class="text-12 secondary">结果根据当前原表重新计算，编辑请前往原表。点击列标题可排序。</span></div>
    <el-table :data="pageRows" height="100%" border row-key="id" @sort-change="sortChanged">
     <el-table-column type="index" label="#" width="60" :index="(i:number)=>(page-1)*100+i+1"/>
     <el-table-column v-for="f in result.fields" :key="f.key" :prop="f.key" :label="f.name+(f.type==='formula'?' ƒ':'')" min-width="155" sortable="custom"><template #default="{row}"><span v-if="row.computed_errors?.[f.key]" class="virtual-error" :title="row.computed_errors[f.key]">#ERROR · {{ row.computed_errors[f.key] }}</span><span v-else>{{ display(f,row.data[f.key]) }}</span></template></el-table-column>
     <el-table-column label="数据来源" width="115" fixed="right"><template #default="{row}"><el-button link @click="trace=row">{{ row.origin_count }} 条原记录</el-button></template></el-table-column>
    </el-table>
    <div class="virtual-pagination"><span class="text-12 muted">{{ result.fields.length }} 个字段 · 点击“数据来源”可追溯</span><el-pagination v-model:current-page="page" :page-size="100" :total="filtered.length" layout="prev, pager, next" :pager-count="5"/></div>
   </template>
   <div v-else class="empty-hint">{{ loading?'正在组合原表数据…':'尚未载入数据' }}</div>
  </div>
  <el-dialog :model-value="!!trace" title="原始记录来源" width="min(620px,94vw)" @close="trace=null"><p class="text-13 secondary">此行来自 {{ trace?.origin_count }} 条原始记录。{{ trace?.origin_count>100?'当前列出前 100 条；可打开来源表继续查询。':'' }}</p><div v-for="o in trace?.origins||[]" :key="`${o.table_id}:${o.record_id}`" class="origin-row"><span>{{ sourceName(o.table_id) }} · 记录 #{{ o.record_id }}</span><router-link :to="`/data/${o.table_id}?record=${o.record_id}`">查看原始记录</router-link></div></el-dialog>
 </div>
</template>
<script setup lang="ts">
import {computed,onMounted,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {http,apiError} from '@/api/client'
import {Search} from '@/icons'
import {csvCell,defaultConfig,display,queryRows} from '@/table-core'
import {modeLabels} from '@/virtual-table'
const props=defineProps<{table:any}>(),router=useRouter(),result=ref<any>(),loading=ref(false),failure=ref(''),search=ref(''),page=ref(1),trace=ref<any>(),sort=ref<any[]>([])
const filtered=computed(()=>result.value?queryRows(result.value.records,result.value.fields,{...defaultConfig(),search:search.value,sorts:sort.value},{}):[]),pageRows=computed(()=>filtered.value.slice((page.value-1)*100,page.value*100))
async function load(){if(loading.value)return;loading.value=true;failure.value='';try{result.value=(await http.get(`/virtual-tables/${props.table.id}/data`)).data;page.value=1}catch(e){result.value=null;failure.value=apiError(e).message}finally{loading.value=false}}
function sortChanged(s:any){sort.value=s.order?[{field:s.prop,order:s.order==='descending'?'desc':'asc'}]:[];page.value=1}
function sourceName(id:number){return result.value?.sources.find((s:any)=>s.table_id===id)?.name||`原表 #${id}`}
function exportCSV(){if(!result.value)return;const fields=result.value.fields,content='\ufeff'+[fields.map((f:any)=>csvCell(f.name)).join(','),...filtered.value.map((r:any)=>fields.map((f:any)=>csvCell(r.computed_errors?.[f.key]?'#ERROR · '+r.computed_errors[f.key]:display(f,r.data[f.key]))).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=props.table.name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
watch(search,()=>page.value=1);onMounted(load)
</script>
<style scoped>
.virtual-body{padding:16px;display:flex;flex:1;min-height:0;flex-direction:column;gap:12px}.virtual-sources,.virtual-query,.virtual-pagination{display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex-shrink:0}.virtual-sources a{font-size:13px;color:var(--wb-text);text-decoration:none;border:1px solid var(--wb-border);border-radius:5px;padding:5px 8px}.virtual-query>.el-input{width:240px}.virtual-pagination{justify-content:space-between}.virtual-body>.el-table{flex:1;min-height:180px}.virtual-error{color:var(--el-color-danger)}.origin-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--wb-border);font-size:13px}.origin-row a{color:var(--wb-primary)}@media(max-width:700px){.virtual-body{padding:10px}.virtual-query>.el-input{width:100%}.virtual-sources{gap:6px}}
</style>
