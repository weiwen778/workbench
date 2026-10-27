<template>
  <el-drawer
    :model-value="modelValue"
    :title="record ? '编辑这一行' : '添加一行'"
    :size="drawerSize"
    :close-on-click-modal="false"
    :close-on-press-escape="uploading === null && !saving"
    :show-close="uploading === null && !saving"
    @update:model-value="$emit('update:modelValue', $event)"
    @open="init"
  >
    <el-form label-position="top" class="drawer-form" :disabled="saving || uploading !== null">
      <el-form-item
        v-for="field in fields"
        :key="field.key"
        :label="field.name"
        :required="field.required"
      >
        <!-- 短文本 -->
        <el-input
          v-if="field.type === 'short_text'"
          v-model="data[field.key]"
          maxlength="500"
          show-word-limit
        />
        <!-- 长文本 -->
        <el-input
          v-else-if="field.type === 'long_text'"
          v-model="data[field.key]"
          type="textarea"
          :rows="4"
          maxlength="20000"
        />
        <!-- 数字：按文本保存，避免浮点近似 -->
        <el-input
          v-else-if="field.type === 'number'"
          v-model="data[field.key]"
          inputmode="decimal"
          placeholder="例如：12.50"
        />
        <!-- 日期 -->
        <el-date-picker
          v-else-if="field.type === 'date'"
          v-model="data[field.key]"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
        <!-- 单选 -->
        <el-select
          v-else-if="field.type === 'select'"
          v-model="data[field.key]"
          clearable
          style="width: 100%"
        >
          <el-option v-for="opt in field.options || []" :key="opt.id" :label="opt.name" :value="opt.id" />
        </el-select>
        <!-- 多选 -->
        <el-select
          v-else-if="field.type === 'multiselect'"
          v-model="data[field.key]"
          multiple
          clearable
          style="width: 100%"
        >
          <el-option v-for="opt in field.options || []" :key="opt.id" :label="opt.name" :value="opt.id" />
        </el-select>
        <!-- 勾选 -->
        <el-switch v-else-if="field.type === 'checkbox'" v-model="data[field.key]" />
        <!-- 链接 -->
        <el-input v-else-if="field.type === 'url'" v-model="data[field.key]" placeholder="https://" />
        <!-- 附件 -->
        <div v-else-if="field.type === 'attachment'" class="upload-field">
          <template v-if="data[field.key]">
            <div class="file-chip">
              <el-icon><Paperclip /></el-icon>
              <el-link v-if="fileInfo[field.key]" @click="previewFile = fileInfo[field.key]; previewOpen = true">
                {{ fileInfo[field.key].name }}
              </el-link>
              <span v-else>附件 #{{ data[field.key] }}</span>
              <el-button text size="small" @click="removeFile(field)">替换</el-button>
            </div>
          </template>
          <el-upload
            v-else
            :show-file-list="false"
            :http-request="(options: any) => uploadFile(options, field)"
            :disabled="uploading !== null || saving"
          >
            <el-button :icon="Upload" :loading="uploading === field.key" size="small">选择文件</el-button>
            <span class="text-12 muted" style="margin-left: 8px">单文件，最大 20 MB</span>
          </el-upload>
        </div>
      </el-form-item>

      <el-alert v-if="conflict" type="warning" :closable="false" show-icon style="margin-bottom: 10px">
        <template #title>这一行已经在别处被改过</template>
        <div class="text-12">你填的内容还留在这里。可以先复制、刷新后再改，也可以直接按你填的保存。</div>
        <div class="toolbar-actions" style="margin-top: 6px">
          <el-button size="small" @click="reloadLatest">换成最新的</el-button>
          <el-button size="small" type="warning" @click="save(true)">按我填的保存</el-button>
        </div>
      </el-alert>
    </el-form>

    <template #footer>
      <div class="toolbar-actions" style="justify-content: flex-end">
        <el-button :disabled="saving || uploading !== null" @click="$emit('update:modelValue', false)">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="uploading !== null" @click="save(false)">
          {{ uploading !== null ? '附件上传中…' : '保存' }}
        </el-button>
      </div>
    </template>
  </el-drawer>
  <AttachmentPreview v-model="previewOpen" :file="previewFile" />
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Paperclip, Upload } from '@element-plus/icons-vue'
import { apiError, http } from '@/api/client'
import AttachmentPreview from './AttachmentPreview.vue'

