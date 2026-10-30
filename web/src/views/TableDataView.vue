<template>
  <div class="page">
    <div class="page-toolbar">
      <div class="title-15">{{ table?.name || '表格' }}</div>
      <el-tooltip v-if="table?.note" :content="table.note" placement="bottom">
        <el-icon class="muted"><InfoFilled /></el-icon>
      </el-tooltip>
      <span class="text-12 muted">共 {{ total }} 行</span>
      <div class="spacer" />
      <div class="toolbar-actions">
        <el-button text :icon="DashboardIcon" @click="router.push({ path: '/visualizations', query: { table: tableId } })">可视化</el-button>
        <el-button text :icon="Refresh" @click="reload">刷新</el-button>
        <el-popover placement="bottom-end" :width="360" trigger="click">
          <template #reference>
            <el-button text :icon="Sort">
              排序{{ sorts.length ? `(${sorts.length})` : '' }}
            </el-button>
          </template>
          <div class="text-13" style="margin-bottom: 6px">排序（最多 3 列，临时生效）</div>
          <div v-for="(sort, index) in sortDraft" :key="index" class="filter-item" style="margin-bottom: 6px">
            <el-select v-model="sort.field" size="small" style="width: 140px" placeholder="列">
              <el-option v-for="f in sortableFields" :key="f.key" :label="f.name" :value="f.key" />
            </el-select>
            <el-select v-model="sort.order" size="small" style="width: 90px">
              <el-option label="升序" value="asc" />
              <el-option label="降序" value="desc" />
            </el-select>
            <el-button text size="small" :icon="Close" @click="sortDraft.splice(index, 1)" />
          </div>
          <div class="toolbar-actions">
            <el-button v-if="sortDraft.length < 3" text size="small" :icon="Plus" @click="addSort">添加排序</el-button>
            <el-button size="small" @click="clearSorts">清除</el-button>
            <el-button size="small" type="primary" @click="applySorts">应用</el-button>
          </div>
        </el-popover>
        <el-button text :icon="Setting" @click="fieldsOpen = true">列设置</el-button>
        <el-button text :icon="Download" @click="exportOpen = true">导出</el-button>
        <el-button text :icon="Upload" @click="importOpen = true">批量导入</el-button>
        <el-button class="btn-tonal" :icon="Plus" :disabled="!fields.length" @click="openCreate">添加一行</el-button>
      </div>
    </div>

    <!-- 筛选条 -->
    <div class="filter-bar">
      <div v-for="(filter, index) in filters" :key="index" class="filter-item">
        <el-select v-model="filter.field" placeholder="列" style="width: 130px" @change="onFilterFieldChange(filter)">
          <el-option v-for="f in sortableFields" :key="f.key" :label="f.name" :value="f.key" />
        </el-select>
        <el-select v-model="filter.op" style="width: 104px">
          <el-option v-for="op in operatorsFor(filter.field)" :key="op.value" :label="op.label" :value="op.value" />
        </el-select>
        <template v-if="!['empty', 'not_empty'].includes(filter.op)">
          <template v-if="filter.op === 'between'">
            <el-date-picker
              v-if="fieldType(filter.field) === 'date'"
              v-model="filter.value"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="从"
              end-placeholder="到"
              style="width: 230px"
            />
            <div v-else class="range-inputs">
              <el-input v-model="filter.value[0]" placeholder="最小" style="width: 90px" />
              <span class="muted">~</span>
              <el-input v-model="filter.value[1]" placeholder="最大" style="width: 90px" />
            </div>
          </template>
          <el-select
            v-else-if="['select', 'multiselect'].includes(fieldType(filter.field))"
            v-model="filter.value"
            :multiple="fieldType(filter.field) === 'multiselect'"
            clearable
            style="width: 160px"
          >
            <el-option
              v-for="opt in optionsOf(filter.field)"
              :key="opt.id"
              :label="opt.name"
              :value="opt.id"
            />
          </el-select>
          <el-select v-else-if="fieldType(filter.field) === 'checkbox'" v-model="filter.value" style="width: 110px">
            <el-option label="是" :value="true" />
            <el-option label="否" :value="false" />
          </el-select>
          <el-input
            v-else
            v-model="filter.value"
            placeholder="值"
            style="width: 140px"
            @keyup.enter="applyFilters"
          />
        </template>
        <el-button text :icon="Close" size="small" title="移除条件" @click="removeFilter(index)" />
      </div>
      <div class="toolbar-actions">
        <el-button v-if="filters.length < 10" text :icon="Plus" size="small" @click="addFilter">添加条件</el-button>
        <el-button size="small" type="primary" @click="applyFilters">查询</el-button>
        <el-button v-if="filters.length" size="small" @click="resetFilters">重置</el-button>
      </div>
    </div>

    <div class="page-body">
      <div v-if="!fields.length" class="empty-hint">
        <div>这张表格还没有列</div>
        <el-button class="btn-tonal" @click="fieldsOpen = true">添加一列</el-button>
      </div>
      <template v-else>
        <div class="table-scroll">
          <el-table
            :data="rows"
            v-loading="loading"
            size="small"
            height="100%"
            style="width: 100%"
            @selection-change="onSelectionChange"
            @row-click="openEdit"
          >
            <el-table-column type="selection" width="42" />
            <el-table-column
              v-for="field in fields"
              :key="field.key"
              :label="field.name"
              :min-width="columnWidth(field)"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <span v-if="field.type === 'checkbox'">
                  <el-icon v-if="row.data[field.key]" color="var(--wb-primary)"><Check /></el-icon>
                  <span v-else class="muted">否</span>
                </span>
                <el-link
                  v-else-if="field.type === 'url' && row.data[field.key]"
                  :href="row.data[field.key]"
                  target="_blank"
                  :underline="false"
                  @click.stop
                >{{ row.data[field.key] }}</el-link>
                <el-link
                  v-else-if="field.type === 'attachment' && row.data[field.key]"
                  underline="never"
                  @click.stop="openAttachment(row.data[field.key])"
                >查看附件</el-link>
                <span v-else-if="field.type === 'select'">{{ optionName(field, row.data[field.key]) }}</span>
                <span v-else-if="field.type === 'multiselect'">{{ multiName(field, row.data[field.key]) }}</span>
                <span v-else>{{ row.data[field.key] ?? '' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <div class="actions-group">
                  <el-button text size="small" @click.stop="openEdit(row)">编辑</el-button>
                  <el-button text size="small" @click.stop="removeRecord(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="pager">
          <div class="toolbar-actions">
            <el-button v-if="selection.length" size="small" @click="batchDelete">
              删除选中的 {{ selection.length }} 行
            </el-button>
            <span v-if="!rows.length" class="text-12 muted">没有符合条件的内容</span>
          </div>
          <div class="spacer" />
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="total"
            :page-sizes="[20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadRecords"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </div>

    <RecordDrawer
      v-model="recordOpen"
      :table-id="tableId"
      :fields="fields"
      :record="editingRecord"
      @saved="loadRecords"
    />
    <AttachmentPreview v-model="previewOpen" :file="previewFile" />
    <FieldManager v-model="fieldsOpen" :table-id="tableId" :fields="fields" @updated="reload" />
    <ImportWizard v-model="importOpen" :table-id="tableId" :existing-fields="fields" @done="reload" />

    <!-- 导出 -->
    <el-dialog v-model="exportOpen" title="导出表格" width="420px">
      <el-radio-group v-model="exportScope">
        <el-radio value="all">整张表格（{{ total }} 行）</el-radio>
        <el-radio value="filtered">当前筛选结果</el-radio>
      </el-radio-group>
      <div v-if="exportScope === 'filtered'" class="text-12 muted" style="margin-top: 8px">
        导出所有符合条件的内容（不只是这一页），顺序照当前排序。
      </div>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="exportOpen = false">取消</el-button>
          <el-button type="primary" :loading="exporting" @click="doExport">导出</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Close, DashboardIcon, Download, InfoFilled, Plus, Refresh, Setting, Sort, Upload } from '@/icons'
import { apiError, http } from '@/api/client'
import RecordDrawer from '@/components/RecordDrawer.vue'
import AttachmentPreview from '@/components/AttachmentPreview.vue'
import FieldManager from '@/components/FieldManager.vue'
import ImportWizard from '@/components/ImportWizard.vue'

const route = useRoute()
const router = useRouter()
const previewOpen = ref(false)
const previewFile = ref<any | null>(null)
async function openAttachment(id: number) {
  try {
    previewFile.value = (await http.get(`/files/${id}`)).data
    previewOpen.value = true
  } catch (cause) { ElMessage.error(apiError(cause).message) }
}
const tableId = Number(route.params.tableId)

const table = ref<any>(null)
const fields = ref<any[]>([])
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const loading = ref(false)
const selection = ref<any[]>([])

const filters = ref<any[]>([])
const sorts = ref<any[]>([])
const sortDraft = ref<any[]>([])

const recordOpen = ref(false)
const editingRecord = ref<any>(null)
const fieldsOpen = ref(false)
const importOpen = ref(false)
const exportOpen = ref(false)
const exportScope = ref<'all' | 'filtered'>('all')
const exporting = ref(false)

const sortableFields = computed(() => fields.value.filter((f) => !['long_text', 'multiselect', 'attachment'].includes(f.type)))

const operatorsByType: Record<string, { label: string; value: string }[]> = {
  short_text: [
    { label: '包含', value: 'contains' },
    { label: '等于', value: 'eq' },
    { label: '为空', value: 'empty' },
    { label: '不为空', value: 'not_empty' },
  ],
  long_text: [
    { label: '包含', value: 'contains' },
    { label: '为空', value: 'empty' },
    { label: '不为空', value: 'not_empty' },
  ],
  number: [
    { label: '等于', value: 'eq' },
    { label: '大于', value: 'gt' },
    { label: '小于', value: 'lt' },
    { label: '区间', value: 'between' },
    { label: '为空', value: 'empty' },
    { label: '不为空', value: 'not_empty' },
  ],
  date: [
    { label: '等于', value: 'eq' },
    { label: '早于', value: 'lt' },
    { label: '晚于', value: 'gt' },
    { label: '区间', value: 'between' },
    { label: '为空', value: 'empty' },
  ],
  select: [
    { label: '等于', value: 'eq' },
    { label: '不等于', value: 'ne' },
    { label: '为空', value: 'empty' },
  ],
  multiselect: [
    { label: '包含任一', value: 'has_any' },
    { label: '包含全部', value: 'has_all' },
    { label: '为空', value: 'empty' },
  ],
  checkbox: [
    { label: '已勾选', value: 'eq' },
    { label: '未勾选', value: 'eq' },
  ],
  url: [
    { label: '包含', value: 'contains' },
    { label: '为空', value: 'empty' },
  ],
  attachment: [
    { label: '有附件', value: 'not_empty' },
    { label: '无附件', value: 'empty' },
  ],
}

function fieldType(key: string) {
  return fields.value.find((f) => f.key === key)?.type || 'short_text'
}

function optionsOf(key: string) {
  return fields.value.find((f) => f.key === key)?.options || []
}

function operatorsFor(key: string) {
  return operatorsByType[fieldType(key)] || operatorsByType.short_text
}

function columnWidth(field: any) {
  if (field.type === 'long_text') return 220
  if (field.type === 'url') return 200
  return 130
}

function optionName(field: any, value: string) {
  return (field.options || []).find((o: any) => o.id === value)?.name || ''
}

function multiName(field: any, value: any) {
  if (!Array.isArray(value)) return ''
  return value.map((v: string) => optionName(field, v)).filter(Boolean).join('、')
}

function addSort() {
  const first = sortableFields.value[0]
  if (!first) return
  sortDraft.value.push({ field: first.key, order: 'asc' })
}

function applySorts() {
  sorts.value = sortDraft.value
    .filter((item) => item.field)
    .map((item) => ({ field: item.field, order: item.order }))
  page.value = 1
  loadRecords()
}

function clearSorts() {
  sortDraft.value = []
  sorts.value = []
  page.value = 1
  loadRecords()
}

function addFilter() {
  const first = sortableFields.value[0]
  if (!first) return
  filters.value.push({ field: first.key, op: operatorsFor(first.key)[0].value, value: '' })
}

function removeFilter(index: number) {
  filters.value.splice(index, 1)
}

function onFilterFieldChange(filter: any) {
  filter.op = operatorsFor(filter.field)[0].value
  filter.value = filter.op === 'between' ? ['', ''] : ''
}

function resetFilters() {
  filters.value = []
  page.value = 1
  loadRecords()
}

function normalizedFilters() {
  const out: any[] = []
  for (const filter of filters.value) {
    if (!filter.field || !filter.op) continue
    if (!['empty', 'not_empty'].includes(filter.op)) {
      if (filter.op === 'between') {
        if (!filter.value || (!filter.value[0] && !filter.value[1])) continue
      } else if (filter.value === '' || filter.value === null || filter.value === undefined) {
        continue
      }
    }
    out.push({ field: filter.field, op: filter.op, value: filter.value })
  }
  return out
}

async function applyFilters() {
  page.value = 1
  await loadRecords()
}

async function loadTable() {
  const { data } = await http.get(`/tables/${tableId}`)
  table.value = data
  fields.value = data.fields
}

async function loadRecords() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: page.value, page_size: pageSize.value }
    const activeFilters = normalizedFilters()
    if (activeFilters.length) params.filters = JSON.stringify(activeFilters)
    if (sorts.value.length) params.sorts = JSON.stringify(sorts.value)
    const { data } = await http.get(`/tables/${tableId}/records`, { params })
    rows.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

