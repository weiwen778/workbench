<template>
  <div class="page">
    <div class="page-toolbar dashboard-toolbar">
      <el-button v-if="current" text @click="router.push('/visualizations')">全部看板</el-button>
      <div class="spacer" />
      <div class="toolbar-actions">
        <el-button v-if="current" :icon="Refresh" :loading="refreshing" @click="fetchData">刷新数据</el-button>
        <el-button v-if="current" @click="renameBoard">重命名</el-button>
        <el-button @click="createBoard">新建看板</el-button>
        <el-button v-if="current" type="primary" :icon="Plus" :disabled="saving || current.widgets.length >= 24" @click="openEditor()">添加图表</el-button>
      </div>
    </div>
    <div v-loading="loading" class="page-body dashboard-body">
      <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError">
        <el-button text @click="load">重新加载</el-button>
      </el-alert>
      <template v-if="!route.params.dashboardId">
        <div class="visualization-intro">
          <div class="empty-title">每家店铺，都有自己的数据看板</div>
          <p class="text-13 secondary">从左侧子项进入各店铺。每个看板独立保存图表、数据来源和布局。</p>
          <el-alert v-if="linkedTableId" type="info" :closable="false" title="请选择一个看板来添加当前表格的图表，也可以新建看板。" />
        </div>
        <div v-if="boards.length" class="board-index-grid">
          <button v-for="board in boards" :key="board.id" class="board-index-card" @click="openBoard(board.id)">
            <el-icon :size="22"><DashboardIcon /></el-icon>
            <strong>{{ board.name }}</strong>
            <span class="text-12 secondary">{{ board.widgets.length }} 张图表</span>
            <span class="text-12 muted">更新于 {{ new Date(board.updated_at).toLocaleDateString('zh-CN') }}</span>
          </button>
        </div>
        <div v-else-if="!loading" class="dashboard-empty"><el-icon :size="42"><DashboardIcon /></el-icon><div class="empty-title">创建第一个店铺看板</div><p>例如：天猫旗舰店、抖音店铺、京东店铺。</p><el-button type="primary" :icon="Plus" @click="createBoard">创建看板</el-button></div>
      </template>
      <template v-else-if="current">
        <div class="dashboard-filter">
          <div class="filter-controls">
            <span class="text-13 secondary">统计时间</span>
            <el-select v-model="period" aria-label="统计时间" style="width: 130px" @change="changePeriod">
              <el-option label="全部时间" value="all" /><el-option label="最近 7 天" value="last7" />
              <el-option label="最近 30 天" value="last30" /><el-option label="本月" value="month" /><el-option label="自定义" value="custom" />
            </el-select>
            <el-date-picker v-if="period === 'custom'" v-model="customDates" type="daterange" value-format="YYYY-MM-DD"
              start-placeholder="开始日期" end-placeholder="结束日期" class="date-range" @change="changeCustomDates" />
          </div>
          <span class="text-12 muted">{{ lastRefresh ? `更新于 ${displayTime(lastRefresh)} · ` : '' }}每 60 秒自动刷新</span>
        </div>
        <div class="dashboard-note text-12 secondary">汇总原表全部有效记录，不继承表格页的临时筛选。原表或 Agent 更新后，刷新即可看到最新结果；时间筛选仅作用于已配置日期列的图表。</div>

        <div v-if="!current.widgets.length" class="dashboard-empty">
          <el-icon :size="42"><DashboardIcon /></el-icon>
          <div class="empty-title">把表格里的数据，变成每天关注的经营指标</div>
          <p>例如：销售额合计、各店铺销售对比、每日订单趋势、商品状态占比。</p>
          <el-button type="primary" :icon="Plus" @click="openEditor()">关联表格，添加第一张图表</el-button>
          <el-button v-if="!tables.length" text @click="router.push('/data')">先去创建或导入表格</el-button>
        </div>
        <div v-else class="dashboard-grid" :aria-busy="refreshing" :style="{ '--metric-span': metricSpan }">
          <section v-for="(widget, index) in current.widgets" :key="widget.id" class="widget-card"
            :class="{ 'metric-card': widget.kind === 'metric', 'only-metric': widget.kind === 'metric' && metricCount === 1, 'wide-card': widget.wide }" :aria-label="widget.title">
            <div class="widget-heading">
              <div class="widget-title" :title="widget.title">{{ widget.title }}</div>
              <el-dropdown trigger="click" @command="(command: string) => widgetCommand(command, widget, index)">
                <el-button text :icon="MoreFilled" :aria-label="`${widget.title}的操作`" :disabled="saving" />
                <template #dropdown><el-dropdown-menu>
                  <el-dropdown-item command="edit">编辑图表</el-dropdown-item>
                  <el-dropdown-item command="up" :disabled="index === 0">上移</el-dropdown-item>
                  <el-dropdown-item command="down" :disabled="index === current.widgets.length - 1">下移</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>移除图表</el-dropdown-item>
                </el-dropdown-menu></template>
              </el-dropdown>
            </div>
            <div class="widget-source text-12 muted">
              <router-link :to="`/data/${widget.table_id}`">{{ resultFor(widget).table_name || tableName(widget.table_id) }}</router-link>
              <span> · {{ aggregationLabels[widget.aggregation] }}{{ widget.unit ? `（${widget.unit}）` : '' }}</span>
            </div>
            <DashboardChart v-if="results[widget.id]" :widget="widget" :result="results[widget.id]" />
            <div v-else class="widget-placeholder">{{ refreshing ? '正在汇总…' : '等待刷新数据' }}</div>
            <div v-if="results[widget.id]?.status === 'ok'" class="widget-foot text-12 muted">
              <span v-if="widget.kind !== 'metric'">{{ results[widget.id].matched_rows }} 条记录</span>
              <span v-if="results[widget.id].ignored_rows">{{ results[widget.id].ignored_rows }} 条空值或无效数值未参与计算</span>
              <span v-if="(results[widget.id].groups_total || 0) > widget.limit">{{ widget.kind === 'pie' ? `前 ${widget.limit} 组，其余合并为其他` : widget.kind === 'line' && groupIsDate(widget) ? `显示最近 ${widget.limit} 组` : `显示前 ${widget.limit} / ${results[widget.id].groups_total} 组` }}</span>
              <span v-if="results[widget.id].date_filter_unavailable" class="date-warning">未设日期列，展示全部时间</span>
            </div>
          </section>
        </div>
        <div class="board-bottom text-12 muted"><span>图表配置保存到账号，可在不同设备继续使用；移除图表不会修改原表数据。</span><el-button text type="danger" size="small" @click="removeBoard">删除此看板</el-button></div>
      </template>
      <div v-else-if="!loading" class="dashboard-empty"><div class="empty-title">看板不存在或已删除</div><el-button @click="router.push('/visualizations')">返回全部看板</el-button></div>
    </div>

    <el-dialog v-model="editorOpen" :title="editingId ? '编辑图表' : '添加图表'" width="min(800px, 95vw)" :close-on-click-modal="false" @closed="editorClosed">
      <el-form label-position="top" class="widget-form">
        <div class="chart-guide">例如：想看每天的销售额、成本和利润，就选折线图，横轴选“日期”，对比数字勾选这三列，计算方式选“加起来”。三条线使用同一套纵轴刻度。</div>
        <el-form-item label="图表标题"><el-input v-model="form.title" maxlength="100" placeholder="例如：本月销售额、各店铺销售对比" /></el-form-item>
        <el-form-item label="展示方式">
          <el-radio-group v-model="form.kind" @change="kindChanged">
            <el-radio-button v-for="(label, kind) in chartLabels" :key="kind" :value="kind">{{ label }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="来源表格" required>
          <el-select v-model="form.table_id" filterable placeholder="选择要关联的表格" aria-label="来源表格" @change="chooseTable">
            <el-option v-for="table in tables" :key="table.id" :label="table.name+(table.kind==='virtual'?' · 虚拟表':'')" :value="table.id" />
          </el-select>
          <div v-if="!tables.length" class="text-12 muted">还没有表格，<el-link type="primary" @click="editorOpen = false; router.push('/data')">先去创建或导入</el-link>。</div>
        </el-form-item>
        <el-alert v-if="fieldError" :title="fieldError" type="error" :closable="false" />
        <div v-loading="fieldsLoading" class="form-grid">
          <el-form-item label="同一天或同一类的数据怎么算？">
            <el-select v-model="form.aggregation" aria-label="同一天或同一类的数据怎么算？" @change="aggregationChanged">
              <el-option v-for="(label, value) in aggregationLabels" :key="value" :label="label" :value="value" :disabled="form.kind === 'pie' && !['count', 'sum'].includes(value)" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.aggregation !== 'count'" :label="['bar','line'].includes(form.kind) ? '纵轴：要对比哪些数字？（可多选）' : '要看哪个数字？'" required>
            <el-select v-if="['bar','line'].includes(form.kind)" v-model="form.value_fields" multiple :multiple-limit="8" placeholder="例如：销售额、成本、利润" aria-label="对比指标" @change="form.value_field = form.value_fields?.[0] || null"><el-option v-for="field in numericFields" :key="field.key" :label="field.name" :value="field.key" /></el-select>
            <el-select v-else v-model="form.value_field" placeholder="选择数字列" aria-label="统计列"><el-option v-for="field in numericFields" :key="field.key" :label="field.name" :value="field.key" /></el-select>
            <div class="text-12 secondary">最多对比 8 列，使用同一个纵轴；请选择单位一致的数字，如都是“元”。</div>
            <div v-if="!numericFields.length && form.table_id" class="text-12 muted">这张表没有数字列，可选择“数一数有多少条记录”。</div>
          </el-form-item>
          <el-form-item v-if="form.kind !== 'metric'" :label="form.kind === 'pie' ? '按什么分类看占比？' : '横轴：按什么对比？'" required>
            <el-select v-model="form.group_field" placeholder="例如：店铺、状态、日期" aria-label="横轴" @change="groupChanged">
              <el-option v-for="field in dimensionFields" :key="field.key" :label="field.name" :value="field.key" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="selectedGroup?.type === 'date' && form.kind !== 'metric'" label="日期按天、周还是月显示？">
            <el-select v-model="form.date_bucket" aria-label="日期按天、周还是月显示？"><el-option label="按天" value="day" /><el-option label="按周（周一开始）" value="week" /><el-option label="按月" value="month" /></el-select>
          </el-form-item>
          <el-form-item label="顶部的日期筛选用哪一列？">
            <el-select v-model="form.date_field" clearable placeholder="不参与页面时间筛选" aria-label="时间筛选列" @clear="form.date_field = null">
              <el-option v-for="field in dateFields" :key="field.key" :label="field.name" :value="field.key" />
            </el-select>
          </el-form-item>
          <el-form-item label="数值单位"><el-input v-model="form.unit" maxlength="12" placeholder="例如：元、单、件（不自动换算）" /></el-form-item>
          <el-form-item label="最多保留小数位"><el-input-number v-model="form.decimals" :min="0" :max="6" /></el-form-item>
          <el-form-item v-if="form.kind !== 'metric'" label="最多显示多少个横轴项目？"><el-input-number v-model="form.limit" :min="1" :max="30" /></el-form-item>
          <el-form-item v-if="form.kind !== 'metric' && !(form.kind === 'line' && selectedGroup?.type === 'date')" label="横轴项目怎么排列？">
            <el-select v-model="form.sort"><el-option label="按第一个指标，从大到小" value="value_desc" /><el-option label="按名称或日期顺序" value="label_asc" /></el-select>
          </el-form-item>
        </div>
        <div class="form-options"><el-checkbox v-model="form.wide">图表占满一行</el-checkbox><span class="text-12 muted">日期折线按时间先后显示；多条线或多组柱子用不同颜色区分。</span></div>
        <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
        <div v-if="previewResult" class="preview-box"><div class="text-12 muted">数据预览 · 使用当前页面的时间范围</div><DashboardChart :widget="form" :result="previewResult" /></div>
      </el-form>
      <template #footer><div class="editor-footer">
        <el-button :loading="previewing" :disabled="!form.table_id || fieldsLoading" @click="preview">预览数据</el-button>
        <div class="spacer" /><el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!form.table_id || fieldsLoading || !!fieldError" @click="saveWidget">保存图表</el-button>
      </div></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DashboardIcon, MoreFilled, Plus, Refresh } from '@/icons'
