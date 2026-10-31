<template>
  <div class="wb-sidebar" :style="{ width: '192px' }">
    <div class="brand"><img src="/favicon.svg?v=20261031-notion" width="24" height="24" alt="" /><span class="ellipsis-1">个人工作台</span><div class="spacer" /><el-button v-if="collapsible" text :icon="Fold" size="small" title="收起侧栏" @click="$emit('collapse')" /></div>
    <div class="wb-nav">
      <button class="wb-nav-item nav-button" :aria-expanded="expandedKey === 'checkin'" @click="toggle('checkin')">
        <el-icon><Calendar /></el-icon><span>打卡</span><div class="spacer" /><el-icon class="caret" :class="{ open: expandedKey === 'checkin' }"><ArrowRight /></el-icon>
      </button>
      <div class="wb-nav-collapse" :class="{ open: expandedKey === 'checkin' }" :inert="expandedKey !== 'checkin'" :aria-hidden="expandedKey !== 'checkin'">
        <div class="wb-nav-sub">
          <div v-for="item in checkinItems" :key="item.path" class="checkin-nav-row" :class="{ active: route.path === item.path }">
            <button class="wb-nav-item nav-button" :class="{ active: route.path === item.path }" :title="item.label" @click="go(item.path)"><span class="ellipsis-1">{{ item.label }}</span></button>
            <el-button text size="small" :icon="Edit" class="rename-checkin" :aria-label="`重命名${item.label}`" title="重命名" @click="$emit('rename-checkin', item.key)" />
          </div>
        </div>
      </div>

      <button class="wb-nav-item nav-button" :aria-expanded="expandedKey === 'visualizations'" @click="toggle('visualizations')">
        <el-icon><DashboardIcon /></el-icon><span>数据可视化</span><div class="spacer" /><el-icon class="caret" :class="{ open: expandedKey === 'visualizations' }"><ArrowRight /></el-icon>
      </button>
      <div class="wb-nav-collapse" :class="{ open: expandedKey === 'visualizations' }" :inert="expandedKey !== 'visualizations'" :aria-hidden="expandedKey !== 'visualizations'">
        <div class="wb-nav-sub" aria-label="数据可视化看板">
          <div v-if="dashboards.length > 10" class="table-search"><el-input v-model="dashboardSearch" size="small" placeholder="搜索看板" clearable aria-label="搜索看板" /></div>
          <button v-for="board in filteredDashboards" :key="board.id" class="wb-nav-item nav-button" :class="{ active: String(route.params.dashboardId) === String(board.id) }" :title="board.name" @click="go(`/visualizations/${board.id}`)">
            <span class="ellipsis-1">{{ board.name }}</span>
          </button>
          <div v-if="!filteredDashboards.length" class="table-empty">{{ dashboards.length ? '没有匹配的看板' : '还没有看板' }}</div>
          <button class="wb-nav-item nav-button new-item" @click="$emit('new-dashboard')"><el-icon><Plus /></el-icon><span>新建看板</span></button>
        </div>
      </div>

      <button class="wb-nav-item nav-button" :aria-expanded="expandedKey === 'data'" @click="toggle('data')">
        <el-icon><Collection /></el-icon><span>表格</span><div class="spacer" /><el-icon class="caret" :class="{ open: expandedKey === 'data' }"><ArrowRight /></el-icon>
      </button>
      <div class="wb-nav-collapse" :class="{ open: expandedKey === 'data' }" :inert="expandedKey !== 'data'" :aria-hidden="expandedKey !== 'data'">
        <div class="wb-nav-sub">
          <div v-if="tables.length > 10" class="table-search"><el-input :model-value="tableSearch" size="small" placeholder="搜索表格" clearable @update:model-value="$emit('update:tableSearch', $event)" /></div>
          <button v-for="table in filteredTables" :key="table.id" class="wb-nav-item nav-button" :class="{ active: String(route.params.tableId) === String(table.id) }" :title="table.name" @click="go(`/data/${table.id}`)"><span class="ellipsis-1">{{ table.name }}</span></button>
          <div v-if="!filteredTables.length" class="table-empty">{{ tables.length ? '没有匹配的表格' : '还没有表格' }}</div>
          <button class="wb-nav-item nav-button new-item" @click="$emit('new-table')"><el-icon><Plus /></el-icon><span>新建表格</span></button>
        </div>
      </div>

      <button class="wb-nav-item nav-button" :aria-expanded="expandedKey === 'todos'" @click="toggle('todos')"><el-icon><Todo /></el-icon><span>待办</span><div class="spacer" /><el-icon class="caret" :class="{ open: expandedKey === 'todos' }"><ArrowRight /></el-icon></button>
      <div class="wb-nav-collapse" :class="{ open: expandedKey === 'todos' }" :inert="expandedKey !== 'todos'" :aria-hidden="expandedKey !== 'todos'">
        <div class="wb-nav-sub" aria-label="待办清单">
          <div v-if="todoLists.length > 10" class="table-search"><el-input v-model="todoSearch" size="small" placeholder="搜索清单" clearable /></div>
          <button v-for="list in filteredTodoLists" :key="list.id" class="wb-nav-item nav-button" :class="{ active: String(route.params.listId) === String(list.id) }" :title="list.name" :aria-label="`待办清单：${list.name}`" @click="go(`/todos/${list.id}`)"><span class="ellipsis-1">{{ list.name }}</span><span class="nav-count">{{ list.pending }}</span></button>
          <div v-if="!filteredTodoLists.length" class="table-empty">{{ todoLists.length ? '没有匹配的清单' : '还没有清单' }}</div>
          <button class="wb-nav-item nav-button new-item" @click="$emit('new-todo-list')"><el-icon><Plus /></el-icon><span>新建清单</span></button>
        </div>
      </div>

      <button class="wb-nav-item nav-button" :aria-expanded="expandedKey === 'notes'" @click="toggle('notes')"><el-icon><Document /></el-icon><span>笔记</span><div class="spacer" /><el-icon class="caret" :class="{ open: expandedKey === 'notes' }"><ArrowRight /></el-icon></button>
      <div class="wb-nav-collapse" :class="{ open: expandedKey === 'notes' }" :inert="expandedKey !== 'notes'" :aria-hidden="expandedKey !== 'notes'">
        <div class="wb-nav-sub" aria-label="笔记文件夹">
          <button class="wb-nav-item nav-button" :class="{ active: route.path === '/notes' }" @click="go('/notes')">全部笔记</button>
          <button class="wb-nav-item nav-button" :class="{ active: route.params.folderKey === 'uncategorized' }" @click="go('/notes/uncategorized')"><span class="ellipsis-1">未分类</span><span class="nav-count">{{ uncategorizedCount }}</span></button>
          <div v-if="noteFolders.length > 10" class="table-search"><el-input v-model="noteSearch" size="small" placeholder="搜索文件夹" clearable /></div>
          <button v-for="folder in filteredNoteFolders" :key="folder.id" class="wb-nav-item nav-button" :class="{ active: String(route.params.folderKey) === String(folder.id) }" :title="folder.name" :aria-label="`笔记文件夹：${folder.name}`" @click="go(`/notes/${folder.id}`)"><span class="ellipsis-1">{{ folder.name }}</span><span class="nav-count">{{ folder.note_count }}</span></button>
          <button class="wb-nav-item nav-button new-item" @click="$emit('new-note-folder')"><el-icon><Plus /></el-icon><span>新建文件夹</span></button>
        </div>
      </div>

      <button class="wb-nav-item nav-button" :aria-expanded="expandedKey === 'memos'" @click="toggle('memos')"><el-icon><Memo /></el-icon><span>便利贴</span><div class="spacer" /><el-icon class="caret" :class="{ open: expandedKey === 'memos' }"><ArrowRight /></el-icon></button>
      <div class="wb-nav-collapse" :class="{ open: expandedKey === 'memos' }" :inert="expandedKey !== 'memos'" :aria-hidden="expandedKey !== 'memos'">
        <div class="wb-nav-sub" aria-label="便利贴分类">
          <button class="wb-nav-item nav-button" :class="{ active: isMemoActive(route) }" @click="go(memoPath())">全部便利贴</button>
          <button class="wb-nav-item nav-button" :class="{ active: isMemoActive(route, null) }" @click="go(memoPath(null))">未分类</button>
          <div v-if="memoCategories.length > 10" class="table-search"><el-input v-model="memoSearch" size="small" placeholder="搜索便利贴分类" clearable /></div>
          <button v-for="name in filteredMemoCategories" :key="name" class="wb-nav-item nav-button" :class="{ active: isMemoActive(route, name) }" :title="name" :aria-label="`便利贴分类：${name}`" @click="go(memoPath(name))"><span class="ellipsis-1">{{ name }}</span></button>
          <div v-if="memoSearch && !filteredMemoCategories.length" class="table-empty">没有匹配的分类</div>
        </div>
      </div>

      <button v-for="item in mainItems" :key="item.path" class="wb-nav-item nav-button" :class="{ active: route.path === item.path }" @click="go(item.path)"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Calendar, DashboardIcon, Collection, Document, Fold, Memo, Plus, Todo, Translate, Picture, Edit } from '@/icons'
