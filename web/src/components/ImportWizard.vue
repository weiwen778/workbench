<template>
  <el-dialog
    :model-value="modelValue"
    :title="tableId ? '导入到当前表格' : '从文件新建表格'"
    width="820px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="reset"
  >
    <!-- 第一步：选文件 -->
    <div v-if="step === 'upload'">
      <el-upload
        drag
        :auto-upload="false"
        :show-file-list="false"
        accept=".xlsx,.xls,.csv,.json"
        :on-change="onFileChange"
      >
        <div class="upload-hint">
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <div>把 Excel、CSV 或 JSON 文件拖到这里，或点一下选择</div>
          <div class="text-12 muted">支持 .xlsx / .xls / .csv / .json；最多 1 万行、50 列，第一行当标题行</div>
        </div>
      </el-upload>
      <div v-if="errorText" class="text-13" style="color: var(--el-color-danger); margin-top: 8px">
        {{ errorText }}
      </div>
    </div>

    <!-- 第二步：对应关系与检查 -->
    <div v-else>
      <div class="toolbar-actions" style="margin-bottom: 10px">
        <template v-if="sheets.length > 1">
          <span class="text-13 secondary">工作表：</span>
          <el-select v-model="sheet" style="width: 160px" @change="reloadPreview">
            <el-option v-for="name in sheets" :key="name" :label="name" :value="name" />
          </el-select>
        </template>
        <span class="text-12 muted">共 {{ rowCount }} 行</span>
        <div class="spacer" />
        <el-button text size="small" @click="step = 'upload'">重新选择文件</el-button>
      </div>

      <el-form v-if="!tableId" label-position="top" style="margin-bottom: 10px">
        <el-form-item label="新表格名称" required>
          <el-input v-model="tableName" maxlength="100" />
        </el-form-item>
      </el-form>

      <el-table :data="columnRows" size="small" max-height="320">
        <el-table-column prop="header" label="Excel 列" width="150" show-overflow-tooltip />
        <el-table-column label="示例内容" width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-12 muted">{{ row.sample || '—' }}</span>
          </template>
        </el-table-column>
        <template v-if="tableId">
          <el-table-column label="对应到哪一列" width="200">
            <template #default="{ row }">
              <el-select v-model="mapping[row.col]" size="small" placeholder="忽略此列" clearable style="width: 100%">
                <el-option v-for="f in existingFields" :key="f.key" :label="`${f.name}（${typeText(f.type)}）`" :value="f.key" />
              </el-select>
            </template>
          </el-table-column>
        </template>
        <template v-else>
          <el-table-column label="列名" width="150">
            <template #default="{ row }">
              <el-input v-model="row.name" size="small" maxlength="50" />
            </template>
          </el-table-column>
          <el-table-column label="类型" width="140">
            <template #default="{ row }">
              <el-select v-model="row.type" size="small" style="width: 100%">
                <el-option v-for="t in fieldTypes" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="必填" width="70" align="center">
            <template #default="{ row }">
              <el-checkbox v-model="row.required" />
            </template>
          </el-table-column>
        </template>
      </el-table>

      <div v-if="errors.length" class="error-box">
        <div class="text-13" style="font-weight: 600; margin-bottom: 4px">
          发现 {{ errors.length }} 处问题，这次一行都不会导入
        </div>
        <div class="error-list">
          <div v-for="(err, index) in errors.slice(0, 50)" :key="index" class="text-12">
            第 {{ err.row }} 行 · {{ err.column }}：{{ err.message }}
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="toolbar-actions" style="justify-content: flex-end">
        <el-button @click="$emit('update:modelValue', false)">取消</el-button>
        <el-button v-if="step === 'preview'" :loading="checking" @click="validate">检查</el-button>
        <el-button
          v-if="step === 'preview'"
          type="primary"
          :loading="confirming"
          @click="confirmImport"
        >确认导入</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { apiError, http } from '@/api/client'

const props = defineProps<{ modelValue: boolean; tableId?: number; existingFields?: any[] }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'done', tableId: number): void
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
]

