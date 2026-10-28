<template>
  <div class="page">
    <!-- 顶部操作条 -->
    <div class="page-toolbar">
      <el-select v-model="provider" style="width: 150px">
        <el-option
          v-for="conn in connections"
          :key="conn.provider"
          :label="conn.name"
          :value="conn.provider"
        >
          <span>{{ conn.name }}</span>
          <span class="text-12 muted" style="margin-left: 6px">
            {{ conn.enabled ? (conn.configured ? '' : '未配置') : '已停用' }}
          </span>
        </el-option>
      </el-select>

      <el-select v-model="sourceLang" style="width: 120px">
        <el-option label="自动检测" value="auto" />
        <el-option label="中文" value="zh" />
        <el-option label="英语" value="en" />
      </el-select>

      <el-button text :icon="Switch" circle title="交换语言" @click="swapLanguages" />

      <el-select v-model="targetLang" style="width: 110px">
        <el-option label="英语" value="en" />
        <el-option label="中文" value="zh" />
      </el-select>

      <el-button type="primary" :icon="Promotion" :loading="translating" @click="translate">
        翻译
      </el-button>

      <el-switch v-model="autoTranslate" active-text="自动翻译" aria-label="自动翻译" />
      <span class="text-12 muted" role="status">{{ translationHint }}</span>

      <span class="text-12" :class="{ danger: overLimit }">
        {{ counterText }}
      </span>

      <div class="spacer" />

      <div class="toolbar-actions">
        <el-button text :icon="Setting" @click="settingsOpen = true">服务设置</el-button>
      </div>
    </div>

    <!-- 中间工作区 -->
    <div class="translate-workbench">
      <div class="translate-pane">
        <div class="pane-head">
          <span>原文</span>
          <div class="spacer" />
          <span class="text-12 muted">{{ sourceText.length }} 字</span>
        </div>
        <div class="pane-body">
          <el-input
            v-model="sourceText"
            type="textarea"
            resize="none"
            :placeholder="autoTranslate ? '输入或粘贴内容，停止输入后自动翻译' : '输入需要翻译的内容，Ctrl / Command + Enter 开始翻译'"
            @compositionstart="composing = true"
            @compositionend="composing = false"
            @keydown.ctrl.enter.prevent="translate"
            @keydown.meta.enter.prevent="translate"
          />
        </div>
        <div class="pane-foot">
          <el-button text size="small" :icon="DocumentCopy" @click="pasteSource">粘贴</el-button>
          <el-button text size="small" :icon="Delete" @click="clearSource">清空原文</el-button>
        </div>
      </div>

      <div class="translate-pane">
        <div class="pane-head">
          <span>译文</span>
          <div class="spacer" />
          <span v-if="result" class="text-12 muted">
            {{ result.provider_name }} · {{ result.duration_ms }} ms
          </span>
        </div>
        <div class="pane-body result-body">
          <div v-if="result" class="result-text">{{ result.target_text }}</div>
          <div v-else class="text-13 muted">译文只读，可复制到其他地方修改</div>
        </div>
        <div class="pane-foot">
          <el-button text size="small" :icon="CopyDocument" :disabled="!result" @click="copyResult">复制译文</el-button>
          <el-button text size="small" :icon="Delete" :disabled="!result" @click="clearResult">清空译文</el-button>
        </div>
      </div>
    </div>

    <!-- 历史 -->
    <div class="history-block translate-history">
      <div class="history-head">
        <span class="group-title" style="padding: 0">翻译历史</span>
        <el-input
          v-model="historyQuery"
          size="small"
          placeholder="搜索原文或译文"
          clearable
          style="width: 200px"
          :prefix-icon="Search"
          @input="onHistorySearch"
        />
        <el-select v-model="historyProvider" size="small" style="width: 130px" clearable placeholder="全部服务" @change="loadHistory(1)">
          <el-option v-for="conn in connections" :key="conn.provider" :label="conn.name" :value="conn.provider" />
        </el-select>
        <el-button text size="small" :icon="Refresh" @click="loadHistory(page)">刷新</el-button>
        <div class="spacer" />
        <span class="text-12 muted">共 {{ historyTotal }} 条</span>
      </div>

      <div class="history-list">
        <div v-for="item in history" :key="item.id" class="history-row">
          <div class="history-text">
            <div class="ellipsis-1">{{ item.source_text }}</div>
            <div class="ellipsis-1 muted">{{ item.target_text }}</div>
            <div class="text-12 muted" style="margin-top: 2px">
              {{ langText(item.source_lang) }} → {{ langText(item.target_lang) }} ·
              {{ item.provider_name }}{{ item.model ? ' · ' + item.model : '' }} · {{ formatTime(item.created_at) }}
            </div>
          </div>
          <div class="actions-group">
            <el-button text size="small" @click="openDetail(item)">详情</el-button>
            <el-button text size="small" :icon="CopyDocument" @click="copyHistory(item)">复制</el-button>
          </div>
        </div>
        <div v-if="!history.length" class="empty-hint" style="padding: 24px">
          {{ historyQuery ? '没有匹配的历史记录' : '还没有翻译记录' }}
        </div>
      </div>

      <el-pagination
        v-if="historyTotal > pageSize"
        v-model:current-page="page"
        :page-size="pageSize"
        :total="historyTotal"
        layout="prev, pager, next"
        @current-change="loadHistory"
      />
    </div>

    <!-- 历史详情 -->
    <el-dialog v-model="detailOpen" title="翻译详情" width="720px">
      <div v-if="detail">
        <div class="detail-label">原文（{{ langText(detail.source_lang) }}）</div>
        <div class="detail-box">{{ detail.source_text }}</div>
        <div class="detail-label" style="margin-top: 10px">译文（{{ langText(detail.target_lang) }}）</div>
        <div class="detail-box">{{ detail.target_text }}</div>
        <div class="text-12 muted" style="margin-top: 8px">
          {{ detail.provider_name }}{{ detail.model ? ' · ' + detail.model : '' }} · {{ formatTime(detail.created_at) }}
        </div>
      </div>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="copyDetail('source')">复制原文</el-button>
          <el-button type="primary" @click="copyDetail('target')">复制译文</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 服务设置 -->
    <el-drawer v-model="settingsOpen" title="翻译服务设置" size="560px">
      <el-alert
        v-if="!credentialKeyReady"
        type="warning"
        :closable="false"
        show-icon
        title="系统还没配置加密主密钥（WB_ENCRYPTION_KEY）"
        style="margin-bottom: 12px"
      >
        需要在服务器的 .env 里设置 WB_ENCRYPTION_KEY，重启后就能保存和使用翻译密钥。
      </el-alert>

      <div v-for="conn in connections" :key="conn.provider" class="conn-block">
        <div class="conn-head">
          <b>{{ conn.name }}</b>
          <el-tag v-if="conn.enabled" size="small" type="success" effect="plain">已启用</el-tag>
          <el-tag v-else size="small" type="info" effect="plain">已停用</el-tag>
          <span v-if="conn.last_test_message" class="text-12" :class="conn.last_test_ok ? 'ok' : 'danger'">
            {{ conn.last_test_message }}
          </span>
          <div class="spacer" />
          <el-switch
            :model-value="conn.enabled"
            :disabled="!conn.configured"
            @change="(value: boolean) => toggleProvider(conn, value)"
          />
        </div>

        <div class="conn-fields">
          <el-input
            v-for="field in fieldsOf(conn.provider)"
            :key="field.key"
            v-model="configDraft[conn.provider][field.key]"
            :placeholder="`${field.label}${conn.masked[field.key] ? '（已保存：' + conn.masked[field.key] + '）' : ''}`"
            show-password
            type="password"
            style="margin-bottom: 6px"
          />
          <el-input
            v-if="conn.provider === 'deepseek'"
            v-model="modelDraft[conn.provider]"
            placeholder="模型名，例如 deepseek-chat"
            style="margin-bottom: 6px"
          />
          <div class="toolbar-actions">
            <el-button size="small" type="primary" :disabled="!credentialKeyReady" :loading="savingProvider === conn.provider" @click="saveProvider(conn)">
              保存
            </el-button>
            <el-button size="small" :disabled="!conn.configured || !credentialKeyReady" @click="testProvider(conn)">连接测试</el-button>
            <el-button size="small" :disabled="!conn.configured || !credentialKeyReady" @click="clearProvider(conn)">清除密钥</el-button>
          </div>
          <div class="text-12 muted" style="margin-top: 4px">
            {{ providerHint(conn) }}
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CopyDocument,
  Delete,
  DocumentCopy,
  Promotion,
  Refresh,
  Search,
  Setting,
  Switch,
} from '@element-plus/icons-vue'
import { apiError, copyText, http } from '@/api/client'

