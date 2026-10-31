<template>
 <div class="grid-frame" @copy="copyEvent" @paste="pasteEvent" @keydown="keyDown">
  <div ref="host" class="canvas-grid" role="region" aria-label="可编辑数据表，方向键导航，Enter 编辑，Shift 选择区域" tabindex="0" />
  <div class="grid-foot"><span>{{ selectedCount }} 个单元格 · {{ selectedRows.length }} 行</span><span v-if="selectionSum">合计 {{ selectionSum }}</span><span class="spacer"/><span v-if="error" class="save-error">{{ error }}</span><span v-else-if="saving">正在保存…</span><span v-else-if="dirty">待保存</span><span v-else>已保存</span></div>
 </div>
</template>
<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import * as VTable from '@visactor/vtable'
import {InputEditor,DateInputEditor,ListEditor,TextAreaEditor} from '@visactor/vtable-editors'
import Decimal from 'decimal.js'
import {computedTypes,display,parseCell,parseTSV,toTSV,type Field,type Row,type ViewConfig} from '@/table-core'
const props=defineProps<{rows:Row[];fields:Field[];config:ViewConfig;references:Record<string,{id:number;label:string}[]>;commit:(changes:{id:number;changes:Record<string,any>}[],label:string)=>Promise<void>}>()
const emit=defineEmits<{(e:'select',row:Row|null):void;(e:'width',key:string,width:number):void;(e:'dirty',value:boolean):void;(e:'detail',row:Row):void;(e:'attachment',id:number):void;(e:'order',keys:string[]):void;(e:'undo'):void;(e:'redo'):void}>()
const host=ref<HTMLElement>(),ranges=ref<any[]>([]),error=ref(''),saving=ref(false),dirty=ref(false)
let grid:any,resize:ResizeObserver|undefined,themeObserver:MutationObserver|undefined,timer:number|undefined,active=true,job:Promise<boolean>|null=null
const drafts=new Map<number,Record<string,any>>(),inflight=new Map<number,Record<string,any>>()
let ids:number[]=[],fillStart:any=null,syncing=false,batchLabel='编辑单元格'
let signatures=new Map<number,string>()
const visibleFields=computed(()=>{const order=props.config.order;return props.fields.filter(f=>!props.config.hidden.includes(f.key)).sort((a,b)=>{const ai=order.indexOf(a.key),bi=order.indexOf(b.key);return (ai<0?999:ai)-(bi<0?999:bi)})})
function bounds(){const range=ranges.value[0];if(!range)return null;return {c1:Math.max(1,Math.min(range.start.col,range.end.col)),c2:Math.min(visibleFields.value.length,Math.max(range.start.col,range.end.col)),r1:Math.max(1,Math.min(range.start.row,range.end.row)),r2:Math.min(props.rows.length,Math.max(range.start.row,range.end.row))}}
const selectedRows=computed(()=>{const b=bounds();return b?props.rows.slice(b.r1-1,b.r2):[]})
const selectedCount=computed(()=>{const b=bounds();return b?Math.max(0,b.c2-b.c1+1)*Math.max(0,b.r2-b.r1+1):0})
const selectionSum=computed(()=>{const b=bounds();if(!b)return '';let sum=new Decimal(0),count=0;for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++){const v=props.rows[r-1]?.data[visibleFields.value[c-1]?.key];if(v==null||v==='')continue;try{const n=new Decimal(v);if(n.isFinite()){sum=sum.add(n);count++}}catch{}}return count?sum.toFixed():''})
function mark(){dirty.value=!!drafts.size||!!inflight.size;emit('dirty',dirty.value)}
function flat(row:Row){return {...row.data,...inflight.get(row.id),...drafts.get(row.id),_rowId:row.id,_errors:row.computed_errors||{}}}
function restoreSelection(){const b=bounds();if(b&&b.r1<=props.rows.length&&b.c1<=visibleFields.value.length)grid?.selectCells([{start:{col:b.c1,row:b.r1},end:{col:b.c2,row:b.r2}}])}
function syncRecords(force=false){if(!grid)return;syncing=true;const next=props.rows.map(flat),same=ids.length===next.length&&ids.every((id,i)=>id===props.rows[i].id),top=grid.scrollTop,left=grid.scrollLeft
 if(same){const changed:any[]=[],indices:number[]=[];next.forEach((r,i)=>{if(force||signatures.get(props.rows[i].id)!==JSON.stringify(r)){changed.push(r);indices.push(i)}});if(changed.length)grid.updateRecords(changed,indices)}else{const b=bounds(),selectedId=b?ids[b.r1-1]:null;grid.setRecords(next);ids=props.rows.map(r=>r.id);if(selectedId&&!ids.includes(selectedId)){ranges.value=[];grid.clearSelected();emit('select',null)}}
 signatures=new Map(props.rows.map((r,i)=>[r.id,JSON.stringify(next[i])]))
 grid.scrollTop=top;grid.scrollLeft=left;syncing=false;restoreSelection()
}
function stage(col:number,row:number,value:any){if(syncing)return;const f=visibleFields.value[col-1],record=props.rows[row-1];if(!f||!record||computedTypes.has(f.type))return
 try{const v=parseCell(f,value,props.references);drafts.set(record.id,{...drafts.get(record.id),[f.key]:v});error.value='';mark();window.clearTimeout(timer);timer=window.setTimeout(()=>void flush(),120)}catch(e:any){error.value=e.message;syncRecords(true)}}