import { checkinItems, type CheckinNavKey } from '@/stores/session'
import { isMemoActive, memoPath } from '@/memo-navigation'
const props = defineProps<{ tables: any[]; dashboards: { id: number; name: string }[]; tableSearch: string; todoLists: any[]; noteFolders: any[]; uncategorizedCount: number; memoCategories: string[]; collapsed?: boolean; collapsible?: boolean }>()
const emit = defineEmits<{ (e: 'update:tableSearch', value: string): void; (e: 'navigate'): void; (e: 'new-table'): void; (e: 'new-dashboard'): void; (e: 'new-todo-list'): void; (e: 'new-note-folder'): void; (e: 'collapse'): void; (e: 'rename-checkin', key: CheckinNavKey): void }>()
const route = useRoute(), router = useRouter()
const dashboardSearch = ref('')
const todoSearch = ref(''), noteSearch = ref(''), memoSearch = ref('')
// Expansion is intentionally transient: reload starts with every group closed.
const expandedKey = ref<string | null>(null)
const mainItems = [
  { label: '翻译', path: '/translate', icon: Translate }, { label: '图片处理', path: '/images', icon: Picture },
]
const filteredMemoCategories = computed(() => props.memoCategories.filter(name => name.toLowerCase().includes(memoSearch.value.trim().toLowerCase())))
const filteredTables = computed(() => props.tables.filter(t => String(t.name).toLowerCase().includes(props.tableSearch.trim().toLowerCase())))
const filteredDashboards = computed(() => props.dashboards.filter(b => b.name.toLowerCase().includes(dashboardSearch.value.trim().toLowerCase())))
const filteredTodoLists = computed(() => props.todoLists.filter(l => l.name.toLowerCase().includes(todoSearch.value.trim().toLowerCase())))
const filteredNoteFolders = computed(() => props.noteFolders.filter(f => f.name.toLowerCase().includes(noteSearch.value.trim().toLowerCase())))
function toggle(key: string) { expandedKey.value = expandedKey.value === key ? null : key }
function go(path: string) { if (route.fullPath !== path) router.push(path); emit('navigate') }
</script>

