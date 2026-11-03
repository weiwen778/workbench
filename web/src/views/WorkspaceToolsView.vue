<template>
 <div class="page workspace-tools">
  <div class="page-toolbar"><el-radio-group v-model="tab" @change="changeTab"><el-radio-button value="tasks">任务中心</el-radio-button><el-radio-button value="search">统一搜索</el-radio-button><el-radio-button value="activity">操作记录</el-radio-button></el-radio-group><div class="spacer"/><el-button :loading="loading" @click="load">刷新</el-button></div>
  <div class="page-body scroll-area">
   <el-alert v-if="failure" type="error" :title="failure" :closable="false"/>
   <template v-if="tab==='tasks'">
    <el-alert v-if="agentPending" type="info" :closable="false"><template #title>有 {{ agentPending }} 份 Agent 变更等待审核 <el-button text type="primary" @click="router.push('/settings/agents')">前往暂存区</el-button></template></el-alert>
    <p class="secondary text-13">任务在后台执行，离开页面后仍会继续。取消在下一个安全检查点生效；失败任务可查看原因并重试。</p>
    <el-select v-model="status" clearable placeholder="全部状态" @change="page=1;load()" style="width:160px"><el-option v-for="(label,value) in statuses" :key="value" :value="value" :label="label"/></el-select>
    <el-table :data="items" v-loading="loading" empty-text="暂无后台任务"><el-table-column prop="id" label="编号" width="75"/><el-table-column prop="title" label="任务" min-width="170"/><el-table-column label="进度" min-width="180"><template #default="{row}"><el-progress :percentage="row.progress" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined"/><span class="text-12 secondary">{{ row.cancel_requested&&row.status==='running'?'正在取消':statuses[row.status] }}<template v-if="row.kind==='export'"> · 已处理 {{ row.processed }} 行</template></span></template></el-table-column><el-table-column label="提交时间" min-width="160"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column><el-table-column label="结果与操作" min-width="230"><template #default="{row}"><span v-if="row.error" class="error">{{ row.error }}</span><el-link v-if="row.result?.download_url" :href="row.result.download_url" type="primary">下载结果</el-link><el-button v-if="row.kind==='import'&&row.result?.result?.table_id" text @click="router.push('/data/'+row.result.result.table_id)">打开导入表格</el-button><span v-if="row.result?.verified" class="success">备份校验通过</span><el-button v-if="['queued','running'].includes(row.status)" text type="danger" @click="jobAction(row,'cancel')">取消</el-button><el-button v-if="['failed','cancelled'].includes(row.status)" text @click="jobAction(row,'retry')">重试</el-button></template></el-table-column></el-table>
    <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total,prev,pager,next" @current-change="load"/>
   </template>
   <template v-else-if="tab==='search'">
    <div class="search-controls"><el-input v-model="keyword" placeholder="搜索待办、笔记、便利贴、书签和表格" clearable @input="scheduleSearch" @keyup.enter="page=1;load()"/><el-select v-model="kind" @change="page=1;load()"><el-option label="全部内容" value="all"/><el-option v-for="(label,value) in kinds" :key="value" :value="value" :label="label"/></el-select></div>
    <p class="text-12 secondary">{{ kind==='all'?'全部搜索每类最多展示 20 条；选择类型可以继续翻页。':'搜索结果' }}<template v-if="keyword.trim()"> · {{ kind==='all'?'当前展示':'共' }} {{ total }} 项<span v-if="hasMore">，更多结果请按类型查看</span></template></p>
    <el-empty v-if="!items.length&&!loading" :description="keyword.trim()?'没有找到匹配内容':'输入关键词开始搜索'"/>
    <router-link v-for="item in items" :key="item.kind+item.id" :to="item.url" class="search-result"><div><el-tag size="small">{{ kinds[item.kind] }}</el-tag><strong>{{ item.title }}</strong></div><p>{{ item.excerpt||'无摘要' }}</p></router-link>
    <el-pagination v-if="kind!=='all'" v-model:current-page="page" :total="total" :page-size="20" layout="total,prev,pager,next" @current-change="load"/>
   </template>
   <template v-else>
    <div class="search-controls"><el-input v-model="keyword" placeholder="按操作人或请求路径筛选" clearable @input="scheduleSearch"/><el-button @click="router.push('/settings/trash')">回收站与恢复</el-button></div>
    <p class="secondary text-13">记录本次升级后的成功操作。表格撤销在表格的变更历史中，笔记旧版本在笔记历史中；删除内容前往回收站恢复。文件和外部服务操作可能无法撤销。</p>
    <el-table :data="items" empty-text="暂无操作记录"><el-table-column label="时间" min-width="160"><template #default="{row}">{{ time(row.created_at) }}</template></el-table-column><el-table-column prop="actor" label="操作人" min-width="130"/><el-table-column label="操作" min-width="140"><template #default="{row}">{{ actions[row.method]||row.method }}{{ row.status===202?'（已暂存或排队）':'' }}</template></el-table-column><el-table-column prop="path" label="位置" min-width="230"/><el-table-column label="查看" width="90"><template #default="{row}"><el-button text @click="follow(row)">前往</el-button></template></el-table-column></el-table>
    <el-pagination v-model:current-page="page" :total="total" :page-size="30" layout="total,prev,pager,next" @current-change="load"/>
   </template>
  </div>
 </div>
