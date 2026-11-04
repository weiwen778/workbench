<template>
  <div class="memo-body">
    <div :id="contentId" ref="body" class="memo-content collapsed">{{ content }}</div>
    <el-button v-if="overflows" text size="small" class="expand-content" :aria-controls="contentId" @click="emit('expand')">查看全文<el-icon><ArrowRight/></el-icon></el-button>
  </div>
</template>
<script setup lang="ts">
import {ArrowRight} from '@/icons'
import {nextTick,onMounted,onBeforeUnmount,ref,useId,watch} from 'vue'
const emit=defineEmits<{expand:[]}>()
const props=defineProps<{content:string}>()
const contentId=useId(),body=ref<HTMLElement>(),overflows=ref(false)
let observer:ResizeObserver|undefined
function measure(){
  if(!body.value)return
  overflows.value=body.value.scrollHeight>body.value.clientHeight+1
}
watch(()=>props.content,async()=>{await nextTick();measure()})
onMounted(()=>{observer=new ResizeObserver(measure);if(body.value)observer.observe(body.value);measure()})
onBeforeUnmount(()=>observer?.disconnect())
</script>
<style scoped>
.memo-body { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.memo-content.collapsed {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  max-height: 11.1em;
  overflow: hidden;
}
.expand-content { align-self:flex-start; margin:0; min-height:32px; height:auto; padding:5px 9px; border-radius:6px; font-size:12px; font-weight:500; color:var(--wb-text-secondary); background:color-mix(in srgb,var(--wb-surface) 65%,transparent); }
.expand-content :deep(.el-icon) { margin-left:6px; font-size:14px; }
.expand-content:hover { color:var(--wb-primary); background:var(--wb-surface); }
</style>