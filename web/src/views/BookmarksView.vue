<template>
  <div class="bookmark-page">
    <div class="tools"><el-input v-model="query" placeholder="搜索网址" clearable class="search"/><span class="count">{{ filtered.length }} 个网址</span><div class="spacer"/><CategoryManager resource="bookmarks" @changed="load"/><el-tooltip content="检测当前电脑到网站的响应耗时；部分网站无法读取状态" placement="bottom"><el-button text :disabled="!filtered.length || testing" @click="testAll">{{ testing ? '检测中…' : '一键测速' }}</el-button></el-tooltip><el-button text :disabled="!filtered.length" @click="openAll">全部打开</el-button><el-button class="btn-tonal" @click="openForm()">＋ 添加网址</el-button></div>
    <div v-if="!filtered.length && !loading" class="empty">{{ items.length ? '没有找到匹配的网址' : '暂无网址' }}</div>
    <div class="cards">
      <article v-for="item in filtered" :key="item.id" class="card">
        <a class="site-link" :href="item.url" target="_blank" rel="noopener noreferrer" :title="item.description || item.url">
          <div class="avatar"><img v-if="!iconErrors[item.id]" :src="item.icon_url || favicon(item.url)" alt="" referrerpolicy="no-referrer" @error="iconErrors[item.id]=true"/><span v-else>{{ item.title.slice(0,1).toUpperCase() }}</span></div>
          <div class="site-info"><span class="site-name" :title="item.title">{{ item.title }}</span><span class="site-domain">{{ domain(item.url) }}</span></div>
        </a>
        <div class="site-actions">
          <el-dropdown trigger="click" @command="(cmd: string) => action(cmd, item)"><button class="more" aria-label="网址操作">···</button><template #dropdown><el-dropdown-menu><el-dropdown-item command="open">打开网站 ↗</el-dropdown-item><el-dropdown-item command="test" :disabled="testing">测速</el-dropdown-item><el-dropdown-item command="edit" divided>编辑</el-dropdown-item><el-dropdown-item command="delete">删除</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
          <span v-if="results[item.id]" class="site-status" :title="results[item.id]" :aria-label="results[item.id]">{{ shortResult(results[item.id]) }}</span>
        </div>
      </article>
    </div>
    <el-dialog v-model="dialog" :title="editing ? '编辑网址' : '添加网址'" width="520px" align-center>
      <el-form label-position="top" @submit.prevent="save"><el-form-item label="网址"><el-input v-model="form.url" placeholder="https://example.com" @blur="onUrlBlur"/><div class="form-help"></div></el-form-item><el-form-item label="名称"><div class="name-row"><el-input v-model="form.title" maxlength="200" placeholder="留空时使用域名"/><el-button :loading="parsing" @click="parseTitle(true)">解析名称和图标</el-button></div></el-form-item><el-form-item label="分类"><el-select v-model="form.category" filterable allow-create default-first-option clearable placeholder="选择或输入新分类" style="width:100%"><el-option v-for="c in categories" :key="c" :label="c" :value="c"/></el-select></el-form-item><el-form-item label="备注"><el-input v-model="form.description" type="textarea" maxlength="500" placeholder="可选"/></el-form-item></el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import CategoryManager from '@/components/CategoryManager.vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute } from 'vue-router'
