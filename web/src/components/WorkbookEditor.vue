<template>
 <div class="workbook-page">
  <Teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget">
   <div v-show="toolbarActive !== false" class="workbook-toolbar" :class="{compact:!!toolbarTarget}">
    <span class="save-state text-12" :class="{error:!!failure}" :title="failure || '自动保存 · Ctrl / ⌘ + S 立即保存'">{{ failure || (saving?'正在保存…':loading?'正在加载…':dirty?'待保存':'已保存') }}</span>
    <el-button v-if="failure" size="small" :loading="saving" @click="commitAndSave">重试保存</el-button>
    <el-dropdown trigger="click" @command="importCommand"><el-button text size="small" :disabled="loading||saving||!ready">导入 ⌄</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="excel">导入 Excel</el-dropdown-item><el-dropdown-item command="json">导入备份</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
    <el-dropdown trigger="click" @command="exportCommand"><el-button text size="small" :disabled="loading||!ready">导出 ⌄</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="excel">导出 Excel</el-dropdown-item><el-dropdown-item command="csv">导出 CSV</el-dropdown-item><el-dropdown-item command="json">导出备份</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
    <el-dropdown trigger="click" @command="moreCommand"><el-button text size="small" :disabled="loading||!ready">更多 ⌄</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="save">立即保存 · Ctrl / ⌘ + S</el-dropdown-item><el-dropdown-item command="save-as">另存为… · F12</el-dropdown-item><el-dropdown-item command="print">打印当前工作表 · Ctrl / ⌘ + P</el-dropdown-item><el-dropdown-item command="find" divided>查找 · Ctrl / ⌘ + F</el-dropdown-item><el-dropdown-item command="replace">替换 · Ctrl / ⌘ + H</el-dropdown-item><el-dropdown-item command="link">插入超链接 · Ctrl / ⌘ + K</el-dropdown-item><el-dropdown-item command="reload" divided>重新载入</el-dropdown-item><el-dropdown-item command="close">关闭工作簿</el-dropdown-item><el-dropdown-item command="source" divided>复制原表快照</el-dropdown-item><el-dropdown-item command="help" divided>使用说明</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
   </div>
  </Teleport>
  <div v-if="loading" class="empty-hint">正在打开电子表格…</div><div ref="host" tabindex="-1" class="univer-host" :class="{ready:!loading}" />
  <input ref="excelInput" type="file" accept=".xlsx" hidden @change="importExcel"/>
  <input ref="jsonInput" type="file" accept=".json,application/json" hidden @change="importJSON"/>
  <el-dialog v-model="recoveryOpen" title="发现本机未保存的工作簿" width="480px" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false"><p>上次未成功保存的内容仍在本机。请选择要继续编辑的版本，服务器内容暂不修改。</p><template #footer><el-button @click="resolveRecovery(false)">使用服务器版本</el-button><el-button type="primary" @click="resolveRecovery(true)">恢复本机内容</el-button></template></el-dialog>
 </div>
</template>
<script setup lang="ts">
import { randomId } from '@/utils/random-id'

