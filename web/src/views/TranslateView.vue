<template>
  <div class="page">
    <!-- 顶部操作条 -->
    <div class="page-toolbar">
      <el-select v-model="provider" style="width: 150px" @change="onProviderChange">
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

      <el-select v-model="sourceLang" style="width: 130px">
        <el-option label="自动检测" value="auto" />
        <el-option v-for="lang in supportedLangs" :key="lang.code" :label="lang.name" :value="lang.code" />
      </el-select>

      <el-button text :icon="Switch" circle title="交换语言" @click="swapLanguages" />

      <el-select v-model="targetLang" style="width: 130px">
        <el-option v-for="lang in supportedLangs" :key="lang.code" :label="lang.name" :value="lang.code" />
      </el-select>

      <el-button type="primary" :icon="Promotion" :loading="translating" @click="translate">
        翻译
      </el-button>

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
            placeholder="输入需要翻译的内容，Ctrl / Command + Enter 开始翻译"
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
          <el-button text size="small" :icon="Favorite" :disabled="!result" @click="favoriteResult">收藏</el-button>
          <el-button text size="small" :icon="CopyDocument" :disabled="!result" @click="copyResult">复制译文</el-button>
          <el-button text size="small" :icon="Delete" :disabled="!result" @click="clearResult">清空译文</el-button>
        </div>
      </div>
    </div>

    <div ref="bottomRef" class="translate-bottom" :class="{ 'is-resizing': resizing }" :style="{ '--translate-favorites-width': `${favoritesWidth}px` }">
      <!-- 收藏 -->
      <div id="translate-favorites" class="bottom-pane">
        <div class="history-head">
          <span class="group-title" style="padding: 0">收藏</span>
          <div class="spacer" />
          <span class="text-12 muted">共 {{ favorites.length }} 条</span>
        </div>
        <div class="history-list">
          <div v-for="item in favorites" :key="item.id" class="history-row">
            <div class="history-text">
              <div class="ellipsis-1">{{ item.source_text }}</div>
              <el-icon class="history-arrow"><Direction /></el-icon>
              <div class="ellipsis-1 muted">{{ item.target_text }}</div>
            </div>
            <div class="actions-group">
              <el-button text size="small" :icon="CopyDocument" title="复制译文" @click="copyFavorite(item)" />
              <el-button text size="small" :icon="Delete" title="移除收藏" @click="removeFavorite(item)" />
            </div>
          </div>
          <div v-if="!favorites.length" class="empty-hint" style="padding: 24px">
            还没有收藏，翻译后可点「收藏」或从历史里收藏
          </div>
        </div>
      </div>

      <div
        class="bottom-divider"
        role="separator"
        tabindex="0"
        aria-label="调整收藏和历史的宽度"
        aria-orientation="vertical"
        aria-controls="translate-favorites translate-history"
        :aria-valuemin="MIN_FAVORITES_WIDTH"
        :aria-valuemax="Math.round(maxFavoritesWidth)"
        :aria-valuenow="Math.round(favoritesWidth)"
        :aria-valuetext="`收藏宽度 ${Math.round(favoritesWidth)} 像素`"
        title="左右拖动调整宽度，双击恢复默认"
        @pointerdown="startResize"
        @pointermove="resizePanels"
        @pointerup="finishResize"
        @pointercancel="finishResize"
        @lostpointercapture="finishResize"
        @keydown="resizeWithKeyboard"
        @dblclick="resetWidth"
      ></div>

      <!-- 历史 -->
      <div id="translate-history" class="bottom-pane">
        <div class="history-head">
          <span class="group-title" style="padding: 0">历史</span>
          <el-input
            v-model="historyQuery"
            size="small"
            placeholder="搜索原文或译文"
            clearable
            style="width: 150px"
            :prefix-icon="Search"
            @input="onHistorySearch"
          />
          <el-select v-model="historyProvider" size="small" style="width: 110px" clearable placeholder="全部服务" @change="loadHistory(1)">
            <el-option v-for="conn in connections" :key="conn.provider" :label="conn.name" :value="conn.provider" />
          </el-select>
          <el-button text size="small" :icon="Refresh" title="刷新" @click="loadHistory(page)" />
          <div class="spacer" />
          <span class="text-12 muted">共 {{ historyTotal }} 条</span>
        </div>

        <div class="history-list">
          <div v-for="item in history" :key="item.id" class="history-row">
            <div class="history-text">
              <div class="ellipsis-1">{{ item.source_text }}</div>
              <el-icon class="history-arrow"><Direction /></el-icon>
              <div class="ellipsis-1 muted">{{ item.target_text }}</div>
            </div>
            <div class="actions-group">
              <el-button text size="small" @click="openDetail(item)">详情</el-button>
              <el-button text size="small" :icon="Favorite" title="收藏" @click="favoriteHistory(item)" />
              <el-button text size="small" :icon="CopyDocument" title="复制" @click="copyHistory(item)" />
              <el-button text size="small" :icon="Delete" title="删除" @click="removeHistory(item)" />
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

    <el-drawer v-model="settingsOpen" title="翻译服务设置" size="min(650px,100vw)" :before-close="closeServiceSettings">
      <TranslationSettings v-if="settingsOpen" ref="serviceSettings" @updated="loadConnections" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import {onBeforeRouteLeave} from 'vue-router'
