<template>
  <div class="notes-layout" :class="{ 'has-current': !!current }">
    <!-- 列表 -->
    <div class="note-list-pane">
      <div class="list-toolbar">
        <div v-if="selectedFolder" class="note-category-heading">
          <el-dropdown v-if="selectedFolder" trigger="click" @command="folderCommand">
            <el-button text size="small" :icon="MoreFilled" aria-label="文件夹操作" />
            <template #dropdown><el-dropdown-menu><el-dropdown-item command="rename">重命名文件夹</el-dropdown-item><el-dropdown-item command="delete">删除文件夹</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
        </div>
        <el-alert v-if="missingFolder" title="文件夹不存在或已删除" type="error" :closable="false" />
        <el-popover placement="bottom-start" :width="290" trigger="click">
          <template #reference><el-button text size="small" class="tag-filter-button">{{ selectedTag ? `标签：${selectedTag.name}` : '标签筛选' }}</el-button></template>
          <div class="tag-list">
            <el-tag v-for="tag in tags" :key="tag.id" :effect="filter.tagId === tag.id ? 'dark' : 'plain'" size="small" class="tag-chip" @click="selectTag(tag.id)" @close="removeTag(tag)" closable>{{ tag.name }} {{ tag.note_count }}</el-tag>
            <div v-if="!tags.length" class="text-12 muted">还没有标签，可在编辑笔记时添加</div>
          </div>
        </el-popover>
        <el-input v-model="keyword" size="small" placeholder="搜索标题或正文" clearable :prefix-icon="Search" @input="onSearch" />
        <el-button class="btn-tonal" size="small" :icon="Plus" :disabled="missingFolder" style="width: 100%; margin-top: 6px" @click="createNote">
          新建笔记
        </el-button>
      </div>
      <el-pagination v-if="noteTotal>50" v-model:current-page="notePage" small :page-size="50" :total="noteTotal" layout="prev,pager,next" @current-change="loadNotes"/>
      <div class="note-list">
        <div
          v-for="item in notes"
          :key="item.id"
          class="note-item"
          :class="{ active: item.id === current?.id }"
          @click="openNote(item.id)"
        >
          <div class="note-item-title ellipsis-1">{{ item.title }}</div>
          <div class="note-item-excerpt">{{ item.excerpt || '空白笔记' }}</div>
          <div class="note-item-meta">
            <span>{{ formatDate(item.updated_at) }}</span>
            <span v-if="item.tags.length">{{ item.tags.join(' · ') }}</span>
          </div>
        </div>
        <div v-if="!notes.length" class="empty-hint" style="padding: 24px 8px">
          <div>{{ keyword ? '没有匹配的笔记' : '还没有笔记' }}</div>
        </div>
      </div>
    </div>

    <!-- 编辑器 -->
    <div class="editor-pane">
      <el-button v-if="current" text class="editor-back" @click="backToList">返回笔记列表</el-button>
      <template v-if="current">
        <div class="editor-toolbar">
          <el-select v-model="folderId" aria-label="笔记所属文件夹" size="small" placeholder="未分类" clearable @clear="folderId = null; markDirty()" style="width: 130px" @change="markDirty">
            <el-option v-for="folder in folderData.folders" :key="folder.id" :label="folder.name" :value="folder.id" />
          </el-select>
          <el-select
            v-model="tagNames"
            size="small"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="标签"
            style="min-width: 160px; max-width: 260px"
            @change="markDirty"
          >
            <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.name" />
          </el-select>
          <div class="spacer" />
          <span class="save-state" :class="saveState" role="status" aria-live="polite">{{ saveLabel }}</span>
          <el-upload :show-file-list="false" :http-request="uploadImage" accept="image/*">
            <el-button text size="small" :icon="Picture">插入图片</el-button>
          </el-upload>
          <el-button text size="small" :icon="Clock" @click="openRevisions">历史版本</el-button>
          <el-button text size="small" :icon="View" @click="cycleMode">{{ modeLabel }}</el-button>
          <el-button size="small" type="primary" :loading="saving" @click="save('manual')">保存</el-button>
        </div>

        <div v-if="conflict" class="conflict-bar">
          这篇笔记在别处被改过，你写的内容还留在这里。
          <el-button text size="small" @click="reloadServer">换成最新的</el-button>
          <el-button text size="small" @click="forceSave">按我写的保存</el-button>
        </div>

        <el-input v-model="title" class="title-input" maxlength="200" placeholder="未命名笔记" />

        <div class="editor-body" :class="mode">
          <div v-show="mode !== 'preview'" class="editor-col">
            <MarkdownEditor :key="current.id" ref="textareaRef" v-model="content" @paste="onPaste" />
          </div>
          <div v-show="mode !== 'edit'" class="preview-col markdown-body" v-html="rendered"></div>
        </div>
      </template>
      <div v-else class="empty-hint">选择左侧笔记开始编辑</div>
    </div>

    <!-- 历史版本 -->
    <el-drawer v-model="revisionsOpen" title="历史版本" size="460px">
      <div v-if="revisions.length" class="revision-list">
        <div v-for="rev in revisions" :key="rev.id" class="revision-item">
          <div class="text-13"><b>{{ rev.title }}</b></div>
          <div class="text-12 muted">{{ formatDate(rev.created_at) }} · {{ reasonText(rev.reason) }}</div>
          <div class="text-12 secondary ellipsis-1">{{ rev.excerpt }}</div>
          <div class="toolbar-actions" style="margin-top: 4px">
            <el-button text size="small" @click="previewRevision(rev)">查看</el-button>
            <el-button text size="small" @click="restoreRevision(rev)">恢复此版本</el-button>
          </div>
        </div>
      </div>
      <div v-else class="empty-hint">还没有历史版本</div>
    </el-drawer>

    <el-dialog v-model="revisionPreviewOpen" :title="previewing?.title || '历史版本'" width="680px">
      <div class="markdown-body" v-html="previewHtml"></div>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="revisionPreviewOpen = false">关闭</el-button>
          <el-button type="primary" @click="previewing && restoreRevision(previewing)">恢复此版本</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Clock, MoreFilled, Picture, Plus, Search, View } from '@/icons'