</template>
<script setup lang="ts">
import {ref,onMounted,onUnmounted} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
const router=useRouter(),route=useRoute(),tab=ref(route.path==='/search'?'search':route.path==='/activity'?'activity':'tasks')
const hasMore=ref(false)
const items=ref<any[]>([]),total=ref(0),page=ref(1),keyword=ref(String(route.query.q||'')),kind=ref('all'),status=ref(''),loading=ref(false),failure=ref(''),agentPending=ref(0)
const statuses:Record<string,string>={queued:'排队中',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已取消'},kinds:Record<string,string>={todos:'待办',notes:'笔记',memos:'便利贴',bookmarks:'书签',tables:'表格',records:'表格记录'},actions:Record<string,string>={POST:'新增或执行',PUT:'更新',PATCH:'修改',DELETE:'删除'}
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false})
const completedImports=new Set<number>()
let sequence=0,timer:number|undefined,poll:number|undefined
async function load(){const current=++sequence;loading.value=true;failure.value='';try{
 if(tab.value==='search'&&!keyword.value.trim()){items.value=[];total.value=0;return}
 const endpoint=tab.value==='search'?'/search':tab.value==='activity'?'/activity':'/tasks'
 const {data}=await http.get(endpoint,{params:{page:page.value,q:keyword.value.trim()||undefined,kind:kind.value,status:status.value||undefined}})
 if(current!==sequence)return;items.value=data.items;total.value=data.total;hasMore.value=!!data.has_more;agentPending.value=data.agent_pending||0
 if(tab.value==='tasks')for(const item of data.items)if(item.kind==='import'&&item.status==='completed'&&!completedImports.has(item.id)){completedImports.add(item.id);window.dispatchEvent(new Event('wb:tables-changed'))}
}catch(e){if(current===sequence)failure.value=apiError(e).message}finally{if(current===sequence)loading.value=false}}
function changeTab(){router.push(tab.value==='search'?'/search':tab.value==='activity'?'/activity':'/tasks')}
function scheduleSearch(){page.value=1;window.clearTimeout(timer);timer=window.setTimeout(load,300)}
async function jobAction(row:any,action:string){try{await ElMessageBox.confirm(action==='cancel'?'确认取消这个任务？已完成的部分文件可能会保留。':'确认重新提交任务？将创建一个新的后台任务。','确认操作',{confirmButtonText:'确定',cancelButtonText:'取消'});await http.post(`/tasks/${row.id}/${action}`);await load()}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}}
function follow(row:any){const p=row.path;if(p.includes('/agent'))return router.push('/settings/agents');if(row.method==='DELETE'||p.includes('/trash'))return router.push('/settings/trash');const table=p.match(/\/tables\/(\d+)/);if(table)return router.push('/data/'+table[1]);if(p.includes('/notes'))return router.push('/notes');return router.push('/tasks')}
onMounted(()=>{void load();poll=window.setInterval(()=>{if(tab.value==='tasks'&&!document.hidden&&!loading.value)void load()},3000)})
onUnmounted(()=>{sequence++;window.clearTimeout(timer);window.clearInterval(poll)})
</script>
<style scoped>.workspace-tools{height:100%}.search-controls{display:flex;gap:12px;margin-bottom:12px}.search-controls>.el-input{max-width:640px}.search-controls>.el-select{width:160px;flex-shrink:0}.search-result{display:block;border-bottom:1px solid var(--wb-border);padding:16px 4px;text-decoration:none;color:var(--wb-text)}.search-result:hover{background:var(--wb-surface-subtle)}.search-result strong{margin-left:12px;font-weight:500}.search-result p{margin:10px 0 0;color:var(--wb-text-secondary);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.el-pagination{margin-top:16px}.error{color:var(--el-color-danger);font-size:12px}.success{color:var(--el-color-success);font-size:12px}@media(max-width:600px){.search-controls{flex-wrap:wrap}.search-controls>.el-select{width:100%}}</style>