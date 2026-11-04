<template>
 <div class="translation-settings">
  <section class="connection-card"><h3>翻译页面偏好</h3><el-form label-position="top"><el-form-item label="默认翻译服务"><el-select v-model="preferences.provider" @change="savePreferences"><el-option v-for="c in connections" :key="c.provider" :value="c.provider" :label="c.name" /></el-select></el-form-item><el-form-item label="按字数自动调整字号"><el-switch v-model="preferences.autoSize" @change="savePreferences" /></el-form-item><div class="connection-fields"><el-form-item v-for="item in fontFields" :key="item.key" :label="item.label"><el-input-number v-model="preferences[item.key]" :min="12" :max="40" @change="savePreferences"/></el-form-item></div><p class="text-12 secondary">原文和译文分别按字数计算。关闭自动调整时统一使用长文本字号，设置保存在当前浏览器。</p></el-form></section>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon><el-button text @click="refresh">重试加载</el-button></el-alert>
  <el-alert v-if="!loading&&!keyReady" title="凭据加密服务暂未就绪" description="配置加密服务后才能保存和测试密钥。已有输入不会自动提交。" type="warning" :closable="false" show-icon/>
  <div class="connection-summary"><span class="text-13 secondary">{{ connections.filter(c=>c.enabled).length }} 个服务已启用 · 密钥仅显示保存状态</span><el-button text :loading="loading" @click="refresh">刷新状态</el-button></div>
  <div v-if="loading&&!connections.length" class="empty-hint">正在加载翻译服务…</div>
  <section v-for="conn in connections" :key="conn.provider" class="connection-card" :aria-label="conn.name">
   <div class="connection-head"><div><h3>{{ conn.name }}</h3><span class="text-12 secondary">{{ conn.configured ? (conn.enabled?'已启用':'已配置，未启用') : '尚未配置' }}</span></div><el-switch :model-value="conn.enabled" :aria-label="`启用${conn.name}`" :disabled="!conn.configured||!keyReady||!!busy[conn.provider]" :loading="busy[conn.provider]==='toggle'" @change="(v:boolean|string|number)=>toggle(conn,!!v)"/></div>
   <el-form label-position="top" @submit.prevent="save(conn)">
    <div class="connection-fields"><el-form-item v-for="field in fields[conn.provider]" :key="field.key" :label="field.label" :for="`provider-${conn.provider}-${field.key}`"><el-input :id="`provider-${conn.provider}-${field.key}`" v-model="draft[conn.provider][field.key]" type="password" show-password autocomplete="new-password" :placeholder="conn.masked?.[field.key]?'已保存 · 留空保留原值':'输入'+field.label" :disabled="!!busy[conn.provider]"/></el-form-item></div>
    <el-form-item v-if="conn.provider==='deepseek'" label="模型" for="provider-model"><el-input id="provider-model" v-model="models[conn.provider]" placeholder="deepseek-chat" :disabled="!!busy[conn.provider]" maxlength="100"/></el-form-item>
    <p class="text-12 muted">{{ conn.limits?.unit==='byte'?'单次字节上限':'单次字符上限' }} {{ conn.limits?.value }}。连接测试会实际调用服务并可能消耗额度。</p>
    <p v-if="messages[conn.provider]" class="connection-feedback" :class="{error:failed[conn.provider]}" role="status">{{ messages[conn.provider] }}</p>
    <p v-else-if="conn.last_test_message" class="text-12 secondary">最近测试：{{ conn.last_test_message }}</p>
    <div class="connection-actions"><el-button native-type="submit" type="primary" :disabled="!keyReady||!!busy[conn.provider]||!providerDirty(conn)" :loading="busy[conn.provider]==='save'">保存配置</el-button><el-button :disabled="!conn.configured||!keyReady||!!busy[conn.provider]||providerDirty(conn)" :loading="busy[conn.provider]==='test'" @click="test(conn)">连接测试</el-button><span class="spacer"/><el-button text type="danger" :disabled="!conn.configured||!!busy[conn.provider]" @click="clear(conn)">清除密钥</el-button></div>
   </el-form>
  </section>
 </div>
