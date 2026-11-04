<template>
  <div class="page memos-page">
    <div class="page-toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索标题或正文"
        clearable
        style="width: 220px"
        :prefix-icon="Search"
        @input="onSearch"
      />
      <span class="text-12 muted">{{ memoTotal }} 张便利贴</span>
      <div class="spacer" />
      <div class="toolbar-actions">
        <label class="memo-columns-label">每行 <el-select v-model="columns" aria-label="便利贴每行列数" style="width:100px" @change="rememberColumns"><el-option label="自动" :value="0"/><el-option v-for="n in 8" :key="n" :label="`${n} 列`" :value="n"/></el-select></label>
        <CategoryManager resource="memos" @changed="load" />
        <el-button text :icon="Refresh" @click="load">刷新</el-button>
        <el-button class="btn-tonal" :icon="Plus" @click="openCreate">新建便利贴</el-button>
      </div>
    </div>

    <div class="page-body scroll-area memo-board">
      <div v-if="!memos.length && !loading" class="empty-hint">
        <div>{{ keyword ? '没有匹配的便利贴' : '还没有便利贴' }}</div>
        <div class="text-12">记录供应商信息、临时号码这类短内容，可以直接复制正文</div>
        <el-button class="btn-tonal" @click="openCreate">写一张便利贴</el-button>
      </div>

      <el-pagination v-if="memoTotal>50" v-model:current-page="memoPage" :page-size="50" :total="memoTotal" layout="total,prev,pager,next" @current-change="load" style="margin-bottom:16px"/>
      <div class="memo-grid" :style="{gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : undefined}">
        <div v-for="memo in memos" :key="memo.id" class="memo-card" :class="`c-${memo.color}`">
          <div class="memo-head">
            <button class="memo-title" @click="viewing=memo">{{ memo.display_title }}</button>
          </div>
          <MemoContent :content="memo.content" @expand="viewing=memo" />
          <div class="memo-foot">
            <div class="memo-meta">
              <time class="memo-date" :datetime="memo.updated_at" :title="new Date(memo.updated_at).toLocaleString('zh-CN')">更新于 {{ formatDate(memo.updated_at) }}</time>
              <span class="memo-chip"><el-icon><Folder/></el-icon><span>{{ memo.display_category }}</span></span>
            </div>
            <div class="actions-group memo-actions">
              <el-button text class="memo-action" :icon="CopyDocument" title="复制正文" aria-label="复制正文" @click="copyContent(memo)" />
              <el-button text class="memo-action" :icon="Edit" title="编辑" aria-label="编辑便利贴" @click="openEdit(memo)" />
              <el-button text class="memo-action memo-delete" :icon="Delete" title="删除" aria-label="删除便利贴" @click="remove(memo)" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <el-dialog :model-value="!!viewing" :title="viewing?.display_title" width="min(720px,94vw)" @close="viewing=null">
      <div class="memo-reader">{{ viewing?.content }}</div>
      <template #footer><el-button @click="copyContent(viewing)">复制正文</el-button><el-button type="primary" @click="openEdit(viewing); viewing=null">编辑</el-button></template>
    </el-dialog>
    <el-dialog
      v-model="dialogOpen"
      :title="editing ? '编辑便利贴' : '新建便利贴'"
      width="min(640px,94vw)"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item label="标题（可选）">
          <el-input v-model="form.title" maxlength="200" placeholder="不填则显示为无标题便利贴" />
        </el-form-item>
        <el-form-item label="正文" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 16 }"
            maxlength="2000"
            show-word-limit
            placeholder="随手记内容，Ctrl / Command + Enter 保存"
            @keydown.ctrl.enter.prevent="save"
            @keydown.meta.enter.prevent="save"
          />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="分类（可选）">
            <el-select
              v-model="form.category"
              filterable
              allow-create
              default-first-option
              clearable
              placeholder="选择或输入新分类"
              style="width: 100%"
            >
              <el-option v-for="name in categories" :key="name" :label="name" :value="name" />
            </el-select>
          </el-form-item>
          <el-form-item label="背景颜色">
            <div class="color-row">
              <span
                v-for="color in colors"
                :key="color.value"
                class="color-dot"
                :class="[`dot-${color.value}`, { active: form.color === color.value }]"
                :title="color.label"
                @click="form.color = color.value"
              />
            </div>
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="dialogOpen = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import CategoryManager from '@/components/CategoryManager.vue'
import MemoContent from '@/components/MemoContent.vue'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Edit, Folder, Plus, Refresh, Search } from '@/icons'
import { apiError, copyText, http } from '@/api/client'
import { memoFilter, memoTitle } from '@/memo-navigation'

