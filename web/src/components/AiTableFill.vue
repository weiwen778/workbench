<template>
 <el-dialog :model-value="modelValue" title="AI 图片填表" class="ai-fill-dialog" width="min(1120px,96vw)" align-center :close-on-click-modal="false" :close-on-press-escape="false" :before-close="close">
  <template #header><div class="ai-heading"><span class="ai-heading-icon"><el-icon><Picture/></el-icon></span><div><strong>AI 图片填表</strong><p>粘贴或上传截图，自动识别为当前表格的数据</p></div></div></template>
  <div class="ai-workspace">
   <section class="ai-source">
    <div class="ai-section-head"><strong>原始图片</strong><span class="ai-model">{{ modelName }}</span></div>
    <el-upload drag class="ai-uploader" :class="{'has-image':!!preview}" :show-file-list="false" :auto-upload="false" accept="image/png,image/jpeg" :on-change="choose" :disabled="saving">
     <img v-if="preview" :src="preview" alt="待识别截图" class="ai-preview"/>
     <div v-else class="ai-upload-prompt"><span class="ai-upload-icon"><el-icon><UploadFilled/></el-icon></span><h3>把截图粘贴到这里</h3><p><kbd>Ctrl / ⌘</kbd> + <kbd>V</kbd></p><span>或拖入图片、点击选择文件</span><small>PNG / JPG · 最大 8 MB</small></div>
    </el-upload>
    <div class="ai-source-foot"><span class="ai-filename" :title="filename">{{ filename||'图片仅用于本次识别' }}</span><span v-if="preview" class="secondary">点击图片可更换</span></div>
    <p class="ai-privacy"><el-icon><InfoFilled/></el-icon>图片发送至智谱识别，确认前不会写入表格。</p>
   </section>
   <section class="ai-output" aria-live="polite" :aria-busy="busy">
    <div class="ai-section-head"><strong>{{ busy?'正在识别':'核对数据' }}</strong><span v-if="selected&&!busy" class="ai-ready"><el-icon><Check/></el-icon>{{ rows.length }} 条待确认</span></div>
    <div class="ai-output-scroll">
     <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
     <div v-if="busy" class="ai-loading"><el-icon class="is-loading"><Refresh/></el-icon><h3>正在读取图片中的字段</h3><p>识别完成后会自动显示，请稍候…</p><el-skeleton :rows="5" animated/></div>
     <div v-else-if="!results.length&&!error" class="ai-empty"><el-icon><Collection/></el-icon><h3>识别结果会显示在这里</h3><p>自动匹配已有字段、选项和日期格式</p><div><span>1 选择图片</span><span>2 核对内容</span><span>3 确认新增</span></div></div>
     <template v-if="!busy">
      <div v-for="r in results" :key="r.model" class="ai-result-summary" :class="{selected:r===selected}"><div class="ai-result-line"><strong>{{ r.model==='glm-ocr'?'GLM-OCR':'GLM-4V-Flash' }}</strong><span v-if="!r.error" class="secondary">{{ (r.duration_ms/1000).toFixed(2) }} 秒</span><el-button v-if="results.length>1&&r.records.length" :type="r===selected?'primary':undefined" size="small" @click="select(r)">{{ r===selected?'正在核对':'使用此结果' }}</el-button><el-button v-if="r.error" size="small" @click="recognize">重试</el-button></div><p v-if="r.error" class="error-text">{{ r.error }}</p><p v-for="(w,i) in r.warnings" :key="i" class="ai-warning">{{ w }}</p></div>
      <template v-if="selected&&rows[rowIndex]">
       <div v-if="rows.length>1" class="ai-row-switch"><span>逐条核对</span><el-select v-model="rowIndex" aria-label="核对第几条记录" style="width:140px"><el-option v-for="(_,i) in rows" :key="i" :label="`第 ${i+1} 条`" :value="i"/></el-select></div>
       <el-form label-position="top" class="ai-fields" :disabled="saving"><el-form-item v-for="f in writableFields" :key="f.key" :label="f.name" :required="f.required"><el-select v-if="['select','multiselect'].includes(f.type)" v-model="rows[rowIndex][f.key]" :multiple="f.type==='multiselect'" clearable style="width:100%"><el-option v-for="o in f.options" :key="o.id" :label="o.name" :value="o.id"/></el-select><el-date-picker v-else-if="f.type==='date'" v-model="rows[rowIndex][f.key]" type="date" value-format="YYYY-MM-DD" style="width:100%"/><el-switch v-else-if="f.type==='checkbox'" v-model="rows[rowIndex][f.key]"/><el-input v-else v-model="rows[rowIndex][f.key]" :type="f.type==='long_text'?'textarea':'text'" :rows="2"/></el-form-item></el-form>
      </template>
      <el-collapse v-if="selected?.raw_text" class="ai-raw"><el-collapse-item title="原始识别文本"><pre>{{ selected.raw_text }}</pre></el-collapse-item></el-collapse>
     </template>
     <el-button v-if="error&&file&&!busy" :icon="Refresh" @click="recognize">重新识别</el-button>
    </div>
   </section>
  </div>
  <template #footer><div class="ai-footer"><span class="ai-shortcuts"><kbd>Ctrl / ⌘ + V</kbd> 粘贴截图 <i>·</i> <kbd>Ctrl / ⌘ + Enter</kbd> 确认 <i>·</i> <kbd>Esc</kbd> 关闭</span><div><el-button :disabled="saving" @click="close()">取消</el-button><el-button type="primary" :icon="Check" :loading="saving" :disabled="!selected||!rows.length||busy" @click="confirm">{{ rows.length?`确认新增 ${rows.length} 条记录`:'确认新增' }}</el-button></div></div></template>
 </el-dialog>
