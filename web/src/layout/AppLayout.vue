<template>
  <div class="layout" :class="{ narrow: isNarrow, 'resizing-sidebar': resizingSidebar }" :style="{'--sidebar-width':sidebarWidth+'px'}">
    <!-- 窄屏：临时抽屉 -->
    <el-drawer
      v-if="isNarrow"
      v-model="drawerOpen"
      direction="ltr"
      size="232px"
      :with-header="false"
      class="nav-drawer"
    >
      <SidebarContent
        :collapsed="false"
        :tables="tables"
        :dashboards="dashboards"
        :todo-lists="todoLists"
        :note-folders="noteFolders"
        :uncategorized-count="uncategorizedCount"
        :memo-categories="memoCategories"
        :table-search="tableSearch"
        @update:table-search="tableSearch = $event"
        @navigate="drawerOpen = false"
        @new-table="openNewTable"
        @new-dashboard="openNewDashboard"
        @new-todo-list="openNewTodoList"
        @new-note-folder="openNewNoteFolder"
        @new-memo-category="openNewMemoCategory"
        @rename-checkin="renameCheckinItem"
      />
    </el-drawer>

    <el-splitter v-splitter-a11y="{label:'调整侧边栏宽度',value:sidebarWidth,min:180,max:sidebarMax,disabled:isNarrow||collapsed}" class="app-splitter" @resize-start="beginSidebarResize" @resize-end="endSidebarResize" @dblclick="resetSplitBar" @keydown.capture="splitBarKey">
      <el-splitter-panel @update:size="resizeSidebarPanel" :size="isNarrow ? 0 : collapsed ? 64 : sidebarWidth" :min="isNarrow ? 0 : collapsed ? 64 : 180" :max="isNarrow ? 0 : collapsed ? 64 : sidebarMax" :resizable="!isNarrow && !collapsed">
    <!-- 桌面：图标栏或展开栏 -->
    <template v-if="!isNarrow">
      <div v-if="collapsed" class="wb-iconbar">
        <img class="compact-brand" src="/favicon.svg?v=20261031-notion" width="28" height="28" alt="个人工作台" />
        <div class="icon-btn" :title="'展开侧栏'" @click="setCollapsed(false)">
          <el-icon><Expand /></el-icon>
        </div>
        <el-popover
          v-for="group in collapsedGroups"
          :key="group.key"
          placement="right-start"
          trigger="click"
          transition="wb-popover"
          :visible="openPopover === group.key"
          @update:visible="(visible: boolean) => updateNavPopover(group.key, visible)"
          :width="210"
        >
          <template #reference>
            <div class="icon-btn" :class="{ active: isGroupActive(group) }" :title="group.label">
              <el-icon><component :is="group.icon" /></el-icon>
            </div>
          </template>
          <div class="wb-nav collapsed-nav">
            <div v-for="item in group.items" :key="item.path" class="checkin-nav-row" :class="{ active: route.path === item.path }">
              <button class="wb-nav-item collapsed-item" :class="{ active: route.path === item.path }" :title="item.label" @click="go(item.path)"><span class="ellipsis-1">{{ item.label }}</span></button>
              <el-button text size="small" :icon="Edit" class="rename-checkin" :aria-label="`重命名${item.label}`" title="重命名" @click="renameCheckinItem(item.key)" />
            </div>
            <template v-if="group.key === 'visualizations'">
              <div v-for="board in dashboards" :key="board.id" class="wb-nav-item" :class="{ active: String(route.params.dashboardId) === String(board.id) }" :title="board.name" @click="go(`/visualizations/${board.id}`)"><span class="ellipsis-1">{{ board.name }}</span></div>
              <div class="wb-nav-item" @click="openNewDashboard"><el-icon><Plus /></el-icon><span>新建看板</span></div>
            </template>
            <template v-if="group.key === 'todos'">
              <button v-for="list in todoLists" :key="list.id" class="wb-nav-item collapsed-item" :class="{ active: String(route.params.listId) === String(list.id) }" :title="list.name" @click="go(`/todos/${list.id}`)"><span class="ellipsis-1">{{ list.name }}</span><span class="text-12 muted">{{ list.pending }}</span></button>
              <button class="wb-nav-item collapsed-item" @click="openNewTodoList"><el-icon><Plus /></el-icon><span>新建清单</span></button>
            </template>
            <template v-if="group.key === 'notes'">
              <button class="wb-nav-item collapsed-item" :class="{ active: route.params.folderKey === 'uncategorized' }" @click="go('/notes/uncategorized')">未分类</button>
              <button v-for="folder in noteFolders" :key="folder.id" class="wb-nav-item collapsed-item" :class="{ active: String(route.params.folderKey) === String(folder.id) }" :title="folder.name" @click="go(`/notes/${folder.id}`)"><span class="ellipsis-1">{{ folder.name }}</span><span class="text-12 muted">{{ folder.note_count }}</span></button>
              <button class="wb-nav-item collapsed-item" @click="openNewNoteFolder"><el-icon><Plus /></el-icon><span>新建文件夹</span></button>
            </template>
            <template v-if="group.key === 'memos'">
              <button class="wb-nav-item collapsed-item" :class="{ active: isMemoActive(route, null) }" @click="go(memoPath(null))">未分类</button>
              <button v-for="name in memoCategories" :key="name" class="wb-nav-item collapsed-item" :class="{ active: isMemoActive(route, name) }" :title="name" :aria-label="`便利贴分类：${name}`" @click="go(memoPath(name))"><span class="ellipsis-1">{{ name }}</span></button>
              <button class="wb-nav-item collapsed-item" @click="openNewMemoCategory"><el-icon><Plus /></el-icon><span>新建分类</span></button>
            </template>
            <template v-if="group.key === 'data'">
              <div
                v-for="table in tables.slice(0, 20)"
                :key="table.id"
                class="wb-nav-item"
                :class="{ active: String(table.id) === String(route.params.tableId) }"
                @click="go(`/data/${table.id}`)"
              >
                <span class="ellipsis-1">{{ table.name }}</span>
              </div>
              <div class="wb-nav-item" @click="openNewTable">
                <el-icon><Plus /></el-icon><span>新建表格</span>
              </div>
            </template>
          </div>
        </el-popover>
        <div
          v-for="item in simpleItems"
          :key="item.path"
          class="icon-btn"
          :class="{ active: route.path === item.path }"
          :title="item.label"
          @click="go(item.path)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
        </div>
      </div>

      <SidebarContent
        v-if="!collapsed"
        :width="sidebarWidth"
        :collapsed="false"
        :collapsible="true"
        :tables="tables"
        :dashboards="dashboards"
        :todo-lists="todoLists"
        :note-folders="noteFolders"
        :uncategorized-count="uncategorizedCount"
        :memo-categories="memoCategories"
        :table-search="tableSearch"
        @update:table-search="tableSearch = $event"
        @navigate="() => {}"
        @new-table="openNewTable"
        @new-dashboard="openNewDashboard"
        @new-todo-list="openNewTodoList"
        @new-note-folder="openNewNoteFolder"
        @new-memo-category="openNewMemoCategory"
        @rename-checkin="renameCheckinItem"
        @collapse="setCollapsed(true)"
      />

    </template>

    </el-splitter-panel>
    <el-splitter-panel :size="Math.max(0,viewportWidth-(isNarrow ? 0 : collapsed ? 64 : sidebarWidth))" :min="0">
    <div class="wb-main">
      <div class="wb-topbar">
        <el-button v-if="isNarrow" text :icon="Menu" aria-label="打开导航" @click="drawerOpen = true" />
        <h1 class="title-15 page-title" :title="pageTitle">{{ pageTitle }}</h1>
        <div class="spacer" />
        <el-button text aria-label="统一搜索" @click="go('/search')">搜索</el-button>
        <TaskStatusButton/>
        <el-tooltip content="设置" placement="bottom">
          <el-button
            text
            circle
            :icon="Setting"
            class="topbar-action"
            aria-label="打开设置"
            :class="{ current: route.path.startsWith('/settings') }"
            @click="go('/settings')"
          />
        </el-tooltip>
        <el-tooltip content="切换浅色／深色主题" placement="bottom">
          <el-button text circle :icon="themeIcon" class="topbar-action" aria-label="切换主题" :disabled="session.appearanceSaving" @click="handleThemeToggle" />
        </el-tooltip>
        <span v-if="collapsed || isNarrow" class="text-12 muted">{{ session.user?.username }}</span>
      </div>
      <div class="wb-content" :class="{ scroll: scrollable, 'settings-scroll': isSettingsRoute }">
        <div :key="viewKey" class="wb-route-frame" :class="{ 'settings-route-frame': isSettingsRoute }">
          <router-view :key="isSettingsRoute ? 'settings' : route.fullPath" />
        </div>
      </div>
    </div>

    </el-splitter-panel>
    </el-splitter>
    <!-- 新建表格 -->
    <el-dialog v-model="newTableOpen" title="新建表格" width="520px" :append-to-body="true">
      <el-form label-position="top" :model="newTable">
        <el-form-item label="表格名称" required>
          <el-input v-model="newTable.name" maxlength="100" placeholder="例如：商品台账" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="newTable.note" type="textarea" :rows="2" maxlength="2000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="newTableOpen = false">取消</el-button>
          <el-button type="primary" :loading="creatingTable" @click="createTable">创建</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import TaskStatusButton from '@/components/TaskStatusButton.vue'