import TranslationSettings from '@/components/TranslationSettings.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CopyDocument,
  Direction,
  Delete,
  DocumentCopy,
  Favorite,
  Promotion,
  Refresh,
  Search,
  Setting,
  Switch,
} from '@/icons'
import { apiError, copyText, http } from '@/api/client'

const connections = ref<any[]>([])
const languages = ref<{ code: string; name: string }[]>([])
const provider = ref('baidu')
const sourceLang = ref('auto')
const targetLang = ref('en')
const sourceText = ref('')
const result = ref<any>(null)
const translating = ref(false)
const settingsOpen = ref(false)
const savingConfig = ref(false)

const favorites = ref<any[]>([])
const history = ref<any[]>([])
const historyTotal = ref(0)
const historyQuery = ref('')
const historyProvider = ref('')
const page = ref(1)
const pageSize = ref(20)
const detailOpen = ref(false)
const detail = ref<any>(null)

// 收藏／历史分栏：仅在左右布局时启用，窄屏继续上下排列。
const MIN_FAVORITES_WIDTH = 240
const MIN_HISTORY_WIDTH = 360
const DIVIDER_WIDTH = 9
const DEFAULT_FAVORITES_WIDTH = 320
const WIDTH_STORAGE_KEY = 'wb_translate_favorites_width'
const bottomRef = ref<HTMLElement | null>(null)
const bottomWidth = ref(0)
const resizing = ref(false)
function readWidth() {
  try {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= MIN_FAVORITES_WIDTH ? stored : DEFAULT_FAVORITES_WIDTH
  } catch { return DEFAULT_FAVORITES_WIDTH }
}
const preferredWidth = ref(readWidth())
const maxFavoritesWidth = computed(() => Math.max(MIN_FAVORITES_WIDTH, bottomWidth.value - DIVIDER_WIDTH - MIN_HISTORY_WIDTH))
const favoritesWidth = computed(() => Math.min(maxFavoritesWidth.value, Math.max(MIN_FAVORITES_WIDTH, preferredWidth.value)))
let sizeObserver: ResizeObserver | null = null
let activePointer: number | null = null
let dragStartX = 0
let dragStartWidth = 0

