<template>
  <el-button text @click="open">管理分类</el-button>
  <el-drawer v-model="visible" :title="`${label}分类管理`" size="min(520px, 100vw)" append-to-body>
    <div class="toolbar-actions"><el-input v-model="newName" maxlength="80" placeholder="新分类名称" style="flex:1;min-width:120px" @keyup.enter="create"/><el-button type="primary" :loading="busy" @click="create">添加分类</el-button></div>
    <el-table :data="names.map(name=>({name}))" v-loading="loading" style="margin-top:12px">
      <el-table-column prop="name" label="分类" min-width="120" show-overflow-tooltip/>
      <el-table-column label="操作" width="150"><template #default="{row}"><el-button text size="small" :disabled="busy" @click="rename(row.name)">重命名</el-button><el-button text size="small" type="danger" :disabled="busy" @click="remove(row.name)">删除</el-button></template></el-table-column>
    </el-table>
    <p class="text-12 secondary">删除分类后，内容会移到未分类，不会删除{{ label }}。</p>
  </el-drawer>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
const props=defineProps<{resource:'memos'|'bookmarks'}>()
const emit=defineEmits<{(e:'changed'):void}>()
const route=useRoute(),router=useRouter()
const label=computed(()=>props.resource==='memos'?'便利贴':'网址')
const visible=ref(false),loading=ref(false),busy=ref(false),newName=ref(''),names=ref<string[]>([])
async function load(){loading.value=true;try{names.value=(await http.get(`/${props.resource}/categories`)).data}finally{loading.value=false}}
async function open(){visible.value=true;try{await load()}catch(e){ElMessage.error(apiError(e).message)}}
function valid(name:string){return !!name.trim()&&name.trim().length<=80&&!['未分类','__all','__none','__uncategorized__'].includes(name.trim())}
async function changed(oldName?:string,nextName?:string){
  window.dispatchEvent(new Event(props.resource==='memos'?'wb:memos-changed':'wb-bookmarks-changed'))
  if(oldName&&route.query.category===oldName){
    const query={...route.query};delete query.category
    if(nextName)query.category=nextName
    else if(props.resource==='memos')query.uncategorized='1'
    else query.category='__none'
    await router.replace({path:route.path,query})
  }
  await load();emit('changed')
}
async function create(){if(busy.value)return;if(!valid(newName.value)){ElMessage.warning('请输入 1–80 个字的有效分类名称');return}busy.value=true;try{await http.post(`/${props.resource}/categories`,{name:newName.value.trim()});newName.value='';await changed();ElMessage.success('分类已添加')}catch(e){ElMessage.error(apiError(e).message)}finally{busy.value=false}}
async function rename(name:string){try{
 const {value}=await ElMessageBox.prompt('分类名称','重命名分类',{inputValue:name,inputValidator:(v:string)=>valid(v)||'请输入 1–80 个字的有效分类名称',confirmButtonText:'保存',cancelButtonText:'取消'})
 busy.value=true
 const {data}=await http.patch(`/${props.resource}/categories/manage`,{original_name:name,name:value.trim()});await changed(name,data.name);ElMessage.success('分类已修改')
}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}finally{busy.value=false}}
async function remove(name:string){try{
 await ElMessageBox.confirm(`删除分类「${name}」？分类下的${label.value}会移到未分类，内容保留。`,'删除分类',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'})
 busy.value=true
 await http.delete(`/${props.resource}/categories/manage`,{params:{name}});await changed(name);ElMessage.success('分类已删除，内容已保留')
}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}finally{busy.value=false}}
</script>