import {onMounted as onToolsMounted,onUnmounted as onToolsUnmounted} from 'vue'
import {vSplitterA11y} from '@/utils/splitter-a11y'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Calendar,
  Collection,
  DashboardIcon,
  Document,
  Expand,
  Edit,
  Menu,
  Memo,
  Moon,
  Plus,
  Setting,
  Sunny,
  Todo,
  Translate,
  Picture,
  Link,
} from '@/icons'
import SidebarContent from './SidebarContent.vue'
import { isMemoActive, memoPath, memoTitle } from '@/memo-navigation'
import { http, apiError } from '@/api/client'
import { checkinItems, session, setCheckinLabel, toggleTheme, type CheckinNavKey } from '@/stores/session'

const route = useRoute()
const router = useRouter()
// Settings owns a persistent shell across all of its section routes.
const isSettingsRoute = computed(() => route.path.startsWith('/settings'))
const viewKey = computed(() => isSettingsRoute.value ? 'settings' : route.path)

const collapsed = ref(localStorage.getItem('wb_sidebar_collapsed') === '1')
const drawerOpen = ref(false)
const isNarrow = ref(window.innerWidth < 1280)
const viewportWidth=ref(window.innerWidth),resizingSidebar=ref(false)
const sidebarMax=computed(()=>Math.max(180,Math.min(360,Math.floor(viewportWidth.value*.28),viewportWidth.value-640)))
function storedSidebarWidth(){try{const n=Number(localStorage.getItem('wb_sidebar_width'));return Number.isFinite(n)&&n>=180&&n<=360?n:192}catch{return 192}}
const preferredSidebarWidth=ref(storedSidebarWidth())
const sidebarWidth=computed(()=>Math.round(Math.max(180,Math.min(sidebarMax.value,preferredSidebarWidth.value))))
let sidebarStartWidth=192,sidebarCancelled=false
function beginSidebarResize(){sidebarStartWidth=preferredSidebarWidth.value;sidebarCancelled=false;resizingSidebar.value=true;window.addEventListener('keydown',cancelSidebarWithEscape)}
function endSidebarResize(){resizingSidebar.value=false;window.removeEventListener('keydown',cancelSidebarWithEscape);if(!sidebarCancelled)persistSidebarWidth()}
function cancelSidebarWithEscape(e:KeyboardEvent){if(e.key!=='Escape')return;e.preventDefault();sidebarCancelled=true;window.dispatchEvent(new MouseEvent('mouseup'));preferredSidebarWidth.value=sidebarStartWidth;resizingSidebar.value=false}
function persistSidebarWidth(){try{localStorage.setItem('wb_sidebar_width',String(preferredSidebarWidth.value))}catch{}}
function resizeSidebarPanel(size:string|number|undefined){if(resizingSidebar.value&&typeof size==='number'&&!isNarrow.value&&!collapsed.value)preferredSidebarWidth.value=Math.max(180,Math.min(sidebarMax.value,size))}
function resetSplitBar(e:MouseEvent){if((e.target as HTMLElement).closest('.el-splitter-bar')){sidebarCancelled=true;resizingSidebar.value=false;preferredSidebarWidth.value=192;persistSidebarWidth()}}
function splitBarKey(e:KeyboardEvent){
 if(!(e.target as HTMLElement).closest('.el-splitter-bar')||isNarrow.value||collapsed.value)return
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
 e.preventDefault();preferredSidebarWidth.value=e.key==='Home'?180:e.key==='End'?sidebarMax.value:Math.max(180,Math.min(sidebarMax.value,sidebarWidth.value+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?20:10)));persistSidebarWidth()
}