function rememberWidth() {
  try { localStorage.setItem(WIDTH_STORAGE_KEY, String(preferredWidth.value)) } catch { /* Storage may be unavailable. */ }
}
function setWidth(width: number) {
  preferredWidth.value = Math.min(maxFavoritesWidth.value, Math.max(MIN_FAVORITES_WIDTH, width))
}
function startResize(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || window.innerWidth <= 820) return
  event.preventDefault()
  dragStartX = event.clientX
  dragStartWidth = favoritesWidth.value
  activePointer = event.pointerId
  resizing.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function resizePanels(event: PointerEvent) {
  if (activePointer !== event.pointerId) return
  setWidth(dragStartWidth + event.clientX - dragStartX)
}
function finishResize(event: PointerEvent) {
  if (activePointer !== event.pointerId) return
  activePointer = null
  resizing.value = false
  const handle = event.currentTarget as HTMLElement
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  rememberWidth()
}
function resetWidth() {
  setWidth(DEFAULT_FAVORITES_WIDTH)
  rememberWidth()
}
function resizeWithKeyboard(event: KeyboardEvent) {
  const step = event.shiftKey ? 40 : 16
  const width = { ArrowLeft: favoritesWidth.value - step, ArrowRight: favoritesWidth.value + step, Home: MIN_FAVORITES_WIDTH, End: maxFavoritesWidth.value }[event.key]
  if (width === undefined) return
  event.preventDefault()
  setWidth(width)
  rememberWidth()
}

let requestSeq = 0
let historyTimer: number | null = null

const currentConn = computed(() => connections.value.find((c) => c.provider === provider.value))
const langNames = computed<Record<string, string>>(() =>
  Object.fromEntries(languages.value.map((item) => [item.code, item.name])),
)
// 不同服务支持的语言不一样，选项跟着当前服务走
const supportedLangs = computed<{ code: string; name: string }[]>(() => {
  const conn = connections.value.find((c) => c.provider === provider.value)
  return conn?.languages?.length ? conn.languages : languages.value
})
const limitInfo = computed(() => currentConn.value?.limits || { unit: 'char', value: 4000 })
const used = computed(() =>
  limitInfo.value.unit === 'byte' ? new TextEncoder().encode(sourceText.value).length : sourceText.value.length,
)
const overLimit = computed(() => used.value > limitInfo.value.value)
const counterText = computed(() => {
  const unit = limitInfo.value.unit === 'byte' ? '字节' : '字符'
  return `${used.value} / ${limitInfo.value.value} ${unit}`
})

