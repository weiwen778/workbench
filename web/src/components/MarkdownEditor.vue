<template><div ref="host" class="markdown-editor" /></template>
<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue'
import {EditorView,placeholder} from '@codemirror/view'
import {EditorState,Compartment,Transaction} from '@codemirror/state'
import {basicSetup} from 'codemirror'
import {markdown} from '@codemirror/lang-markdown'
import {oneDark} from '@codemirror/theme-one-dark'
import {session} from '@/stores/session'
const props=defineProps<{modelValue:string}>()
const emit=defineEmits<{(e:'update:modelValue',value:string):void;(e:'paste',event:ClipboardEvent):void}>()
const host=ref<HTMLElement>();let editor:EditorView|undefined
const appearance=new Compartment()
onMounted(()=>{
 editor=new EditorView({parent:host.value,state:EditorState.create({doc:props.modelValue,extensions:[basicSetup,markdown(),EditorView.lineWrapping,
  appearance.of(session.theme==='dark'?oneDark:[]),
  placeholder('直接写内容，支持 Markdown 排版；Ctrl / Command + F 查找'),
  EditorView.contentAttributes.of({'aria-label':'笔记正文'}),
  EditorView.domEventHandlers({paste:event=>{emit('paste',event);return event.defaultPrevented}}),
  EditorView.updateListener.of(update=>{if(update.docChanged)emit('update:modelValue',update.state.doc.toString())}),
 ]})})
})
watch(()=>props.modelValue,value=>{if(editor&&editor.state.doc.toString()!==value)editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:value},annotations:Transaction.addToHistory.of(false)})})
watch(()=>session.theme,theme=>editor?.dispatch({effects:appearance.reconfigure(theme==='dark'?oneDark:[])}))
onBeforeUnmount(()=>editor?.destroy())
defineExpose({focus:()=>editor?.focus()})
</script>
<style scoped>
.markdown-editor { height:100%;min-height:160px;min-width:0; }
.markdown-editor :deep(.cm-editor) { height:100%;background:var(--wb-surface);color:var(--wb-text);font-size:14px; }
.markdown-editor :deep(.cm-scroller) { overflow:auto;font-family:var(--el-font-family);line-height:1.7; }
.markdown-editor :deep(.cm-gutters) { background:var(--wb-surface-subtle);color:var(--wb-text-tertiary);border-color:var(--wb-border); }
.markdown-editor :deep(.cm-focused) { outline:2px solid var(--wb-focus-ring);outline-offset:-2px; }
</style>