import { http, apiError } from '@/api/client'
type Item = { id:number; url:string; title:string; icon_url:string; category:string; description:string }
const route=useRoute()
const category=computed(()=>typeof route.query.category==='string'?route.query.category:'__all')
const items=ref<Item[]>([]), loading=ref(false), query=ref(''), dialog=ref(false), editing=ref<Item|null>(null), saving=ref(false), parsing=ref(false), testing=ref(false)
const form=reactive({url:'',title:'',icon_url:'',category:'',description:''})
const iconErrors=reactive<Record<number,boolean>>({})
function domain(url:string){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}}
function shortResult(value:string){const ms=value.match(/(\d+) ms/);return ms?ms[1]+' ms · 未确认':value.includes('HTTP')?value:value.includes('失败')?'未确认':value}
function favicon(url:string){try{return new URL('/favicon.ico',url).href}catch{return ''}}
let parseSequence=0
const results=reactive<Record<number,string>>({})
const categories=ref<string[]>([])
const filtered=computed(()=>{const q=query.value.trim().toLowerCase();return items.value.filter(i=>(category.value==='__all'||(category.value==='__none'?!i.category:i.category===category.value))&&(!q||[i.title,i.url,i.description].some(s=>s.toLowerCase().includes(q))))})
async function load(){loading.value=true;try{items.value=(await http.get('/bookmarks')).data;categories.value=(await http.get('/bookmarks/categories')).data}catch(e){ElMessage.error(apiError(e).message)}finally{loading.value=false}}
function openForm(item?:Item){parseSequence++;parsing.value=false;editing.value=item||null;Object.assign(form,item ? {url:item.url,title:item.title,icon_url:item.icon_url||'',category:item.category,description:item.description} : {url:'',title:'',icon_url:'',category:category.value.startsWith('__')?'':category.value,description:''});dialog.value=true}
function normalizeUrl(){let s=form.url.trim();if(s&&!/^[a-z][a-z\d+.-]*:/i.test(s))s='https://'+s;form.url=s}
function onUrlBlur(){normalizeUrl();if(form.url && validUrl(form.url)) void parseTitle(false)}
function validUrl(raw:string){try{const u=new URL(raw);return (u.protocol==='http:'||u.protocol==='https:')&&!u.username&&!u.password}catch{return false}}
async function save(){normalizeUrl();if(!validUrl(form.url)){ElMessage.warning('请输入有效的 HTTP 或 HTTPS 网址，且不要包含账号密码');return} saving.value=true;try{if(editing.value)await http.put(`/bookmarks/${editing.value.id}`,form);else await http.post('/bookmarks',form);dialog.value=false;await load();window.dispatchEvent(new Event('wb-bookmarks-changed'));ElMessage.success('已保存')}catch(e){ElMessage.error(apiError(e).message)}finally{saving.value=false}}
async function parseTitle(manual=true){
 normalizeUrl();if(!validUrl(form.url)){if(manual)ElMessage.warning('请先输入有效网址');return}
 const target=form.url,initialTitle=form.title,sequence=++parseSequence;parsing.value=true
 try{const {data}=await http.post('/bookmarks/metadata',{url:target});if(sequence!==parseSequence||form.url!==target)return
 form.icon_url=data.icon_url||''
 if(form.title===initialTitle && (manual||!initialTitle||initialTitle===new URL(target).hostname))form.title=data.title
 }catch{if(sequence===parseSequence&&!form.title)form.title=new URL(target).hostname}
 finally{if(sequence===parseSequence)parsing.value=false}
}
async function action(cmd:string,item:Item){if(cmd==='open'){openLink(item);return}if(cmd==='test'){await testOne(item);return}if(cmd==='edit'){openForm(item);return}try{await ElMessageBox.confirm(`确定删除“${item.title}”吗？`,'删除网址',{type:'warning'});await http.delete(`/bookmarks/${item.id}`);await load();window.dispatchEvent(new Event('wb-bookmarks-changed'));ElMessage.success('已删除')}catch(e:any){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}}
function openLink(item:Item){if(validUrl(item.url))window.open(item.url,'_blank','noopener,noreferrer')}
function openAll(){const list=filtered.value;if(list.length>20){ElMessage.warning('当前列表超过 20 个网址，请先选择分类或搜索缩小范围');return}let blocked=0;for(const item of list){if(!validUrl(item.url))continue;const w=window.open('','_blank');if(w){w.opener=null;w.location.href=item.url}else blocked++}if(blocked)ElMessage.warning(`${blocked} 个窗口被浏览器拦截，请允许本站弹窗后重试`)}
async function probe(item:Item){const started=performance.now();try{const r=await fetch(item.url,{mode:'no-cors',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});const ms=Math.round(performance.now()-started);results[item.id]=r.type==='opaque'?`收到响应 ${ms} ms · 状态不可读取`:`HTTP ${r.status} · ${ms} ms`}catch{results[item.id]='检测失败或受浏览器限制'} }
async function testOne(item:Item){testing.value=true;results[item.id]='检测中…';try{await probe(item)}finally{testing.value=false}}
async function testAll(){testing.value=true;const list=[...filtered.value];list.forEach(i=>results[i.id]='等待检测');let index=0;try{await Promise.all(Array.from({length:Math.min(5,list.length)},async()=>{while(index<list.length){const i=list[index++];results[i.id]='检测中…';await probe(i)}}));ElMessage.info(`已完成 ${list.length} 个网址的检测`)}finally{testing.value=false}}
onMounted(async()=>{await load();if(route.query.focus){const item=items.value.find((i:any)=>i.id===Number(route.query.focus));if(item)openForm(item)}})
</script>
<style scoped>
.bookmark-page{width:100%;height:100%;overflow:auto;box-sizing:border-box}
.tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid var(--wb-border)}
.search{width:250px}.count{font-size:12px;color:var(--wb-text-tertiary)}.spacer{flex:1}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;padding:20px;align-content:start}
.card{display:flex;align-items:center;gap:8px;min-width:0;padding:14px 12px 14px 16px;border:1px solid var(--wb-border);border-radius:8px;background:var(--wb-bg);transition:border-color .15s,background-color .15s}
.card:hover{background:var(--wb-nav-hover);border-color:var(--wb-text-tertiary)}
.site-link{display:flex;align-items:center;gap:13px;flex:1;min-width:0;text-decoration:none;color:var(--wb-text);border-radius:4px}
.site-link:focus-visible,.more:focus-visible{outline:2px solid var(--wb-text-secondary);outline-offset:4px}
.avatar{width:40px;height:40px;border-radius:9px;background:var(--wb-nav-active);display:grid;place-items:center;flex-shrink:0;font-size:18px;font-weight:600}
.avatar img{width:26px;height:26px;object-fit:contain}.site-info{display:flex;flex-direction:column;gap:5px;min-width:0}
.site-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:20px}
.site-domain{font-size:12px;color:var(--wb-text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:16px}
.site-actions{align-self:stretch;display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;flex-shrink:0;gap:3px;max-width:105px}
.more{border:0;background:transparent;color:var(--wb-text-tertiary);font-size:18px;line-height:20px;width:26px;height:24px;cursor:pointer;border-radius:4px}.more:hover{background:var(--wb-nav-active);color:var(--wb-text)}
.site-status{font-size:10px;line-height:14px;color:var(--wb-text-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums}
.empty{text-align:center;padding:56px 0;color:var(--wb-text-tertiary)}.name-row{display:flex;align-items:center;gap:10px;width:100%}
@media(max-width:700px){.tools{padding:10px 12px}.search{width:100%}.cards{padding:12px}.spacer{display:none}}
@media(prefers-reduced-motion:reduce){.card{transition:none}}
</style>
