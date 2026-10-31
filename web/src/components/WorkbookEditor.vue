<template>
 <div class="workbook-page">
  <div class="workbook-toolbar"><span class="text-12 secondary">独立工作簿 · 修改不会写回原表</span><span class="spacer"/><span class="text-12" :class="{error:!!failure}">{{ failure || (saving?'正在保存…':dirty?'有未保存修改':'已保存') }}</span><el-button size="small" :loading="saving" @click="save">保存</el-button><el-button size="small" @click="reloadServer">重新载入</el-button><el-button size="small" @click="exportExcel">导出 Excel</el-button><el-button size="small" @click="excelInput?.click()">导入 Excel</el-button><el-button size="small" @click="exportJSON">导出备份</el-button><el-button size="small" @click="exportCSV">导出 CSV</el-button><el-button size="small" @click="jsonInput?.click()">导入备份</el-button><el-button size="small" @click="copySource">复制原表快照</el-button></div>
  <div v-if="loading" class="empty-hint">正在打开电子表格…</div><div ref="host" class="univer-host" :class="{ready:!loading}" />
  <input ref="excelInput" type="file" accept=".xlsx" hidden @change="importExcel"/>
  <input ref="jsonInput" type="file" accept=".json,application/json" hidden @change="importJSON"/>
  <el-dialog v-model="recoveryOpen" title="发现本机未保存的工作簿" width="480px" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false"><p>上次未成功保存的内容仍在本机。请选择要继续编辑的版本，服务器内容暂不修改。</p><template #footer><el-button @click="resolveRecovery(false)">使用服务器版本</el-button><el-button type="primary" @click="resolveRecovery(true)">恢复本机内容</el-button></template></el-dialog>
 </div>
</template>
<script setup lang="ts">
import { randomId } from '@/utils/random-id'