const props = defineProps<{
  modelValue: boolean
  tableId: number
  fields: any[]
  record: any | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const data = reactive<Record<string, any>>({})
const fileInfo = reactive<Record<string, any>>({})
const saving = ref(false)
const uploading = ref<string | null>(null)
const conflict = ref(false)
const previewOpen = ref(false)
const previewFile = ref<any | null>(null)
const version = ref<number | null>(null)

const drawerSize = computed(() => (window.innerWidth < 900 ? '100%' : '520px'))

function init() {
  conflict.value = false
  Object.keys(data).forEach((key) => delete data[key])
  Object.keys(fileInfo).forEach((key) => delete fileInfo[key])
  version.value = props.record?.version ?? null
  for (const field of props.fields) {
    const raw = props.record?.data?.[field.key]
    if (field.type === 'multiselect') {
      data[field.key] = Array.isArray(raw) ? [...raw] : []
    } else if (field.type === 'checkbox') {
      data[field.key] = raw === true
    } else {
      data[field.key] = raw ?? (field.default_value ?? '')
    }
    if (field.type === 'attachment' && raw) {
      http
        .get(`/files/${raw}`)
        .then(({ data: file }) => {
          fileInfo[field.key] = file
        })
        .catch(() => {
          fileInfo[field.key] = null
        })
    }
  }
}

async function uploadFile(options: any, field: any) {
  if (uploading.value !== null || saving.value) return
  uploading.value = field.key
  const form = new FormData()
  form.append('file', options.file)
  try {
    const { data: file } = await http.post('/files', form)
    data[field.key] = file.id
    fileInfo[field.key] = file
    ElMessage.success('附件已上传，保存后生效')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    uploading.value = null
  }
}

function removeFile(field: any) {
  data[field.key] = ''
  delete fileInfo[field.key]
}

function buildPayload() {
  const payload: Record<string, any> = {}
  for (const field of props.fields) {
    const value = data[field.key]
    payload[field.key] = value === '' || value === undefined ? null : value
  }
  return payload
}

async function save(force: boolean) {
  if (uploading.value !== null || saving.value) return
  saving.value = true
  try {
    if (props.record) {
      const body: Record<string, any> = { data: buildPayload() }
      if (!force) body.version = version.value
      const { data: saved } = await http.put(`/records/${props.record.id}`, body)
      version.value = saved.version
    } else {
      await http.post(`/tables/${props.tableId}/records`, { data: buildPayload() })
    }
    ElMessage.success('已保存')
    conflict.value = false
    emit('saved')
    emit('update:modelValue', false)
  } catch (error: any) {
    if (error?.response?.status === 409 && error.response.data?.code === 'VERSION_CONFLICT') {
      conflict.value = true
      version.value = error.response.data.details?.current_version ?? version.value
      ElMessage.warning('这一行已经在别处被改过，请确认后再保存')
    } else {
      ElMessage.error(apiError(error).message)
    }
  } finally {
    saving.value = false
  }
}

async function reloadLatest() {
  if (!props.record) return
  try {
    const { data: latest } = await http.get(`/records/${props.record.id}`)
    version.value = latest.version
    for (const field of props.fields) {
      const raw = latest.data?.[field.key]
      data[field.key] = field.type === 'multiselect' ? (Array.isArray(raw) ? [...raw] : []) : (raw ?? '')
    }
    conflict.value = false
    ElMessage.success('已载入最新内容')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}
</script>

<style scoped>
.upload-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.file-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--wb-border);
  border-radius: 8px;
  font-size: 13px;
}
</style>
