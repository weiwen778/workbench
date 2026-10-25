<template>
  <el-drawer
    :model-value="modelValue"
    title="字段设置"
    size="560px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="toolbar-actions" style="margin-bottom: 10px">
      <el-button class="btn-tonal" :icon="Plus" @click="openAdd">添加字段</el-button>
      <span class="text-12 muted">共 {{ fields.length }} / 50 个字段</span>
    </div>

    <el-table :data="fields" size="small">
      <el-table-column prop="name" label="字段" min-width="120" show-overflow-tooltip />
      <el-table-column label="类型" width="86">
        <template #default="{ row }">{{ typeText(row.type) }}</template>
      </el-table-column>
      <el-table-column label="必填" width="60" align="center">
        <template #default="{ row }">
          <el-icon v-if="row.required" color="var(--wb-primary)"><Check /></el-icon>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row, $index }">
          <div class="actions-group">
            <el-button text size="small" @click="openEdit(row)">编辑</el-button>
            <el-button text size="small" :disabled="$index === 0" @click="move($index, -1)">上移</el-button>
            <el-button text size="small" :disabled="$index === fields.length - 1" @click="move($index, 1)">下移</el-button>
            <el-button text size="small" @click="removeField(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogOpen"
      :title="editing ? '编辑字段' : '添加字段'"
      width="460px"
      :append-to-body="true"
    >
      <el-form label-position="top">
        <el-form-item label="字段名称" required>
          <el-input v-model="form.name" maxlength="50" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" :disabled="!!editing" style="width: 100%">
            <el-option v-for="t in fieldTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
          <div v-if="editing" class="text-12 muted">已有数据的字段不能直接改类型；如需改类型请新建字段并迁移数据</div>
        </el-form-item>
        <el-form-item label="必填">
          <el-switch v-model="form.required" />
        </el-form-item>
        <el-form-item v-if="form.type === 'select' || form.type === 'multiselect'" label="选项">
          <div style="width: 100%">
            <div v-for="(opt, index) in form.options" :key="index" class="option-row">
              <el-input v-model="opt.name" placeholder="选项名称" maxlength="40" style="flex: 1" />
              <el-button text :icon="Delete" @click="form.options.splice(index, 1)" />
            </div>
            <el-button text :icon="Plus" size="small" @click="form.options.push({ id: '', name: '' })">
              添加选项
            </el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="!editing" label="默认值（表中已有数据时，新增必填字段需要填默认值）">
          <el-select
            v-if="form.type === 'select' || form.type === 'multiselect'"
            v-model="form.default_value"
            clearable
            style="width: 100%"
          >
            <el-option v-for="opt in form.options.filter((o) => o.name)" :key="opt.name" :label="opt.name" :value="opt.id || opt.name" />
          </el-select>
          <el-switch v-else-if="form.type === 'checkbox'" v-model="form.default_value" />
          <el-input v-else v-model="form.default_value" placeholder="可不填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="dialogOpen = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Delete, Plus } from '@element-plus/icons-vue'
import { apiError, http } from '@/api/client'

const props = defineProps<{
  modelValue: boolean
  tableId: number
  fields: any[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'updated'): void
}>()

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

const dialogOpen = ref(false)
const saving = ref(false)
const editing = ref<any>(null)
const form = reactive<{ name: string; type: string; required: boolean; default_value: any; options: { id: string; name: string }[] }>(
  { name: '', type: 'short_text', required: false, default_value: '', options: [] },
)

function typeText(type: string) {
  return fieldTypes.find((t) => t.value === type)?.label || type
}

function openAdd() {
  editing.value = null
  form.name = ''
  form.type = 'short_text'
  form.required = false
  form.default_value = ''
  form.options = []
  dialogOpen.value = true
}

function openEdit(row: any) {
  editing.value = row
  form.name = row.name
  form.type = row.type
  form.required = row.required
  form.default_value = row.default_value ?? ''
  form.options = (row.options || []).map((o: any) => ({ id: o.id, name: o.name }))
  dialogOpen.value = true
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写字段名称')
    return
  }
  saving.value = true
  try {
    const options =
      form.type === 'select' || form.type === 'multiselect'
        ? form.options
            .filter((o) => o.name.trim())
            .map((o, index) => ({ id: o.id || `opt_${Date.now()}_${index}`, name: o.name.trim() }))
        : null
    if (editing.value) {
      await http.patch(`/fields/${editing.value.id}`, {
        name: form.name.trim(),
        required: form.required,
        options: options ?? undefined,
      })
    } else {
      await http.post(`/tables/${props.tableId}/fields`, {
        name: form.name.trim(),
        type: form.type,
        required: form.required,
        default_value: form.default_value === '' ? null : form.default_value,
        options,
      })
    }
    dialogOpen.value = false
    ElMessage.success('已保存')
    emit('updated')
  } catch (error: any) {
    const details = error?.response?.data?.details
    if (details?.empty_count) {
      ElMessage.error(`已有 ${details.empty_count} 条数据的该字段为空，请先补齐再设为必填`)
    } else if (details?.used) {
      ElMessage.error(`有 ${details.used} 条数据仍在使用要删除的选项，请先调整这些数据`)
    } else {
      ElMessage.error(apiError(error).message)
    }
  } finally {
    saving.value = false
  }
}

async function removeField(row: any) {
  try {
    await http.delete(`/fields/${row.id}`)
    ElMessage.success('字段已删除')
    emit('updated')
  } catch (error: any) {
    const body = error?.response?.data
    if (body?.code === 'DELETE_CONFIRM_REQUIRED') {
      try {
        await ElMessageBox.confirm(
          `该字段在 ${body.details.active} 条活动数据和 ${body.details.trashed} 条回收站数据中有值。删除后这些值不再显示，字段也不进入回收站。`,
          '确认删除字段',
          { type: 'warning', confirmButtonText: '仍要删除', cancelButtonText: '取消' },
        )
        await http.delete(`/fields/${row.id}`, { params: { confirm: true } })
        ElMessage.success('字段已删除')
        emit('updated')
      } catch (inner: any) {
        if (inner === 'cancel' || inner === 'close') return
        ElMessage.error(apiError(inner).message)
      }
      return
    }
    ElMessage.error(apiError(error).message)
  }
}

async function move(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= props.fields.length) return
  const current = props.fields[index]
  const other = props.fields[target]
  try {
    await http.patch(`/fields/${current.id}`, { sort_order: other.sort_order })
    await http.patch(`/fields/${other.id}`, { sort_order: current.sort_order })
    emit('updated')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}
</script>

<style scoped>
.option-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
</style>