const viewing=ref<any>(null)
const columns=ref(Math.min(8,Math.max(0,Number(localStorage.getItem('wb_memo_columns'))||0)))
function rememberColumns(){localStorage.setItem('wb_memo_columns',String(columns.value))}
const memos = ref<any[]>([])
const categories = ref<string[]>([])
const keyword = ref('')
const route = useRoute()
const selection = computed(() => memoFilter(route.query))
const category = computed(() => selection.value.uncategorized ? '__uncategorized__' : selection.value.category)
const currentCategoryLabel = computed(() => memoTitle(route.query))
const loading = ref(false)
const dialogOpen = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const form = reactive<{ title: string; content: string; category: string; color: string }>({
  title: '',
  content: '',
  category: '',
  color: 'default',
})

const colors = [
  { value: 'default', label: '默认' },
  { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' },
  { value: 'blue', label: '蓝色' },
  { value: 'pink', label: '粉色' },
  { value: 'purple', label: '紫色' },
]

let searchTimer: number | null = null

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : ''
}

const memoPage=ref(1),memoTotal=ref(0)
let memoRequest=0
async function load() {
  const request=++memoRequest
  loading.value = true
  try {
    const params: Record<string, any> = {page:memoPage.value,page_size:50}
    if (category.value) params.category = category.value
    if (keyword.value.trim()) params.q = keyword.value.trim()
    const [{ data }, { data: cats }] = await Promise.all([
      http.get('/memos', { params }),
      http.get('/memos/categories'),
    ])
    if(request!==memoRequest)return
    memoPage.value=data.page
    memoTotal.value=data.total
    memos.value = data.items
    categories.value = cats
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  memoPage.value=1
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(load, 300)
}

function openCreate() {
  editing.value = null
  form.title = ''
  form.content = ''
  form.category = selection.value.category
  form.color = 'default'
  dialogOpen.value = true
}

function openEdit(memo: any) {
  editing.value = memo
  form.title = memo.title
  form.content = memo.content
  form.category = memo.category
  form.color = memo.color
  dialogOpen.value = true
}

async function save() {
  if (!form.content.trim()) {
    ElMessage.warning('正文不能为空')
    return
  }
  saving.value = true
  try {
    if (editing.value) {
      await http.patch(`/memos/${editing.value.id}`, {
        title: form.title,
        content: form.content,
        category: form.category || '',
        color: form.color,
        version: editing.value.version,
      })
    } else {
      await http.post('/memos', {
        title: form.title || null,
        content: form.content,
        category: form.category || null,
        color: form.color,
      })
    }
    dialogOpen.value = false
    ElMessage.success('已保存')
    await load()
    window.dispatchEvent(new Event('wb:memos-changed'))
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    saving.value = false
  }
}

async function remove(memo: any) {
  try {
    await ElMessageBox.confirm('删除这张便利贴？删除后可在回收站保留 30 天。', '删除便利贴', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.delete(`/memos/${memo.id}`)
    await load()
    window.dispatchEvent(new Event('wb:memos-changed'))
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function copyContent(memo: any) {
  const ok = await copyText(memo.content)
  if (ok) {
    ElMessage.success('已复制正文')
  } else {
    ElMessage.warning('浏览器不让自动复制，请打开便利贴后手动选中复制')
  }
}

onMounted(async()=>{await load();if(route.query.focus){try{openEdit((await http.get('/memos/'+Number(route.query.focus))).data)}catch(e){ElMessage.error(apiError(e).message)}}})
onUnmounted(() => { if (searchTimer) window.clearTimeout(searchTimer) })
</script>

<style scoped>
.memo-board { background:color-mix(in srgb,var(--wb-surface-subtle) 36%,var(--wb-surface)); }
.memo-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; grid-auto-rows:360px; }
.memo-card {
  --memo-accent:#718096;
  --memo-paper:var(--wb-memo-default);
  position:relative; container-type:inline-size; min-width:0; height:360px; box-sizing:border-box; overflow:hidden;
  display:flex; flex-direction:column; gap:0; padding:22px 20px 16px;
  border:1px solid color-mix(in srgb,var(--memo-accent) 19%,var(--wb-border)); border-radius:14px;
  color:var(--wb-text); font-family:var(--el-font-family);
  box-shadow:0 2px 5px rgba(20,30,45,.035);
  transition:border-color .16s ease,box-shadow .16s ease;
}
.memo-card::before { content:''; position:absolute; top:0; left:20px; width:28px; height:3px; border-radius:0 0 3px 3px; background:var(--memo-accent); }
.memo-card.c-default,.memo-card.c-yellow,.memo-card.c-green,.memo-card.c-blue,.memo-card.c-pink,.memo-card.c-purple { background:color-mix(in srgb,var(--memo-paper) 40%,var(--wb-surface)); color:var(--wb-text); }
.memo-card.c-yellow { --memo-accent:var(--wb-memo-yellow-text); --memo-paper:var(--wb-memo-yellow); }
.memo-card.c-green { --memo-accent:var(--wb-memo-green-text); --memo-paper:var(--wb-memo-green); }
.memo-card.c-blue { --memo-accent:var(--wb-memo-blue-text); --memo-paper:var(--wb-memo-blue); }
.memo-card.c-pink { --memo-accent:var(--wb-memo-pink-text); --memo-paper:var(--wb-memo-pink); }
.memo-card.c-purple { --memo-accent:var(--wb-memo-purple-text); --memo-paper:var(--wb-memo-purple); }
.memo-card:hover,.memo-card:focus-within { border-color:color-mix(in srgb,var(--memo-accent) 50%,var(--wb-border)); box-shadow:0 4px 14px rgba(20,30,45,.065); }
.memo-head { min-width:0; margin-bottom:12px; flex:none; }
.memo-card :deep(.memo-body) { flex:1; min-height:0; overflow:hidden; }
.memo-card :deep(.memo-content) { white-space:pre-wrap; overflow-wrap:anywhere; min-height:0; flex-shrink:1; }
.memo-card :deep(.expand-content) { flex-shrink:0; }
.memo-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.memo-title { display:block; width:100%; border:0; background:none; padding:0; font:inherit; font-size:16px; line-height:1.5; font-weight:650; letter-spacing:.1px; color:var(--wb-text); text-align:left; cursor:pointer; overflow-wrap:anywhere; }
.memo-title:focus-visible { outline:2px solid var(--wb-primary); outline-offset:4px; border-radius:3px; }
.memo-card :deep(.memo-content) { opacity:1; font-size:14px; line-height:1.85; color:var(--wb-text-secondary); }
.memo-foot { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-top:12px; flex:none; padding-top:12px; border-top:1px solid color-mix(in srgb,var(--memo-accent) 12%,var(--wb-border)); }
.memo-meta { display:flex; flex-direction:column; align-items:flex-start; gap:7px; min-width:0; flex:1; }
.memo-date { font-size:12px; line-height:1.5; color:var(--wb-text-secondary); font-variant-numeric:tabular-nums; }
.memo-meta .memo-chip { display:inline-flex; align-items:flex-start; gap:5px; max-width:100%; min-height:0; height:auto; padding:0; border-radius:0; background:none; color:var(--wb-text-secondary); font-size:12px; line-height:1.6; }
.memo-chip .el-icon { flex:none; margin-top:2px; font-size:13px; color:var(--memo-accent); }
.memo-chip>span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.memo-actions { display:flex; flex:none; gap:2px; }
.memo-actions :deep(.memo-action) { width:40px; height:40px; padding:0; margin:0; border:1px solid transparent; border-radius:9px; color:var(--wb-text-secondary); font-size:18px; background:transparent; }
.memo-actions :deep(.memo-action:hover),.memo-actions :deep(.memo-action:focus-visible) { background:var(--wb-surface); border-color:var(--wb-border); color:var(--wb-primary); }
.memo-actions :deep(.memo-action:active) { background:var(--wb-pressed); transform:scale(.95); }
.memo-actions :deep(.memo-delete:hover),.memo-actions :deep(.memo-delete:focus-visible) { color:var(--el-color-danger); }
@container(max-width:220px){.memo-foot{flex-direction:column;align-items:stretch;gap:6px}.memo-actions{width:100%;justify-content:flex-end;gap:0}.memo-actions :deep(.memo-action){flex:1;min-width:0;max-width:40px;width:auto}}
@media(max-width:700px){.memo-grid{grid-template-columns:minmax(0,1fr)!important}.memo-card{padding:20px 18px 14px}.memo-foot{gap:8px}.memo-actions{gap:0}}
@media(prefers-reduced-motion:reduce){.memo-card,.memo-actions :deep(.memo-action){transition:none}}
.memo-reader { white-space:pre-wrap; overflow-wrap:anywhere; font-size:16px; line-height:1.8; color:var(--wb-text); }
.memo-columns-label {display:flex;align-items:center;gap:6px;white-space:nowrap}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.color-row {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 34px;
}
.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--wb-border);
  cursor: pointer;
}
.color-dot.active {
  outline: 2px solid var(--wb-primary);
  outline-offset: 2px;
}
.dot-default { background: var(--wb-memo-default); }
.dot-yellow { background: var(--wb-memo-yellow); }
.dot-green { background: var(--wb-memo-green); }
.dot-blue { background: var(--wb-memo-blue); }
.dot-pink { background: var(--wb-memo-pink); }
.dot-purple { background: var(--wb-memo-purple); }
</style>