async function reload() {
  try {
    await loadTable()
    await loadRecords()
    window.dispatchEvent(new Event('wb:tables-changed'))
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function onPageSizeChange() {
  page.value = 1
  loadRecords()
}

function onSelectionChange(value: any[]) {
  selection.value = value
}

function openCreate() {
  editingRecord.value = null
  recordOpen.value = true
}

function openEdit(row: any) {
  editingRecord.value = row
  recordOpen.value = true
}

async function removeRecord(row: any) {
  try {
    await ElMessageBox.confirm('删除这一行？删除后会在回收站保留 30 天。', '删除行', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.delete(`/records/${row.id}`)
    await loadRecords()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function batchDelete() {
  try {
    await ElMessageBox.confirm(`删除选中的 ${selection.value.length} 行？一次最多 100 行。`, '删除行', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.post(`/tables/${tableId}/records/batch-delete`, {
      ids: selection.value.map((row) => row.id),
    })
    ElMessage.success('已移入回收站')
    await loadRecords()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function doExport() {
  exporting.value = true
  try {
    const body: Record<string, any> = { scope: exportScope.value }
    if (exportScope.value === 'filtered') {
      body.filters = normalizedFilters()
      body.sorts = sorts.value
    }
    const { data } = await http.post(`/tables/${tableId}/exports`, body)
    ElMessage.success(`已导出 ${data.rows} 行`)
    exportOpen.value = false
    window.open(data.download_url, '_blank')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  try {
    await loadTable()
    await loadRecords()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
})
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--wb-border);
  border-radius: 10px;
  background: var(--wb-surface);
  min-height: 50px;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.range-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}
.table-scroll {
  flex: 1;
  min-height: 0;
}
</style>
