<template>
  <div class="wb-sidebar" :style="{ width: '192px' }">
    <div class="brand">
      <span class="ellipsis-1">个人工作台</span>
      <div class="spacer" />
      <el-button v-if="collapsible" text :icon="Fold" size="small" title="收起侧栏" @click="$emit('collapse')" />
    </div>

    <div class="wb-nav">
      <div class="wb-nav-item" :class="{ active: route.path === '/dashboard' }" @click="go('/dashboard')">
        <el-icon><DashboardIcon /></el-icon><span>经营驾驶舱</span>
      </div>
      <!-- 打卡 -->
      <div class="wb-nav-item" @click="toggle('checkin')">
        <el-icon><Calendar /></el-icon>
        <span>打卡</span>
        <div class="spacer" />
        <el-icon class="caret" :class="{ open: expanded.checkin }"><ArrowRight /></el-icon>
      </div>
      <div v-show="expanded.checkin" class="wb-nav-sub">
        <div
          v-for="item in checkinItems"
          :key="item.path"
          class="wb-nav-item"
          :class="{ active: route.path === item.path }"
          @click="go(item.path)"
        >
          <span>{{ item.label }}</span>
        </div>
      </div>

      <!-- 待办 -->
      <div class="wb-nav-item" :class="{ active: route.path === '/todos' }" @click="go('/todos')">
        <el-icon><Todo /></el-icon><span>待办</span>
      </div>

      <!-- 表格 -->
      <div class="wb-nav-item" @click="toggle('data')">
        <el-icon><Collection /></el-icon>
        <span>表格</span>
        <div class="spacer" />
        <el-icon class="caret" :class="{ open: expanded.data }"><ArrowRight /></el-icon>
      </div>
      <div v-show="expanded.data" class="wb-nav-sub">
        <div v-if="tables.length > 10" class="table-search">
          <el-input
            :model-value="tableSearch"
            size="small"
            placeholder="搜索表格"
            clearable
            @update:model-value="$emit('update:tableSearch', $event)"
          />
        </div>
        <el-tooltip
          v-for="table in filteredTables"
          :key="table.id"
          :content="table.name"
          placement="right"
          :disabled="table.name.length < 12"
        >
          <div
            class="wb-nav-item table-item"
            :class="{ active: String(route.params.tableId) === String(table.id) }"
            @click="go(`/data/${table.id}`)"
          >
            <span class="ellipsis-1">{{ table.name }}</span>
          </div>
        </el-tooltip>
        <div v-if="!filteredTables.length" class="table-empty">还没有表格</div>
        <div class="wb-nav-item new-table" @click="$emit('new-table')">
          <el-icon><Plus /></el-icon><span>新建表格</span>
        </div>
      </div>

      <div
        v-for="item in mainItems"
        :key="item.path"
        class="wb-nav-item"
        :class="{ active: route.path === item.path }"
        @click="go(item.path)"
      >
        <el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowRight,
  Calendar,
  DashboardIcon,
  Collection,
  Delete,
  Document,
  Fold,
  Memo,
  Plus,
  Todo,
  Translate,
} from '@/icons'

const props = defineProps<{
  tables: any[]
  tableSearch: string
  collapsed?: boolean
  collapsible?: boolean
}>()

defineEmits<{
  (e: 'update:tableSearch', value: string): void
  (e: 'navigate'): void
  (e: 'new-table'): void
  (e: 'collapse'): void
}>()

const route = useRoute()
const router = useRouter()

const stored = localStorage.getItem('wb_nav_expanded')
const expanded = reactive<Record<string, boolean>>(
  stored ? JSON.parse(stored) : { checkin: true, data: true },
)

const checkinItems = [
  { label: '店铺打卡', path: '/checkins/shops' },
  { label: '社媒打卡', path: '/checkins/social' },
]

const mainItems = [
  { label: '笔记', path: '/notes', icon: Document },
  { label: '便利贴', path: '/memos', icon: Memo },
  { label: '翻译', path: '/translate', icon: Translate },
  { label: '回收站', path: '/trash', icon: Delete },
]

const filteredTables = computed(() => {
  const keyword = (props.tableSearch || '').trim().toLowerCase()
  if (!keyword) return props.tables
  return props.tables.filter((table) => String(table.name).toLowerCase().includes(keyword))
})

function toggle(key: string) {
  expanded[key] = !expanded[key]
  localStorage.setItem('wb_nav_expanded', JSON.stringify(expanded))
}

function go(path: string) {
  if (route.fullPath !== path) router.push(path)
}
</script>

<style scoped>
.table-search {
  padding: 2px 6px 6px;
}
.table-empty {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  padding: 6px 14px 6px 36px;
}
.new-table {
  color: var(--wb-primary);
}
.caret {
  transition: transform 0.15s ease;
  font-size: 12px;
}
.caret.open {
  transform: rotate(90deg);
}
</style>
