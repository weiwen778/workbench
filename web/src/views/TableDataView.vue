<template>
 <div class="table-workbench">
  <header class="workbench-head">
   <el-radio-group class="table-modes" :model-value="kind" size="small" aria-label="表格显示方式" :disabled="switching" @change="changeKind"><el-radio-button value="grid">原始表</el-radio-button><el-radio-button value="workbook">自由工作簿</el-radio-button></el-radio-group>
   <div :id="toolbarId" class="mode-actions"/>
  </header>
  <main class="mode-content">
   <LegacyTableView v-if="mounted" v-show="kind==='grid'" embedded :toolbar-target="`#${toolbarId}`" :toolbar-active="kind==='grid'"/>
   <section v-if="workbookVisited" v-show="kind==='workbook'" class="workbook-pane">
    <div v-if="sourceLoading && !source" class="mode-loading">正在打开工作簿…</div>
    <div v-else-if="sourceError && !source" class="mode-loading"><span>{{ sourceError }}</span><el-button size="small" @click="loadSource">重试</el-button></div>
    <WorkbookEditor v-else-if="source" ref="workbookRef" :table-id="tableId" :name="source.table.name" :fields="source.fields" :rows="source.records" :references="source.references" :toolbar-target="`#${toolbarId}`" :toolbar-active="kind==='workbook'" @dirty="workbookDirty=$event" @close="closeWorkbook"/>
   </section>
  </main>
 </div>
</template>
<script setup lang="ts">
import {defineAsyncComponent,onMounted,onUnmounted,ref} from 'vue'
import {onBeforeRouteLeave,useRoute} from 'vue-router'
import {ElMessage} from 'element-plus'
import {http,apiError} from '@/api/client'
import {session} from '@/stores/session'
import LegacyTableView from '@/views/LegacyTableView.vue'
import HeavyLoading from '@/components/HeavyLoading.vue'
import HeavyError from '@/components/HeavyError.vue'
const WorkbookEditor=defineAsyncComponent({loader:()=>import('@/components/WorkbookEditor.vue'),loadingComponent:HeavyLoading,errorComponent:HeavyError,delay:120,timeout:120000})
const route=useRoute(),tableId=Number(route.params.tableId),toolbarId=`table-mode-actions-${tableId}`
const mounted=ref(false),kind=ref('grid'),switching=ref(false),workbookVisited=ref(false),source=ref<any>(null),sourceLoading=ref(false),sourceError=ref(''),workbookRef=ref<any>(),workbookDirty=ref(false)
const storageKey=`wb-table-view:${session.user?.id}:${tableId}:active`
let active=true
async function loadSource(){sourceLoading.value=true;sourceError.value='';try{const {data}=await http.get(`/tables/${tableId}/workspace`);if(active)source.value=data}catch(e){if(active)sourceError.value=apiError(e).message}finally{sourceLoading.value=false}}
async function changeKind(value:any){if(switching.value||value===kind.value)return;switching.value=true
 try{if(kind.value==='workbook'&&workbookRef.value&&!await workbookRef.value.flush()){ElMessage.warning('工作簿尚未保存，请先重试或导出备份');return}
 kind.value=value==='workbook'?'workbook':'grid';try{sessionStorage.setItem(storageKey,JSON.stringify({kind:kind.value}))}catch{}
 if(kind.value==='workbook'){workbookVisited.value=true;await loadSource()}
 }finally{switching.value=false}}
async function closeWorkbook(){await changeKind('grid');if(kind.value==='grid'){workbookVisited.value=false;source.value=null}}
onBeforeRouteLeave(async()=>!workbookRef.value||await workbookRef.value.flush())
function beforeUnload(e:BeforeUnloadEvent){if(workbookDirty.value){e.preventDefault();e.returnValue=''}}
onMounted(()=>{mounted.value=true;window.addEventListener('beforeunload',beforeUnload);try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'{}');if(saved.kind==='workbook')void changeKind('workbook')}catch{}})
onUnmounted(()=>{active=false;window.removeEventListener('beforeunload',beforeUnload)})
</script>
<style scoped>
.table-workbench{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.workbench-head{display:flex;align-items:center;gap:14px;height:44px;min-height:44px;max-height:44px;flex-shrink:0;padding:0 12px;border-bottom:1px solid var(--wb-border);box-sizing:border-box;overflow:hidden}
.table-modes{flex-shrink:0;white-space:nowrap}.table-modes :deep(.el-radio-button:first-child){width:72px}.table-modes :deep(.el-radio-button:last-child){width:112px}.table-modes :deep(.el-radio-button__inner){width:100%;box-sizing:border-box;text-align:center;padding:5px 8px}
.mode-actions{flex:1;min-width:0;height:32px;display:flex;align-items:center;justify-content:flex-end;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.mode-actions::-webkit-scrollbar{display:none}
.mode-content{flex:1;min-height:0;overflow:hidden;position:relative}.mode-content>.page,.workbook-pane{height:100%;min-height:0}.workbook-pane{display:flex;flex-direction:column}.mode-loading{display:flex;align-items:center;justify-content:center;gap:12px;height:100%;font-size:13px;color:var(--wb-text-secondary)}
@media(max-width:700px){.workbench-head{padding:0 8px;gap:8px}.table-modes :deep(.el-radio-button:first-child){width:60px}.table-modes :deep(.el-radio-button:last-child){width:100px}}
</style>
