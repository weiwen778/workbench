<template>
  <el-card shadow="never" class="agent-access-card">
    <div class="heading">
      <div>
        <div class="group-title">Agent 接入</div>
        <div class="text-13 secondary">为每个 Agent 创建独立令牌，让它读取任务、回写执行结果和修改表格状态。</div>
      </div>
      <div class="actions">
        <el-button @click="copyGuide">复制接入说明</el-button>
        <el-button type="primary" @click="showCreate = true">创建令牌</el-button>
      </div>
    </div>
    <div class="text-12 muted tip">权限覆盖所选模块内的全部数据。写入权限包含读取；Agent 不能删除数据或修改表格结构。</div>
    <el-alert v-if="insecureRemote" type="warning" :closable="false" show-icon class="transport-tip"
      title="当前通过 HTTP 访问。远程 Agent 的令牌和数据会明文传输，建议配置 HTTPS 或通过 SSH 隧道接入。" />
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
    <el-table v-loading="loading" :data="tokens" empty-text="还没有令牌，创建后即可让 Agent 连接">
      <el-table-column prop="name" label="Agent" min-width="140" />
      <el-table-column label="权限" min-width="240">
        <template #default="{ row }">
          <el-tag v-for="scope in row.scopes" :key="scope" size="small" class="scope-tag">{{ scopeLabels[scope] || scope }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="有效期" min-width="145"><template #default="{ row }">{{ time(row.expires_at) }}</template></el-table-column>
      <el-table-column label="最近使用" min-width="145"><template #default="{ row }">{{ time(row.last_used_at) }}</template></el-table-column>
      <el-table-column label="状态" width="85"><template #default="{ row }">{{ statusLabels[row.status] }}</template></el-table-column>
      <el-table-column width="85" label="操作">
        <template #default="{ row }"><el-button v-if="row.status === 'active'" link type="danger" @click="revoke(row)">撤销</el-button></template>
      </el-table-column>
    </el-table>
    <div class="activity-heading">
      <span class="text-13 secondary">最近成功的写入操作（最多 100 条）</span>
      <el-button text size="small" @click="load">刷新</el-button>
    </div>
    <el-table :data="activity" empty-text="暂无 Agent 写入记录" max-height="260">
      <el-table-column label="时间" min-width="150"><template #default="{ row }">{{ time(row.created_at) }}</template></el-table-column>
      <el-table-column prop="agent_name" label="Agent" min-width="120" />
      <el-table-column label="操作" min-width="160"><template #default="{ row }">{{ actionLabel(row) }}</template></el-table-column>
      <el-table-column prop="path" label="请求路径" min-width="260" />
    </el-table>
  </el-card>

  <el-dialog v-model="showCreate" title="创建 Agent 令牌" width="min(560px, 94vw)">
    <el-form label-position="top" @submit.prevent="create">
      <el-form-item label="Agent 名称"><el-input v-model="form.name" maxlength="100" placeholder="例如：运营助手、报表 Agent" /></el-form-item>
      <el-form-item label="权限">
        <el-checkbox-group v-model="form.scopes">
          <el-checkbox v-for="(label, scope) in scopeLabels" :key="scope" :value="scope">{{ label }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="有效期">
        <el-select v-model="form.expires_in_days">
          <el-option v-for="days in [7, 30, 90, 365]" :key="days" :value="days" :label="`${days} 天`" />
        </el-select>
      </el-form-item>
      <div class="text-12 muted">只勾选该 Agent 需要的权限。创建后可随时撤销；令牌明文只显示一次。</div>
    </el-form>
    <template #footer><el-button @click="showCreate = false">取消</el-button><el-button type="primary" :loading="creating" @click="create">创建</el-button></template>
  </el-dialog>

  <el-dialog v-model="showSecret" title="保存 Agent 令牌" width="min(620px, 94vw)" :close-on-click-modal="false" @closed="secret = ''">
    <el-alert type="warning" :closable="false" title="令牌仅在这里显示一次。请保存到 Agent 的环境变量或机密配置，不要提交到 Git。" />
    <el-input :model-value="secret" readonly class="secret" aria-label="新建的 Agent 令牌" />
    <div class="text-13 secondary">接口地址：{{ baseUrl }}/api/v1/agent</div>
    <div class="text-12 muted tip">将接入说明交给 Agent，再通过它的机密配置提供令牌。无需提供你的登录密码。</div>
    <template #footer><el-button @click="copyGuide">复制接入说明</el-button><el-button type="primary" @click="copySecret">复制令牌</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiError, copyText, http } from '@/api/client'

interface Token { id: number; name: string; scopes: string[]; status: string; expires_at: string; last_used_at: string | null }
interface Activity { id: number; agent_name: string; method: string; path: string; created_at: string }
const scopeLabels: Record<string, string> = { 'todos:read': '读取待办', 'todos:write': '添加和修改待办', 'tables:read': '读取表格', 'tables:write': '添加和修改表格记录' }
const statusLabels: Record<string, string> = { active: '有效', revoked: '已撤销', expired: '已过期' }
const tokens = ref<Token[]>([])
const activity = ref<Activity[]>([])
const loading = ref(false)
const creating = ref(false)
const showCreate = ref(false)
const showSecret = ref(false)
const secret = ref('')
const loadError = ref('')
const baseUrl = window.location.origin
const insecureRemote = window.location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
const form = reactive({ name: '', scopes: ['todos:read', 'tables:read'], expires_in_days: 90 })

function time(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚未使用'
}
function actionLabel(row: Activity) {
  if (row.path.endsWith('/completion')) return '设置待办完成状态'
  if (row.path.endsWith('/todo-lists')) return '创建待办清单'
  if (row.path.includes('/records')) return row.method === 'POST' ? '添加表格记录' : '修改表格记录'
  return row.method === 'POST' ? '添加待办' : '修改待办'
}
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [t, a] = await Promise.all([http.get('/agent-tokens'), http.get('/agent-activity')])
    tokens.value = t.data.items
    activity.value = a.data.items
  } catch (error) {
    loadError.value = apiError(error).message
  } finally {
    loading.value = false
  }
}
async function create() {
  if (!form.name.trim() || !form.scopes.length) { ElMessage.warning('请填写 Agent 名称并选择至少一项权限'); return }
  creating.value = true
  try {
    const { data } = await http.post('/agent-tokens', form)
    secret.value = data.token
    showCreate.value = false
    showSecret.value = true
    form.name = ''
    await load()
  } catch (error) { ElMessage.error(apiError(error).message) }
  finally { creating.value = false }
}
async function revoke(token: Token) {
  try {
    await ElMessageBox.confirm(`撤销后「${token.name}」将无法继续访问工作台。`, '撤销令牌', { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' })
    await http.delete(`/agent-tokens/${token.id}`)
    ElMessage.success('令牌已撤销')
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(apiError(error).message)
  }
}
async function copyGuide() {
  try {
    const { data } = await http.get('/agent-guide')
    const guide = data.guide.replaceAll('{{BASE_URL}}', baseUrl)
    if (await copyText(guide)) ElMessage.success('接入说明已复制，请另行通过机密配置提供令牌')
    else ElMessage.error('复制失败，请重试')
  } catch (error) { ElMessage.error(apiError(error).message) }
}
async function copySecret() {
  if (await copyText(secret.value)) ElMessage.success('令牌已复制')
  else ElMessage.error('复制失败，请手动选中令牌复制')
}
onMounted(load)
</script>

<style scoped>
.agent-access-card { flex: 0 0 auto; margin-bottom: 10px; }
.heading, .actions, .activity-heading { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.heading, .activity-heading { justify-content: space-between; }
.tip { margin: 10px 0; }
.transport-tip { margin-bottom: 12px; }
.scope-tag { margin: 2px 4px 2px 0; }
.activity-heading { margin-top: 18px; }
.secret { margin: 16px 0; }
.el-checkbox-group { display: flex; flex-wrap: wrap; gap: 4px 16px; }
</style>