import { apiError, http } from '@/api/client'

const route = useRoute(), router = useRouter()
const routeFolder = String(route.params.folderKey || '')
const missingFolder = ref(false)
const folderData = reactive<{ folders: any[]; uncategorized: number }>({ folders: [], uncategorized: 0 })
const tags = ref<any[]>([])
const notes = ref<any[]>([])
const current = ref<any>(null)
const title = ref('')
const content = ref('')
const folderId = ref<number | null>(null)
const tagNames = ref<string[]>([])
const keyword = ref('')
const filter = reactive<{ folderId: number | null; uncategorized: boolean; tagId: number | null }>({
  folderId: /^\d+$/.test(routeFolder) ? Number(routeFolder) : null,
  uncategorized: routeFolder === 'uncategorized',
  tagId: null,
})
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saving = ref(false)
const conflict = ref(false)
const version = ref(0)
const mode = ref<'split' | 'edit' | 'preview'>('split')
const revisionsOpen = ref(false)
const revisions = ref<any[]>([])
const revisionPreviewOpen = ref(false)
const previewing = ref<any>(null)
const previewHtml = ref('')
const textareaRef = ref<any>(null)
const loading = ref(false)

let saveTimer: number | null = null
let searchTimer: number | null = null
let suppressWatch = false
let saveInFlight: Promise<boolean> | null = null
const selectedFolder = computed(() => folderData.folders.find(folder => folder.id === filter.folderId))
const selectedTag = computed(() => tags.value.find(tag => tag.id === filter.tagId))
const currentFolderLabel = computed(() => selectedFolder.value?.name || (filter.uncategorized ? '未分类' : missingFolder.value ? '文件夹不存在' : '全部笔记'))