import {onMounted,onUnmounted,ref,watch} from 'vue'
import Decimal from 'decimal.js'
import {ElMessage,ElMessageBox} from 'element-plus'
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
import {UniverSheetsFindReplacePreset} from '@univerjs/preset-sheets-find-replace'
import FindLocale from '@univerjs/preset-sheets-find-replace/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import {http,apiError} from '@/api/client'
import {csvCell,display,toTSV,type Field,type Row} from '@/table-core'
import {session} from '@/stores/session'
const props=defineProps<{tableId:number;name:string;fields:Field[];rows:Row[];references:Record<string,any[]>}>()
const emit=defineEmits<{(e:'dirty',value:boolean):void}>()
const host=ref<HTMLElement>(),jsonInput=ref<HTMLInputElement>(),excelInput=ref<HTMLInputElement>(),loading=ref(true),dirty=ref(false),saving=ref(false),failure=ref(''),recoveryOpen=ref(false)
let univer:any,api:any,workbook:any,version=0,timer:number|undefined,revision=0,active=true,job:Promise<boolean>|null=null,listener:any,recovery:any=null,recoveryResolve:((s:any)=>void)|null=null,lastHash=''
const recoveryKey=`workbench:${session.user?.id}:${props.tableId}`
async function recoveryStore(value?:any,remove=false):Promise<any>{return new Promise((resolve,reject)=>{const open=indexedDB.open('workbench-workbook-recovery',1);open.onupgradeneeded=()=>open.result.createObjectStore('workbooks');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('workbooks',value!==undefined||remove?'readwrite':'readonly'),store=tx.objectStore('workbooks'),r=remove?store.delete(recoveryKey):value!==undefined?store.put(value,recoveryKey):store.get(recoveryKey);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close()}})}
function seed(){if(props.rows.length*Math.max(1,props.fields.length)>100000)throw new Error('原表超过 100000 个单元格，无法整体复制到工作簿');const cellData:any={0:Object.fromEntries(props.fields.map((f,c)=>[c,{v:f.name}]))};props.rows.forEach((r,i)=>{const cells:any={};props.fields.forEach((f,c)=>{const v=r.data[f.key];if(v==null)return;cells[c]=f.type==='number'&&new Decimal(v).sd()<=15?{v:Number(v),t:2}:{v:display(f,v,props.references),t:1}});cellData[i+1]=cells});const id='sheet-'+randomId();return {id:'workbook-'+randomId(),name:props.name,locale:LocaleType.ZH_CN,sheetOrder:[id],sheets:{[id]:{id,name:'原表快照',rowCount:Math.max(1000,props.rows.length+100),columnCount:Math.max(26,props.fields.length),cellData}}}}
function download(value:string,name:string,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function snapshot(){return workbook?.save()}
function changed(){if(!active)return;revision++;dirty.value=true;emit('dirty',true);window.clearTimeout(timer);timer=window.setTimeout(()=>void save(),1200)}
async function save():Promise<boolean>{window.clearTimeout(timer);if(!workbook)return !dirty.value;if(loading.value)return false;if(job){await job;if(failure.value)return false}const data=snapshot(),hash=JSON.stringify(data);if(hash===lastHash){dirty.value=false;emit('dirty',false);return true}const at=revision;saving.value=true
 job=(async()=>{try{try{await recoveryStore({snapshot:data,version,savedAt:Date.now()})}catch{}const response=await http.put(`/tables/${props.tableId}/workbook`,{version,snapshot:data});version=response.data.version;lastHash=hash;failure.value='';if(revision===at){dirty.value=false;emit('dirty',false);try{await recoveryStore(undefined,true)}catch{}}return true}catch(e:any){failure.value=apiError(e).message;dirty.value=true;emit('dirty',true);return false}finally{saving.value=false;job=null}})()
 const result=await job;if(result&&revision!==at&&active)return save();return result
}
async function replace(data:any){listener?.dispose();if(workbook)api.disposeUnit(workbook.getId());workbook=api.createWorkbook(data);listener=workbook.onCommandExecuted(()=>changed())}
async function copySource(){try{await ElMessageBox.confirm('用原表当前数据替换工作簿？工作簿内已有内容将被替换，原表保持不变。','复制原表快照',{confirmButtonText:'替换',cancelButtonText:'取消'});const data=seed();await replace(data);changed();await save()}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(e.message||apiError(e).message)}}
function exportJSON(){download(JSON.stringify(snapshot()),`${props.name}.workbook.json`)}
function exportCSV(){if(!workbook)return;const s=snapshot(),sheet=s.sheets[s.sheetOrder[0]],data=sheet.cellData||{},ri=Object.keys(data).map(Number);const maxRow=Math.max(0,...ri),maxCol=Math.max(0,...Object.values(data).flatMap((r:any)=>Object.keys(r).map(Number)));if((maxRow+1)*(maxCol+1)>1000000){ElMessage.error('CSV 导出范围超过 100 万格，请缩小数据范围或导出 Excel / 备份');return}const values=Array.from({length:maxRow+1},(_,r)=>Array.from({length:maxCol+1},(_,c)=>data[r]?.[c]?.v??''));const csv=values.map(row=>row.map(csvCell).join(',')).join('\r\n');download('\ufeff'+csv,`${props.name}.csv`,'text/csv;charset=utf-8')}
async function importJSON(e:Event){const input=e.target as HTMLInputElement,file=input.files?.[0];try{if(!file)return;if(file.size>10000000)throw new Error('备份文件最大 10MB');const data=JSON.parse(await file.text());if(!data.sheets||!Array.isArray(data.sheetOrder))throw new Error('不是工作簿备份文件');await http.post(`/tables/${props.tableId}/workbook/validate`,{version,snapshot:data});await ElMessageBox.confirm('导入后会替换当前工作簿，原表保持不变。','导入备份',{confirmButtonText:'导入',cancelButtonText:'取消'});await replace(data);changed();await save()}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(e.message||'导入失败')}finally{input.value=''}}
async function reloadServer(){try{if(dirty.value)await ElMessageBox.confirm('未保存的工作簿改动将被放弃，可先导出备份。是否载入服务器版本？','重新载入工作簿',{confirmButtonText:'放弃并载入',cancelButtonText:'取消'});window.clearTimeout(timer);if(job)await job;const {data}=await http.get(`/tables/${props.tableId}/workbook`);version=data.version;await replace(data.snapshot||seed());lastHash=JSON.stringify(snapshot());failure.value='';dirty.value=false;emit('dirty',false);try{await recoveryStore(undefined,true)}catch{}}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}}
async function importExcel(e:Event){const input=e.target as HTMLInputElement,file=input.files?.[0];try{if(!file)return;const body=new FormData();body.append('file',file);loading.value=true;const {data}=await http.post(`/imports/workbook/${props.tableId}`,body);loading.value=false;await ElMessageBox.confirm(`${data.sheets} 张工作表，${data.cells} 个单元格。${data.notice} 导入后将替换当前工作簿，原表保持不变。`,'导入 Excel',{confirmButtonText:'导入工作簿',cancelButtonText:'取消'});await replace(data.snapshot);changed();await save()}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}finally{loading.value=false;input.value=''}}
async function exportExcel(){try{const {data}=await http.post(`/tables/${props.tableId}/workbook/export`,{snapshot:snapshot()},{responseType:'blob'});const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=props.name+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e:any){ElMessage.error('Excel 导出失败，可导出 JSON 备份保留完整内容')}}
function resolveRecovery(useLocal:boolean){recoveryOpen.value=false;recoveryResolve?.(useLocal?recovery.snapshot:null);recoveryResolve=null;if(!useLocal)void recoveryStore(undefined,true)}
function beforeUnload(e:BeforeUnloadEvent){if(dirty.value){e.preventDefault();e.returnValue=''}}
onMounted(async()=>{try{const response=await http.get(`/tables/${props.tableId}/workbook`);version=response.data.version;let initial=response.data.snapshot
 try{recovery=await recoveryStore()}catch{}
 if(recovery?.snapshot&&JSON.stringify(recovery.snapshot)!==JSON.stringify(initial)){recoveryOpen.value=true;const local=await new Promise(resolve=>recoveryResolve=resolve);if(local)initial=local}
 if(!active)return
 const instance=createUniver({locale:LocaleType.ZH_CN,locales:{[LocaleType.ZH_CN]:mergeLocales(CoreLocale,FilterLocale,SortLocale,ConditionalLocale,ValidationLocale,FindLocale)},presets:[UniverSheetsCorePreset({container:host.value!,disableAutoFocus:true}),UniverSheetsFilterPreset(),UniverSheetsSortPreset(),UniverSheetsConditionalFormattingPreset(),UniverSheetsDataValidationPreset(),UniverSheetsFindReplacePreset()]})
 univer=instance.univer;api=instance.univerAPI;api.toggleDarkMode(session.theme==='dark')
 if(!initial){try{initial=seed()}catch{const id='sheet1';initial={id:randomId(),name:props.name,sheetOrder:[id],sheets:{[id]:{id,name:'Sheet1',rowCount:1000,columnCount:26,cellData:{}}}}}}
 await replace(initial);lastHash=response.data.snapshot?JSON.stringify(response.data.snapshot):'';loading.value=false
 if(JSON.stringify(initial)!==lastHash)changed();window.addEventListener('beforeunload',beforeUnload)
 }catch(e:any){failure.value=e.message||apiError(e).message;loading.value=false}})
watch(()=>session.theme,value=>api?.toggleDarkMode(value==='dark'))
onUnmounted(()=>{active=false;window.clearTimeout(timer);window.removeEventListener('beforeunload',beforeUnload);listener?.dispose();univer?.dispose();recoveryResolve?.(null)})
defineExpose({flush:save,dirty,snapshot})
</script>
<style scoped>
.workbook-page{height:100%;display:flex;flex-direction:column;min-height:400px}.workbook-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--wb-border);flex-wrap:wrap}.univer-host{flex:1;min-height:350px;visibility:hidden;overflow:hidden}.univer-host.ready{visibility:visible}.error{color:var(--el-color-danger);max-width:300px}.workbook-page :deep(.univer-app){height:100%}
</style>