async function flush():Promise<boolean>{window.clearTimeout(timer);grid?.completeEditCell();if(job){await job;if(error.value)return false}if(!drafts.size)return !error.value
 const label=batchLabel;batchLabel='编辑单元格'
 const batch=[...drafts].map(([id,changes])=>({id,changes:{...changes}}));drafts.clear();for(const e of batch)inflight.set(e.id,e.changes);saving.value=true;mark()
 job=(async()=>{try{await props.commit(batch,label);error.value='';return true}catch(e:any){for(const e of batch)drafts.set(e.id,{...e.changes,...drafts.get(e.id)});error.value=e?.response?.data?.message||e.message||'保存失败，修改仍保留';return false}finally{inflight.clear();saving.value=false;mark();syncRecords();job=null}})()
 const ok=await job;if(ok&&drafts.size&&active)return flush();return ok
}
function discard(){window.clearTimeout(timer);drafts.clear();error.value='';mark();syncRecords()}
async function paste(text:string){if(!await flush())return;const b=bounds();if(!b)return;try{const matrix=parseTSV(text);if(matrix.length>500)throw new Error('一次最多粘贴 500 行');if(b.r1+matrix.length-1>props.rows.length)throw new Error('粘贴区域超出现有行，请先添加足够的行');if(matrix.some(r=>b.c1+r.length-1>visibleFields.value.length))throw new Error('粘贴区域超出现有列')
 const edits:{col:number;row:number;value:any}[]=[]
 matrix.forEach((line,r)=>line.forEach((v,c)=>edits.push({col:b.c1+c,row:b.r1+r,value:parseCell(visibleFields.value[b.c1+c-1],v,props.references)})))
 batchLabel=`粘贴 ${matrix.length} 行数据`;for(const e of edits)stage(e.col,e.row,e.value);await flush()
 }catch(e:any){error.value=e.message}}