const step = ref<'upload' | 'preview'>('upload')
const file = ref<File | null>(null)
const job = ref<any>(null)
const sheets = ref<string[]>([])
const sheet = ref('')
const headers = ref<string[]>([])
const sample = ref<string[][]>([])
const rowCount = ref(0)
const mapping = reactive<Record<string, string | null>>({})
const fields = ref<any[]>([])
const tableName = ref('')
const errors = ref<any[]>([])
const errorText = ref('')
const checking = ref(false)
const confirming = ref(false)

const columnRows = computed(() =>
  headers.value.map((header, index) => ({
    col: String(index),
    header,
    sample: sample.value[0]?.[index] || '',
    get name() {
      return fields.value[index]?.name ?? header
    },
    set name(value: string) {
      if (fields.value[index]) fields.value[index].name = value
    },
    get type() {
      return fields.value[index]?.type ?? 'short_text'
    },
    set type(value: string) {
      if (fields.value[index]) fields.value[index].type = value
    },
    get required() {
      return fields.value[index]?.required ?? false
    },
    set required(value: boolean) {
      if (fields.value[index]) fields.value[index].required = value
    },
  })),
)

function typeText(type: string) {
  return fieldTypes.find((t) => t.value === type)?.label || type
}

function reset() {
  step.value = 'upload'
  file.value = null
  job.value = null
  errors.value = []
  errorText.value = ''
  tableName.value = ''
  headers.value = []
  sample.value = []
  rowCount.value = 0
  Object.keys(mapping).forEach((key) => delete mapping[key])
}

async function onFileChange(uploadFile: any) {
  file.value = uploadFile.raw
  errorText.value = ''
  await uploadPreview()
}

async function uploadPreview() {
  if (!file.value) return
  const form = new FormData()
  form.append('file', file.value)
  if (props.tableId) form.append('table_id', String(props.tableId))
  if (sheet.value) form.append('sheet', sheet.value)
  try {
    const { data } = await http.post('/imports/preview', form)
    job.value = data
    sheets.value = data.sheets
    sheet.value = data.sheet
    headers.value = data.headers
    sample.value = data.sample
    rowCount.value = data.row_count
    tableName.value = data.table_name
    fields.value = data.fields || []
    Object.keys(mapping).forEach((key) => delete mapping[key])
    Object.assign(mapping, data.mapping)
    step.value = 'preview'
  } catch (error) {
    errorText.value = apiError(error).message
  }
}

async function reloadPreview() {
  await uploadPreview()
}

function payload() {
  const body: Record<string, any> = { mapping: { ...mapping } }
  if (!props.tableId) {
    body.table_name = tableName.value
    body.fields = fields.value.map((f, index) => ({
      key: f.key || `col_${index}`,
      name: f.name,
      type: f.type,
      required: !!f.required,
      options: f.options || [],
    }))
  }
  return body
}

async function validate() {
  checking.value = true
  errors.value = []
  try {
    const { data } = await http.post(`/imports/${job.value.id}/draft`, payload())
    errors.value = data.errors || []
    if (!errors.value.length) ElMessage.success('检查通过，可以导入了')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    checking.value = false
  }
}

async function confirmImport() {
  confirming.value = true
  try {
    await http.post(`/imports/${job.value.id}/draft`, payload())
    const { data } = await http.post(`/imports/${job.value.id}/confirm`)
    if (data.status === 'success') {
      ElMessage.success(`已导入 ${data.result.imported} 行`)
      emit('done', data.result.table_id)
      emit('update:modelValue', false)
      window.dispatchEvent(new Event('wb:tables-changed'))
    } else {
      errors.value = data.errors || []
      ElMessage.warning('还有需要改的地方')
    }
  } catch (error: any) {
    const body = error?.response?.data
    if (body?.details?.errors) {
      errors.value = body.details.errors
    }
    ElMessage.error(apiError(error).message)
  } finally {
    confirming.value = false
  }
}
</script>

<style scoped>
.upload-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 12px;
  font-size: 13px;
}
.upload-icon {
  font-size: 32px;
  color: var(--wb-text-tertiary);
}
.error-box {
  margin-top: 10px;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--el-color-danger-light-9);
}
.error-list {
  max-height: 150px;
  overflow: auto;
  color: var(--el-color-danger);
}
</style>