const connections = ref<any[]>([])
const credentialKeyReady = ref(true)
const provider = ref('baidu')
const sourceLang = ref('auto')
const targetLang = ref('en')
const sourceText = ref('')
const result = ref<any>(null)
const translating = ref(false)
const composing = ref(false)
const autoTranslate = ref(readAutoPreference())
const autoPending = ref(false)
const settingsOpen = ref(false)
const configDraft = reactive<Record<string, Record<string, string>>>({ baidu: {}, youdao: {}, deepseek: {} })
const modelDraft = reactive<Record<string, string>>({})
const savingProvider = ref('')
const savingConfig = ref(false)

const history = ref<any[]>([])
const historyTotal = ref(0)
const historyQuery = ref('')
const historyProvider = ref('')
const page = ref(1)
const pageSize = ref(20)
const detailOpen = ref(false)
const detail = ref<any>(null)

let requestSeq = 0
let translationTimer: number | null = null
let translationController: AbortController | null = null
let lastSuccessKey = ''

function readAutoPreference() {
  try { return localStorage.getItem('wb_auto_translate') !== 'false' } catch { return true }
}
let historyTimer: number | null = null

const currentConn = computed(() => connections.value.find((c) => c.provider === provider.value))
const limitInfo = computed(() => currentConn.value?.limits || { unit: 'char', value: 4000 })
const used = computed(() =>
  limitInfo.value.unit === 'byte' ? new TextEncoder().encode(sourceText.value).length : sourceText.value.length,
)
const overLimit = computed(() => used.value > limitInfo.value.value)
const counterText = computed(() => {
  const unit = limitInfo.value.unit === 'byte' ? '字节' : '字符'
  return `${used.value} / ${limitInfo.value.value} ${unit}`
})

