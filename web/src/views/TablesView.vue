<template>
  <div class="page">
    <div class="page-toolbar">
      <span class="text-12 muted">共 {{ tables.length }} 张表格</span>
      <div class="spacer" />
      <div class="toolbar-actions">
        <el-button text :icon="Refresh" @click="load">刷新</el-button>
        <el-button :icon="Upload" @click="importOpen = true">从 Excel 导入</el-button>
        <el-button class="btn-tonal" :icon="Plus" @click="createOpen = true">新建表格</el-button>
      </div>
    </div>

    <div class="page-body">
      <el-table :data="tables" v-loading="loading" size="default">
        <el-table-column prop="name" label="表格名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="open(row)">{{ row.name }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="说明" min-width="200" show-overflow-tooltip />
        <el-table-column label="列" width="80" align="center">
          <template #default="{ row }">{{ row.field_count ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="数据" width="80" align="center">
          <template #default="{ row }">{{ row.record_count }}</template>
        </el-table-column>
        <el-table-column label="操作" width="190">
          <template #default="{ row }">
            <div class="actions-group">
              <el-button text size="small" @click="open(row)">打开</el-button>
              <el-button text size="small" @click="rename(row)">重命名</el-button>
              <el-button text size="small" @click="remove(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!tables.length && !loading" class="empty-hint">
        <div>还没有表格</div>
        <div class="text-12">新建后可以自己加列；也可以点右上角「从 Excel 导入」，用一个现成的表格直接生成</div>
        <el-button class="btn-tonal" @click="createOpen = true">新建一张表格</el-button>
      </div>
    </div>

    <!-- 新建 -->
    <el-dialog v-model="createOpen" title="新建表格" width="520px">
      <el-form label-position="top">
        <el-form-item label="表格名称" required>
          <el-input v-model="form.name" maxlength="100" placeholder="例如：商品台账" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="2000" />
        </el-form-item>
        <el-form-item label="初始的列（可选，创建后也能再加）">
          <div style="width: 100%">
            <div v-for="(field, index) in form.fields" :key="index" class="field-row">
              <el-input v-model="field.name" placeholder="列名" maxlength="50" style="flex: 1" />
              <el-select v-model="field.type" style="width: 120px">
                <el-option v-for="t in fieldTypes" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
              <el-button text :icon="Delete" @click="form.fields.splice(index, 1)" />
            </div>
            <el-button text :icon="Plus" size="small" @click="addFieldDraft">添加一列</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="createOpen = false">取消</el-button>
          <el-button type="primary" :loading="creating" @click="createTable">创建并打开</el-button>
        </div>
      </template>
    </el-dialog>

    <ImportWizard v-model="importOpen" @done="onImported" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus, Refresh, Upload } from '@/icons'
import { apiError, http } from '@/api/client'
import ImportWizard from '@/components/ImportWizard.vue'

const router = useRouter()
const tables = ref<any[]>([])
const loading = ref(false)
const createOpen = ref(false)
const importOpen = ref(false)
const creating = ref(false)
const form = reactive<{ name: string; note: string; fields: { name: string; type: string }[] }>({
  name: '',
  note: '',
  fields: [],
})

const fieldTypes = [
  { label: '短文本', value: 'short_text' },
  { label: '长文本', value: 'long_text' },
  { label: '数字', value: 'number' },
  { label: '日期', value: 'date' },
  { label: '单选', value: 'select' },
  { label: '多选', value: 'multiselect' },
  { label: '勾选', value: 'checkbox' },
  { label: '链接', value: 'url' },
  { label: '附件', value: 'attachment' },
]

async function load() {
  loading.value = true
  try {
    const { data } = await http.get('/tables')
    tables.value = data
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

function addFieldDraft() {
  form.fields.push({ name: '', type: 'short_text' })
}

async function createTable() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写表格名称')
    return
  }
  creating.value = true
  try {
    const { data } = await http.post('/tables', {
      name: form.name.trim(),
      note: form.note,
      fields: form.fields.filter((f) => f.name.trim()).map((f) => ({ name: f.name.trim(), type: f.type })),
    })
    createOpen.value = false
    form.name = ''
    form.note = ''
    form.fields = []
    window.dispatchEvent(new Event('wb:tables-changed'))
    router.push(`/data/${data.id}`)
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    creating.value = false
  }
}

function open(row: any) {
  router.push(`/data/${row.id}`)
}

async function rename(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('新的表格名称', '重命名表格', {
      inputValue: row.name,
      inputPattern: /\S+/,
      inputErrorMessage: '请输入表格名称',
    })
    await http.patch(`/tables/${row.id}`, { name: value.trim() })
    await load()
    window.dispatchEvent(new Event('wb:tables-changed'))
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(
      `删除整张表格「${row.name}」和里面的 ${row.record_count} 行内容？删除后会在回收站保留 30 天。`,
      '删除表格',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await http.delete(`/tables/${row.id}`)
    await load()
    window.dispatchEvent(new Event('wb:tables-changed'))
    ElMessage.success('已移入回收站')
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

function onImported(tableId: number) {
  load()
  window.dispatchEvent(new Event('wb:tables-changed'))
  router.push(`/data/${tableId}`)
}

onMounted(load)
</script>

<style scoped>
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