const tables = ref<any[]>([])
const dashboards = ref<any[]>([])
const tableSearch = ref('')
const todoLists = ref<any[]>([]), noteFolders = ref<any[]>([])
const uncategorizedCount = ref(0)
const memoCategories = ref<string[]>([])
const openPopover = ref<string | null>(null)
const newTableOpen = ref(false)
const creatingTable = ref(false)
const newTable = reactive({ name: '', note: '' })

const collapsedGroups = computed(() => [
  {
    key: 'checkin',
    label: '打卡',
    icon: Calendar,
    items: checkinItems.value,
  },
  { key: 'visualizations', label: '数据可视化', icon: DashboardIcon, items: [] },
  {
    key: 'data',
    label: '表格',
    icon: Collection,
    items: [],
  },
  { key: 'todos', label: '待办', icon: Todo, items: [] },
  { key: 'notes', label: '笔记', icon: Document, items: [] },
  { key: 'memos', label: '便利贴', icon: Memo, items: [] },
])

const simpleItems = [
  { label: '翻译', path: '/translate', icon: Translate },
  { label: '图片处理', path: '/images', icon: Picture },
  { label: '网址导航', path: '/bookmarks', icon: Link },
]

const pageTitle = computed(() => {
  if (route.path.startsWith('/settings')) return '设置'
  if (route.name === 'memos') return memoTitle(route.query)
  const checkin = checkinItems.value.find(item => route.path === item.path)
  if (checkin) return checkin.label
  if (route.name === 'target') return '资料'
  if (route.name === 'table') {
    const found = tables.value.find((t) => String(t.id) === String(route.params.tableId))
    return found?.name || '表格'
  }
  if (route.name === 'visualizations' && route.params.dashboardId) {
    return dashboards.value.find(b => String(b.id) === String(route.params.dashboardId))?.name || '数据可视化'
  }
  if (route.name === 'todos' && route.params.listId) return todoLists.value.find(l => String(l.id) === String(route.params.listId))?.name || '待办'
  if (route.name === 'notes') {
    if (route.params.folderKey === 'uncategorized') return '未分类笔记'
    if (route.params.folderKey) return noteFolders.value.find(f => String(f.id) === String(route.params.folderKey))?.name || '笔记'
  }
  return (route.meta.title as string) || '个人工作台'
})

