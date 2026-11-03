<template>
 <el-card shadow="never" class="agent-drafts">
  <div class="draft-heading"><div><h3>Agent 暂存区</h3><p>Agent 的新增、修改、删除先放在这里。只有你合并后，正式数据才会改变。</p></div><el-button :loading="loading" @click="load">刷新暂存</el-button></div>
  <el-input v-model="keyword" placeholder="按 Agent 名称或提交内容筛选" clearable style="max-width:320px;margin:8px 12px 8px 0" @change="page=1;load()"/>
  <el-radio-group v-model="status" size="small" @change="page=1;load()"><el-radio-button value="pending">待审核 {{ counts.pending||0 }}</el-radio-button><el-radio-button value="applied">已合并 {{ counts.applied||0 }}</el-radio-button><el-radio-button value="rejected">已拒绝 {{ counts.rejected||0 }}</el-radio-button><el-radio-button value="split">已拆分 {{ counts.split||0 }}</el-radio-button></el-radio-group>
  <el-alert v-if="failure" :title="failure" type="error" :closable="false"/>
  <el-table v-loading="loading" :data="items" empty-text="暂无暂存变更" style="margin-top:12px">
   <el-table-column prop="id" label="编号" width="75"/>
   <el-table-column prop="agent_name" label="Agent" min-width="110"/>
   <el-table-column prop="title" label="提交内容" min-width="180" show-overflow-tooltip/>
   <el-table-column prop="operation_count" label="操作数" width="80"/>
   <el-table-column label="提交时间" min-width="155"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column>
   <el-table-column label="操作" width="110"><template #default="{row}"><el-button text type="primary" @click="open(row.id)">{{ row.status==='pending'?'查看与审核':'查看记录' }}</el-button></template></el-table-column>
  </el-table>
  <el-pagination v-if="total>20" v-model:current-page="page" :page-size="20" :total="total" layout="total,prev,pager,next" @current-change="load"/>
 </el-card>
 <el-drawer v-model="visible" title="审核 Agent 暂存" size="min(960px,100vw)" append-to-body :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
  <div v-if="selected" v-loading="busy">
   <div class="draft-title"><strong>#{{ selected.id }} · {{ selected.title }}</strong><el-tag :type="selected.status==='applied'?'success':selected.status==='rejected'?'info':'warning'">{{ labels[selected.status] }}</el-tag></div>
   <p class="secondary">提交者：{{ selected.agent_name }} · {{ time(selected.created_at) }}</p>
   <el-alert v-if="selected.error" :title="selected.error" type="error" :closable="false"/>
   <el-alert v-if="selected.status==='pending'" title="当前仍是暂存，尚未修改正式数据。预览中的新建 ID 是临时值，正式 ID 以合并结果为准。" type="info" :closable="false"/>
   <section v-for="(operation,index) in selected.preview" :key="index" class="draft-operation">
    <el-checkbox v-if="selected.status==='pending'&&selected.preview.length>1" :model-value="chosen.includes(index)" :value="index" @change="(checked:boolean|string|number)=>toggleChosen(index,!!checked)">选择此操作以拆分审核</el-checkbox>
    <h4>{{ index+1 }}. {{ operation.summary || actions[operation.method] }}</h4>
    <el-tag v-if="operation.irreversible" type="warning">合并时执行，可能无法撤销</el-tag>
    <p v-if="operation.deferred" class="secondary">{{ operation.note }}</p>
    <p v-if="operation.upload">文件：{{ operation.upload.name }}（{{ Math.ceil(operation.upload.size/1024) }} KB）</p>
    <el-table v-if="operation.changes?.length" :data="operation.changes" size="small"><el-table-column prop="label" label="修改项目" min-width="100"/><el-table-column label="修改前" min-width="160"><template #default="{row}"><pre>{{ valueText(row.before) }}</pre></template></el-table-column><el-table-column label="修改后" min-width="160"><template #default="{row}"><pre>{{ valueText(row.after) }}</pre></template></el-table-column></el-table>
    <p v-if="operation.method==='DELETE'" class="secondary">将删除该内容；可恢复内容会进入回收站，永久清理和外部操作以具体接口为准。</p>
    <details><summary>技术详情 · {{ operation.path }}</summary><div class="draft-comparison"><div><h5>修改前</h5><pre>{{ pretty(operation.before) }}</pre></div><div><h5>{{ operation.deferred?'待执行内容':'预览结果' }}</h5><pre>{{ pretty(operation.deferred?operation.request:operation.after) }}</pre></div></div><pre>{{ pretty(operation.request) }}</pre></details>
   </section>
   <div v-if="selected.results"><h4>{{ selected.status==='split'?'关联暂存（请分别审核）':'正式合并结果' }}</h4><div v-for="(result,index) in selected.results" :key="index"><el-button v-if="selected.status==='split'&&result.change_id" text type="primary" @click="open(result.change_id)">查看关联暂存 #{{ result.change_id }}</el-button><el-link v-if="result?.download_url" :href="result.download_url" type="primary">下载第 {{ index+1 }} 项的文件结果</el-link><pre>{{ pretty(result) }}</pre></div></div>
   <el-input v-if="selected.status==='pending'" v-model="reviewNote" type="textarea" :rows="2" maxlength="1000" placeholder="审核备注（可选）"/>
   <p v-if="selected.review_note" class="secondary">审核备注：{{ selected.review_note }}</p>
   <p v-if="selected.reviewed_at" class="secondary">处理时间：{{ time(selected.reviewed_at) }}</p>
  </div>
  <template #footer><div v-if="selected?.status==='pending'" class="draft-footer"><el-button :disabled="busy" @click="refreshPreview">重新预览</el-button><el-button v-if="selected.preview.length>1" :disabled="busy||!chosen.length||chosen.length===selected.preview.length" @click="splitSelected">拆成独立暂存</el-button><div class="spacer"/><el-button type="danger" plain :disabled="busy" @click="review('reject')">拒绝</el-button><el-button type="primary" :loading="busy" @click="review('merge')">合并到正式数据</el-button></div><el-button v-else @click="visible=false">关闭</el-button></template>
 </el-drawer>
