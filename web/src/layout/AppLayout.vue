<template>
  <div class="layout" :class="{ narrow: isNarrow }">
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
        :table-search="tableSearch"
        @update:table-search="tableSearch = $event"
        @navigate="drawerOpen = false"
        @new-table="openNewTable"
        @logout="handleLogout"
      />
    </el-drawer>

    <!-- 桌面：图标栏或展开栏 -->
    <template v-else>
      <div v-if="collapsed" class="wb-iconbar">
        <div class="icon-btn" :title="'展开侧栏'" @click="setCollapsed(false)">
          <el-icon><Expand /></el-icon>
        </div>
        <el-popover
          v-for="group in collapsedGroups"
          :key="group.key"
          placement="right-start"
          trigger="click"
          :width="170"
        >
          <template #reference>
            <div class="icon-btn" :class="{ active: isGroupActive(group) }" :title="group.label">
              <el-icon><component :is="group.icon" /></el-icon>
            </div>
          </template>
          <div class="wb-nav">
            <div
              v-for="item in group.items"
              :key="item.path"
              class="wb-nav-item"
              :class="{ active: route.path === item.path }"
              @click="go(item.path)"
            >
              <span>{{ item.label }}</span>
            </div>
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
        <div class="spacer" />
        <div class="icon-btn" title="切换主题" @click="toggleTheme">
          <el-icon><component :is="themeIcon" /></el-icon>
        </div>
      </div>

      <SidebarContent
        v-if="!collapsed"
        :collapsed="false"
        :collapsible="true"
        :tables="tables"
        :table-search="tableSearch"
        @update:table-search="tableSearch = $event"
        @navigate="() => {}"
        @new-table="openNewTable"
        @logout="handleLogout"
        @collapse="setCollapsed(true)"
      />
    </template>

    <div class="wb-main">
      <div class="wb-topbar">
        <el-button v-if="isNarrow" text :icon="Menu" @click="drawerOpen = true" />
        <div class="title-15">{{ pageTitle }}</div>
        <div class="spacer" />
        <el-tooltip v-if="!isNarrow" content="切换浅色／深色主题" placement="bottom">
          <el-button text :icon="themeIcon" circle @click="toggleTheme" />
        </el-tooltip>
        <span class="text-12 muted">{{ session.user?.username }}</span>
      </div>
      <div class="wb-content" :class="{ scroll: scrollable }">
        <router-view :key="route.fullPath" />
      </div>
    </div>

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
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Calendar,
  Check,
  Collection,
  DataLine,
  Document,
  Expand,
  Files,
  Menu,
  Memo,
  Moon,
  Plus,
  Setting,
  Sunny,
  SwitchButton,
  Tickets,
  Delete,
} from '@element-plus/icons-vue'
import SidebarContent from './SidebarContent.vue'
import { http, apiError } from '@/api/client'
import { logout, session, toggleTheme } from '@/stores/session'

const route = useRoute()
const router = useRouter()

const collapsed = ref(localStorage.getItem('wb_sidebar_collapsed') === '1')
const drawerOpen = ref(false)
const isNarrow = ref(window.innerWidth < 1280)
const tables = ref<any[]>([])
const tableSearch = ref('')
const newTableOpen = ref(false)
const creatingTable = ref(false)
const newTable = reactive({ name: '', note: '' })

const collapsedGroups = [
  {
    key: 'checkin',
    label: '打卡',
    icon: Calendar,
    items: [
      { label: '店铺打卡', path: '/checkins/shops' },
      { label: '社媒打卡', path: '/checkins/social' },
    ],
  },
  {
    key: 'data',
    label: '表格',
    icon: Collection,
    items: [],
  },
]

const simpleItems = [
  { label: '待办', path: '/todos', icon: Check },
  { label: '笔记', path: '/notes', icon: Document },
  { label: '便利贴', path: '/memos', icon: Memo },
  { label: '翻译', path: '/translate', icon: SwitchButton },
  { label: '回收站', path: '/trash', icon: Delete },
  { label: '设置', path: '/settings', icon: Setting },
]

const pageTitle = computed(() => {
  if (route.name === 'target') return '资料'
  if (route.name === 'table') {
    const found = tables.value.find((t) => String(t.id) === String(route.params.tableId))
    return found?.name || '表格'
  }
  return (route.meta.title as string) || '个人工作台'
})

const themeIcon = computed(() => (session.theme === 'dark' ? Moon : Sunny))
const scrollable = computed(() => ['settings', 'trash', 'tables', 'notes', 'memos'].includes(String(route.name)))

function isGroupActive(group: { key: string }) {
  if (group.key === 'checkin') return route.path.startsWith('/checkins')
  return route.path.startsWith('/data')
}

function go(path: string) {
  if (route.fullPath !== path) router.push(path)
  drawerOpen.value = false
}

function setCollapsed(value: boolean) {
  collapsed.value = value
  localStorage.setItem('wb_sidebar_collapsed', value ? '1' : '0')
}

function onResize() {
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

function openNewTable() {
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

async function handleLogout() {
  await logout()
  router.replace('/login')
}

function onTablesChanged() {
  loadTables()
}

onMounted(() => {
  loadTables()
  window.addEventListener('resize', onResize)
  window.addEventListener('wb:tables-changed', onTablesChanged)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('wb:tables-changed', onTablesChanged)
})
</script>

<style scoped>
.layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}
</style>