watch([pageTitle, () => route.fullPath], ([title]) => { document.title = `${title} · 个人工作台` }, { immediate: true })

async function handleThemeToggle(){try{await toggleTheme()}catch(error){ElMessage.error(apiError(error).message)}}

const themeIcon = computed(() => (session.theme === 'dark' ? Moon : Sunny))
const scrollable = computed(() => ['tasks','search','activity','images', 'visualizations', 'settings', 'settings-trash', 'settings-section', 'data', 'tables', 'notes', 'memos'].includes(String(route.name)))

function isGroupActive(group: { key: string }) {
  if (group.key === 'checkin') return route.path.startsWith('/checkins')
  if (group.key === 'visualizations') return route.path.startsWith('/visualizations')
  if (group.key === 'todos') return route.path.startsWith('/todos')
  if (group.key === 'notes') return route.path.startsWith('/notes')
  if (group.key === 'memos') return route.name === 'memos'
  return route.path.startsWith('/data')
}

async function renameCheckinItem(key: CheckinNavKey) {
  drawerOpen.value = false; closeNavPopovers()
  const item = checkinItems.value.find(item => item.key === key)
  if (!item) return
  try {
    const { value } = await ElMessageBox.prompt('修改左侧导航显示名称', '重命名打卡子项', {
      inputValue: item.label, inputPlaceholder: '请输入 1–40 个字',
      inputValidator: value => !!value?.trim() && value.trim().length <= 40 || '请输入 1–40 个字',
      confirmButtonText: '保存', cancelButtonText: '取消',
    })
    await setCheckinLabel(key, value)
    ElMessage.success('名称已保存')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}

function updateNavPopover(key: string, visible: boolean) {
  if (visible) openPopover.value = key
  else if (openPopover.value === key) openPopover.value = null
}
function closeNavPopovers() { openPopover.value = null }
function go(path: string) {
  closeNavPopovers()
  if (route.fullPath !== path) router.push(path)
  drawerOpen.value = false
}

function setCollapsed(value: boolean) {
  closeNavPopovers()
  collapsed.value = value
  localStorage.setItem('wb_sidebar_collapsed', value ? '1' : '0')
}

function onResize() {
  viewportWidth.value=window.innerWidth
  if (isNarrow.value !== (window.innerWidth < 1280)) closeNavPopovers()
  isNarrow.value = window.innerWidth < 1280
}

async function loadTables() {
  try {
    const { data } = await http.get('/tables')
    tables.value = data
  } catch {
    /* 刷新失败时保留旧目录 */
  }
}

async function loadDashboards() {
  try { const { data } = await http.get('/dashboards'); dashboards.value = data } catch { /* keep the last sidebar list */ }
}
async function loadTodoLists() {
  try { const { data } = await http.get('/todo-lists'); todoLists.value = data } catch { /* keep navigation available */ }
}
async function openNewMemoCategory() {
  try {
    const { value } = await ElMessageBox.prompt('分类名称', '新建便利贴分类', {
      inputPlaceholder: '例如：工作灵感',
      inputValidator: (value: string) => {
        const name = value.trim()
        return !!name && name.length <= 80 && name !== '未分类' || '请输入 1–80 个字的名称，不能使用未分类'
      },
      confirmButtonText: '创建', cancelButtonText: '取消',
    })
    const { data } = await http.post('/memos/categories', { name: value.trim() })
    await loadMemoCategories()
    window.dispatchEvent(new Event('wb:memos-changed'))
    drawerOpen.value = false
    go(memoPath(data.name))
    ElMessage.success('分类已就绪')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message)
  }
}
async function loadMemoCategories() {
  try { const { data } = await http.get('/memos/categories'); memoCategories.value = data } catch { /* preserve the previous categories */ }
}
async function loadNoteFolders() {
  try { const { data } = await http.get('/note-folders'); noteFolders.value = data.folders; uncategorizedCount.value = data.uncategorized } catch { /* keep navigation available */ }
}
async function createCategory(kind: 'todos' | 'notes') {
  drawerOpen.value = false; closeNavPopovers()
  const isTodo = kind === 'todos'
  try {
    const { value } = await ElMessageBox.prompt(isTodo ? '清单名称' : '文件夹名称', isTodo ? '新建清单' : '新建文件夹', {
      inputPlaceholder: isTodo ? '例如：本周工作、店铺活动' : '例如：经营复盘、流程与SOP',
      inputValidator: v => !!v?.trim() && v.trim().length <= 100 || '请输入 1–100 个字', confirmButtonText: '创建', cancelButtonText: '取消',
    })
    const { data } = await http.post(isTodo ? '/todo-lists' : '/note-folders', { name: value.trim() })
    await (isTodo ? loadTodoLists() : loadNoteFolders())
    go(isTodo ? `/todos/${data.id}` : `/notes/${data.id}`)
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}
function openNewTodoList() { createCategory('todos') }
function openNewNoteFolder() { createCategory('notes') }

async function openNewDashboard() {
  closeNavPopovers()
  drawerOpen.value = false
  try {
    const { value } = await ElMessageBox.prompt('为店铺或业务创建独立看板。', '新建看板', {
      inputPlaceholder: '例如：天猫旗舰店、抖音店铺', inputValidator: v => !!v?.trim() && v.trim().length <= 80 || '请输入 1–80 个字', confirmButtonText: '创建', cancelButtonText: '取消',
    })
    const { data } = await http.post('/dashboards', { name: value.trim() })
    await loadDashboards()
    router.push(`/visualizations/${data.id}`)
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}

function openNewTable() {
  closeNavPopovers()
  newTable.name = ''
  newTable.note = ''
  newTableOpen.value = true
  drawerOpen.value = false
}

async function createTable() {
  if (!newTable.name.trim()) {
    ElMessage.warning('请填写表格名称')
    return
  }
  creatingTable.value = true
  try {
    const { data } = await http.post('/tables', { name: newTable.name.trim(), note: newTable.note, fields: [] })
    ElMessage.success('已创建，接下来添加一列')
    newTableOpen.value = false
    await loadTables()
    router.push(`/data/${data.id}`)
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    creatingTable.value = false
  }
}

function onTablesChanged() {
  loadTables()
}

onMounted(() => {
  loadTables()
  loadDashboards()
  loadTodoLists(); loadNoteFolders(); loadMemoCategories()
  window.addEventListener('wb:memos-changed', loadMemoCategories)
  window.addEventListener('focus', loadMemoCategories)
  window.addEventListener('wb:todos-changed', loadTodoLists)
  window.addEventListener('wb:notes-changed', loadNoteFolders)
  window.addEventListener('focus', loadTodoLists)
  window.addEventListener('focus', loadNoteFolders)
  window.addEventListener('wb:dashboards-changed', loadDashboards)
  window.addEventListener('focus', loadDashboards)
  window.addEventListener('resize', onResize)
  window.addEventListener('wb:tables-changed', onTablesChanged)
})

onUnmounted(() => {
  if(resizingSidebar.value)window.dispatchEvent(new MouseEvent('mouseup'))
  window.removeEventListener('keydown',cancelSidebarWithEscape)
  window.removeEventListener('wb:memos-changed', loadMemoCategories)
  window.removeEventListener('focus', loadMemoCategories)
  window.removeEventListener('wb:todos-changed', loadTodoLists)
  window.removeEventListener('wb:notes-changed', loadNoteFolders)
  window.removeEventListener('focus', loadTodoLists)
  window.removeEventListener('focus', loadNoteFolders)
  window.removeEventListener('wb:dashboards-changed', loadDashboards)
  window.removeEventListener('focus', loadDashboards)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('wb:tables-changed', onTablesChanged)
})
function searchShortcut(event:KeyboardEvent){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!event.altKey&&!event.shiftKey&&!event.defaultPrevented){const target=event.target as HTMLElement;if(target?.closest('input,textarea,[contenteditable=true],.univer-host'))return;event.preventDefault();go('/search')}}
onToolsMounted(()=>window.addEventListener('keydown',searchShortcut))
onToolsUnmounted(()=>window.removeEventListener('keydown',searchShortcut))
</script>

<style scoped>
.app-splitter { min-width:0; }
/* No iframe panes here: keep the native handle reachable for double-click reset. */
.app-splitter :deep(.el-splitter__mask) { pointer-events:none; }
.app-splitter :deep(.el-splitter-panel) { overflow:hidden; }
.app-splitter :deep(.el-splitter-bar) { --el-splitter-bar-size: 1px; }


.checkin-nav-row { display: flex; align-items: center; min-width: 0; }
.checkin-nav-row.active { background: var(--wb-nav-active); border-radius: 5px; }
.checkin-nav-row .collapsed-item { flex: 1; min-width: 0; padding-right: 4px; }
.checkin-nav-row .rename-checkin { margin: 0 4px 0 0; flex-shrink: 0; width: 26px; padding: 4px; color: var(--wb-text-tertiary); }

.collapsed-nav { max-height: 70vh; overflow-y: auto; }
.collapsed-item { width: 100%; border: 0; background: transparent; text-align: left; font-family: inherit; }
.collapsed-item:hover { background: var(--wb-nav-hover); }
.collapsed-item.active { background: var(--wb-nav-active); color: var(--wb-text); }
.compact-brand { margin: 3px 0 7px; }
.layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}
</style>
