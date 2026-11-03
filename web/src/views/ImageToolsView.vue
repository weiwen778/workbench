<template>
  <div class="image-studio" @dragover.prevent="dragOver = true" @dragleave="leaveDrop" @drop.prevent="dropFiles">
    <div class="studio-toolbar">
      <input ref="fileInput" class="hidden-input" type="file" accept="image/*" multiple aria-label="选择图片文件" @change="fileChange" />
      <el-button type="primary" :icon="Plus" :disabled="busy" @click="fileInput?.click()">添加图片</el-button>
      <el-button :disabled="busy" @click="pasteImages">粘贴图片</el-button>
      <span class="privacy"><el-icon><Picture /></el-icon>本地处理 · 图片不上传</span>
      <div class="spacer" />
      <el-button :disabled="!active || busy || !canUndo" @click="undo">撤销</el-button>
      <el-button :disabled="!active || busy || !canRedo" @click="redo">重做</el-button>
      <el-button :disabled="!active || busy" @click="resetCurrent">重置当前图片</el-button>
      <el-button type="primary" :icon="Download" :disabled="!active || busy" :loading="busy" @click="exportCurrent">导出当前图片</el-button>
    </div>

    <div v-if="!assets.length" class="studio-empty" @click.self="fileInput?.click()">
      <el-icon :size="52"><Picture /></el-icon>
      <h2>把图片拖到这里，开始处理</h2>
      <p>也可以选择文件，或用 Ctrl / Command + V 粘贴截图</p>
      <el-button type="primary" @click="fileInput?.click()">选择图片</el-button>
      <div class="empty-features"><span>裁剪与尺寸</span><span>压缩与转换</span><span>水印与标注</span><span>调色与去底</span><span>拼图与批量</span></div>
      <p class="text-12 muted">支持浏览器可读取的 PNG、JPEG、WebP、GIF、BMP、SVG、AVIF；动图按静态画面导出。<br />每次最多 30 张、合计 100 MB；单张最多 20 MB / 4000 万像素。离开页面会清空素材，请先导出。</p>
    </div>

    <template v-else-if="active">
      <div class="studio-body">
        <div class="preview-panel">
          <div class="preview-toolbar">
            <div class="preview-caption"><strong :title="active.name">{{ active.name }}</strong><span>{{ active.image.naturalWidth }} × {{ active.image.naturalHeight }} · {{ bytes(active.file.size) }}</span></div>
            <div class="spacer" />
            <el-checkbox v-if="tool !== 'collage'" v-model="showOriginal" :disabled="cropMode || drawingMode !== 'none'">查看原图</el-checkbox>
            <span v-if="cropMode" class="text-12 secondary">在图片上拖选裁剪范围</span>
            <span v-else-if="drawingMode !== 'none'" class="text-12 secondary">在图片上拖动绘制</span>
          </div>
          <div ref="stageRef" class="preview-space" :class="{ drawing: cropMode || drawingMode !== 'none' }">
            <div class="canvas-frame" :style="frameStyle" @pointerdown="startPointer" @pointermove="movePointer" @pointerup="endPointer" @pointercancel="cancelPointer" @lostpointercapture="cancelPointer">
              <canvas v-show="!cropMode" ref="previewCanvas" aria-label="图片处理预览" />
              <ImageCropper v-if="cropMode && cropPreviewUrl" :src="cropPreviewUrl" :model-value="options.crop" :aspect-ratio="desiredRatio()" @update:model-value="updateCrop" @commit="commit" />
              <svg v-if="draftMark" class="mark-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                <polyline v-if="draftMark.kind === 'brush'" :points="draftMark.points.map(p => `${p.x * 1000},${p.y * 1000}`).join(' ')" fill="none" :stroke="draftMark.color" :stroke-width="Math.max(1, draftMark.size * parseFloat(frameStyle.width) / Math.max(1, displayedSize.width))" vector-effect="non-scaling-stroke" stroke-linecap="round" />
                <rect v-else :x="draftRect.x * 1000" :y="draftRect.y * 1000" :width="draftRect.w * 1000" :height="draftRect.h * 1000" :fill="draftMark.kind === 'mosaic' ? '#78777466' : 'none'" :stroke="draftMark.color" stroke-width="3" />
              </svg>
            </div>
            <div v-if="previewError" class="preview-error">{{ previewError }}</div>
          </div>
          <div class="preview-footer"><span>{{ tool === 'collage' ? '拼图' : showOriginal ? '原图' : cropMode ? '裁剪选区' : '处理后' }} · {{ displayedSize.width }} × {{ displayedSize.height }} px</span><span>{{ busy ? progress : '预览已适应窗口，导出使用实际尺寸' }}</span></div>
        </div>

        <aside class="editor-panel" :class="{ locked: busy }" :inert="busy || undefined">
          <el-tabs v-model="tool" stretch @tab-change="changeTool">
            <el-tab-pane label="尺寸" name="geometry" /><el-tab-pane label="调色" name="color" /><el-tab-pane label="标注" name="marks" /><el-tab-pane label="拼图" name="collage" /><el-tab-pane label="导出" name="export" />
          </el-tabs>
          <div class="tool-content">
            <template v-if="tool === 'geometry'">
              <div class="tool-heading">旋转与翻转</div>
              <div class="button-grid"><el-button @click="rotate(-90)">左转 90°</el-button><el-button @click="rotate(90)">右转 90°</el-button><el-button @click="flip('flipX')">水平翻转</el-button><el-button @click="flip('flipY')">垂直翻转</el-button></div>
              <div class="tool-heading">裁剪</div>
              <div class="control-row"><el-select v-model="cropRatio" aria-label="裁剪比例" @change="applyCropRatio"><el-option v-for="r in cropRatios" :key="r.value" :label="r.label" :value="r.value" /></el-select><el-button :type="cropMode ? 'primary' : 'default'" @click="toggleCrop">{{ cropMode ? '完成裁剪' : '拖选裁剪' }}</el-button></div>
              <div class="number-grid"><label v-for="field in cropFields" :key="field.key">{{ field.label }}<el-input-number :model-value="cropPixels(field.key)" :min="field.key === 'w' || field.key === 'h' ? 1 : 0" :max="field.key === 'x' || field.key === 'w' ? geometry.width : geometry.height" :precision="0" controls-position="right" @change="(v: number | undefined) => setCropPixel(field.key, v)" /></label></div>
              <el-button text size="small" @click="resetCrop">恢复完整画面</el-button>
              <div class="tool-heading">输出尺寸 <el-checkbox v-model="lockAspect">锁定比例</el-checkbox></div>
              <div class="number-grid"><label>宽（px）<el-input-number :model-value="options.width || Math.round(geometry.width * options.crop.w)" :min="1" :max="8192" :precision="0" controls-position="right" aria-label="输出宽度" @change="(v: number | undefined) => resizeDimension('width', v)" /></label><label>高（px）<el-input-number :model-value="options.height || Math.round(geometry.height * options.crop.h)" :min="1" :max="8192" :precision="0" controls-position="right" aria-label="输出高度" @change="(v: number | undefined) => resizeDimension('height', v)" /></label></div>
              <el-select v-model="sizePreset" placeholder="常用尺寸" aria-label="常用尺寸" @change="applySizePreset"><el-option label="原始尺寸（保留裁剪）" value="original" /><el-option label="商品主图 · 800 × 800" value="800x800" /><el-option label="高清主图 · 1600 × 1600" value="1600x1600" /><el-option label="竖版 · 1080 × 1440" value="1080x1440" /><el-option label="横版 · 1920 × 1080" value="1920x1080" /></el-select>
              <label class="field">适配方式<el-select v-model="options.fit" @change="commit"><el-option label="拉伸到尺寸" value="stretch" /><el-option label="完整放入（留白）" value="contain" /><el-option label="铺满画布（裁边）" value="cover" /></el-select></label>
              <div class="tool-heading">画布与圆角</div>
              <div class="number-grid"><label>四周留白（px）<el-input-number v-model="options.padding" :min="0" :max="500" controls-position="right" @change="commit" /></label><label>圆角（px）<el-input-number v-model="options.radius" :min="0" :max="1000" controls-position="right" @change="commit" /></label></div>
              <div class="control-row"><el-checkbox v-model="options.transparent" @change="commit">透明背景</el-checkbox><label class="color-control">底色<input v-model="options.background" type="color" aria-label="画布底色" @change="commit" /></label></div>
              <p class="tool-help">留白会加在输出尺寸四周。JPEG 会将透明区域填充为所选底色。</p>
            </template>

            <template v-else-if="tool === 'color'">
              <div class="tool-heading">快捷滤镜</div><div class="preset-buttons"><el-button v-for="preset in filterPresets" :key="preset" size="small" @click="setFilter(preset)">{{ preset }}</el-button></div>
              <label v-for="field in adjustments" :key="field.key" class="range-field"><span>{{ field.label }}<b>{{ options[field.key] }}{{ field.key === 'blur' ? ' px' : '%' }}</b></span><input v-model.number="options[field.key]" type="range" :min="field.min" :max="field.max" :step="field.key === 'blur' ? .5 : 1" :aria-label="field.label" @change="commit" /></label>
              <div class="tool-heading">纯色去底<el-switch v-model="options.cutout" aria-label="启用纯色去底" @change="commit" /></div>
              <template v-if="options.cutout"><label class="color-control">移除颜色<input v-model="options.cutoutColor" type="color" aria-label="移除颜色" @change="commit" /></label><label class="range-field"><span>颜色容差<b>{{ options.tolerance }}</b></span><input v-model.number="options.tolerance" aria-label="颜色容差" type="range" min="0" max="300" @change="commit" /></label><label class="range-field"><span>边缘柔化<b>{{ options.feather }}</b></span><input v-model.number="options.feather" aria-label="边缘柔化" type="range" min="0" max="100" @change="commit" /></label></template>
              <p class="tool-help">适合白底、绿幕等纯色背景，会移除画面中所有接近该颜色的像素。导出 PNG / WebP 可保留透明；复杂背景可用裁剪和标注处理。</p>
            </template>

            <template v-else-if="tool === 'marks'">
              <div class="tool-heading">文字水印</div>
              <el-input v-model="options.watermark" placeholder="输入店铺名或水印文字" maxlength="100" aria-label="水印文字" @change="commit" />
              <label class="field">位置<el-select v-model="options.watermarkPosition" @change="commit"><el-option v-for="p in watermarkPositions" :key="p.value" :label="p.label" :value="p.value" /></el-select></label>
              <div class="number-grid"><label>字号（px）<el-input-number v-model="options.watermarkSize" :min="8" :max="500" controls-position="right" @change="commit" /></label><label class="color-control">文字颜色<input v-model="options.watermarkColor" type="color" aria-label="水印颜色" @change="commit" /></label></div>
              <label class="range-field"><span>不透明度<b>{{ options.watermarkOpacity }}%</b></span><input v-model.number="options.watermarkOpacity" type="range" min="1" max="100" aria-label="水印不透明度" @change="commit" /></label>
              <label v-if="options.watermarkPosition === 'repeat'" class="range-field"><span>平铺角度<b>{{ options.watermarkAngle }}°</b></span><input v-model.number="options.watermarkAngle" type="range" min="-90" max="90" aria-label="平铺水印角度" @change="commit" /></label>
              <div class="tool-heading">画笔与遮挡</div>
              <el-radio-group v-model="drawingMode" size="small" @change="activateDrawing"><el-radio-button value="none">浏览</el-radio-button><el-radio-button value="brush">画笔</el-radio-button><el-radio-button value="rectangle">画框</el-radio-button><el-radio-button value="mosaic">马赛克</el-radio-button></el-radio-group>
              <div class="control-row"><label class="color-control">颜色<input v-model="markColor" type="color" aria-label="标注颜色" /></label><label class="compact-field">粗细 / 色块<el-input-number v-model="markSize" :min="2" :max="200" controls-position="right" /></label></div>
              <el-button text :disabled="!options.marks.length" @click="options.marks = []; commit()">清除全部标注（{{ options.marks.length }}）</el-button>
              <p class="tool-help">选择工具后在预览上绘制；每笔均可撤销。马赛克用于日常遮挡，重要隐私建议用不透明画笔覆盖。</p>
            </template>

            <template v-else-if="tool === 'collage'">
              <div class="tool-heading">多图拼接 <span class="muted text-12">已选 {{ checkedAssets.length }} 张</span></div>
              <p class="tool-help">使用下方勾选的图片与各自的编辑效果，按队列顺序拼接；可用缩略图旁的箭头调整顺序。</p>
              <div class="preset-buttons"><el-button size="small" @click="collage.columns = 1">竖向长图</el-button><el-button size="small" @click="collage.columns = Math.max(1, checkedAssets.length)">横向拼接</el-button><el-button size="small" @click="collage.columns = 2">网格</el-button></div>
              <div class="number-grid"><label>列数<el-input-number v-model="collage.columns" :min="1" :max="30" controls-position="right" /></label><label>间距（px）<el-input-number v-model="collage.gap" :min="0" :max="200" controls-position="right" /></label><label>每格宽（px）<el-input-number v-model="collage.tileWidth" :min="50" :max="4096" controls-position="right" /></label><label>每格高（px）<el-input-number v-model="collage.tileHeight" :min="50" :max="4096" controls-position="right" /></label></div>
              <label class="field">适配方式<el-select v-model="collage.fit"><el-option label="完整放入" value="contain" /><el-option label="铺满裁边" value="cover" /></el-select></label><label class="color-control">拼图底色<input v-model="collage.background" type="color" aria-label="拼图底色" /></label>
              <el-button type="primary" class="wide-button" :disabled="!checkedAssets.length" @click="exportCollage">导出拼图</el-button>
              <p class="tool-help">格式和压缩参数使用“导出”中的设置。输出每边最多 8192 像素，总像素最多 2400 万。</p>
            </template>

            <template v-else>
              <div class="tool-heading">格式与压缩</div>
              <label class="field">输出格式<el-select v-model="exportOptions.format" aria-label="输出格式"><el-option label="PNG · 无损 / 透明" value="image/png" /><el-option label="JPEG · 照片 / 更小体积" value="image/jpeg" /><el-option label="WebP · 压缩 / 透明" value="image/webp" /></el-select></label>
              <label v-if="exportOptions.format !== 'image/png'" class="range-field"><span>质量<b>{{ Math.round(exportOptions.quality * 100) }}%</b></span><input v-model.number="exportOptions.quality" aria-label="导出质量" type="range" min=".1" max="1" step=".01" /></label>
              <label class="field">目标大小（KB，0 表示不限）<el-input-number v-model="exportOptions.targetKB" :min="0" :max="20000" :precision="0" controls-position="right" aria-label="目标大小KB" /></label>
              <p class="tool-help">设定目标大小后先调质量，仍超出时缩小像素尺寸。PNG 使用缩小尺寸来减小体积；导出完成会显示实际大小。</p>
              <div class="tool-heading">文件命名</div>
              <label class="field">文件名前缀<el-input v-model="namePrefix" placeholder="可选，例如：店铺主图" maxlength="40" /></label>
              <el-button type="primary" class="wide-button" @click="exportCurrent">导出当前图片</el-button>
              <div class="tool-heading">批量处理 <span class="muted text-12">已选 {{ checkedAssets.length }} 张</span></div>
              <el-button class="wide-button" :disabled="!checkedAssets.length" @click="applyToChecked">将当前编辑参数应用到已选图片</el-button>
              <p class="tool-help">会替换其他已选图片的编辑效果，裁剪与标注按比例适配；每张图片都可以撤销。输出尺寸未指定时，保留各自尺寸。</p>
              <el-button type="primary" class="wide-button" :disabled="!checkedAssets.length" @click="exportBatch">批量导出 ZIP</el-button>
            </template>
          </div>
        </aside>
      </div>

      <div class="queue-toolbar"><strong class="text-13">图片队列 <span class="muted">{{ assets.length }} / 30</span></strong><el-checkbox :model-value="checkedAssets.length === assets.length" :indeterminate="!!checkedAssets.length && checkedAssets.length < assets.length" :disabled="busy" @change="selectAll">全选</el-checkbox><span class="text-12 muted">勾选用于拼图和批量导出</span><div class="spacer" /><el-button text size="small" :disabled="busy" @click="clearImages">清空素材</el-button></div>
      <div class="image-queue">
        <div v-for="(asset, index) in assets" :key="asset.id" class="queue-item" :class="{ selected: asset.id === selectedId }">
          <button class="thumbnail-button" :aria-label="`编辑图片：${asset.name}`" :disabled="busy" @click="selectAsset(asset.id)"><img :src="asset.url" alt="" /><span :title="asset.name">{{ asset.name }}</span></button>
          <div class="queue-item-actions"><el-checkbox v-model="asset.checked" :disabled="busy" :aria-label="`选中图片：${asset.name}`" /><button :disabled="busy || index === 0" title="前移图片" @click="moveAsset(index, -1)">←</button><button :disabled="busy || index === assets.length - 1" title="后移图片" @click="moveAsset(index, 1)">→</button><button :disabled="busy" :aria-label="`移除图片：${asset.name}`" @click="removeAsset(asset.id)">×</button></div>
        </div>
      </div>
      <div v-if="lastExport" class="export-status" role="status">{{ lastExport }}</div>
    </template>
    <div v-if="dragOver" class="drop-overlay">松开以添加图片</div>
  </div>
