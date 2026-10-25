<template>
  <div class="page">
    <div class="page-toolbar">
      <el-radio-group v-model="period" size="default" @change="load">
        <el-radio-button value="daily">今日</el-radio-button>
        <el-radio-button value="weekly">本周</el-radio-button>
        <el-radio-button value="monthly">本月</el-radio-button>
      </el-radio-group>

      <el-select v-model="targetId" placeholder="全部对象" clearable style="width: 150px" @change="load">
        <el-option v-for="t in targets" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>

      <el-select v-model="status" style="width: 120px" @change="load">
        <el-option label="全部" value="all" />
        <el-option label="未完成" value="pending" />
        <el-option label="已完成" value="done" />
      </el-select>

      <span class="text-13 secondary">
        {{ periodLabel }} {{ periodRange }}
      </span>
      <span class="text-13">
        完成 <b>{{ statistics.completed }}</b> / {{ statistics.total }}
        <span class="muted">（完成率 {{ statistics.rate === null ? '—' : statistics.rate + '%' }}）</span>
      </span>

      <div class="spacer" />

      <div class="toolbar-actions">
        <el-button text :icon="Refresh" @click="load">刷新</el-button>
        <el-button text :icon="Clock" @click="historyOpen = true">历史</el-button>
        <el-button class="btn-tonal" :icon="Setting" @click="manageOpen = true">管理对象</el-button>
      </div>
    </div>

    <div class="page-body">
      <div v-if="loading" class="empty-hint">加载中…</div>
      <div v-else-if="!groups.length" class="empty-hint">
        <div>{{ emptyText }}</div>
        <el-button v-if="!targets.length" class="btn-tonal" @click="manageOpen = true">先添加{{ kindLabel }}</el-button>
      </div>
      <div v-else class="scroll-area">
        <div v-for="group in groups" :key="group.group_id" class="group-block">
          <div class="group-head">
            <span class="group-title">{{ group.group_name }}</span>
            <span class="text-12 muted">{{ group.completed }} / {{ group.total }}</span>
          </div>
          <div
            v-for="item in group.items"
            :key="item.id"
            class="checkin-row"
            :class="{ done: item.completed }"
          >
            <el-checkbox
              :model-value="item.completed"
              :disabled="item.locked || busyId === item.id"
              size="large"
              @change="toggle(item)"
            />
            <div class="checkin-main">
              <div class="checkin-title">
                <span>{{ item.title }}</span>
                <span class="chip">{{ item.target_name }}</span>
                <el-tag v-if="item.locked" size="small" type="info" effect="plain">{{ item.lock_reason || '已结束' }}</el-tag>
                <el-popover v-if="item.description" placement="top-start" :width="280" trigger="hover">
                  <template #reference>
                    <el-icon class="info-icon"><InfoFilled /></el-icon>
                  </template>
                  <div class="text-13" style="white-space: pre-wrap">{{ item.description }}</div>
                </el-popover>
              </div>
              <div class="checkin-meta">
                <span v-if="item.completed_at">完成于 {{ formatTime(item.completed_at) }}</span>
                <span v-else>本{{ periodUnit }}内完成一次</span>
                <span v-if="item.note"> · 备注：{{ item.note }}</span>
              </div>
            </div>
            <el-popover
              v-model:visible="notePopover[item.id]"
              placement="left"
              :width="280"
              trigger="click"
            >
              <template #reference>
                <el-button text size="small" :disabled="item.locked">{{ item.note ? '改备注' : '备注' }}</el-button>
              </template>
              <div class="text-13" style="margin-bottom: 6px">本次备注（可选）</div>
              <el-input v-model="noteDraft[item.id]" type="textarea" :rows="3" maxlength="2000" show-word-limit />
              <div class="toolbar-actions" style="justify-content: flex-end; margin-top: 8px">
                <el-button size="small" @click="notePopover[item.id] = false">取消</el-button>
                <el-button size="small" type="primary" @click="saveNote(item)">保存</el-button>
              </div>
            </el-popover>
          </div>
        </div>
      </div>
    </div>

    <!-- 对象管理 -->
    <el-drawer v-model="manageOpen" :title="`${kindLabel}与分组`" size="520px" :append-to-body="true">
      <div class="toolbar-actions" style="margin-bottom: 12px">
        <el-input v-model="newTarget.name" placeholder="名称" style="width: 180px" maxlength="100" />
        <el-input v-model="newTarget.platform" placeholder="平台（可选）" style="width: 140px" maxlength="100" />
        <el-button type="primary" :loading="creatingTarget" @click="createTarget">添加{{ kindLabel }}</el-button>
      </div>
      <div class="table-scroll">
      <el-table :data="allTargets" size="small" style="width: 100%">
        <el-table-column prop="name" label="名称" min-width="110" show-overflow-tooltip />
        <el-table-column prop="platform" label="平台" width="80" />
        <el-table-column label="启用事项" width="76" align="center">
          <template #default="{ row }">{{ row.rule_count }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'archived'" size="small" type="info" effect="plain">已归档</el-tag>
            <span v-else class="text-12 secondary">使用中</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="146">
          <template #default="{ row }">
            <div class="actions-group">
              <el-button text size="small" @click="openTarget(row)">资料与事项</el-button>
              <el-button
                v-if="row.status === 'active'"
                text
                size="small"
                @click="archive(row)"
              >归档</el-button>
              <el-button v-else text size="small" @click="restore(row)">恢复</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      </div>

      <div class="group-title" style="margin-top: 16px">工作分组</div>
      <div class="toolbar-actions" style="margin-bottom: 8px">
        <el-input v-model="newGroupName" placeholder="新分组名称" style="width: 180px" maxlength="100" />
        <el-button :icon="Plus" @click="createGroup">添加分组</el-button>
      </div>
      <el-table :data="groupList" size="small">
        <el-table-column prop="name" label="分组" min-width="120" />
        <el-table-column label="启用事项" width="86" align="center">
          <template #default="{ row }">{{ row.rule_count }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button text size="small" @click="removeGroup(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <!-- 历史 -->
    <el-drawer v-model="historyOpen" title="打卡历史" size="680px" :append-to-body="true">
      <div class="toolbar-actions" style="margin-bottom: 12px">
        <el-select v-model="historyStatus" style="width: 120px" @change="loadHistory">
          <el-option label="全部" value="all" />
          <el-option label="未完成" value="pending" />
          <el-option label="已完成" value="done" />
        </el-select>
        <el-date-picker
          v-model="historyRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 240px"
          @change="loadHistory"
        />
        <el-button text :icon="Refresh" @click="loadHistory">刷新</el-button>
      </div>
      <div class="table-scroll">
        <el-table :data="historyItems" size="small" v-loading="historyLoading" style="width: 100%">
          <el-table-column prop="period_start" label="周期" width="96" />
          <el-table-column prop="target_name" label="对象" width="96" show-overflow-tooltip />
          <el-table-column prop="group_name" label="分组" width="84" show-overflow-tooltip />
          <el-table-column prop="title" label="事项" min-width="130" show-overflow-tooltip />
          <el-table-column label="状态" width="78">
            <template #default="{ row }">
              <el-tag v-if="row.completed" size="small" type="success" effect="plain">已完成</el-tag>
              <el-tag v-else size="small" type="warning" effect="plain">未完成</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="完成时间" width="112">
            <template #default="{ row }">
              <span class="text-12">{{ row.completed_at ? formatShort(row.completed_at) : '—' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="historyTotal > historyItems.length" class="text-12 muted" style="margin-top: 8px">
        共 {{ historyTotal }} 条，当前显示 {{ historyItems.length }} 条
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Clock, InfoFilled, Plus, Refresh, Setting } from '@element-plus/icons-vue'
import { apiError, http } from '@/api/client'

const route = useRoute()
const router = useRouter()

const period = ref<'daily' | 'weekly' | 'monthly'>('daily')
const status = ref('all')
const targetId = ref<number | null>(null)
const groups = ref<any[]>([])
const targets = ref<any[]>([])
const statistics = ref<{ completed: number; total: number; rate: number | null }>({
  completed: 0,
  total: 0,
  rate: null,
})
const periodRange = ref('')
const loading = ref(false)
const busyId = ref<number | null>(null)
const noteDraft = reactive<Record<number, string>>({})
const notePopover = reactive<Record<number, boolean>>({})

const manageOpen = ref(false)
const allTargets = ref<any[]>([])
const groupList = ref<any[]>([])
const newTarget = reactive({ name: '', platform: '' })
const newGroupName = ref('')
const creatingTarget = ref(false)

const historyOpen = ref(false)
const historyItems = ref<any[]>([])
const historyTotal = ref(0)
const historyLoading = ref(false)
const historyStatus = ref('all')
const historyRange = ref<[string, string] | null>(null)

const kind = computed(() => (route.meta.kind as string) === 'social' ? 'social' : 'shop')
const kindLabel = computed(() => (kind.value === 'social' ? '社媒账号' : '店铺'))
const periodUnit = computed(() => ({ daily: '日', weekly: '周', monthly: '月' }[period.value]))
const periodLabel = computed(() => ({ daily: '今天', weekly: '本周', monthly: '本月' }[period.value]))
const emptyText = computed(() => {
  if (!targets.value.length) return `还没有${kindLabel.value}，先添加一个`
  if (status.value === 'pending') return '没有未完成事项'
  if (status.value === 'done') return '本周期还没有完成记录'
  return '当前没有需要处理的打卡事项'
})

function formatTime(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatShort(value: string) {
  if (!value) return ''
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { kind: kind.value, period: period.value, status: status.value }
    if (targetId.value) params.target_id = targetId.value
    const { data } = await http.get('/checkin-instances', { params })
    groups.value = data.groups
    targets.value = data.targets
    statistics.value = data.statistics
    periodRange.value = `${data.period_start} ~ ${data.period_end}`
    for (const group of data.groups) {
      for (const item of group.items) {
        if (noteDraft[item.id] === undefined) noteDraft[item.id] = item.note || ''
      }
    }
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

async function toggle(item: any) {
  busyId.value = item.id
  try {
    if (item.completed) {
      await http.post(`/checkin-instances/${item.id}/cancel`)
    } else {
      const note = (noteDraft[item.id] || '').trim()
      await http.post(`/checkin-instances/${item.id}/complete`, { note: note || null })
    }
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    busyId.value = null
  }
}

async function saveNote(item: any) {
  try {
    await http.patch(`/checkin-instances/${item.id}`, { note: (noteDraft[item.id] || '').trim() || null })
    notePopover[item.id] = false
    ElMessage.success('备注已保存')
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function loadTargets() {
  const { data } = await http.get('/work-targets', { params: { include_archived: true } })
  allTargets.value = data.filter((t: any) => t.kind === kind.value)
  targets.value = data.filter((t: any) => t.kind === kind.value && t.status === 'active')
}

async function loadGroups() {
  const { data } = await http.get('/checkin-groups')
  groupList.value = data
}

async function openManage() {
  manageOpen.value = true
  try {
    await Promise.all([loadTargets(), loadGroups()])
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function createTarget() {
  if (!newTarget.name.trim()) {
    ElMessage.warning('请填写名称')
    return
  }
  creatingTarget.value = true
  try {
    await http.post('/work-targets', {
      kind: kind.value,
      name: newTarget.name.trim(),
      platform: newTarget.platform.trim() || null,
    })
    newTarget.name = ''
    newTarget.platform = ''
    ElMessage.success('已添加')
    await loadTargets()
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    creatingTarget.value = false
  }
}

async function createGroup() {
  if (!newGroupName.value.trim()) {
    ElMessage.warning('请填写分组名称')
    return
  }
  try {
    await http.post('/checkin-groups', { name: newGroupName.value.trim() })
    newGroupName.value = ''
    await loadGroups()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function removeGroup(row: any) {
  try {
    await ElMessageBox.confirm(`删除分组「${row.name}」？分组仍有启用事项或未完成工作时不能删除。`, '删除分组', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.delete(`/checkin-groups/${row.id}`)
    await loadGroups()
    ElMessage.success('已删除')
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

function openTarget(row: any) {
  manageOpen.value = false
  router.push(`/checkins/targets/${row.id}`)
}

async function archive(row: any) {
  try {
    await ElMessageBox.confirm(
      `归档「${row.name}」后将从日常清单隐藏并停止生成新工作，已有记录保留并锁定。`,
      '归档确认',
      { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
    )
    await http.post(`/work-targets/${row.id}/archive`)
    await loadTargets()
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function restore(row: any) {
  try {
    await http.post(`/work-targets/${row.id}/restore`)
    ElMessage.success('已恢复，从下一个对应周期继续')
    await loadTargets()
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const params: Record<string, any> = { kind: kind.value, period: period.value, status: historyStatus.value }
    if (historyRange.value?.length === 2) {
      params.date_from = historyRange.value[0]
      params.date_to = historyRange.value[1]
    }
    if (targetId.value) params.target_id = targetId.value
    const { data } = await http.get('/checkin-instances/history', { params })
    historyItems.value = data.items
    historyTotal.value = data.total
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    historyLoading.value = false
  }
}

watch(manageOpen, (open) => {
  if (open) openManage()
})
watch(historyOpen, (open) => {
  if (open) loadHistory()
})

onMounted(load)
</script>

<style scoped>
.group-block {
  background: var(--wb-surface);
  border: 1px solid var(--wb-border);
  border-radius: 12px;
  padding: 6px 12px 8px;
  margin-bottom: 10px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 2px;
}
.chip {
  font-size: 12px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--el-color-primary-light-9);
  color: var(--wb-primary);
}
.info-icon {
  color: var(--wb-text-tertiary);
  cursor: help;
  font-size: 14px;
}
</style>