import { apiError, http } from '@/api/client'
import DashboardChart from '@/components/DashboardChart.vue'
import { aggregationLabels, chartLabels, type DashboardBoard, type DashboardWidget, type DashboardResult } from '@/dashboard'

interface TableInfo { id: number; name: string; kind?: string }
interface FieldInfo { key: string; name: string; type: string }
const router = useRouter()
const route = useRoute()
let linkedTableId = Number(route.query.table) || 0
const boards = ref<DashboardBoard[]>([])
const tables = ref<TableInfo[]>([])
const activeId = computed(() => Number(route.params.dashboardId) || null)
const current = computed(() => boards.value.find(b => b.id === activeId.value))
const metricCount = computed(() => current.value?.widgets.filter(w => w.kind === 'metric').length || 0)
const metricSpan = computed(() => 12 / Math.min(4, Math.max(1, metricCount.value)))
const results = ref<Record<string, DashboardResult>>({})
const loading = ref(false), refreshing = ref(false), saving = ref(false)
const loadError = ref(''), lastRefresh = ref('')
const period = ref('all')
const customDates = ref<string[] | null>(null)
let requestId = 0, lastRequestedAt = 0
let timer: ReturnType<typeof setInterval> | undefined
const editorOpen = ref(false), editingId = ref(''), fieldsLoading = ref(false)
const fields = ref<FieldInfo[]>([]), fieldError = ref(''), previewError = ref('')
const previewResult = ref<DashboardResult | null>(null), previewing = ref(false)
let fieldRequestId = 0, previewRequestId = 0
function emptyWidget(): DashboardWidget {
  return { id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, title: '', kind: 'metric', table_id: 0,
    aggregation: 'count', value_field: null, value_fields: [], group_field: null, date_field: null, date_bucket: 'day', sort: 'value_desc', limit: 10, decimals: 0, unit: '', wide: false }
}
const form = reactive<DashboardWidget>(emptyWidget())
const numericFields = computed(() => fields.value.filter(f => ['number','formula','rollup'].includes(f.type)))
const dimensionFields = computed(() => fields.value.filter(f => ['short_text', 'select', 'checkbox', 'date'].includes(f.type)))
const dateFields = computed(() => fields.value.filter(f => f.type === 'date'))
const selectedGroup = computed(() => fields.value.find(f => f.key === form.group_field))
const tableName = (id: number) => tables.value.find(t => t.id === id)?.name || '来源表格'
const resultFor = (w: DashboardWidget) => results.value[w.id] || { id: w.id, status: 'ok' }
const groupIsDate = (w: DashboardWidget) => results.value[w.id]?.group_type === 'date'
const displayTime = (s: string) => new Date(s).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function daysAgo(n: number) { const d = new Date(today() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
function dateParams(): Record<string, string> {
  if (period.value === 'custom' && customDates.value?.length === 2) return { start_date: customDates.value[0], end_date: customDates.value[1] }
  if (period.value === 'month') return { start_date: today().slice(0, 7) + '-01', end_date: today() }
  if (period.value === 'last7' || period.value === 'last30') return { start_date: daysAgo(period.value === 'last7' ? 6 : 29), end_date: today() }
  return {}
}
function changePeriod() {
  if (period.value === 'custom' && !customDates.value) customDates.value = [daysAgo(29), today()]
  fetchData()
}
function changeCustomDates() { if (!customDates.value) period.value = 'all'; fetchData() }
function openBoard(id: number) { router.push({ path: `/visualizations/${id}`, query: linkedTableId ? { table: linkedTableId } : {} }) }
function notifyBoardsChanged() { window.dispatchEvent(new Event('wb:dashboards-changed')) }
async function load() {
  loading.value = true
  try {
    const [b, t] = await Promise.all([http.get('/dashboards'), http.get('/tables')])
    boards.value = b.data; tables.value = t.data
    results.value = {}; lastRefresh.value = ''; loadError.value = ''
    await fetchData()
    if (current.value && linkedTableId) await openEditor()
  } catch (error) { loadError.value = apiError(error).message }
  finally { loading.value = false }
}
async function fetchData() {
  const board = current.value
  if (!board) return
  const sequence = ++requestId
  refreshing.value = true; lastRequestedAt = Date.now()
  try {
    const { data } = await http.get(`/dashboards/${board.id}/data`, { params: dateParams() })
    if (sequence !== requestId || board.id !== current.value?.id) return
    if (data.version !== current.value.version) { loadError.value = '看板配置已在其他位置修改，请重新加载；当前仍显示上次数据。'; return }
    results.value = Object.fromEntries(data.widgets.map((r: DashboardResult) => [r.id, r]))
    lastRefresh.value = data.generated_at; loadError.value = ''
  } catch (error) {
    if (sequence === requestId) loadError.value = `刷新失败：${apiError(error).message}${lastRefresh.value ? '；当前保留上次成功刷新的数据。' : ''}`
  } finally { if (sequence === requestId) refreshing.value = false }
}
async function createBoard() {
  try {
    const { value } = await ElMessageBox.prompt('可以按店铺、业务或用途分别建立看板。', '新建看板', { inputPlaceholder: '例如：天猫旗舰店、抖音店铺', inputValidator: v => !!v?.trim() && v.trim().length <= 80 || '请输入 1–80 个字', confirmButtonText: '创建', cancelButtonText: '取消' })
    const { data } = await http.post('/dashboards', { name: value.trim() })
    notifyBoardsChanged(); openBoard(data.id)
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}
async function saveBoard(widgets: DashboardWidget[], name = current.value?.name) {
  const board = current.value
  if (!board || saving.value) return false
  saving.value = true
  try {
    const { data } = await http.put(`/dashboards/${board.id}`, { name, widgets, version: board.version })
    boards.value = boards.value.map(b => b.id === data.id ? data : b)
    notifyBoardsChanged()
    await fetchData()
    return true
  } catch (error) { ElMessage.error(apiError(error).message); return false }
  finally { saving.value = false }
}
async function renameBoard() {
  if (!current.value) return
  try {
    const { value } = await ElMessageBox.prompt('看板名称', '重命名', { inputValue: current.value.name, inputValidator: v => !!v?.trim() && v.trim().length <= 80 || '请输入 1–80 个字', confirmButtonText: '保存', cancelButtonText: '取消' })
    await saveBoard(current.value.widgets, value.trim())
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}
async function removeBoard() {
  const board = current.value
  if (!board) return
  try {
    await ElMessageBox.confirm(`删除“${board.name}”及其图表配置？来源表格和数据会保留。`, '删除看板', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await http.delete(`/dashboards/${board.id}`, { params: { version: board.version } })
    ++requestId; notifyBoardsChanged(); router.push('/visualizations')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
}
async function openEditor(widget?: DashboardWidget) {
  editingId.value = widget?.id || ''
  Object.assign(form, emptyWidget(), widget ? JSON.parse(JSON.stringify(widget)) : {})
  if (!form.value_fields?.length && form.value_field) form.value_fields = [form.value_field]
  fields.value = []; fieldError.value = ''; previewError.value = ''; previewResult.value = null
  editorOpen.value = true
  if (form.table_id) await loadFields(form.table_id)
  else if (linkedTableId) { form.table_id = linkedTableId; linkedTableId = 0; await chooseTable(form.table_id) }
}
function editorClosed() { if (route.query.table) router.replace(`/visualizations/${activeId.value}`) }
async function loadFields(id: number) {
  const sequence = ++fieldRequestId
  fieldsLoading.value = true; fieldError.value = ''
  try {
    const { data } = await http.get(`/tables/${id}`)
    if (sequence !== fieldRequestId || id !== form.table_id) return
    fields.value = data.fields
  } catch (error) { if (sequence === fieldRequestId) fieldError.value = apiError(error).message }
  finally { if (sequence === fieldRequestId) fieldsLoading.value = false }
}
async function chooseTable(id: number) {
  fields.value = []
  form.value_fields = []; form.value_field = null; form.group_field = null; form.date_field = null
  await loadFields(id)
  if (form.table_id !== id || fieldError.value) return
  form.value_field = numericFields.value[0]?.key || null
  form.value_fields = form.value_field ? [form.value_field] : []
  if (['bar','line'].includes(form.kind) && form.aggregation === 'count' && numericFields.value.length) form.aggregation = 'sum'
  form.group_field = dimensionFields.value[0]?.key || null
  form.date_field = dateFields.value[0]?.key || null
}
function kindChanged() {
  if (['bar','line'].includes(form.kind) && form.aggregation === 'count' && numericFields.value.length) form.aggregation = 'sum'
  if (!['bar','line'].includes(form.kind)) form.value_fields = []
  else if (!form.value_fields?.length && form.value_field) form.value_fields = [form.value_field]
  if (form.kind === 'pie' && !['count', 'sum'].includes(form.aggregation)) form.aggregation = 'count'
  groupChanged()
}
function aggregationChanged() { if (form.aggregation === 'count') form.decimals = 0; else if (!form.value_field) form.value_field = numericFields.value[0]?.key || null }
function groupChanged() {
  if (form.kind === 'line' && selectedGroup.value?.type === 'date') { form.sort = 'label_asc'; if (!form.date_field) form.date_field = form.group_field }
}
function draft(): DashboardWidget {
  return { ...form, title: form.title.trim() || `${fields.value.find(f => f.key === form.value_field)?.name || tableName(form.table_id)} · ${aggregationLabels[form.aggregation]}`,
    value_fields: ['bar','line'].includes(form.kind) && form.aggregation !== 'count' ? form.value_fields || [] : [],
    date_field: form.date_field || null, value_field: ['bar','line'].includes(form.kind) && form.aggregation !== 'count' ? form.value_fields?.[0] || null : form.value_field || null, group_field: form.group_field || null }
}
async function preview() {
  const sequence = ++previewRequestId
  previewing.value = true; previewError.value = ''; previewResult.value = null
  try {
    const { data } = await http.post('/dashboards/preview', { widget: draft(), ...dateParams() })
    if (sequence === previewRequestId) previewResult.value = data
  } catch (error) { if (sequence === previewRequestId) previewError.value = apiError(error).message }
  finally { if (sequence === previewRequestId) previewing.value = false }
}
watch(form, () => { ++previewRequestId; previewResult.value = null; previewError.value = ''; previewing.value = false }, { deep: true })
async function saveWidget() {
  const board = current.value
  if (!board) return
  const widget = draft()
  const widgets = editingId.value ? board.widgets.map(w => w.id === editingId.value ? widget : w) : [...board.widgets, widget]
  if (await saveBoard(widgets)) { editorOpen.value = false; ElMessage.success('图表已保存') }
}
async function widgetCommand(command: string, widget: DashboardWidget, index: number) {
  if (command === 'edit') { openEditor(widget); return }
  const board = current.value
  if (!board) return
  if (command === 'delete') {
    try {
      await ElMessageBox.confirm(`移除“${widget.title}”？来源数据会保留。`, '移除图表', { confirmButtonText: '移除', cancelButtonText: '取消' })
      await saveBoard(board.widgets.filter(w => w.id !== widget.id))
    } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message) }
  } else {
    const target = command === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= board.widgets.length) return
    const widgets = [...board.widgets]; [widgets[index], widgets[target]] = [widgets[target], widgets[index]]
    await saveBoard(widgets)
  }
}
function refreshIfVisible() { if (!document.hidden && !refreshing.value && !saving.value && Date.now() - lastRequestedAt > 5000) fetchData() }
onMounted(() => { load(); timer = setInterval(refreshIfVisible, 60000); window.addEventListener('focus', refreshIfVisible); document.addEventListener('visibilitychange', refreshIfVisible) })
onBeforeUnmount(() => { ++requestId; ++previewRequestId; ++fieldRequestId; clearInterval(timer); window.removeEventListener('focus', refreshIfVisible); document.removeEventListener('visibilitychange', refreshIfVisible) })
</script>

<style scoped>
.dashboard-toolbar { flex-wrap: wrap; }

.visualization-intro p { margin: 10px 0 18px; line-height: 1.8; }
.board-index-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.board-index-card { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 22px; border: 1px solid var(--wb-border); border-radius: 6px; background: var(--wb-surface); color: var(--wb-text); font: inherit; cursor: pointer; text-align: left; }
.board-index-card:hover { background: var(--wb-surface-subtle); }
.board-index-card:focus-visible { outline: 2px solid var(--wb-primary); outline-offset: 2px; }
.board-index-card strong { font-size: 15px; overflow-wrap: anywhere; }
.board-index-card .el-icon { color: var(--wb-text-secondary); }

.dashboard-body { gap: 16px; }
.dashboard-filter, .filter-controls, .board-bottom { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.dashboard-filter, .board-bottom { justify-content: space-between; }
.date-range { max-width: 300px; }
.dashboard-note { line-height: 1.7; }
.dashboard-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; align-items: start; }
.widget-card { grid-column: span 6; min-width: 0; border: 1px solid var(--wb-border); border-radius: 6px; background: var(--wb-surface); padding: 18px 20px; }
.metric-card { grid-column: span var(--metric-span, 3); }
.wide-card { grid-column: span 12; }
.widget-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.widget-title { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.widget-source { margin: 1px 0 8px; line-height: 1.7; }
.widget-source a { color: var(--wb-text-secondary); text-decoration: none; }
.widget-source a:hover { color: var(--wb-primary); text-decoration: underline; }
.widget-placeholder { padding: 30px 0; color: var(--wb-text-tertiary); font-size: 13px; }
.widget-foot { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 10px; line-height: 1.6; }
.date-warning { color: var(--el-color-warning); }
.dashboard-empty { display: flex; align-items: center; flex-direction: column; justify-content: center; gap: 14px; padding: 64px 20px; border: 1px dashed var(--wb-border); border-radius: 6px; text-align: center; color: var(--wb-text-secondary); background: var(--wb-surface); }
.dashboard-empty .el-icon { color: var(--wb-primary); }
.dashboard-empty p { font-size: 13px; margin: 0; line-height: 1.8; }
.empty-title { font-size: 18px; color: var(--wb-text); }
.board-bottom { margin-top: 10px; }
.chart-guide { padding: 12px; margin-bottom: 16px; border-radius: 6px; background: var(--wb-surface-subtle); color: var(--wb-text-secondary); font-size: 13px; line-height: 1.7; }
.widget-form :deep(.el-select) { width: 100%; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }
.form-options { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.preview-box { padding: 16px; border: 1px solid var(--wb-border); border-radius: 10px; margin-top: 16px; }
.editor-footer { display: flex; align-items: center; gap: 8px; }
@media (max-width: 1150px) { .metric-card { grid-column: span 6; } .wide-card { grid-column: span 12; } }
.metric-card.only-metric { grid-column: span 12; }
@media (max-width: 700px) {
  .widget-card, .metric-card { grid-column: span 12; padding: 15px; }
  .form-grid { grid-template-columns: 1fr; }
  .dashboard-toolbar .toolbar-actions { width: 100%; flex-wrap: wrap; }
  .dashboard-toolbar .el-button { margin-left: 0; }
  .filter-controls { width: 100%; }
  .empty-title { font-size: 16px; }
}
</style>