const translationHint = computed(() => {
  if (translating.value) return '正在翻译…'
  if (!autoTranslate.value) return ''
  if (!currentConn.value?.configured || !currentConn.value?.enabled || !credentialKeyReady.value) return '请先配置并启用翻译服务'
  if (overLimit.value) return '内容超出上限，已暂停自动翻译'
  if (sourceLang.value === targetLang.value) return '请选择不同的原文和译文语言'
  return autoPending.value ? '等待输入结束…' : '停止输入 0.8 秒后翻译'
})

const providerFields: Record<string, { key: string; label: string }[]> = {
  baidu: [
    { key: 'app_id', label: 'APP ID' },
    { key: 'secret', label: '应用密钥' },
  ],
  youdao: [
    { key: 'app_key', label: '应用 ID' },
    { key: 'secret', label: '应用密钥' },
  ],
  deepseek: [{ key: 'api_key', label: 'API Key' }],
}

function fieldsOf(name: string) {
  return providerFields[name] || []
}

function providerHint(conn: any) {
  const limit = conn.limits
  const unit = limit.unit === 'byte' ? '字节' : '字符'
  return `一次最多 ${limit.value} ${unit}；超时：连接 10 秒 / 整体 60 秒。点「连接测试」是真的发一次请求，可能消耗额度。`
}

