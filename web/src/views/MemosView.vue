<template>
  <div class="page">
    <div class="page-toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索标题或正文"
        clearable
        style="width: 220px"
        :prefix-icon="Search"
        @input="onSearch"
      />
      <strong class="category-heading" :title="currentCategoryLabel">{{ currentCategoryLabel }}</strong>
      <span class="text-12 muted">{{ memos.length }} 张便利贴</span>
      <div class="spacer" />
      <div class="toolbar-actions">
        <el-button text :icon="Refresh" @click="load">刷新</el-button>
        <el-button class="btn-tonal" :icon="Plus" @click="openCreate">新建便利贴</el-button>
      </div>
    </div>

    <div class="page-body scroll-area">
      <div v-if="!memos.length && !loading" class="empty-hint">
        <div>{{ keyword ? '没有匹配的便利贴' : '还没有便利贴' }}</div>
        <div class="text-12">记录供应商信息、临时号码这类短内容，可以直接复制正文</div>
        <el-button class="btn-tonal" @click="openCreate">写一张便利贴</el-button>
      </div>

      <div class="memo-grid">
        <div v-for="memo in memos" :key="memo.id" class="memo-card" :class="`c-${memo.color}`">
          <div class="memo-head">
            <span class="memo-title ellipsis-1">{{ memo.display_title }}</span>
            <span class="memo-chip">{{ memo.display_category }}</span>
          </div>
          <div class="memo-content">{{ memo.content }}</div>
          <div class="memo-foot">
            <span class="text-12">{{ formatDate(memo.updated_at) }}</span>
            <div class="actions-group">
              <el-button text circle size="small" :icon="CopyDocument" title="复制正文" @click="copyContent(memo)" />
              <el-button text circle size="small" :icon="Edit" title="编辑" @click="openEdit(memo)" />
              <el-button text circle size="small" :icon="Delete" title="删除" @click="remove(memo)" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogOpen"
      :title="editing ? '编辑便利贴' : '新建便利贴'"
      width="540px"
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
            :rows="7"
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
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Edit, Plus, Refresh, Search } from '@/icons'
import { apiError, copyText, http } from '@/api/client'
import { memoFilter, memoTitle } from '@/memo-navigation'

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

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = {}
    if (category.value) params.category = category.value
    if (keyword.value.trim()) params.q = keyword.value.trim()
    const [{ data }, { data: cats }] = await Promise.all([
      http.get('/memos', { params }),
      http.get('/memos/categories'),
    ])
    memos.value = data
    categories.value = cats
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

function onSearch() {
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

onMounted(load)
onUnmounted(() => { if (searchTimer) window.clearTimeout(searchTimer) })
</script>

<style scoped>
.category-heading { font-size: 13px; font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.memo-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.memo-head .memo-title {
  flex: 1;
}
.memo-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  opacity: 0.9;
}
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