</template>
<script setup lang="ts">
import {computed,ref,watch,onUnmounted} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
import {Picture,UploadFilled,InfoFilled,Collection,Check,Refresh} from '@/icons'
const props=defineProps<{modelValue:boolean;tableId:number}>(),emit=defineEmits<{ 'update:modelValue':[boolean];saved:[] }>()
const file=ref<File>(),filename=ref(''),preview=ref(''),model=ref('glm-4v-flash'),compare=ref(false),busy=ref(false),saving=ref(false),error=ref(''),results=ref<any[]>([]),selected=ref<any>(),rows=ref<Record<string,any>[]>([]),rowIndex=ref(0),fields=ref<any[]>([])
const modelName=computed(()=>model.value==='glm-ocr'?'GLM-OCR':'GLM-4V-Flash')
const writableFields=computed(()=>fields.value.filter(f=>['short_text','long_text','number','date','select','multiselect','checkbox','url'].includes(f.type)))
let controller:AbortController|undefined,sequence=0,closing=false
let edited:Record<string,Record<string,any>[]>= {},configReady:Promise<void>=Promise.resolve()
async function init(){try{const {data}=await http.get('/ai/config');if(!props.modelValue)return;model.value=data.default_model;compare.value=!!data.compare_models;if(!data.configured)error.value='请先在设置 → AI 图片填表中配置 API Key'}catch(e){if(props.modelValue)error.value=apiError(e).message}}
function choose(upload:any){void setFile(upload.raw)}
async function setFile(value:File){if(saving.value)return;if(!value||!['image/png','image/jpeg'].includes(value.type)||value.size>8*1024*1024){ElMessage.warning('请选择最大 8 MB 的 PNG/JPG 图片');return}file.value=value;filename.value=value.name;if(preview.value)URL.revokeObjectURL(preview.value);preview.value=URL.createObjectURL(value);void recognize()}
function paste(e:ClipboardEvent){if(!props.modelValue||saving.value||document.querySelector('.el-message-box'))return;for(const item of Array.from(e.clipboardData?.items||[])){if(item.type.startsWith('image/')){const value=item.getAsFile();if(value){e.preventDefault();e.stopImmediatePropagation();void setFile(value);break}}}}
function hotkey(e:KeyboardEvent){
 if(!props.modelValue||e.isComposing||document.querySelector('.el-message-box'))return
 const primary=e.ctrlKey||e.metaKey,key=e.key.toLowerCase()
 if(key==='escape'){e.preventDefault();e.stopImmediatePropagation();void close();return}
 if(primary){e.stopImmediatePropagation();if(key==='enter'){e.preventDefault();if(!busy.value)void confirm()}else if(['k','s','p'].includes(key))e.preventDefault()}
}
async function recognize(){
 const image=file.value;if(!image||saving.value)return
 const run=++sequence;controller?.abort();const current=new AbortController();controller=current;busy.value=true;error.value='';results.value=[];selected.value=undefined;rows.value=[];edited={}
 try{await configReady;if(run!==sequence||!props.modelValue)return;const form=new FormData();form.append('image',image);form.append('model',model.value);form.append('compare',String(compare.value));const {data}=await http.post(`/tables/${props.tableId}/ai/extract`,form,{timeout:120000,signal:current.signal});if(run!==sequence||!props.modelValue)return;fields.value=data.fields;results.value=data.results;const valid=data.results.find((r:any)=>r.records.length);if(valid)select(valid)}catch(e){if(!current.signal.aborted&&run===sequence)error.value=apiError(e).message}finally{if(run===sequence)busy.value=false}
}
function select(result:any){selected.value=result;rows.value=edited[result.draft_id] ||= JSON.parse(JSON.stringify(result.records));rowIndex.value=0}
async function confirm(){if(!selected.value||saving.value||busy.value||!rows.value.length)return;saving.value=true;error.value='';try{const {data}=await http.post(`/tables/${props.tableId}/ai/drafts/${selected.value.draft_id}/confirm`,{records:rows.value});ElMessage.success(`已新增 ${data.record_ids.length} 条记录`);emit('saved');reset();emit('update:modelValue',false)}catch(e){error.value=apiError(e).message}finally{saving.value=false}}
function reset(){sequence++;edited={};controller?.abort();busy.value=false;if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';file.value=undefined;filename.value='';results.value=[];selected.value=undefined;rows.value=[];error.value=''}
async function close(done?:()=>void){if(saving.value||closing)return;closing=true;try{if(selected.value){try{await ElMessageBox.confirm('识别结果尚未写入，关闭后可重新识别。','关闭识别结果',{confirmButtonText:'关闭',cancelButtonText:'继续核对'})}catch{return}}reset();emit('update:modelValue',false);done?.()}finally{closing=false}}
function listeners(open:boolean){window.removeEventListener('paste',paste,true);window.removeEventListener('keydown',hotkey,true);if(open){window.addEventListener('paste',paste,true);window.addEventListener('keydown',hotkey,true)}}
watch(()=>props.modelValue,open=>{listeners(open);if(open)configReady=init();else reset()},{immediate:true,flush:'sync'})
onUnmounted(()=>{listeners(false);reset()})
</script>
<style scoped>
.ai-heading{display:flex;align-items:center;gap:12px}.ai-heading strong{font-size:19px}.ai-heading p{margin:5px 0 0;color:var(--wb-text-secondary);font-size:13px}.ai-heading-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--el-color-primary-light-9);color:var(--wb-primary);font-size:23px}
.ai-workspace{display:grid;grid-template-columns:minmax(240px,40%) minmax(0,1fr);height:min(62vh,620px);min-height:min(360px,45dvh);border:1px solid var(--wb-border);border-radius:12px;overflow:hidden}.ai-source,.ai-output{display:flex;flex-direction:column;min-width:0;min-height:0}.ai-source{background:var(--wb-surface-subtle);border-right:1px solid var(--wb-border);padding:16px}.ai-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;margin-bottom:12px;font-size:14px}.ai-model{font-size:11px;font-weight:600;background:var(--wb-surface);padding:3px 8px;border:1px solid var(--wb-border);border-radius:5px;white-space:nowrap}.ai-uploader{flex:1;min-height:0;overflow:hidden}.ai-uploader :deep(.el-upload){height:100%;width:100%}.ai-uploader :deep(.el-upload-dragger){height:100%;display:flex;align-items:center;justify-content:center;padding:16px;border-radius:9px;background:var(--wb-surface);overflow:auto}.ai-uploader.has-image :deep(.el-upload-dragger){border-style:solid}.ai-preview{width:100%;height:100%;object-fit:contain}.ai-upload-prompt{text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--wb-text-secondary)}.ai-upload-icon{display:grid;place-items:center;background:var(--el-color-primary-light-9);color:var(--wb-primary);width:64px;height:64px;border-radius:18px;font-size:32px}.ai-upload-prompt h3{font-size:17px;margin:8px 0 0;color:var(--wb-text)}.ai-upload-prompt p{margin:0}.ai-upload-prompt small{color:var(--wb-text-secondary)}kbd{font-family:inherit;font-size:11px;border:1px solid var(--wb-border);border-radius:4px;padding:2px 5px;background:var(--wb-surface);white-space:nowrap}.ai-source-foot{display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:12px;margin-top:12px}.ai-filename{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ai-source-foot .secondary{flex:none}.ai-privacy{font-size:11px;line-height:1.6;color:var(--wb-text-secondary);display:flex;gap:5px;margin:10px 0 0}.ai-privacy .el-icon{flex:none;margin-top:3px}
.ai-output{padding:16px 20px;background:var(--wb-surface)}.ai-output-scroll{flex:1;min-height:0;overflow:auto;padding:0 2px}.ai-ready{font-size:12px;color:var(--wb-primary);display:flex;align-items:center;gap:4px}.ai-empty,.ai-loading{height:100%;min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--wb-text-secondary)}.ai-empty>.el-icon,.ai-loading>.el-icon{font-size:38px;color:var(--wb-primary);opacity:.65}.ai-empty h3,.ai-loading h3{font-size:16px;font-weight:600;color:var(--wb-text);margin:20px 0 0}.ai-empty p,.ai-loading p{font-size:13px}.ai-empty>div{display:flex;gap:16px;margin-top:18px;font-size:12px}.ai-loading .el-skeleton{margin-top:24px;padding:0 25px;text-align:left}.ai-result-summary{border:1px solid var(--wb-border);padding:10px 12px;border-radius:8px;margin-bottom:12px}.ai-result-line{display:flex;align-items:center;gap:12px;font-size:12px}.ai-result-line .el-button{margin-left:auto}.ai-result-summary.selected{border-color:var(--el-color-primary-light-5);background:var(--el-color-primary-light-9)}.ai-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.ai-fields :deep(.el-form-item){margin-bottom:16px}.ai-row-switch{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.ai-warning{font-size:12px;margin:8px 0 0;color:var(--wb-text-secondary)}.ai-raw{margin-top:6px}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}.error-text{color:var(--el-color-danger)}.ai-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.ai-shortcuts{font-size:11px;color:var(--wb-text-secondary)}.ai-shortcuts i{font-style:normal;margin:0 6px}
@media(max-width:760px){.ai-workspace{grid-template-columns:1fr;height:65vh;min-height:min(350px,45dvh);overflow:auto}.ai-source{height:260px;border-right:0;border-bottom:1px solid var(--wb-border)}.ai-output{min-height:300px;overflow:visible}.ai-output-scroll{overflow:visible}.ai-shortcuts{display:none}.ai-footer{justify-content:flex-end}.ai-fields{grid-template-columns:1fr}.ai-heading p{font-size:12px}}
</style>