function selectedMatrix(){const b=bounds();if(!b)return [];return props.rows.slice(b.r1-1,b.r2).map(row=>visibleFields.value.slice(b.c1-1,b.c2).map(f=>display(f,{...row.data,...inflight.get(row.id),...drafts.get(row.id)}[f.key],props.references,props.config.formats[f.key])))}
async function copy(){const text=toTSV(selectedMatrix());try{await navigator.clipboard.writeText(text)}catch{error.value='请使用 Ctrl/Cmd+C 复制选区'}return text}
function isEditing(){const el=document.activeElement as HTMLElement|null;return !!el&&!!host.value?.contains(el)&&el.matches('input:not([readonly]):not([type=checkbox]),textarea:not([readonly]),select')&&el.getBoundingClientRect().height>0}
function copyEvent(e:ClipboardEvent){if(isEditing())return;e.clipboardData?.setData('text/plain',toTSV(selectedMatrix()));e.preventDefault()}
function pasteEvent(e:ClipboardEvent){if(isEditing())return;const text=e.clipboardData?.getData('text/plain');if(text!==undefined){e.preventDefault();void paste(text)}}
async function clear(){if(!await flush())return;batchLabel='清空选区';const b=bounds();if(!b)return;const cells=[];for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++){const f=visibleFields.value[c-1];if(f&&!computedTypes.has(f.type))cells.push({c,r})}for(const e of cells)stage(e.c,e.r,null);await flush()}
async function fill(direction:'down'|'right'='down'){if(!await flush())return;batchLabel=direction==='down'?'向下填充':'向右填充';const b=bounds();if(!b)return;if(b.r2-b.r1+1>500){error.value='一次最多填充 500 行';return}try{const cells=[];for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++){if(direction==='down'&&r===b.r1||direction==='right'&&c===b.c1)continue;const source=props.rows[(direction==='down'?b.r1:r)-1],f=visibleFields.value[(direction==='right'?b.c1:c)-1],target=visibleFields.value[c-1];cells.push({r,c,v:parseCell(target,source.data[f.key],props.references)})}for(const x of cells)stage(x.c,x.r,x.v);await flush()}catch(e:any){error.value=e.message}}
function keyDown(e:KeyboardEvent){if(isEditing())return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?emit('redo'):emit('undo')}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();emit('redo')}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();void clear()}else if((e.ctrlKey||e.metaKey)&&['d','r'].includes(e.key.toLowerCase())){e.preventDefault();void fill(e.key.toLowerCase()==='d'?'down':'right')}}
function styles(){const s=getComputedStyle(document.documentElement);return {bg:s.getPropertyValue('--wb-surface').trim(),text:s.getPropertyValue('--wb-text').trim(),border:s.getPropertyValue('--wb-border').trim(),subtle:s.getPropertyValue('--wb-surface-subtle').trim(),primary:s.getPropertyValue('--wb-primary').trim()}}
function columns(){return visibleFields.value.map(f=>{const format=props.config.formats[f.key],choices=f.type==='reference'?(props.references[f.key]||[]).map(o=>o.label):(f.options||[]).map(o=>o.name)
 let editor:any=computedTypes.has(f.type)||['attachment','checkbox'].includes(f.type)?undefined:f.type==='date'?new DateInputEditor():f.type==='select'?new ListEditor({values:choices}):f.type==='long_text'?new TextAreaEditor():new InputEditor()
 return {field:f.key,title:f.name+(computedTypes.has(f.type)?' ƒ':''),width:props.config.widths[f.key]||160,minWidth:70,editor,linkJump:false,cellType:f.type==='checkbox'?'checkbox':format?.style==='bar'?'progressbar':format?.style==='sparkline'?'sparkline':f.type==='url'?'link':'text',
  fieldFormat:(record:any)=>record._errors?.[f.key]?'#ERROR: '+record._errors[f.key]:format?.style==='sparkline'?(Array.isArray(record[f.key])?record[f.key]:String(record[f.key]||'').split(',').map(Number)):f.type==='checkbox'||format?.style==='bar'?record[f.key]:display(f,record[f.key],props.references,format),
  style:{fontSize:13,color:styles().text,bgColor:(args:any)=>{const r=props.rows[args.row-1];if(!r)return styles().bg;const rule=props.config.conditions.find(rule=>rule.field===f.key&&((rule.op==='empty'&&(r.data[f.key]==null||r.data[f.key]===''))||(rule.op==='eq'&&String(r.data[f.key])===rule.value)||(rule.op==='gt'&&Number(r.data[f.key])>Number(rule.value))||(rule.op==='lt'&&Number(r.data[f.key])<Number(rule.value))));const palette:Record<string,string>=document.documentElement.classList.contains('dark')?{red:'#422b2b',yellow:'#423920',green:'#233c2c',blue:'#21354a'}:{red:'#fbe4e4',yellow:'#fbf3db',green:'#edf3ec',blue:'#e7f3f8'};return rule?palette[rule.color]||styles().bg:styles().bg},barColor:styles().primary,barHeight:8},min:0,max:100}
 })}