</template>
<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import {ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
import {key,readTranslationPreferences} from '@/utils/translation-preferences'
const preferences=reactive(readTranslationPreferences())
const fontFields=[{key:'shortSize',label:'100 字以内字号'},{key:'mediumSize',label:'101–500 字字号'},{key:'longSize',label:'超过 500 字字号'}]
function savePreferences(){localStorage.setItem(key,JSON.stringify(preferences))}
const emit=defineEmits<{(e:'updated'):void}>()
const connections=ref<any[]>([]),loading=ref(false),error=ref(''),keyReady=ref(true)
const draft=reactive<Record<string,Record<string,string>>>({baidu:{},youdao:{},deepseek:{}}),models=reactive<Record<string,string>>({}),busy=reactive<Record<string,string>>({}),messages=reactive<Record<string,string>>({}),failed=reactive<Record<string,boolean>>({})
const fields:Record<string,{key:string;label:string}[]>={baidu:[{key:'app_id',label:'APP ID'},{key:'secret',label:'应用密钥'}],youdao:[{key:'app_key',label:'应用 ID'},{key:'secret',label:'应用密钥'}],deepseek:[{key:'api_key',label:'API Key'}]}
function providerDirty(c:any){return Object.values(draft[c.provider]||{}).some(v=>v.length>0)||(c.provider==='deepseek'&&(models[c.provider]||'')!==(c.model||''))}
const dirty=computed(()=>connections.value.some(providerDirty)),pending=computed(()=>Object.values(busy).some(Boolean))
async function confirmDiscard(){if(pending.value)return false;if(!dirty.value)return true;try{await ElMessageBox.confirm('尚未保存的翻译配置将被放弃。','放弃配置修改',{confirmButtonText:'放弃修改',cancelButtonText:'继续编辑'});return true}catch{return false}}
async function load(){loading.value=true;error.value='';try{const {data}=await http.get('/translation-connections');connections.value=data.items;keyReady.value=data.credential_key_ready;for(const c of connections.value){draft[c.provider]={};models[c.provider]=c.model||''}}catch(e){error.value=apiError(e).message}finally{loading.value=false}}
async function refresh(){if(await confirmDiscard())await load()}
function update(c:any,data:any){connections.value=connections.value.map(x=>x.provider===c.provider?data:x);emit('updated')}
async function perform(c:any,kind:string,fn:()=>Promise<void>){if(busy[c.provider])return;busy[c.provider]=kind;messages[c.provider]='';failed[c.provider]=false;try{await fn()}catch(e){failed[c.provider]=true;messages[c.provider]=apiError(e).message}finally{busy[c.provider]=''}}
async function save(c:any){const config=Object.fromEntries(Object.entries(draft[c.provider]).map(([k,v])=>[k,v.trim()]).filter(([,v])=>v));if(!c.configured&&fields[c.provider].some(f=>!config[f.key])){failed[c.provider]=true;messages[c.provider]='请填写完整凭据后保存';return}await perform(c,'save',async()=>{const {data}=await http.put(`/translation-connections/${c.provider}`,{config:Object.keys(config).length?config:undefined,model:c.provider==='deepseek'?(models[c.provider].trim()||'deepseek-chat'):undefined});draft[c.provider]={};models[c.provider]=data.model||'';update(c,data);messages[c.provider]='配置已保存'+(!data.enabled?'，可以开启右上方开关使用。':'。')})}
async function toggle(c:any,value:boolean){await perform(c,'toggle',async()=>{const {data}=await http.put(`/translation-connections/${c.provider}`,{enabled:value});update(c,data);messages[c.provider]=value?'服务已启用':'服务已停用'})}
async function test(c:any){await perform(c,'test',async()=>{const {data}=await http.post(`/translation-connections/${c.provider}/test`);messages[c.provider]=data.message;failed[c.provider]=!data.ok})}
async function clear(c:any){try{await ElMessageBox.confirm(`清除${c.name}的已保存密钥并停用该服务？再次使用需要重新填写。`,'清除翻译密钥',{confirmButtonText:'清除并停用',cancelButtonText:'取消',type:'warning'});await perform(c,'clear',async()=>{const {data}=await http.delete(`/translation-connections/${c.provider}`);draft[c.provider]={};models[c.provider]=data.model||'';update(c,data);messages[c.provider]='密钥已清除，服务已停用'})}catch{}}
onMounted(load)
defineExpose({dirty,pending,confirmDiscard})
</script>
<style scoped>
.translation-settings{display:grid;gap:16px}.connection-summary,.connection-head,.connection-actions{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}.connection-card{border:1px solid var(--wb-border);border-radius:10px;padding:22px;background:var(--wb-surface)}.connection-head{margin-bottom:20px}.connection-head h3{font-size:15px;font-weight:600;margin:0 0 4px}.connection-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}.connection-feedback{font-size:13px;color:var(--el-color-success)}.connection-feedback.error{color:var(--el-color-danger)}.connection-actions{margin-top:16px;justify-content:flex-start}.connection-actions .el-button+.el-button{margin-left:0}@media(max-width:700px){.connection-card{padding:16px}.connection-fields{grid-template-columns:1fr}}
</style>