const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'error') return '保存失败'
  if (saveState.value === 'saved') return '已保存'
  return '未修改'
})
const modeLabel = computed(() => ({ split: '单栏', edit: '只看编辑', preview: '只看预览' }[mode.value]))

const rendered = computed(() => {
  const html = marked.parse(content.value || '', { async: false }) as string
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'iframe', 'style', 'form'], FORBID_ATTR: ['onerror', 'onclick'] })
})

function formatDate(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function reasonText(reason: string) {
  return { auto: '首次保存', interval: '自动保存', manual: '手动保存', restore: '恢复前备份' }[reason] || reason
}

async function loadFolders() {
  const { data } = await http.get('/note-folders')
  folderData.folders = data.folders
  folderData.uncategorized = data.uncategorized
  const { data: tagList } = await http.get('/note-tags')
  tags.value = tagList
  window.dispatchEvent(new Event('wb:notes-changed'))
}

const notePage=ref(1),noteTotal=ref(0)
let noteRequest=0
async function loadNotes() {
  const request=++noteRequest
  loading.value = true
  try {
    const params: Record<string, any> = { summary: true, page:notePage.value,page_size:50 }
    if (filter.folderId) params.folder_id = filter.folderId
    if (filter.uncategorized) params.uncategorized = true
    if (filter.tagId) params.tag_id = filter.tagId
    if (keyword.value.trim()) params.q = keyword.value.trim()
    const { data } = await http.get('/notes', { params })
    if(request!==noteRequest)return
    notes.value = data.items
    notePage.value=data.page
    noteTotal.value=data.total
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  notePage.value=1
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(loadNotes, 300)
}

function selectTag(id: number) {
  notePage.value=1
  filter.tagId = filter.tagId === id ? null : id
  loadNotes()
}

async function removeFolder(folder: any) {
  try {
    if (!await guardNavigation()) return
    await ElMessageBox.confirm(`删除文件夹「${folder.name}」？里面的笔记会移到「未分类」，笔记本身不会删。`, '删除文件夹', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.delete(`/note-folders/${folder.id}`)
    current.value = null
    await loadFolders()
    router.replace('/notes/uncategorized')
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function folderCommand(command: string) {
  const folder = selectedFolder.value
  if (!folder) return
  if (command === 'delete') { await removeFolder(folder); return }
  try {
    const { value } = await ElMessageBox.prompt('文件夹名称', '重命名文件夹', { inputValue: folder.name, inputValidator: v => !!v?.trim() && v.trim().length <= 100 || '请输入 1–100 个字', confirmButtonText: '保存', cancelButtonText: '取消' })
    await http.patch(`/note-folders/${folder.id}`, { name: value.trim() })
    await loadFolders()
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}

async function removeTag(tag: any) {
  try {
    await http.delete(`/note-tags/${tag.id}`)
    if (filter.tagId === tag.id) filter.tagId = null
    await Promise.all([loadFolders(), loadNotes()])
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function createNote() {
  if (!await guardNavigation()) return
  try {
    const { data } = await http.post('/notes', {
      title: '',
      content: '',
      folder_id: filter.folderId,
      tags: [],
    })
    await Promise.all([loadNotes(), loadFolders()])
    await openNote(data.id, true)
    // 新建后直接聚焦标题
    setTimeout(() => {
      const input = document.querySelector('.title-input input') as HTMLInputElement | null
      input?.focus()
    }, 100)
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function openNote(id: number, skipGuard = false) {
  if (!skipGuard && (hasUnsaved() || saveInFlight)) {
    if (!await save('manual')) return
  }
  try {
    const { data } = await http.get(`/notes/${id}`)
    suppressWatch = true
    current.value = data
    title.value = data.raw_title ?? data.title
    content.value = data.content
    folderId.value = data.folder_id
    tagNames.value = [...data.tags]
    version.value = data.version
    saveState.value = 'idle'
    conflict.value = false
    suppressWatch = false
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function hasUnsaved() {
  if (!current.value) return false
  return (
    title.value !== (current.value.raw_title || '') ||
    content.value !== current.value.content ||
    folderId.value !== current.value.folder_id ||
    JSON.stringify(tagNames.value) !== JSON.stringify(current.value.tags)
  )
}

function markDirty() {
  if (suppressWatch || !current.value) return
  saveState.value = 'idle'
  scheduleSave()
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => save('auto'), 1500)
}

async function save(mode: 'auto' | 'manual'): Promise<boolean> {
  if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null }
  while (saveInFlight) { if (!await saveInFlight) return false }
  if (!current.value || !hasUnsaved()) return true
  const request = performSave(mode)
  saveInFlight = request
  try { return await request } finally { if (saveInFlight === request) saveInFlight = null }
}

async function performSave(mode: 'auto' | 'manual'): Promise<boolean> {
  if (!current.value) return true
  saving.value = true
  saveState.value = 'saving'
  try {
    const { data } = await http.put(`/notes/${current.value.id}`, {
      title: title.value,
      content: content.value,
      folder_id: folderId.value ?? null,
      tags: tagNames.value,
      version: version.value,
      mode,
    })
    version.value = data.version
    current.value = data
    saveState.value = 'saved'
    conflict.value = false
    await Promise.all([loadNotes(), loadFolders()])
    return true
  } catch (error: any) {
    saveState.value = 'error'
    if (error?.response?.status === 409) {
      conflict.value = true
      ElMessage.warning('这篇笔记在别处被改过，你的内容没有覆盖它')
    } else {
      ElMessage.error(apiError(error).message)
    }
    return false
  } finally {
    saving.value = false
  }
}

async function forceSave() {
  if (!current.value) return
  try {
    const { data: latest } = await http.get(`/notes/${current.value.id}`)
    version.value = latest.version
    conflict.value = false
    if (await save('manual')) ElMessage.success('已用当前内容覆盖')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function reloadServer() {
  if (!current.value) return
  await openNote(current.value.id, true)
  conflict.value = false
  ElMessage.success('已载入最新内容')
}

async function uploadImage(options: any) {
  const form = new FormData()
  form.append('file', options.file)
  try {
    const { data } = await http.post('/files', form)
    const snippet = `\n![${data.name}](/api/v1/files/${data.id}/content)\n`
    content.value = `${content.value}${snippet}`
    markDirty()
    ElMessage.success('图片已插入正文，保存后生效')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        event.preventDefault()
        await uploadImage({ file })
      }
    }
  }
}

function cycleMode() {
  const order: Array<'split' | 'edit' | 'preview'> = window.innerWidth < 1024 ? ['edit', 'preview'] : ['split', 'edit', 'preview']
  const index = order.indexOf(mode.value)
  mode.value = order[(index + 1) % order.length]
}

async function openRevisions() {
  if (!current.value) return
  revisionsOpen.value = true
  try {
    const { data } = await http.get(`/notes/${current.value.id}/revisions`)
    revisions.value = data
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function previewRevision(rev: any) {
  try {
    const { data } = await http.get(`/notes/${current.value.id}/revisions/${rev.id}`)
    previewing.value = data
    previewHtml.value = DOMPurify.sanitize(marked.parse(data.content || '', { async: false }) as string)
    revisionPreviewOpen.value = true
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function restoreRevision(rev: any) {
  try {
    await ElMessageBox.confirm('恢复后会用这个旧版本盖掉现在的标题和正文（现在的内容会先存成一个历史版本）。', '恢复历史版本', {
      type: 'warning',
      confirmButtonText: '恢复',
      cancelButtonText: '取消',
    })
    const { data } = await http.post(`/notes/${current.value.id}/revisions/${rev.id}/restore`)
    revisionPreviewOpen.value = false
    revisionsOpen.value = false
    suppressWatch = true
    title.value = data.raw_title ?? data.title
    content.value = data.content
    version.value = data.version
    current.value = data
    saveState.value = 'saved'
    suppressWatch = false
    await Promise.all([loadNotes(), loadFolders()])
    ElMessage.success('已恢复')
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

watch([title, content], markDirty)

async function guardNavigation() {
  if (hasUnsaved() || saveInFlight) return await save('manual')
  return true
}
onBeforeRouteLeave(guardNavigation)
onBeforeRouteUpdate(guardNavigation)
async function backToList() { if (await guardNavigation()) current.value = null }

function beforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsaved()) {
    event.preventDefault()
    event.returnValue = ''
  }
}

onMounted(async () => {
  if (window.innerWidth < 1024) mode.value = 'edit'
  await loadFolders()
  missingFolder.value = !!routeFolder && routeFolder !== 'uncategorized' && !folderData.folders.some(folder => String(folder.id) === routeFolder)
  if (!missingFolder.value) await loadNotes()
  if (route.query.note) await openNote(Number(route.query.note),true)
  else if (notes.value.length && window.innerWidth > 700) await openNote(notes.value[0].id, true)
  window.addEventListener('beforeunload', beforeUnload)
})

onUnmounted(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<style scoped>
.notes-layout {
  display: flex;
  height: 100%;
  min-height: 0;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 4px;
}
.tag-chip {
  cursor: pointer;
}
.note-list-pane {
  width: 252px;
  flex: 0 0 252px;
  border-right: 1px solid var(--wb-border);
  background: var(--wb-surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.note-category-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 13px; }
.note-category-heading strong { min-width: 0; }
.editor-back { display: none; }
.list-toolbar {
  padding: 8px 10px;
  border-bottom: 1px solid var(--wb-border);
}
.note-list {
  flex: 1;
  overflow: auto;
}
.note-item {
  padding: 8px 10px;
  border-bottom: 1px solid var(--wb-border);
  cursor: pointer;
}
.note-item:hover {
  background: var(--el-color-primary-light-9);
}
.note-item.active {
  background: var(--el-color-primary-light-9);
}
.note-item-title {
  font-size: 13.5px;
  font-weight: 600;
}
.note-item-excerpt {
  font-size: 12px;
  color: var(--wb-text-secondary);
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.note-item-meta {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 11.5px;
  color: var(--wb-text-tertiary);
  margin-top: 4px;
}
.editor-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--wb-surface);
  min-height: 0;
}
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--wb-border);
}
.save-state {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--wb-surface-subtle);
  font-weight: 500;
  font-size: 12px;
  color: var(--wb-text-tertiary);
}
.save-state.saved {
  color: var(--el-color-success);
}
.save-state.saving {
  color: var(--wb-primary);
}
.save-state.error {
  color: var(--el-color-danger);
}
.conflict-bar {
  margin: 8px 12px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.title-input {
  padding: 10px 12px 4px;
}
.title-input :deep(.el-input__wrapper) {
  box-shadow: none;
  padding: 0;
}
.title-input :deep(.el-input__inner) {
  font-size: 18px;
  font-weight: 600;
}
.editor-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--wb-border);
  margin-top: 6px;
}
.editor-body.edit,
.editor-body.preview {
  grid-template-columns: 1fr;
}
.editor-col,
.preview-col {
  background: var(--wb-surface);
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
}
.editor-col :deep(.el-textarea),
.editor-col :deep(.el-textarea__inner) {
  height: 100%;
  box-shadow: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
  background: transparent;
  resize: none;
}
.revision-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--wb-border);
}
@media (max-width: 1100px) {
  .note-list-pane {
    width: 220px;
    flex-basis: 220px;
  }
  .editor-body {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
@media (max-width: 700px) {
  .note-list-pane { width: 100%; flex: 1; }
  .notes-layout.has-current .note-list-pane { display: none; }
  .notes-layout:not(.has-current) .editor-pane { display: none; }
  .editor-back { display: inline-flex; align-self: flex-start; margin: 6px; }
  .editor-toolbar { padding: 8px; }
  .editor-body { grid-template-columns: 1fr; }
}
</style>