function options(){const c=styles();return {records:props.rows.map(flat),columns:columns(),defaultRowHeight:props.config.rowHeight||36,defaultHeaderRowHeight:38,frozenColCount:Math.min(1+props.config.frozen,visibleFields.value.length+1),rowSeriesNumber:{title:'#',width:48},dragOrder:{dragHeaderMode:'column',validateDragOrderOnEnd:(source:any,target:any)=>source.col>0&&target.col>0},tooltip:{isShowOverflowTextTooltip:true},autoWrapText:false,editCellTrigger:'doubleclick',excelOptions:{fillHandle:true},keyboardOptions:{ctrlMultiSelect:false,moveFocusCellOnTab:true,editCellOnEnter:true,copySelected:false,pasteValueToCell:false,selectAllOnCtrlA:true},theme:{underlayBackgroundColor:c.bg,defaultStyle:{fontFamily:'system-ui, Microsoft YaHei, sans-serif',fontSize:13,color:c.text,bgColor:c.bg,borderColor:c.border},headerStyle:{bgColor:c.subtle,color:c.text,fontSize:12,fontWeight:500,borderColor:c.border},rowHeaderStyle:{bgColor:c.subtle,color:c.text,borderColor:c.border},selectionStyle:{cellBorderColor:c.primary,cellBgColor:'rgba(35,131,226,.08)'},bodyStyle:{bgColor:c.bg},scrollStyle:{visible:'scrolling'}}}}
onMounted(()=>{if(!host.value)return;grid=new VTable.ListTable(host.value,options() as any);ids=props.rows.map(r=>r.id);signatures=new Map(props.rows.map(r=>[r.id,JSON.stringify(flat(r))]))
 grid.on('selected_cell',(args:any)=>{ranges.value=[...grid.getSelectedCellRanges()];emit('select',props.rows[args.row-1]||null)})
 grid.on('drag_select_end',()=>{ranges.value=[...grid.getSelectedCellRanges()]})
 grid.on('selected_clear',()=>{ranges.value=[];emit('select',null)})
 grid.on('change_cell_value',(args:any)=>stage(args.col,args.row,args.changedValue))
 grid.on('checkbox_state_change',(args:any)=>stage(args.col,args.row,args.checked))
 grid.on('change_header_position',(args:any)=>{if(args.source.col<1||args.target.col<1)return;const order=visibleFields.value.map(f=>f.key),[field]=order.splice(args.source.col-1,1);order.splice(args.target.col-1,0,field);emit('order',order)})
 grid.on('resize_column_end',(args:any)=>{const f=visibleFields.value[args.col-1];if(f)emit('width',f.key,args.colWidths[args.col])})
 grid.on('dblclick_cell',(args:any)=>{const f=visibleFields.value[args.col-1],r=props.rows[args.row-1];if(r&&f&&f.type==='attachment'&&r.data[f.key])emit('attachment',r.data[f.key])})
 grid.on('mousedown_fill_handle',()=>{const b=bounds();fillStart=b?{...b,values:props.rows.slice(b.r1-1,b.r2).map(r=>visibleFields.value.slice(b.c1-1,b.c2).map(f=>r.data[f.key]))}:null})
 grid.on('drag_fill_handle_end',async()=>{ranges.value=[...grid.getSelectedCellRanges()];const b=bounds(),start=fillStart;if(!b||!start)return;try{if(b.r2-b.r1+1>500)throw new Error('一次最多填充 500 行');const edits=[];for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++){if(r>=start.r1&&r<=start.r2&&c>=start.c1&&c<=start.c2)continue;const rr=((r-start.r1)%start.values.length+start.values.length)%start.values.length,cc=((c-start.c1)%start.values[0].length+start.values[0].length)%start.values[0].length;edits.push({r,c,v:parseCell(visibleFields.value[c-1],start.values[rr][cc],props.references)})}for(const x of edits)stage(x.c,x.r,x.v);await flush()}catch(e:any){error.value=e.message}})
 resize=new ResizeObserver(()=>grid?.resize());resize.observe(host.value)
 themeObserver=new MutationObserver(()=>{if(grid){grid.updateOption(options());restoreSelection()}});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class']})
})
watch(()=>props.rows,()=>syncRecords())
watch(()=>[props.fields,props.config.hidden,props.config.order,props.config.frozen,props.config.rowHeight,props.config.formats,props.config.conditions,props.config.widths],()=>{if(grid){const top=grid.scrollTop,left=grid.scrollLeft;grid.updateOption(options());ids=props.rows.map(r=>r.id);grid.scrollTop=top;grid.scrollLeft=left;restoreSelection()}},{deep:true})
onUnmounted(()=>{active=false;window.clearTimeout(timer);resize?.disconnect();themeObserver?.disconnect();grid?.release();grid=null})
defineExpose({resetSelection:()=>{ranges.value=[];grid?.clearSelected();emit('select',null)},flush,retry:()=>{error.value='';return flush()},discard,copy,paste,clear,fill,selectedRows,dirty,focusCell:(col:number,row:number)=>grid?.selectCell(col,row),getSelection:()=>bounds()})
</script>
<style scoped>
.grid-frame{display:flex;flex-direction:column;min-height:250px;height:100%;min-width:0}.canvas-grid{flex:1;min-height:200px;min-width:0;overflow:hidden}.grid-foot{display:flex;gap:16px;align-items:center;min-height:28px;padding:4px 10px;font-size:12px;color:var(--wb-text-secondary);border-top:1px solid var(--wb-border)}.save-error{color:var(--el-color-danger);max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