</template>

<script setup lang="ts">
import ImageCropper from '@/components/ImageCropper.vue'
import { computed, markRaw, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Picture, Plus } from '@/icons'
import { clone, collageSize, defaults, download, encodeImage, extension, orientedSize, outputSize, renderCollage, renderImage, safeName, zipImages, type CollageOptions, type ExportOptions, type ImageAsset, type ImageOptions, type Mark, type Point } from '@/utils/image-tools'

const assets = ref<ImageAsset[]>([]), selectedId = ref(0), fileInput = ref<HTMLInputElement | null>(null)
const active = computed(() => assets.value.find(a => a.id === selectedId.value))
const options = computed(() => active.value?.options || defaults())
const checkedAssets = computed(() => assets.value.filter(a => a.checked))
const geometry = computed(() => active.value ? orientedSize(active.value.image, options.value) : { width: 1, height: 1 })
const busy = ref(false), progress = ref(''), lastExport = ref(''), dragOver = ref(false)
const tool = ref('geometry'), showOriginal = ref(false), cropMode = ref(false), lockAspect = ref(true), cropRatio = ref('free'), sizePreset = ref('original')
const drawingMode = ref<'none' | Mark['kind']>('none'), markColor = ref('#e03e3e'), markSize = ref(20), draftMark = ref<Mark | null>(null)
const stageRef = ref<HTMLElement | null>(null), previewCanvas = ref<HTMLCanvasElement | null>(null)
const stageSize = reactive({ width: 800, height: 500 }), previewSize = reactive({ width: 1, height: 1 }), previewError = ref('')
const exportOptions = reactive<ExportOptions>({ format: 'image/png', quality: .85, targetKB: 0 }), namePrefix = ref('')
const collage = reactive<CollageOptions>({ columns: 2, tileWidth: 800, tileHeight: 800, gap: 16, background: '#ffffff', fit: 'contain' })
const cropFields = [{ key: 'x', label: '左（px）' }, { key: 'y', label: '上（px）' }, { key: 'w', label: '宽（px）' }, { key: 'h', label: '高（px）' }] as const
const cropRatios = [{ label: '自由比例', value: 'free' }, { label: '原图比例', value: 'original' }, ...['1:1', '4:3', '3:4', '16:9', '9:16'].map(value => ({ label: value, value }))]
const adjustments: { key: 'brightness' | 'contrast' | 'saturation' | 'grayscale' | 'sepia' | 'blur'; label: string; min: number; max: number }[] = [{ key: 'brightness', label: '亮度', min: 0, max: 200 }, { key: 'contrast', label: '对比度', min: 0, max: 200 }, { key: 'saturation', label: '饱和度', min: 0, max: 200 }, { key: 'grayscale', label: '黑白', min: 0, max: 100 }, { key: 'sepia', label: '复古', min: 0, max: 100 }, { key: 'blur', label: '模糊', min: 0, max: 30 }]
const filterPresets = ['还原', '黑白', '复古', '鲜艳', '柔和']
const watermarkPositions = [{ label: '右下角', value: 'bottom-right' }, { label: '左下角', value: 'bottom-left' }, { label: '右上角', value: 'top-right' }, { label: '左上角', value: 'top-left' }, { label: '居中', value: 'center' }, { label: '全图平铺', value: 'repeat' }]
let nextId = 1, disposed = false, renderFrame = 0, observer: ResizeObserver | null = null, pointerId: number | null = null, pointerStart: Point | null = null
const canUndo = computed(() => !!active.value && (active.value.historyIndex > 0 || JSON.stringify(active.value.options) !== active.value.history[active.value.historyIndex]))
const canRedo = computed(() => !!active.value && active.value.historyIndex < active.value.history.length - 1)
const displayedSize = computed(() => tool.value === 'collage' ? collageSize(checkedAssets.value.length, collage) : showOriginal.value && active.value ? { width: active.value.image.naturalWidth, height: active.value.image.naturalHeight } : cropMode.value ? geometry.value : active.value ? outputSize(active.value.image, options.value) : { width: 0, height: 0 })
const frameStyle = computed(() => { const ratio = previewSize.width / previewSize.height, width = Math.max(1, Math.min(previewSize.width, stageSize.width - 32, (stageSize.height - 32) * ratio)); return { width: `${width}px`, height: `${width / ratio}px` } })
const cropPreviewUrl=ref('')
function updateCrop(crop:ImageOptions['crop']){options.value.crop=crop;options.value.width=options.value.height=0}
const draftRect = computed(() => { const p = draftMark.value?.points || [{ x: 0, y: 0 }], a = p[0], b = p[p.length - 1]; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) } })
function bytes(value: number) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${(value / 1024).toFixed(1)} KB` }
function errorMessage(error: unknown) { ElMessage.error(error instanceof Error ? error.message : '图片处理失败，请重试。') }
function commitAsset(asset: ImageAsset) {
  const initial = defaults(), values = asset.options as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(initial)) if (typeof value === 'number' && (typeof values[key] !== 'number' || !Number.isFinite(values[key]))) values[key] = value
  const value = JSON.stringify(asset.options)
  if (asset.history[asset.historyIndex] === value) return
  asset.history.splice(asset.historyIndex + 1); asset.history.push(value)
  if (asset.history.length > 30) asset.history.shift()
  asset.historyIndex = asset.history.length - 1
}
function commit() { if (active.value) commitAsset(active.value) }
function undo() { const a = active.value; if (!a) return; commit(); if (a.historyIndex > 0) a.options = JSON.parse(a.history[--a.historyIndex]) }
function redo() { const a = active.value; if (a && canRedo.value) a.options = JSON.parse(a.history[++a.historyIndex]) }
function resetCurrent() { if (active.value) { active.value.options = defaults(); cropMode.value = false; drawingMode.value = 'none'; commit() } }
function selectAsset(id: number) { commit(); selectedId.value = id; cropMode.value = false; drawingMode.value = 'none'; showOriginal.value = false; sizePreset.value = 'original'; cropRatio.value = 'free' }
function removeAsset(id: number) { const index = assets.value.findIndex(a => a.id === id); if (index < 0) return; const [asset] = assets.value.splice(index, 1); URL.revokeObjectURL(asset.url); asset.image.src = ''; if (selectedId.value === id) selectAsset(assets.value[Math.min(index, assets.value.length - 1)]?.id || 0) }
function clearImages() { for (const asset of assets.value) { URL.revokeObjectURL(asset.url); asset.image.src = '' } assets.value = []; selectedId.value = 0; lastExport.value = '' }
function moveAsset(index: number, direction: number) { const target = index + direction; if (target < 0 || target >= assets.value.length) return; const [asset] = assets.value.splice(index, 1); assets.value.splice(target, 0, asset) }
function selectAll(value: unknown) { for (const asset of assets.value) asset.checked = !!value }
async function addFiles(files: File[]) {
  if (busy.value) return
  busy.value = true; progress.value = '正在读取图片…'; const failures: string[] = []
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg|avif|ico)$/i.test(file.name)) { failures.push(`${file.name}：不是支持的图片`); continue }
      if (assets.value.length >= 30) { failures.push('最多添加 30 张图片'); break }
      if (file.size > 20 * 1024 * 1024 || assets.value.reduce((n, a) => n + a.file.size, 0) + file.size > 100 * 1024 * 1024) { failures.push(`${file.name}：超出文件大小限制`); continue }
      const url = URL.createObjectURL(file), image = new Image()
      try {
        image.src = url; await image.decode()
        if (disposed) { URL.revokeObjectURL(url); image.src = ''; return }
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片为空或超过 4000 万像素')
        const total = assets.value.reduce((n, a) => n + a.image.naturalWidth * a.image.naturalHeight, 0)
        if (total + image.naturalWidth * image.naturalHeight > 120_000_000) throw new Error('当前队列总像素过多，请先处理并移除部分图片')
        const initial = defaults(), asset: ImageAsset = { id: nextId++, name: file.name || `截图-${nextId}.png`, file: markRaw(file), image: markRaw(image), url, options: initial, checked: true, history: [JSON.stringify(initial)], historyIndex: 0 }
        assets.value.push(asset); if (!selectedId.value) selectedId.value = asset.id
      } catch (error) { URL.revokeObjectURL(url); image.src = ''; failures.push(`${file.name}：${error instanceof Error && error.name !== 'EncodingError' ? error.message : '浏览器无法读取此格式，请先转为 PNG 或 JPEG'}`) }
    }
    if (failures.length) ElMessage({ type: 'warning', message: failures.slice(0, 3).join('；'), duration: 7000 })
    await nextTick(); observeStage(); schedulePreview()
  } finally { busy.value = false; progress.value = '' }
}
function fileChange(event: Event) { const input = event.target as HTMLInputElement; const files = Array.from(input.files || []); input.value = ''; void addFiles(files) }
function dropFiles(event: DragEvent) { dragOver.value = false; void addFiles(Array.from(event.dataTransfer?.files || [])) }
function leaveDrop(event: DragEvent) { if (!event.currentTarget || !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) dragOver.value = false }
function pasteEvent(event: ClipboardEvent) { if (busy.value) return; const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/')); if (files.length) { event.preventDefault(); void addFiles(files) } }
function editorKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (busy.value || !active.value || !(event.ctrlKey || event.metaKey) || target?.closest('input, textarea, [contenteditable="true"]')) return
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
  else if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
}
async function pasteImages() { try { if (!navigator.clipboard?.read) throw new Error('请使用 Ctrl / Command + V 粘贴图片'); const items = await navigator.clipboard.read(); const files: File[] = []; for (const item of items) { const type = item.types.find(t => t.startsWith('image/')); if (type) files.push(new File([await item.getType(type)], `截图-${Date.now()}-${files.length}.${extension(type)}`, { type })) } if (!files.length) throw new Error('剪贴板中没有图片，请先复制图片或截图'); await addFiles(files) } catch { ElMessage.info('请复制图片后，用 Ctrl / Command + V 粘贴到页面。') } }
function observeStage() { observer?.disconnect(); if (!stageRef.value) return; const update = () => { if (stageRef.value) { stageSize.width = stageRef.value.clientWidth; stageSize.height = stageRef.value.clientHeight } }; observer = new ResizeObserver(update); observer.observe(stageRef.value); update() }
function schedulePreview() { cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(renderPreview) }
function renderPreview() {
  if (!active.value || !previewCanvas.value) return
  try {
    let rendered: HTMLCanvasElement
    if (tool.value === 'collage') rendered = renderCollage(checkedAssets.value, collage, 1400)
    else {
      const settings = cropMode.value ? { ...defaults(), rotation: options.value.rotation, flipX: options.value.flipX, flipY: options.value.flipY } : showOriginal.value ? defaults() : options.value
      rendered = renderImage(active.value.image, settings, 1400)
    }
    const preview = previewCanvas.value; preview.width = rendered.width; preview.height = rendered.height
    preview.getContext('2d')?.drawImage(rendered, 0, 0); previewSize.width = rendered.width; previewSize.height = rendered.height; previewError.value = ''; if(cropMode.value)cropPreviewUrl.value=preview.toDataURL(); rendered.width = rendered.height = 1
  } catch (error) { previewError.value = error instanceof Error ? error.message : '预览失败' }
}
function changeTool() { commit(); cropMode.value = false; drawingMode.value = 'none'; showOriginal.value = false }
function rotate(delta: number) { options.value.rotation = (options.value.rotation + delta + 360) % 360; options.value.crop = { x: 0, y: 0, w: 1, h: 1 }; options.value.width = options.value.height = 0; commit() }
function flip(key: 'flipX' | 'flipY') { options.value[key] = !options.value[key]; commit() }
function cropPixels(key: keyof ImageOptions['crop']) { return Math.round(options.value.crop[key] * (key === 'x' || key === 'w' ? geometry.value.width : geometry.value.height)) }
function setCropPixel(key: keyof ImageOptions['crop'], value: number | undefined) {
  if (value === undefined) return
  const crop = options.value.crop, size = key === 'x' || key === 'w' ? geometry.value.width : geometry.value.height
  crop[key] = value / size
  crop.w = Math.max(1 / geometry.value.width, Math.min(crop.w, 1)); crop.h = Math.max(1 / geometry.value.height, Math.min(crop.h, 1))
  crop.x = Math.max(0, Math.min(crop.x, 1 - crop.w)); crop.y = Math.max(0, Math.min(crop.y, 1 - crop.h)); options.value.width = options.value.height = 0; commit()
}
function desiredRatio() { if (cropRatio.value === 'free') return 0; if (cropRatio.value === 'original') return geometry.value.width / geometry.value.height; const [w, h] = cropRatio.value.split(':').map(Number); return w / h }
function applyCropRatio() { const ratio = desiredRatio(); if (!ratio) return; const norm = ratio * geometry.value.height / geometry.value.width; const w = Math.min(1, norm), h = Math.min(1, 1 / norm); options.value.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }; options.value.width = options.value.height = 0; cropMode.value = true; showOriginal.value = false; commit() }
function toggleCrop() { cropMode.value = !cropMode.value; drawingMode.value = 'none'; showOriginal.value = false; commit() }
function resetCrop() { options.value.crop = { x: 0, y: 0, w: 1, h: 1 }; options.value.width = options.value.height = 0; cropRatio.value = 'free'; commit() }
function resizeDimension(key: 'width' | 'height', value: number | undefined) { if (!value) return; options.value[key] = value; if (lockAspect.value) { const ratio = geometry.value.width * options.value.crop.w / (geometry.value.height * options.value.crop.h); options.value[key === 'width' ? 'height' : 'width'] = Math.max(1, Math.round(key === 'width' ? value / ratio : value * ratio)) } sizePreset.value = ''; commit() }
function applySizePreset() { if (sizePreset.value === 'original') options.value.width = options.value.height = 0; else { const [w, h] = sizePreset.value.split('x').map(Number); options.value.width = w; options.value.height = h; options.value.fit = 'contain' } commit() }
function setFilter(preset: string) { Object.assign(options.value, { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0 }); if (preset === '黑白') options.value.grayscale = 100; if (preset === '复古') { options.value.sepia = 70; options.value.contrast = 90 } if (preset === '鲜艳') { options.value.saturation = 135; options.value.contrast = 110 } if (preset === '柔和') { options.value.contrast = 85; options.value.brightness = 108; options.value.saturation = 85 } commit() }
function activateDrawing() { cropMode.value = false; showOriginal.value = false }
function eventPoint(event: PointerEvent) { const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) } }
function startPointer(event: PointerEvent) { if (busy.value || !event.isPrimary || event.button !== 0 || (cropMode.value || drawingMode.value === 'none')) return; event.preventDefault(); pointerStart = eventPoint(event); pointerId = event.pointerId; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); draftMark.value = { kind: drawingMode.value, points: [pointerStart], color: markColor.value, size: markSize.value } }
function movePointer(event: PointerEvent) {
  if (event.pointerId !== pointerId || !pointerStart) return
  const point = eventPoint(event)
  if (draftMark.value) { if (draftMark.value.kind === 'brush') { if (draftMark.value.points.length < 2000) draftMark.value.points.push(point) } else draftMark.value.points = [pointerStart, point] }
}
function endPointer(event: PointerEvent) { if (event.pointerId !== pointerId) return; movePointer(event); if (draftMark.value && active.value) { if (options.value.marks.length < 200) options.value.marks.push(clone(draftMark.value)); else ElMessage.info('最多保留 200 笔标注，请先导出或清理部分标注') } draftMark.value = null; pointerStart = null; pointerId = null; const frame = event.currentTarget as HTMLElement; if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId); commit() }
function cancelPointer(event: PointerEvent) { if (pointerId !== event.pointerId) return; pointerId = null; pointerStart = null; draftMark.value = null; commit() }
function applyToChecked() { if (!active.value) return; commit(); const settings = clone(options.value); for (const asset of checkedAssets.value) { if (asset.id === active.value.id) continue; asset.options = clone(settings); commitAsset(asset) } ElMessage.success(`已应用到 ${checkedAssets.value.length} 张图片，可逐张撤销`) }
function fileName(asset: ImageAsset, index?: number) { const prefix = namePrefix.value.trim() ? safeName(namePrefix.value.trim() + '.x') + '-' : ''; return `${prefix}${index === undefined ? '' : String(index + 1).padStart(2, '0') + '-'}${safeName(asset.name)}-edited.${extension(exportOptions.format)}` }
async function runExport(job: () => Promise<void>) { if (busy.value) return; busy.value = true; cropMode.value = false; drawingMode.value = 'none'; commit(); try { await job() } catch (error) { errorMessage(error) } finally { busy.value = false; progress.value = '' } }
async function exportCurrent() { const asset = active.value; if (!asset) return; const settings = clone(asset.options), encoding = clone(exportOptions), name = fileName(asset); await runExport(async () => { progress.value = '正在生成图片…'; const canvas = renderImage(asset.image, settings); try { const result = await encodeImage(canvas, encoding, settings.background); if (disposed) return; download(result.blob, name); lastExport.value = `已导出 ${name} · ${result.width} × ${result.height} · ${bytes(result.blob.size)}${result.withinTarget ? '' : '（未达到目标体积，可继续缩小尺寸）'}`; ElMessage.success('图片已导出') } finally { canvas.width = canvas.height = 1 } }) }
async function exportBatch() { const queue = checkedAssets.value.map(asset => ({ image: asset.image, options: clone(asset.options), name: fileName(asset, checkedAssets.value.indexOf(asset)) })), encoding = clone(exportOptions); if (!queue.length) return; await runExport(async () => { const files: { name: string; blob: Blob }[] = []; let oversized = 0; for (const [index, asset] of queue.entries()) { if (disposed) return; progress.value = `正在处理 ${index + 1} / ${queue.length}`; await new Promise(resolve => setTimeout(resolve, 0)); const canvas = renderImage(asset.image, asset.options); try { const result = await encodeImage(canvas, encoding, asset.options.background); files.push({ name: asset.name, blob: result.blob }); if (!result.withinTarget) oversized++ } finally { canvas.width = canvas.height = 1 } } progress.value = '正在打包 ZIP…'; const zip = await zipImages(files); if (disposed) return; download(zip, `images-${Date.now()}.zip`); lastExport.value = `已打包 ${files.length} 张图片 · ${bytes(zip.size)}${oversized ? ` · ${oversized} 张未达到目标体积` : ''}`; ElMessage.success('批量图片已打包导出') }) }
async function exportCollage() { const queue = checkedAssets.value.map(a => ({ image: a.image, options: clone(a.options) })), layout = clone(collage), encoding = clone(exportOptions); await runExport(async () => { progress.value = '正在生成拼图…'; const canvas = renderCollage(queue, layout); try { const result = await encodeImage(canvas, encoding, layout.background); if (disposed) return; download(result.blob, `collage-${Date.now()}.${extension(encoding.format)}`); lastExport.value = `已导出拼图 · ${queue.length} 张 · ${result.width} × ${result.height} · ${bytes(result.blob.size)}${result.withinTarget ? '' : '（未达到目标体积）'}` } finally { canvas.width = canvas.height = 1 } }) }
watch(() => [selectedId.value, JSON.stringify(options.value), tool.value, showOriginal.value, cropMode.value, JSON.stringify(collage), checkedAssets.value.map(a => `${a.id}:${JSON.stringify(a.options)}`).join('|')], () => schedulePreview(), { flush: 'post' })
watch(() => !!assets.value.length, async () => { await nextTick(); observeStage(); schedulePreview() })
watch(collage, () => {
  const initial: Record<string, number> = { columns: 2, tileWidth: 800, tileHeight: 800, gap: 16 }
  const values = collage as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(initial)) if (typeof values[key] !== 'number' || !Number.isFinite(values[key])) values[key] = value
})
onMounted(() => { window.addEventListener('paste', pasteEvent); window.addEventListener('keydown', editorKeydown); observeStage() })
onUnmounted(() => { disposed = true; window.removeEventListener('paste', pasteEvent); window.removeEventListener('keydown', editorKeydown); observer?.disconnect(); cancelAnimationFrame(renderFrame); clearImages() })
</script>

<style scoped>
.image-studio { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 12px 16px; gap: 10px; position: relative; }
.studio-toolbar, .preview-toolbar, .queue-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.studio-toolbar :deep(.el-button + .el-button), .button-grid :deep(.el-button + .el-button), .preset-buttons :deep(.el-button + .el-button) { margin-left: 0; }
.hidden-input { display: none; }
.privacy { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--wb-text-secondary); }
.studio-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; border: 1px dashed var(--wb-border); border-radius: 10px; text-align: center; padding: 24px; min-height: 360px; }
.studio-empty > .el-icon { color: var(--wb-text-tertiary); }
.studio-empty h2 { font-size: 23px; font-weight: 500; margin: 5px 0; }
.studio-empty p { margin: 0; color: var(--wb-text-secondary); line-height: 1.9; }
.empty-features { display: flex; flex-wrap: wrap; gap: 10px 24px; justify-content: center; margin: 20px 0; font-size: 13px; }
.studio-body { display: grid; grid-template-columns: minmax(0, 1fr) 316px; flex: 1; min-height: 300px; border: 1px solid var(--wb-border); border-radius: 8px; overflow: hidden; }
.preview-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.preview-toolbar { padding: 9px 12px; border-bottom: 1px solid var(--wb-border); min-height: 46px; }
.preview-caption { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 55%; font-size: 12px; }
.preview-caption strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 500; }
.preview-caption span { color: var(--wb-text-tertiary); font-size: 11px; }
.preview-space { flex: 1; min-height: 180px; min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; background-color: var(--wb-surface-subtle); background-image: conic-gradient(var(--wb-border) 25%, transparent 0 50%, var(--wb-border) 0 75%, transparent 0); background-size: 20px 20px; }
.canvas-frame { position: relative; flex-shrink: 0; box-shadow: 0 2px 12px #0002; }
.canvas-frame canvas { display: block; width: 100%; height: 100%; }
.drawing .canvas-frame { touch-action: none; cursor: crosshair; user-select: none; }


.mark-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.preview-error { position: absolute; inset: 0; padding: 24px; background: var(--wb-surface); color: var(--el-color-danger); display: flex; align-items: center; justify-content: center; text-align: center; }
.preview-footer { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 12px; color: var(--wb-text-tertiary); font-size: 11px; border-top: 1px solid var(--wb-border); }
.editor-panel { border-left: 1px solid var(--wb-border); display: flex; flex-direction: column; overflow: hidden; min-height: 0; background: var(--wb-surface); }
.editor-panel.locked { opacity: .6; }
.editor-panel :deep(.el-tabs__header) { margin-bottom: 0; padding: 0 12px; }
.editor-panel :deep(.el-tabs__item) { font-size: 13px; padding: 0 12px; }
.tool-content { overflow-y: auto; padding: 0 14px 18px; }
.tool-heading { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 10px; font-size: 13px; font-weight: 600; }
.button-grid, .number-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; margin-bottom: 10px; }
.number-grid label, .field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--wb-text-secondary); }
.number-grid :deep(.el-input-number), .field :deep(.el-input-number), .field :deep(.el-select) { width: 100%; }
.field { margin-top: 12px; margin-bottom: 10px; }
.control-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.control-row > .el-select { flex: 1; min-width: 0; }
.color-control { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--wb-text-secondary); }
.color-control input[type=color] { width: 34px; height: 28px; padding: 2px; border: 1px solid var(--wb-border); background: var(--wb-surface); border-radius: 4px; cursor: pointer; }
.compact-field { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.compact-field :deep(.el-input-number) { width: 100px; }
.range-field { display: flex; flex-direction: column; gap: 6px; margin: 16px 0; font-size: 12px; }
.range-field span { display: flex; justify-content: space-between; color: var(--wb-text-secondary); }
.range-field b { font-weight: 400; }
input[type=range] { width: 100%; accent-color: var(--wb-primary); cursor: pointer; }
.preset-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.tool-help { font-size: 11px; line-height: 1.8; color: var(--wb-text-tertiary); margin: 10px 0; }
.wide-button { width: 100%; margin: 12px 0 0; white-space: normal; height: auto; min-height: 32px; line-height: 1.5; padding: 7px 10px; }
.queue-toolbar { min-height: 30px; }
.image-queue { display: flex; gap: 8px; overflow-x: auto; flex-shrink: 0; padding-bottom: 4px; }
.queue-item { width: 120px; flex: 0 0 120px; border: 1px solid var(--wb-border); border-radius: 6px; padding: 4px; }
.queue-item.selected { border-color: var(--wb-primary); background: var(--el-color-primary-light-9); }
.thumbnail-button { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; border: 0; background: none; padding: 0; cursor: pointer; color: var(--wb-text); }
.thumbnail-button img { width: 108px; height: 56px; object-fit: contain; background: var(--wb-surface-subtle); }
.thumbnail-button span { max-width: 108px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.queue-item-actions { display: flex; align-items: center; justify-content: space-between; gap: 4px; height: 24px; }
.queue-item-actions button { border: 0; background: none; color: var(--wb-text-secondary); cursor: pointer; padding: 2px 5px; }
.queue-item-actions button:disabled { opacity: .3; cursor: default; }
.export-status { font-size: 12px; color: var(--wb-text-secondary); overflow-wrap: anywhere; }
.drop-overlay { position: absolute; inset: 6px; display: flex; align-items: center; justify-content: center; pointer-events: none; color: var(--wb-primary); background: var(--el-color-primary-light-9); border: 2px dashed var(--wb-primary); border-radius: 10px; font-size: 24px; z-index: 8; }
@media (max-width: 900px) {
  .image-studio { height: auto; min-height: 100%; padding: 10px; }
  .studio-body { grid-template-columns: 1fr; flex: none; overflow: visible; }
  .preview-panel { min-height: 360px; height: 50vh; }
  .editor-panel { border-left: 0; border-top: 1px solid var(--wb-border); max-height: 520px; }
  .tool-content { max-height: 450px; }
  .studio-toolbar > .spacer { display: none; }
  .studio-empty h2 { font-size: 19px; }
  .queue-toolbar .spacer { min-width: 0; }
}
</style>
