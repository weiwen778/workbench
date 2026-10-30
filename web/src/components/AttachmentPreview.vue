<template>
  <el-dialog :model-value="modelValue" :title="file?.name || '附件预览'" width="min(960px, 96vw)" top="5vh" @update:model-value="$emit('update:modelValue', $event)" @opened="load" @closed="dispose">
    <div v-if="isPdf" class="pdf-preview">
      <div class="toolbar-actions pdf-tools">
        <el-button :disabled="!pdf || page <= 1" @click="move(-1)">上一页</el-button>
        <span>第 {{ page }} / {{ pages }} 页</span>
        <el-button :disabled="!pdf || page >= pages" @click="move(1)">下一页</el-button>
        <el-button :disabled="!pdf" @click="zoom(-0.2)">缩小</el-button>
        <el-button :disabled="!pdf" @click="zoom(0.2)">放大</el-button>
        <el-button :disabled="!pdf" @click="fit">适合宽度</el-button>
      </div>
      <el-alert v-if="error" type="error" :closable="false" :title="error" />
      <div ref="viewport" v-loading="loading" class="pdf-viewport"><canvas ref="canvas" aria-label="PDF 页面" /></div>
    </div>
    <el-image v-else-if="file?.is_image" :src="url" :preview-src-list="[url]" fit="contain" style="width:100%;max-height:70vh" />
    <p v-else>此类型请下载后查看。</p>
    <template #footer><div class="toolbar-actions"><el-link :href="`/api/v1/files/${file?.id}/download`" target="_blank">下载文件</el-link><el-button @click="$emit('update:modelValue', false)">关闭</el-button></div></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { http } from '@/api/client'
const props = defineProps<{ modelValue: boolean; file: any | null }>()
defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
const pdf = shallowRef<PDFDocumentProxy | null>(null)
const page = ref(1), pages = ref(0), scale = ref(1), loading = ref(false), error = ref('')
const canvas = ref<HTMLCanvasElement | null>(null), viewport = ref<HTMLElement | null>(null)
const isPdf = computed(() => props.file?.is_pdf || props.file?.name?.toLowerCase().endsWith('.pdf'))
const url = computed(() => `/api/v1/files/${props.file?.id}/content`)
let sequence = 0, renderTask: RenderTask | null = null, documentTask: PDFDocumentLoadingTask | null = null
function dispose() {
  sequence++
  renderTask?.cancel(); renderTask = null
  if (documentTask) void documentTask.destroy().catch(() => {})
  documentTask = null; pdf.value = null; loading.value = false
}
async function load() {
  dispose(); error.value = ''; pages.value = 0; page.value = 1
  if (!isPdf.value || !props.file?.id) return
  const current = ++sequence
  loading.value = true
  try {
    const response = await http.get(`/files/${props.file.id}/content`, { responseType: 'arraybuffer' })
    if (current !== sequence) return
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    if (current !== sequence) return
    GlobalWorkerOptions.workerSrc = workerUrl
    const task = getDocument({ data: new Uint8Array(response.data), cMapUrl: '/pdfjs/6.4.299/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/6.4.299/standard_fonts/', wasmUrl: '/pdfjs/6.4.299/wasm/' })
    documentTask = task
    const document = await task.promise
    if (current !== sequence) { void task.destroy().catch(() => {}); return }
    pdf.value = document; pages.value = document.numPages
    await nextTick(); await fit()
  } catch {
    if (current === sequence) error.value = 'PDF 无法读取，请重试或下载查看。'
  } finally { if (current === sequence) loading.value = false }
}
async function render() {
  if (!pdf.value || !canvas.value) return
  const current = ++sequence
  renderTask?.cancel()
  loading.value = true
  try {
    const pdfPage = await pdf.value.getPage(page.value)
    if (current !== sequence || !canvas.value) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const view = pdfPage.getViewport({ scale: scale.value * ratio })
    canvas.value.width = Math.ceil(view.width); canvas.value.height = Math.ceil(view.height)
    canvas.value.style.width = `${view.width / ratio}px`; canvas.value.style.height = `${view.height / ratio}px`
    renderTask = pdfPage.render({ canvas: canvas.value, canvasContext: canvas.value.getContext('2d')!, viewport: view })
    await renderTask.promise
  } catch (cause: any) {
    if (current === sequence && cause?.name !== 'RenderingCancelledException') error.value = 'PDF 页面加载失败，请重试。'
  } finally { if (current === sequence) loading.value = false }
}
async function fit() {
  if (!pdf.value || !viewport.value) return
  const document = pdf.value
  try {
    const first = await document.getPage(page.value)
    if (pdf.value !== document || !viewport.value) return
    scale.value = Math.max(0.25, Math.min(3, (viewport.value.clientWidth - 24) / first.getViewport({ scale: 1 }).width))
    await render()
  } catch { if (pdf.value === document) error.value = 'PDF 页面加载失败，请重试。' }
}
function move(delta: number) { page.value = Math.max(1, Math.min(pages.value, page.value + delta)); void render() }
function zoom(delta: number) { scale.value = Math.max(0.25, Math.min(3, scale.value + delta)); void render() }
onBeforeUnmount(dispose)
</script>

<style scoped>
.pdf-tools { flex-wrap: wrap; margin-bottom: 12px; }
.pdf-viewport { height: min(62vh, 680px); min-height: 240px; overflow: auto; background: var(--el-fill-color-light); padding: 12px; }
.pdf-viewport canvas { display: block; margin: auto; }
</style>