import {nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import Decimal from 'decimal.js'
import {ElMessage,ElMessageBox} from 'element-plus'
import {IUniverInstanceService} from '@univerjs/core'
import {createUniver,LocaleType,mergeLocales} from '@univerjs/presets'
import {UniverSheetsCorePreset} from '@univerjs/preset-sheets-core'
import CoreLocale from '@univerjs/preset-sheets-core/locales/zh-CN'
import {UniverSheetsFilterPreset} from '@univerjs/preset-sheets-filter'
import FilterLocale from '@univerjs/preset-sheets-filter/locales/zh-CN'
import {UniverSheetsSortPreset} from '@univerjs/preset-sheets-sort'
import SortLocale from '@univerjs/preset-sheets-sort/locales/zh-CN'
import {UniverSheetsConditionalFormattingPreset} from '@univerjs/preset-sheets-conditional-formatting'
import ConditionalLocale from '@univerjs/preset-sheets-conditional-formatting/locales/zh-CN'
import {UniverSheetsDataValidationPreset} from '@univerjs/preset-sheets-data-validation'
import ValidationLocale from '@univerjs/preset-sheets-data-validation/locales/zh-CN'
import {SheetsFindReplaceController,UniverSheetsFindReplacePreset} from '@univerjs/preset-sheets-find-replace'
import FindLocale from '@univerjs/preset-sheets-find-replace/locales/zh-CN'
import {OpenFindDialogOperation,OpenReplaceDialogOperation} from '@univerjs/find-replace'
import {UniverSheetsHyperLinkPreset,InsertHyperLinkOperation} from '@univerjs/preset-sheets-hyper-link'
import HyperLinkLocale from '@univerjs/preset-sheets-hyper-link/locales/zh-CN'
import '@univerjs/preset-sheets-hyper-link/lib/index.css'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import {http,apiError} from '@/api/client'
import {csvCell,display,toTSV,type Field,type Row} from '@/table-core'
import {session} from '@/stores/session'
const props=defineProps<{tableId:number;name:string;fields:Field[];rows:Row[];references:Record<string,any[]>;toolbarTarget?:string;toolbarActive?:boolean}>()
const emit=defineEmits<{(e:'dirty',value:boolean):void;(e:'close'):void}>()
const host=ref<HTMLElement>(),jsonInput=ref<HTMLInputElement>(),excelInput=ref<HTMLInputElement>(),loading=ref(true),dirty=ref(false),saving=ref(false),failure=ref(''),recoveryOpen=ref(false),ready=ref(false)
let univer:any,api:any,workbook:any,version=0,timer:number|undefined,revision=0,active=true,job:Promise<boolean>|null=null,listener:any,recovery:any=null,recoveryResolve:((s:any)=>void)|null=null,lastHash=''
const recoveryKey=`workbench:${session.user?.id}:${props.tableId}`
async function recoveryStore(value?:any,remove=false):Promise<any>{return new Promise((resolve,reject)=>{const open=indexedDB.open('workbench-workbook-recovery',1);open.onupgradeneeded=()=>open.result.createObjectStore('workbooks');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('workbooks',value!==undefined||remove?'readwrite':'readonly'),store=tx.objectStore('workbooks'),r=remove?store.delete(recoveryKey):value!==undefined?store.put(value,recoveryKey):store.get(recoveryKey);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close()}})}
function seed(){if(props.rows.length*Math.max(1,props.fields.length)>100000)throw new Error('原表超过 100000 个单元格，无法整体复制到工作簿');const cellData:any={0:Object.fromEntries(props.fields.map((f,c)=>[c,{v:f.name}]))};props.rows.forEach((r,i)=>{const cells:any={};props.fields.forEach((f,c)=>{const v=r.data[f.key];if(v==null)return;cells[c]=f.type==='number'&&new Decimal(v).sd()<=15?{v:Number(v),t:2}:{v:display(f,v,props.references),t:1}});cellData[i+1]=cells});const id='sheet-'+randomId();return {id:'workbook-'+randomId(),name:props.name,locale:LocaleType.ZH_CN,sheetOrder:[id],sheets:{[id]:{id,name:'原表快照',rowCount:Math.max(1000,props.rows.length+100),columnCount:Math.max(26,props.fields.length),cellData}}}}
function download(value:string,name:string,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function importCommand(command:string){if(command==='excel')excelInput.value?.click();else jsonInput.value?.click()}
function exportCommand(command:string){if(command==='excel')void exportExcel();else if(command==='csv')exportCSV();else exportJSON()}
function moreCommand(command:string){if(command==='save')void commitAndSave();else if(command==='save-as')void saveAsWorkbook();else if(command==='print')void printWorkbook();else if(['find','replace','link'].includes(command))void editorCommand(command);else if(command==='close')void closeWorkbook();else if(command==='reload')void reloadServer();else if(command==='source')void copySource();else void ElMessageBox.alert('Ctrl / ⌘ + S 保存；Ctrl + Z / Y 撤销和重做；Ctrl + A / C / X / V 使用编辑器原生选择和剪贴板；Ctrl / ⌘ + F / H / K 查找、替换和超链接。F12 另存为 Excel，Ctrl / ⌘ + P 打印当前工作表。浏览器可能保留 F12、Ctrl + W 等按键，届时使用“更多”菜单中的另存为或关闭工作簿。','工作簿快捷键',{confirmButtonText:'知道了'})}
async function finishCellEdit(){return !workbook?.isCellEditing?.()||await workbook.endEditingAsync(true)}
function focusWorkbook(){if(univer&&workbook&&props.toolbarActive!==false){host.value?.focus({preventScroll:true});univer.__getInjector().get(IUniverInstanceService).focusUnit(workbook.getId())}}
async function editorCommand(command:string){try{if(!await finishCellEdit())return;
 // The preset normally creates its provider at the delayed Steady lifecycle.
 // Initialize that singleton on demand so the very first shortcut also works.
 if(command==='find'||command==='replace')univer.__getInjector().get(SheetsFindReplaceController)
 focusWorkbook();await api.executeCommand(command==='find'?OpenFindDialogOperation.id:command==='replace'?OpenReplaceDialogOperation.id:InsertHyperLinkOperation.id)
 }catch(e:any){ElMessage.error(e.message||'操作失败')}}
async function closeWorkbook(){if(await commitAndSave())emit('close')}
async function saveAsWorkbook(){try{if(!await finishCellEdit())return;const {value}=await ElMessageBox.prompt('下载为独立的 Excel 文件，工作台内容保留。','另存为',{inputValue:props.name,inputPlaceholder:'文件名',inputValidator:(v:string)=>!!v.trim()&&!/[\\/:*?"<>|\x00-\x1f]/.test(v)||'请输入有效的文件名',confirmButtonText:'下载 Excel',cancelButtonText:'取消'});await exportExcel(value.trim().replace(/\.xlsx$/i,'')+'.xlsx')}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(e.message||'另存为失败')}}
let printFrame:HTMLIFrameElement|null=null
function escapeHtml(value:any){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
async function printWorkbook(){try{if(!await finishCellEdit())return;const sheet=workbook.getActiveSheet(),range=sheet.getDataRange();if(range.getHeight()*range.getWidth()>100000)throw new Error('打印范围超过 10 万格，请缩小工作表范围后重试');const data=range.getDisplayValues();printFrame?.remove();const frame=document.createElement('iframe');printFrame=frame;frame.title='工作簿打印';frame.style.cssText='position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0';document.body.appendChild(frame);const doc=frame.contentDocument!;doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"><title>'+escapeHtml(props.name)+'</title><style>@page{size:A4 landscape;margin:12mm}body{font:10pt Arial,sans-serif;color:#222}h1{font-size:14pt}table{border-collapse:collapse;width:100%}td{border:1px solid #bbb;padding:4px;white-space:pre-wrap;overflow-wrap:anywhere}tr{break-inside:avoid}</style></head><body><h1>'+escapeHtml(props.name)+' / '+escapeHtml(sheet.getSheetName())+'</h1><table><tbody>'+data.map((row:any[])=>'<tr>'+row.map(v=>'<td>'+escapeHtml(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></body></html>');doc.close();await new Promise(resolve=>setTimeout(resolve,100));frame.contentWindow?.addEventListener('afterprint',()=>{frame.remove();if(printFrame===frame)printFrame=null},{once:true});frame.contentWindow?.focus();frame.contentWindow?.print()}catch(e:any){printFrame?.remove();printFrame=null;ElMessage.error(e.message||'打印失败')}}

let explicitSave:Promise<boolean>|null=null
function commitAndSave():Promise<boolean>{
 if(explicitSave)return explicitSave
 explicitSave=(async()=>{try{
  if(!ready.value||loading.value||!workbook)return !loading.value&&!dirty.value
  if(workbook.isCellEditing?.()&&!await workbook.endEditingAsync(true))return false
  return await save()
 }catch(e:any){failure.value=e.message||apiError(e).message;return false}})().finally(()=>{explicitSave=null})
 return explicitSave
}
function onWorkbookShortcut(e:KeyboardEvent){
 if(!active||props.toolbarActive===false||e.isComposing||e.altKey||e.shiftKey)return
 const key=e.key.toLowerCase(),primary=e.ctrlKey||e.metaKey
 const command=key==='f12'&&!primary?'save-as':primary?({s:'save',p:'print',w:'close',f:'find',h:'replace',k:'link'} as Record<string,string>)[key]:undefined
 if(!command)return
 if(Array.from(document.querySelectorAll('[role="dialog"]')).some(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'))return
 e.preventDefault();e.stopPropagation()
 if(!ready.value||loading.value)return
 moreCommand(command)
}

function snapshot(){return workbook?.save()}
function changed(){if(!active)return;revision++;dirty.value=true;emit('dirty',true);window.clearTimeout(timer);timer=window.setTimeout(()=>void save(),1200)}
async function save():Promise<boolean>{window.clearTimeout(timer);if(!workbook)return !dirty.value;if(loading.value)return false;if(job){await job;if(failure.value)return false}const data=snapshot(),hash=JSON.stringify(data);if(hash===lastHash){dirty.value=false;emit('dirty',false);return true}const at=revision;saving.value=true
 job=(async()=>{try{try{await recoveryStore({snapshot:data,version,savedAt:Date.now()})}catch{}const response=await http.put(`/tables/${props.tableId}/workbook`,{version,snapshot:data});version=response.data.version;lastHash=hash;failure.value='';if(revision===at){dirty.value=false;emit('dirty',false);try{await recoveryStore(undefined,true)}catch{}}return true}catch(e:any){failure.value=apiError(e).message;dirty.value=true;emit('dirty',true);return false}finally{saving.value=false;job=null}})()
 const result=await job;if(result&&revision!==at&&active)return save();return result
}
async function replace(data:any){listener?.dispose();if(workbook)api.disposeUnit(workbook.getId());workbook=api.createWorkbook(data);ready.value=true;focusWorkbook();listener=workbook.onCommandExecuted(()=>changed())}
async function copySource(){try{await ElMessageBox.confirm('用原表当前数据替换工作簿？工作簿内已有内容将被替换，原表保持不变。','复制原表快照',{confirmButtonText:'替换',cancelButtonText:'取消'});const data=seed();await replace(data);changed();await save()}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(e.message||apiError(e).message)}}
function exportJSON(){download(JSON.stringify(snapshot()),`${props.name}.workbook.json`)}
function exportCSV(){if(!workbook)return;const s=snapshot(),sheet=s.sheets[s.sheetOrder[0]],data=sheet.cellData||{},ri=Object.keys(data).map(Number);const maxRow=Math.max(0,...ri),maxCol=Math.max(0,...Object.values(data).flatMap((r:any)=>Object.keys(r).map(Number)));if((maxRow+1)*(maxCol+1)>1000000){ElMessage.error('CSV 导出范围超过 100 万格，请缩小数据范围或导出 Excel / 备份');return}const values=Array.from({length:maxRow+1},(_,r)=>Array.from({length:maxCol+1},(_,c)=>data[r]?.[c]?.v??''));const csv=values.map(row=>row.map(csvCell).join(',')).join('\r\n');download('\ufeff'+csv,`${props.name}.csv`,'text/csv;charset=utf-8')}
async function importJSON(e:Event){const input=e.target as HTMLInputElement,file=input.files?.[0];try{if(!file)return;if(file.size>10000000)throw new Error('备份文件最大 10MB');const data=JSON.parse(await file.text());if(!data.sheets||!Array.isArray(data.sheetOrder))throw new Error('不是工作簿备份文件');await http.post(`/tables/${props.tableId}/workbook/validate`,{version,snapshot:data});await ElMessageBox.confirm('导入后会替换当前工作簿，原表保持不变。','导入备份',{confirmButtonText:'导入',cancelButtonText:'取消'});await replace(data);changed();await save()}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(e.message||'导入失败')}finally{input.value=''}}
async function reloadServer(){try{if(dirty.value)await ElMessageBox.confirm('未保存的工作簿改动将被放弃，可先导出备份。是否载入服务器版本？','重新载入工作簿',{confirmButtonText:'放弃并载入',cancelButtonText:'取消'});window.clearTimeout(timer);if(job)await job;const {data}=await http.get(`/tables/${props.tableId}/workbook`);version=data.version;await replace(data.snapshot||seed());lastHash=JSON.stringify(snapshot());failure.value='';dirty.value=false;emit('dirty',false);try{await recoveryStore(undefined,true)}catch{}}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}}
async function importExcel(e:Event){const input=e.target as HTMLInputElement,file=input.files?.[0];try{if(!file)return;const body=new FormData();body.append('file',file);loading.value=true;const {data}=await http.post(`/imports/workbook/${props.tableId}`,body);loading.value=false;await ElMessageBox.confirm(`${data.sheets} 张工作表，${data.cells} 个单元格。${data.notice} 导入后将替换当前工作簿，原表保持不变。`,'导入 Excel',{confirmButtonText:'导入工作簿',cancelButtonText:'取消'});await replace(data.snapshot);changed();await save()}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}finally{loading.value=false;input.value=''}}
async function exportExcel(filename?:string){try{const {data}=await http.post(`/tables/${props.tableId}/workbook/export`,{snapshot:snapshot()},{responseType:'blob'});const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=filename||props.name+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e:any){ElMessage.error('Excel 导出失败，可导出 JSON 备份保留完整内容')}}
function resolveRecovery(useLocal:boolean){recoveryOpen.value=false;recoveryResolve?.(useLocal?recovery.snapshot:null);recoveryResolve=null;if(!useLocal)void recoveryStore(undefined,true)}
function beforeUnload(e:BeforeUnloadEvent){if(dirty.value){e.preventDefault();e.returnValue=''}}
onMounted(async()=>{window.addEventListener('keydown',onWorkbookShortcut,true);try{const response=await http.get(`/tables/${props.tableId}/workbook`);version=response.data.version;let initial=response.data.snapshot
 try{recovery=await recoveryStore()}catch{}
 if(recovery?.snapshot&&JSON.stringify(recovery.snapshot)!==JSON.stringify(initial)){recoveryOpen.value=true;const local=await new Promise(resolve=>recoveryResolve=resolve);if(local)initial=local}
 if(!active)return
 const instance=createUniver({locale:LocaleType.ZH_CN,locales:{[LocaleType.ZH_CN]:mergeLocales(CoreLocale,FilterLocale,SortLocale,ConditionalLocale,ValidationLocale,FindLocale,HyperLinkLocale)},presets:[UniverSheetsCorePreset({container:host.value!,disableAutoFocus:true}),UniverSheetsFilterPreset(),UniverSheetsSortPreset(),UniverSheetsConditionalFormattingPreset(),UniverSheetsDataValidationPreset(),UniverSheetsFindReplacePreset(),UniverSheetsHyperLinkPreset()]})
 univer=instance.univer;api=instance.univerAPI;api.toggleDarkMode(session.theme==='dark')
 if(!initial){try{initial=seed()}catch{const id='sheet1';initial={id:randomId(),name:props.name,sheetOrder:[id],sheets:{[id]:{id,name:'Sheet1',rowCount:1000,columnCount:26,cellData:{}}}}}}
 await replace(initial);lastHash=response.data.snapshot?JSON.stringify(response.data.snapshot):'';loading.value=false;await nextTick();focusWorkbook()
 if(JSON.stringify(initial)!==lastHash)changed();window.addEventListener('beforeunload',beforeUnload)
 }catch(e:any){failure.value=e.message||apiError(e).message;loading.value=false}})
watch(()=>props.toolbarActive,async value=>{if(value!==false){await nextTick();focusWorkbook()}else if(univer&&workbook){const units=univer.__getInjector().get(IUniverInstanceService);if(units.getFocusedUnit()?.getUnitId()===workbook.getId())units.focusUnit(null)}})
watch(()=>session.theme,value=>api?.toggleDarkMode(value==='dark'))
onUnmounted(()=>{printFrame?.remove();printFrame=null;window.removeEventListener('keydown',onWorkbookShortcut,true);active=false;window.clearTimeout(timer);window.removeEventListener('beforeunload',beforeUnload);listener?.dispose();univer?.dispose();recoveryResolve?.(null)})
defineExpose({flush:commitAndSave,dirty,snapshot})
</script>
<style scoped>
.workbook-page{height:100%;display:flex;flex-direction:column;min-height:400px}.workbook-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--wb-border);flex-wrap:wrap}.univer-host{flex:1;min-height:350px;visibility:hidden;overflow:hidden}.univer-host.ready{visibility:visible}.error{color:var(--el-color-danger);max-width:300px}.workbook-page :deep(.univer-app){height:100%}
</style>

<style scoped>
.workbook-toolbar.compact{padding:0;border:0;gap:8px;flex-wrap:nowrap;min-width:0}.workbook-toolbar.compact :deep(.el-button+.el-button){margin-left:0}.save-state{color:var(--wb-text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}.save-state.error{color:var(--el-color-danger)}.workbook-page{flex:1;min-height:0}.univer-host{min-height:0}.workbook-toolbar.compact :deep(.el-button){padding-left:7px;padding-right:7px}@media(max-width:700px){.workbook-toolbar.compact{gap:2px}.save-state{max-width:100px}.workbook-toolbar.compact :deep(.el-button){padding-left:4px;padding-right:4px}}
</style>
