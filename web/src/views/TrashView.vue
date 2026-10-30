<template>
  <div class="page">
    <div class="page-toolbar">
      <div class="title-15">回收站</div>
      <span class="text-12 muted">删除后保留 30 天，到期不可恢复</span>
      <div class="spacer" />
      <div class="toolbar-actions">
        <el-button text :icon="Refresh" @click="load">刷新</el-button>
        <el-button text @click="purgeExpired">清理已到期</el-button>
      </div>
    </div>

    <el-radio-group v-model="kind" size="small" @change="load">
      <el-radio-button value="">全部</el-radio-button>
      <el-radio-button value="table">表格</el-radio-button>
      <el-radio-button value="record">表格行</el-radio-button>
      <el-radio-button value="note">笔记</el-radio-button>
      <el-radio-button value="memo">便利贴</el-radio-button>
    </el-radio-group>

    <div class="page-body">
      <el-table :data="items" v-loading="loading" size="default">
        <el-table-column prop="kind_label" label="类型" width="100" />
        <el-table-column prop="name" label="名称或摘要" min-width="200" show-overflow-tooltip />
        <el-table-column label="删除时间" width="160">
          <template #default="{ row }">{{ formatTime(row.deleted_at) }}</template>
        </el-table-column>
        <el-table-column label="剩余" width="90">
          <template #default="{ row }">
            <span :class="{ warn: row.remaining_days <= 3 }">{{ row.remaining_days }} 天</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <div class="actions-group">
              <el-button text size="small" @click="restore(row)">恢复</el-button>
              <el-button text size="small" @click="purge(row)">彻底删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!items.length && !loading" class="empty-hint">
        <div>回收站是空的</div>
        <div class="text-12">
          表格、表格里的行、笔记、便利贴删除后会在这里保留 30 天；待办、店铺、社媒账号不进回收站
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@/icons'
import { apiError, http } from '@/api/client'

const items = ref<any[]>([])
const kind = ref('')
const loading = ref(false)

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = {}
    if (kind.value) params.kind = kind.value
    const { data } = await http.get('/trash', { params })
    items.value = data.items
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

async function restore(row: any) {
  try {
    const { data } = await http.post(`/trash/${row.kind}/${row.entity_id}/restore`)
    ElMessage.success(data.message || '已恢复')
    await load()
    window.dispatchEvent(new Event('wb:tables-changed'))
  } catch (error: any) {
    const body = error?.response?.data
    if (body?.code === 'NAME_CONFLICT') {
      ElMessage.error('已经有同名表格，请先给现有表格改名再恢复')
    } else if (body?.code === 'PARENT_TABLE_DELETED') {
      ElMessage.error('它所属的表格还没恢复，请先恢复表格')
    } else {
      ElMessage.error(apiError(error).message)
    }
  }
}

async function purge(row: any) {
  try {
    await ElMessageBox.confirm(
      `彻底删除「${row.name}」？删了就找不回来；附件如果没别的地方在用，也会一起清掉。`,
      '彻底删除',
      { type: 'warning', confirmButtonText: '彻底删除', cancelButtonText: '取消' },
    )
    await http.delete(`/trash/${row.kind}/${row.entity_id}`)
    ElMessage.success('已彻底删除')
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function purgeExpired() {
  try {
    const { data } = await http.post('/trash/purge-expired')
    ElMessage.success(`已清理 ${data.purged} 条到期内容`)
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

onMounted(load)
</script>

<style scoped>
.warn {
  color: var(--el-color-danger);
}
</style>
