<template>
 <section class="ai-settings"><el-alert title="图片发往智谱进行识别；API Key 加密保存于服务端，识别结果需在表格中确认后写入。" type="info" :closable="false"/><el-form label-position="top" @submit.prevent="save"><el-form-item label="智谱 API Key"><el-input v-model="key" type="password" show-password autocomplete="new-password" :placeholder="configured?'已保存，留空保留原密钥':'输入 API Key'" :disabled="pending"/></el-form-item><el-form-item label="默认识别模型"><el-select v-model="model" :disabled="pending"><el-option label="GLM-OCR（专业文字与表格识别）" value="glm-ocr"/><el-option label="GLM-4V-Flash（视觉理解）" value="glm-4v-flash"/></el-select></el-form-item><el-form-item label="识别时同时对比两个模型"><el-switch v-model="compare" :disabled="pending"/></el-form-item><p class="secondary">表格 → 原始表 → AI 图片填表，可单独识别或同时对比两个模型。一次最多提取 50 条记录，支持 PNG/JPG，最大 8 MB。</p><p class="secondary">GLM-OCR 调用版面解析接口，GLM-4V-Flash 调用视觉对话接口；具体费用与额度以智谱账号为准。</p><el-alert v-if="message" :title="message" :type="failed?'error':'success'" :closable="false"/><div class="ai-setting-actions"><el-button type="primary" native-type="submit" :loading="pending" :disabled="!dirty">保存配置</el-button><el-button :disabled="pending||!configured" @click="clear">清除密钥</el-button></div></el-form></section>
</template>
<script setup lang="ts">
import {ref,computed,onMounted} from 'vue'
import {ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
const key=ref(''),model=ref('glm-4v-flash'),savedModel=ref('glm-4v-flash'),configured=ref(false),pending=ref(false),message=ref(''),failed=ref(false)
const compare=ref(false),savedCompare=ref(false)
const dirty=computed(()=>!!key.value||model.value!==savedModel.value||compare.value!==savedCompare.value)
async function load(){try{const {data}=await http.get('/ai/config');configured.value=data.configured;compare.value=savedCompare.value=!!data.compare_models;model.value=savedModel.value=data.default_model}catch(e){message.value=apiError(e).message;failed.value=true}}
async function save(){if(pending.value)return;pending.value=true;message.value='';try{const {data}=await http.put('/ai/config',{api_key:key.value||undefined,default_model:model.value,compare_models:compare.value});configured.value=data.configured;savedModel.value=data.default_model;savedCompare.value=compare.value;key.value='';failed.value=false;message.value='配置已保存'}catch(e){failed.value=true;message.value=apiError(e).message}finally{pending.value=false}}
async function clear(){try{await ElMessageBox.confirm('清除后两个模型都需要重新配置密钥才能使用。','清除 AI 密钥',{confirmButtonText:'清除',cancelButtonText:'取消'});pending.value=true;await http.delete('/ai/config');configured.value=false;key.value='';message.value='密钥已清除';failed.value=false}catch(e){if(e!=='cancel'&&e!=='close'){failed.value=true;message.value=apiError(e).message}}finally{pending.value=false}}
onMounted(load);defineExpose({dirty,pending})
</script>
<style scoped>.ai-settings{display:grid;gap:20px;max-width:760px}.ai-setting-actions{display:flex;gap:12px;margin-top:16px}</style>