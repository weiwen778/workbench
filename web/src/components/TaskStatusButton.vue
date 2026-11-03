<template><el-tooltip :content="hint"><el-badge :value="count" :hidden="!count" :type="summary.failed?'danger':'primary'" :max="99"><el-button text aria-label="任务中心" @click="router.push('/tasks')">任务中心</el-button></el-badge></el-tooltip></template>
<script setup lang="ts">
import {ref,computed,onMounted,onUnmounted} from 'vue'
import {useRouter} from 'vue-router'
import {http} from '@/api/client'
const router=useRouter(),summary=ref({active:0,failed:0,agent_pending:0})
const count=computed(()=>summary.value.failed+summary.value.active+summary.value.agent_pending)
const hint=computed(()=>`执行中或排队 ${summary.value.active} 项，近七天失败 ${summary.value.failed} 项，Agent 待审核 ${summary.value.agent_pending} 份`)
let timer:number|undefined,active=true
async function load(){if(document.hidden)return;try{const {data}=await http.get('/tasks/summary');if(active)summary.value=data}catch{}}
onMounted(()=>{void load();timer=window.setInterval(load,15000)})
onUnmounted(()=>{active=false;window.clearInterval(timer)})
</script>