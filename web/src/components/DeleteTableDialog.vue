<template>
 <el-dialog :model-value="modelValue" title="导出备份后删除表格" width="520px" :close-on-click-modal="!busy" :show-close="!busy" :close-on-press-escape="!busy" @update:model-value="$emit('update:modelValue',$event)">
  <p>即将删除「{{ table?.name }}」。请先将全部数据导出到电脑，再确认删除。删除后仍在回收站保留 30 天。</p>
  <el-alert title="备份包含整张原始表的全部列和数据，不受当前筛选、分页影响；附件列保留文件链接，自由工作簿请另行导出。" type="info" :closable="false"/>
  <div class="backup-step"><el-button :loading="busy" :disabled="deleting" :type="downloaded?'default':'primary'" @click="backup">{{ downloaded?'重新下载整表备份':'导出并下载整表备份' }}</el-button><span v-if="busy" role="status">{{ progress }}</span></div>
  <p v-if="error" role="alert" class="error">{{ error }}</p>
  <el-checkbox v-model="saved" :disabled="!downloaded || busy">我已确认备份文件保存到电脑，可以删除表格</el-checkbox>
  <template #footer><el-button :disabled="busy||deleting" @click="$emit('update:modelValue',false)">取消</el-button><el-button type="danger" :disabled="!downloaded||!saved||busy" :loading="deleting" @click="remove">确认删除</el-button></template>
 </el-dialog>
</template>
<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue'
import {http,apiError} from '@/api/client'
import {requestId} from '@/utils/request-id'
import {ElMessage} from 'element-plus'
const props=defineProps<{modelValue:boolean;table:{id:number;name:string}|null}>()
const emit=defineEmits<{ 'update:modelValue':[boolean]; deleted:[] }>()
const busy=ref(false),deleting=ref(false),downloaded=ref(false),saved=ref(false),error=ref(''),progress=ref('')
let generation=0
watch(()=>props.modelValue,()=>{generation++;downloaded.value=false;saved.value=false;error.value='';busy.value=false})
onBeforeUnmount(()=>generation++)
async function backup(){
 if(!props.table||busy.value)return
 const run=++generation;busy.value=true;downloaded.value=false;saved.value=false;error.value='';progress.value='正在生成整表备份…'
 try{
  let {data:job}=await http.post(`/tables/${props.table.id}/export-tasks`,{scope:'all'},{headers:{'Idempotency-Key':requestId()}})
  const deadline=Date.now()+10*60*1000
  while(['queued','running'].includes(job.status)){
   if(run!==generation)return
   if(Date.now()>deadline)throw new Error('导出仍在后台进行，请到任务中心查看，完成后重新下载备份。尚未删除表格。')
   progress.value=`正在导出：${job.processed||0} 行（${job.progress||0}%）`
   await new Promise(r=>setTimeout(r,1000));if(run!==generation)return
   job=(await http.get(`/tasks/${job.id}`)).data
  }
  if(run!==generation)return
  if(job.status!=='completed'||!job.result?.download_url)throw new Error(job.error||'导出未完成，表格未删除')
  const response=await http.get(job.result.download_url,{baseURL:'',responseType:'blob'})
  if(run!==generation)return
  if(!response.data.size)throw new Error('备份文件为空，请重新导出')
  const url=URL.createObjectURL(response.data),a=document.createElement('a')
  a.href=url;a.download=props.table.name.replace(/[\/:*?"<>|]/g,'_')+'-完整备份.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
  downloaded.value=true;progress.value='';ElMessage.success('备份已开始下载，请确认文件已保存后再删除')
 }catch(e){if(run===generation)error.value=e instanceof Error&&!('response'in e)?e.message:apiError(e).message}
 finally{if(run===generation)busy.value=false}
}
async function remove(){if(!props.table||!downloaded.value||!saved.value||busy.value||deleting.value)return;deleting.value=true;try{await http.delete(`/tables/${props.table.id}`);window.dispatchEvent(new Event('wb:tables-changed'));emit('deleted');emit('update:modelValue',false);ElMessage.success('表格已移入回收站')}catch(e){error.value=apiError(e).message}finally{deleting.value=false}}
</script>
<style scoped>.backup-step{display:flex;align-items:center;gap:12px;margin:20px 0;flex-wrap:wrap}.error{color:var(--el-color-danger)}p{line-height:1.7}</style>