</template>
<script setup lang="ts">
import {onMounted,ref} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
const chosen=ref<number[]>([])
function toggleChosen(index:number,checked:boolean){chosen.value=checked?[...chosen.value,index]:chosen.value.filter(i=>i!==index)}
const keyword=ref(''),reviewNote=ref('')
const valueText=(v:unknown)=>v===null||v===undefined?'无':typeof v==='boolean'?(v?'是':'否'):typeof v==='string'?v:JSON.stringify(v,null,2)
const status=ref('pending'),page=ref(1),total=ref(0),counts=ref<Record<string,number>>({}),items=ref<any[]>([]),selected=ref<any>(null),visible=ref(false),loading=ref(false),busy=ref(false),failure=ref('')
const labels:Record<string,string>={pending:'待审核',applied:'已合并',rejected:'已拒绝',split:'已拆分'},actions:Record<string,string>={POST:'新增或执行',PUT:'更新',PATCH:'修改',DELETE:'删除'}
const time=(value:string)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):''
const pretty=(value:unknown)=>value===null||value===undefined?'无':JSON.stringify(value,null,2)
async function load(){loading.value=true;failure.value='';try{const {data}=await http.get('/agent-changes',{params:{status:status.value,page:page.value,q:keyword.value}});items.value=data.items;total.value=data.total;counts.value=data.counts}catch(e){failure.value=apiError(e).message}finally{loading.value=false}}
async function open(id:number){try{selected.value=(await http.get('/agent-changes/'+id)).data;visible.value=true;reviewNote.value='';chosen.value=[]}catch(e){ElMessage.error(apiError(e).message)}}
async function refreshPreview(){if(!selected.value)return;busy.value=true;try{selected.value=(await http.post(`/agent-changes/${selected.value.id}/refresh`,{version:selected.value.version},{timeout:180000})).data;ElMessage.success('已按当前数据重新预览，请核对后再合并')}catch(e){ElMessage.error(apiError(e).message)}finally{busy.value=false}}
async function splitSelected(){if(!selected.value)return;busy.value=true;try{const {data}=await http.post(`/agent-changes/${selected.value.id}/split`,{version:selected.value.version,indices:chosen.value},{timeout:180000});selected.value=data.split;chosen.value=[];await load();ElMessage.success('已拆分，请分别审核。涉及相同模块时，后续暂存可能需要重新预览。')}catch(e){ElMessage.error(apiError(e).message)}finally{busy.value=false}}
async function review(action:'merge'|'reject'){
 if(!selected.value||busy.value)return
 try{await ElMessageBox.confirm(action==='merge'?`确认将这 ${selected.value.operation_count} 项变更合并到正式数据？删除、文件和外部服务操作也会在此时执行。`:'拒绝后不会修改正式数据，暂存上传文件将清理。',action==='merge'?'合并 Agent 暂存':'拒绝 Agent 暂存',{type:'warning',confirmButtonText:action==='merge'?'确认合并':'确认拒绝',cancelButtonText:'取消'})}catch{return}
 busy.value=true
 try{selected.value=(await http.post(`/agent-changes/${selected.value.id}/${action}`,{version:selected.value.version,note:reviewNote.value},{timeout:180000})).data;await load();ElMessage.success(action==='merge'?'已合并到正式数据':'已拒绝，正式数据未改变')
  if(action==='merge')for(const event of ['wb:tables-changed','wb:notes-changed','wb:todos-changed','wb:memos-changed','wb:dashboards-changed','wb-bookmarks-changed'])window.dispatchEvent(new Event(event))
 }catch(e){ElMessage.error(apiError(e).message);selected.value=(await http.get('/agent-changes/'+selected.value.id)).data;await load()}finally{busy.value=false}
}
onMounted(load)
defineExpose({load})
</script>
<style scoped>
.agent-drafts{margin-bottom:16px}.draft-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.draft-heading h3{margin:0;font-size:15px}.draft-heading p{font-size:13px;color:var(--wb-text-secondary)}.draft-title,.draft-footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.draft-operation{margin:18px 0;padding:14px;border:1px solid var(--wb-border);border-radius:6px}.draft-operation h4{margin:0 0 10px;overflow-wrap:anywhere}.draft-comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px}.draft-comparison>div{min-width:0}.draft-comparison h5{margin:8px 0;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto;padding:10px;background:var(--wb-surface-subtle);border-radius:4px;font-size:12px;line-height:1.6}summary{cursor:pointer;font-size:12px;color:var(--wb-text-secondary)}@media(max-width:700px){.draft-comparison{grid-template-columns:1fr}}
</style>