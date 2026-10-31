<template>
 <el-dialog v-model="open" :title="editing?'编辑字段':'添加字段'" width="520px" :close-on-click-modal="false">
  <el-form label-position="top">
   <el-form-item label="名称" required><el-input v-model="form.name" maxlength="50"/></el-form-item>
   <el-form-item label="类型"><el-select v-model="form.type" :disabled="!!editing" style="width:100%"><el-option v-for="t in types" :key="t.value" :label="t.label" :value="t.value"/></el-select></el-form-item>
   <template v-if="form.type==='formula'"><el-form-item label="整列公式" required><el-input v-model="form.expression" type="textarea" :rows="3" placeholder="例如：ROUND({数量} * {单价}, 2)" maxlength="1000"/></el-form-item><p class="text-12 secondary">用 {列名} 引用字段。支持 + − * / %、比较、IF、ROUND、SUM、AVG、MIN、MAX、COUNT、ABS、LEN、CONCAT、COALESCE、DATE_DIFF。计算列不可手动编辑。</p></template>
   <template v-if="form.type==='reference'"><el-form-item label="关联表" required><el-select v-model="form.table_id" style="width:100%" @change="loadTarget"><el-option v-for="t in tables" :key="t.id" :label="t.name" :value="t.id"/></el-select></el-form-item><el-form-item label="显示列" required><el-select v-model="form.label_field" style="width:100%"><el-option v-for="f in targetFields" :key="f.key" :label="f.name" :value="f.key"/></el-select></el-form-item><el-checkbox v-model="form.multiple">允许关联多条记录</el-checkbox></template>
   <template v-if="['lookup','rollup'].includes(form.type)"><el-form-item label="关联字段" required><el-select v-model="form.reference_field" style="width:100%" @change="loadReference"><el-option v-for="f in fields.filter(f=>f.type==='reference')" :key="f.key" :label="f.name" :value="f.key"/></el-select></el-form-item><el-form-item label="读取关联表的列" required><el-select v-model="form.target_field" style="width:100%"><el-option v-for="f in targetFields" :key="f.key" :label="f.name" :value="f.key"/></el-select></el-form-item><el-form-item v-if="form.type==='rollup'" label="汇总方式"><el-select v-model="form.operation"><el-option v-for="o in operations" :key="o.value" :value="o.value" :label="o.label"/></el-select></el-form-item></template>
   <el-form-item v-if="['select','multiselect'].includes(form.type)" label="选项，每行一个"><el-input v-model="form.optionsText" type="textarea" :rows="4"/></el-form-item>
   <template v-if="!['formula','lookup','rollup'].includes(form.type)"><el-form-item label="必填"><el-switch v-model="form.required"/></el-form-item><el-form-item v-if="!editing" label="默认值（已有记录时新增必填字段需要提供）"><el-switch v-if="form.type==='checkbox'" v-model="form.default_value"/><el-input v-else v-model="form.default_value"/></el-form-item></template>
  </el-form>
  <el-alert v-if="failure" :title="failure" type="error" :closable="false"/>
  <template #footer><el-button @click="open=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存字段</el-button></template>
 </el-dialog>
</template>
<script setup lang="ts">
import { randomId } from '@/utils/random-id'

import {computed,reactive,ref,watch} from 'vue'
import {http,apiError} from '@/api/client'
import type {Field} from '@/table-core'
const props=defineProps<{modelValue:boolean;tableId:number;fields:Field[];editing:Field|null}>(),emit=defineEmits(['update:modelValue','saved'])
const open=computed({get:()=>props.modelValue,set:v=>emit('update:modelValue',v)})
const types=[['short_text','短文本'],['long_text','长文本'],['number','数字'],['date','日期'],['select','单选'],['multiselect','多选'],['checkbox','勾选'],['url','链接'],['attachment','附件'],['formula','整列公式'],['reference','关联记录'],['lookup','查找引用'],['rollup','关联汇总']].map(([value,label])=>({value,label}))
const operations=[['sum','求和'],['avg','平均值'],['min','最小值'],['max','最大值'],['count','计数']].map(([value,label])=>({value,label}))
const form=reactive<any>({}),saving=ref(false),failure=ref(''),tables=ref<any[]>([]),targetFields=ref<Field[]>([])
async function loadTarget(){targetFields.value=form.table_id?(await http.get(`/tables/${form.table_id}`)).data.fields:[]}
async function loadReference(){const f=props.fields.find(f=>f.key===form.reference_field);form.table_id=f?.config?.table_id;await loadTarget()}
watch(open,async value=>{if(!value)return;failure.value='';const f=props.editing;Object.assign(form,{name:f?.name||'',type:f?.type||'short_text',required:f?.required||false,default_value:'',expression:'',table_id:null,label_field:'',multiple:false,reference_field:'',target_field:'',operation:'sum',optionsText:(f?.options||[]).map(o=>o.name).join('\n'),...f?.config});try{tables.value=(await http.get('/tables')).data;if(form.table_id)await loadTarget();else targetFields.value=[]}catch(e){failure.value=apiError(e).message}})
async function save(){saving.value=true;failure.value='';try{const config=form.type==='formula'?{expression:form.expression}:form.type==='reference'?{table_id:form.table_id,label_field:form.label_field,multiple:form.multiple}:['lookup','rollup'].includes(form.type)?{reference_field:form.reference_field,target_field:form.target_field,operation:form.operation}:props.editing?.config||{}
 const names=String(form.optionsText||'').split('\n').map(s=>s.trim()).filter(Boolean);if(new Set(names).size!==names.length)throw new Error('选项名称不能重复')
 const options=names.map(name=>({id:props.editing?.options?.find(o=>o.name===name)?.id||randomId(),name}))
 const payload:any={name:form.name,type:form.type,required:['formula','lookup','rollup'].includes(form.type)?false:form.required,config};if(['select','multiselect'].includes(form.type))payload.options=options
 if(!props.editing&&!['formula','lookup','rollup'].includes(form.type)&&form.default_value!==''){payload.default_value=form.default_value;if(form.type==='select')payload.default_value=options.find(o=>o.name===form.default_value)?.id||form.default_value;if(form.type==='multiselect')payload.default_value=String(form.default_value).split(/[,，、]/).map(v=>options.find(o=>o.name===v)?.id||v)}
 if(props.editing)await http.patch(`/fields/${props.editing.id}`,payload);else await http.post(`/tables/${props.tableId}/fields`,payload);open.value=false;emit('saved')
 }catch(e:any){failure.value=e?.response?apiError(e).message:e.message}finally{saving.value=false}}
</script>
