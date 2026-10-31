<template>
 <VirtualTableView v-if="table?.kind==='virtual'" :table="table"/>
 <TableDataView v-else-if="table"/>
 <div v-else class="empty-hint"><span>{{ failure||'正在打开表格…' }}</span><el-button v-if="failure" @click="load">重试</el-button></div>
</template>
<script setup lang="ts">
import {defineAsyncComponent,onMounted,ref} from 'vue'
import {useRoute} from 'vue-router'
import {http,apiError} from '@/api/client'
const TableDataView=defineAsyncComponent(()=>import('@/views/TableDataView.vue')),VirtualTableView=defineAsyncComponent(()=>import('@/views/VirtualTableView.vue'))
const route=useRoute(),table=ref<any>(),failure=ref('')
async function load(){failure.value='';try{table.value=(await http.get(`/tables/${route.params.tableId}`)).data}catch(e){failure.value=apiError(e).message}}
onMounted(load)
</script>