<style scoped>
.checkin-nav-row { display: flex; align-items: center; min-width: 0; }
.checkin-nav-row.active { background: var(--wb-nav-active); border-radius: 5px; }
.checkin-nav-row .nav-button { min-width: 0; flex: 1; padding-right: 4px; }
.checkin-nav-row .rename-checkin { flex-shrink: 0; margin: 0 4px 0 0; color: var(--wb-text-tertiary); width: 26px; padding: 4px; }
.checkin-nav-row:hover .rename-checkin, .rename-checkin:focus-visible { color: var(--wb-text); }

.nav-button { appearance: none; border: 0; background: transparent; width: 100%; text-align: left; font-family: inherit; }
.nav-button:hover { background: var(--wb-nav-hover); }
.nav-button.active { background: var(--wb-nav-active); color: var(--wb-text); }
.nav-button:focus-visible { outline: 2px solid var(--wb-primary); outline-offset: -2px; }
.table-search { padding: 3px 6px 7px; }
.table-empty { font-size: 12px; color: var(--wb-text-tertiary); padding: 6px 14px 6px 36px; }
.nav-count { margin-left: auto; padding-left: 4px; font-size: 11px; font-weight: 400; color: var(--wb-text-tertiary); flex-shrink: 0; }
.new-item { color: var(--wb-text-secondary); }
.caret { transition: transform var(--wb-motion-duration) var(--wb-motion-ease); font-size: 12px; }
.caret.open { transform: rotate(90deg); }
</style>
