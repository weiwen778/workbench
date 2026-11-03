<template>
  <div class="memo-body">
    <div :id="contentId" ref="body" class="memo-content" :class="{ collapsed: !expanded }">{{ content }}</div>
    <el-button v-if="overflows" text size="small" class="expand-content" :aria-expanded="expanded" :aria-controls="contentId" @click="expanded = !expanded">{{ expanded ? '收起全文' : '展开全文' }}</el-button>
  </div>
</template>
<script setup lang="ts">
import {nextTick,onMounted,onBeforeUnmount,ref,useId,watch} from 'vue'
const props=defineProps<{content:string}>()
const contentId=useId(),body=ref<HTMLElement>(),expanded=ref(false),overflows=ref(false)
let observer:ResizeObserver|undefined
function measure(){
  if(!body.value)return
  const lineHeight=parseFloat(getComputedStyle(body.value).lineHeight)
  overflows.value=body.value.scrollHeight>lineHeight*8+1
}
watch(()=>props.content,async()=>{expanded.value=false;await nextTick();measure()})
onMounted(()=>{observer=new ResizeObserver(measure);if(body.value)observer.observe(body.value);measure()})
onBeforeUnmount(()=>observer?.disconnect())
</script>
<style scoped>
.memo-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.memo-content.collapsed {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 8;
  max-height: 13.2em;
  overflow: hidden;
}
.expand-content { align-self: flex-start; margin: 0; padding: 2px 0; color: inherit; text-decoration: underline; text-underline-offset: 3px; }
</style>