function langText(code: string) {
  return { auto: '自动检测', zh: '中文', en: '英语' }[code] || code
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

async function loadConnections() {
  try {
    const { data } = await http.get('/translation-connections')
    connections.value = data.items
    credentialKeyReady.value = data.credential_key_ready
    for (const conn of data.items) {
      if (!configDraft[conn.provider]) configDraft[conn.provider] = {}
      modelDraft[conn.provider] = conn.model || ''
    }
    if (!connections.value.find((c: any) => c.provider === provider.value && c.enabled)) {
      const firstEnabled = connections.value.find((c: any) => c.enabled)
      if (firstEnabled) provider.value = firstEnabled.provider
    }
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function swapLanguages() {
  if (sourceLang.value === 'auto') {
    sourceLang.value = targetLang.value === 'en' ? 'zh' : 'en'
  } else {
    const tmp = sourceLang.value
    sourceLang.value = targetLang.value
    targetLang.value = tmp
  }
}

function clearTranslationTimer() {
  if (translationTimer !== null) window.clearTimeout(translationTimer)
  translationTimer = null
  autoPending.value = false
}

function invalidateTranslation() {
  clearTranslationTimer()
  ++requestSeq
  translationController?.abort()
  translationController = null
  translating.value = false
}

function translationKey() {
  return JSON.stringify([provider.value, sourceLang.value, targetLang.value, sourceText.value.trim()])
}

function scheduleTranslation() {
  clearTranslationTimer()
  if (!autoTranslate.value || composing.value || !sourceText.value.trim() || overLimit.value
      || sourceLang.value === targetLang.value || !currentConn.value?.configured
      || !currentConn.value?.enabled || !credentialKeyReady.value) return
  if (result.value && lastSuccessKey === translationKey()) return
  autoPending.value = true
  translationTimer = window.setTimeout(() => { void translate(true) }, 800)
}

async function translate(automatic: unknown = false) {
  clearTranslationTimer()
  if (translating.value || composing.value) return
  const text = sourceText.value.trim()
  const warning = !text ? '请输入需要翻译的内容'
    : overLimit.value ? '内容超过这个服务的上限，请缩短后再翻（不会自动截断）'
    : sourceLang.value === targetLang.value ? '两边语言不能一样'
    : !currentConn.value?.configured || !currentConn.value?.enabled || !credentialKeyReady.value
      ? '请先在服务设置中配置并启用翻译服务' : ''
  if (warning) {
    if (automatic !== true) ElMessage.warning(warning)
    return
  }
  translating.value = true
  const seq = ++requestSeq
  const key = translationKey()
  const controller = new AbortController()
  translationController = controller
  try {
    const { data } = await http.post('/translations', {
      provider: provider.value,
      source_text: text,
      source_lang: sourceLang.value,
      target_lang: targetLang.value,
    }, { signal: controller.signal })
    if (seq !== requestSeq) return
    result.value = data
    lastSuccessKey = key
    await loadHistory(1)
  } catch (error) {
    if (seq === requestSeq && !controller.signal.aborted) ElMessage.error(apiError(error).message)
  } finally {
    if (seq === requestSeq) {
      translating.value = false
      translationController = null
    }
  }
}

watch([sourceText, sourceLang, targetLang, provider], () => {
  invalidateTranslation()
  result.value = null
  scheduleTranslation()
}, { flush: 'sync' })

watch([autoTranslate, composing, () => currentConn.value?.configured,
  () => currentConn.value?.enabled, credentialKeyReady], () => {
  invalidateTranslation()
  scheduleTranslation()
}, { flush: 'sync' })

watch(autoTranslate, (value) => {
  try { localStorage.setItem('wb_auto_translate', String(value)) } catch { /* Storage may be unavailable. */ }
})

onBeforeUnmount(() => {
  invalidateTranslation()
  if (historyTimer !== null) window.clearTimeout(historyTimer)
})

async function pasteSource() {
  try {
    const text = await navigator.clipboard.readText()
    sourceText.value = text
    ElMessage.success('已粘贴剪贴板内容')
  } catch {
    ElMessage.warning('浏览器不让读剪贴板，请用 Ctrl+V 或长按粘贴')
  }
}

function clearSource() {
  sourceText.value = ''
}

async function copyResult() {
  if (!result.value) return
  const ok = await copyText(result.value.target_text)
  ok ? ElMessage.success('已复制译文') : ElMessage.warning('浏览器不让自动复制，请手动选中复制')
}

function clearResult() {
  invalidateTranslation()
  result.value = null
}

async function loadHistory(target = page.value) {
  try {
    const params: Record<string, any> = { page: target, page_size: pageSize.value }
    if (historyQuery.value.trim()) params.q = historyQuery.value.trim()
    if (historyProvider.value) params.provider = historyProvider.value
    const { data } = await http.get('/translation-history', { params })
    history.value = data.items
    historyTotal.value = data.total
    page.value = target
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function onHistorySearch() {
  if (historyTimer) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(() => loadHistory(1), 300)
}

async function openDetail(item: any) {
  try {
    const { data } = await http.get(`/translation-history/${item.id}`)
    detail.value = data
    detailOpen.value = true
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function copyHistory(item: any) {
  const ok = await copyText(item.target_text)
  ok ? ElMessage.success('已复制译文') : ElMessage.warning('浏览器不让自动复制，请打开详情手动选中复制')
}

async function copyDetail(which: 'source' | 'target') {
  if (!detail.value) return
  const text = which === 'source' ? detail.value.source_text : detail.value.target_text
  const ok = await copyText(text)
  ok ? ElMessage.success(which === 'source' ? '已复制原文' : '已复制译文') : ElMessage.warning('浏览器不让自动复制，请手动选中')
}

async function saveProvider(conn: any) {
  const config: Record<string, string> = {}
  for (const field of fieldsOf(conn.provider)) {
    const value = (configDraft[conn.provider][field.key] || '').trim()
    if (value) config[field.key] = value
  }
  if (!Object.keys(config).length && !conn.configured) {
    ElMessage.warning('请填写该服务需要的密钥')
    return
  }
  savingProvider.value = conn.provider
  try {
    await http.put(`/translation-connections/${conn.provider}`, {
      config: Object.keys(config).length ? config : undefined,
      model: conn.provider === 'deepseek' ? modelDraft[conn.provider] || 'deepseek-chat' : undefined,
    })
    configDraft[conn.provider] = {}
    ElMessage.success('已保存')
    await loadConnections()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    savingProvider.value = ''
  }
}

async function toggleProvider(conn: any, value: boolean) {
  try {
    await http.put(`/translation-connections/${conn.provider}`, { enabled: value })
    await loadConnections()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function testProvider(conn: any) {
  try {
    const { data } = await http.post(`/translation-connections/${conn.provider}/test`)
    data.ok ? ElMessage.success(data.message) : ElMessage.error(data.message)
    await loadConnections()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function clearProvider(conn: any) {
  try {
    await http.delete(`/translation-connections/${conn.provider}`)
    ElMessage.success('已清除密钥')
    await loadConnections()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

onMounted(async () => {
  await loadConnections()
  await loadHistory(1)
})
</script>

<style scoped>
.result-body {
  font-size: 14px;
  line-height: 1.7;
}
.result-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.history-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wb-surface);
  border: 1px solid var(--wb-border);
  border-radius: 12px;
  padding: 8px 12px;
}
.history-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--wb-border);
  flex-wrap: wrap;
}
.history-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.danger {
  color: var(--el-color-danger);
}
.ok {
  color: var(--el-color-success);
}
.detail-label {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  margin-bottom: 4px;
}
.detail-box {
  background: var(--wb-surface-subtle);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}
.conn-block {
  border: 1px solid var(--wb-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.conn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
@media (max-width: 900px) {
  .translate-workbench {
    grid-template-columns: 1fr;
    height: auto;
  }
  .translate-pane {
    height: 240px;
  }
}
</style>