function langText(code: string) {
  if (code === 'auto') return '自动检测'
  return langNames.value[code] || code
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

async function loadConnections() {
  try {
    const { data } = await http.get('/translation-connections')
    connections.value = data.items
    languages.value = data.languages || []
    if (!connections.value.find((c: any) => c.provider === provider.value && c.enabled)) {
      const firstEnabled = connections.value.find((c: any) => c.enabled)
      if (firstEnabled) provider.value = firstEnabled.provider
    }
    ensureLanguage()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

// 换服务后把不在支持列表里的语言改掉，避免提交必然失败的组合
function ensureLanguage() {
  const codes = supportedLangs.value.map((item) => item.code)
  if (!codes.length) return
  if (sourceLang.value !== 'auto' && !codes.includes(sourceLang.value)) sourceLang.value = 'auto'
  if (!codes.includes(targetLang.value)) {
    targetLang.value = codes.find((code) => code !== sourceLang.value) || codes[0]
  }
}

function onProviderChange() {
  result.value = null
  ensureLanguage()
}

function swapLanguages() {
  if (sourceLang.value === 'auto') {
    const nextSource = targetLang.value
    sourceLang.value = nextSource
    targetLang.value =
      supportedLangs.value.map((item) => item.code).find((code) => code !== nextSource) || nextSource
  } else {
    const tmp = sourceLang.value
    sourceLang.value = targetLang.value
    targetLang.value = tmp
  }
}

async function translate() {
  if (translating.value) return
  const text = sourceText.value.trim()
  if (!text) {
    ElMessage.warning('请输入需要翻译的内容')
    return
  }
  if (overLimit.value) {
    ElMessage.warning('内容超过这个服务的上限，请缩短后再翻（不会自动截断）')
    return
  }
  if (sourceLang.value === targetLang.value) {
    ElMessage.warning('两边语言不能一样')
    return
  }
  translating.value = true
  const seq = ++requestSeq
  try {
    const { data } = await http.post('/translations', {
      provider: provider.value,
      source_text: text,
      source_lang: sourceLang.value,
      target_lang: targetLang.value,
    })
    if (seq !== requestSeq) return
    result.value = data
    await loadHistory(1)
  } catch (error) {
    if (seq === requestSeq) ElMessage.error(apiError(error).message)
  } finally {
    if (seq === requestSeq) translating.value = false
  }
}

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

async function removeHistory(item: any) {
  try {
    await ElMessageBox.confirm('删除这条翻译记录？删除后不可恢复。', '删除记录', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.delete(`/translation-history/${item.id}`)
    ElMessage.success('已删除')
    if (history.value.length === 1 && page.value > 1) await loadHistory(page.value - 1)
    else await loadHistory(page.value)
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function loadFavorites() {
  try {
    const { data } = await http.get('/translation-favorites')
    favorites.value = data.items
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function saveFavorite(item: any) {
  try {
    await http.post('/translation-favorites', {
      source_text: item.source_text || '',
      target_text: item.target_text || '',
      source_lang: item.source_lang || 'auto',
      target_lang: item.target_lang || 'en',
      provider: item.provider,
      model: item.model || null,
    })
    ElMessage.success('已收藏')
    await loadFavorites()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function favoriteResult() {
  if (!result.value) return
  saveFavorite(result.value)
}

function favoriteHistory(item: any) {
  saveFavorite(item)
}

async function copyFavorite(item: any) {
  const ok = await copyText(item.target_text)
  ok ? ElMessage.success('已复制译文') : ElMessage.warning('浏览器不让自动复制，请手动选中复制')
}

async function removeFavorite(item: any) {
  try {
    await ElMessageBox.confirm('从收藏里移除这条记录？', '移除收藏', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消',
    })
    await http.delete(`/translation-favorites/${item.id}`)
    ElMessage.success('已移除')
    await loadFavorites()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
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

const serviceSettings=ref<InstanceType<typeof TranslationSettings>>()
onBeforeRouteLeave(async()=>!settingsOpen.value||!serviceSettings.value||await serviceSettings.value.confirmDiscard())
async function closeServiceSettings(done:()=>void){if(await serviceSettings.value?.confirmDiscard())done()}

onMounted(async () => {
  if (bottomRef.value) {
    bottomWidth.value = bottomRef.value.clientWidth
    sizeObserver = new ResizeObserver(() => {
      if (bottomRef.value) bottomWidth.value = bottomRef.value.clientWidth
    })
    sizeObserver.observe(bottomRef.value)
  }
  await loadConnections()
  await loadFavorites()
  await loadHistory(1)
})
onUnmounted(() => {
  sizeObserver?.disconnect()
  if (historyTimer) window.clearTimeout(historyTimer)
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
/* 下方是一个整体卡片，内部再分收藏／历史，避免和上面两个面板凑成 2×2 */
.translate-bottom {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--translate-favorites-width, 320px) 9px minmax(0, 1fr);
  background: var(--wb-surface);
  border: 1px solid var(--wb-border);
  border-radius: 12px;
  overflow: hidden;
}
.bottom-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
}
.bottom-divider {
  position: relative;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  outline: none;
}
.bottom-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: var(--wb-border);
}
.bottom-divider:hover::before,
.bottom-divider:focus-visible::before,
.is-resizing .bottom-divider::before {
  left: 3px;
  width: 3px;
  background: var(--wb-primary);
}
.bottom-divider:focus-visible { background: var(--el-color-primary-light-9); }
.is-resizing, .is-resizing :deep(*) { cursor: col-resize; user-select: none; }
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
@media (max-width: 820px) {
  .translate-bottom {
    grid-template-columns: 1fr;
  }
  .bottom-divider { display: none; }
  #translate-history {
    border-left: none;
    border-top: 1px solid var(--wb-border);
  }
}
</style>
