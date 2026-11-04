<template>
  <aside class="wb-sidebar nexus-sidebar" :style="{width:width ? width+'px' : '100%'}" aria-label="主导航">
    <div class="brand"><span>Nexus</span><span class="spacer"/><el-button v-if="collapsible" text :icon="Fold" class="collapse-nav" aria-label="收起侧栏" title="收起侧栏" @click="emit('collapse')"/></div>
    <div class="nav-search"><el-input v-model="query" :prefix-icon="Search" clearable placeholder="查找导航项目" aria-label="查找导航项目" @keydown.esc="query=''"/></div>
    <nav ref="navScroll" class="nav-scroll" aria-label="工作空间导航">
      <div class="section-label">工作空间</div>
      <section v-for="group in visibleGroups" :key="group.key" class="nav-group" :data-nav-group="group.key">
        <div class="group-row" :class="{'in-section':currentGroup===group.key}">
          <button class="group-link nav-button" :class="{active:isActive(group.path)&&!isOpen(group.key)}" :aria-current="isActive(group.path)&&!isOpen(group.key)?'page':undefined" :aria-expanded="isOpen(group.key)" :title="group.label" @click="openGroup(group)"><el-icon><component :is="group.icon"/></el-icon><span>{{group.label}}</span></button>
          <button class="nav-icon group-create" :aria-label="group.createLabel" :title="group.createLabel" @click="create(group.key)"><el-icon><Plus/></el-icon></button>
          <button class="nav-icon group-toggle" :aria-label="`${isOpen(group.key)?'收起':'展开'}${group.label}`" :aria-expanded="isOpen(group.key)" :aria-controls="`${navId}-${group.key}`" @click="toggle(group.key)"><el-icon :class="{rotated:isOpen(group.key)}"><ArrowRight/></el-icon></button>
        </div>
        <div v-if="isOpen(group.key)" :id="`${navId}-${group.key}`" class="group-children" :aria-label="group.childrenLabel">
          <div v-for="item in shownItems(group)" :key="item.path" class="child-row" :class="{selected:isActive(item.path)}">
            <button class="child-link nav-button" :class="{active:isActive(item.path)}" :aria-current="isActive(item.path)?'page':undefined" :title="item.label" @click="go(item.path)"><span class="child-dot"/><span class="child-name">{{item.label}}</span><span v-if="item.count" class="nav-count">{{item.count}}</span></button>
            <button v-if="item.targetId" class="nav-icon rename-project" :aria-label="`重命名${item.label}`" title="重命名" @click="emit('rename-checkin',item.targetId)"><el-icon><Edit/></el-icon></button>
          </div>
          <button v-if="filteredItems(group).length>shownItems(group).length" class="show-more nav-button" @click="showAll[group.key]=true">显示其余 {{filteredItems(group).length-shownItems(group).length}} 项<el-icon><ArrowRight/></el-icon></button>
          <div v-if="!filteredItems(group).length" class="nav-empty">{{query?'没有匹配的项目':'暂无项目，点击 + 新建'}}</div>
        </div>
      </section>
      <div v-if="visibleTools.length" class="section-label tools-label">工具</div>
      <button v-for="item in visibleTools" :key="item.path" class="tool-link nav-button" :class="{active:isActive(item.path)}" :aria-current="isActive(item.path)?'page':undefined" @click="go(item.path)"><el-icon><component :is="item.icon"/></el-icon><span>{{item.label}}</span></button>
      <div v-if="!visibleGroups.length&&!visibleTools.length" class="search-empty">没有找到“{{query}}”<button class="show-more nav-button" @click="query=''">清除搜索</button></div>
    </nav>
    <div class="nav-footer"><button class="footer-link nav-button" :class="{active:route.path==='/tasks'}" @click="go('/tasks')"><el-icon><Todo/></el-icon><span>任务中心</span></button><button class="footer-link nav-button" :class="{active:route.path.startsWith('/settings')}" @click="go('/settings')"><el-icon><Setting/></el-icon><span>设置</span></button></div>
  </aside>
</template>

<script setup lang="ts">
import {computed,ref,onMounted,onBeforeUnmount,watch,useId,nextTick} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ArrowRight,Calendar,DashboardIcon,Collection,Document,Fold,Memo,Plus,Todo,Translate,Picture,Edit,Link,Search,Setting} from '@/icons'
import {ElMessage,ElMessageBox} from 'element-plus'
import {http,apiError} from '@/api/client'
import {memoPath} from '@/memo-navigation'
import {session} from '@/stores/session'
type Item={label:string;path:string;count?:number;targetId?:number}
type Group={key:string;label:string;path:string;icon:any;createLabel:string;childrenLabel:string;items:Item[]}
const props=defineProps<{checkinTargets:any[];tables:any[];dashboards:{id:number;name:string}[];tableSearch:string;todoLists:any[];noteFolders:any[];uncategorizedCount:number;memoCategories:string[];collapsed?:boolean;collapsible?:boolean;width?:number}>()
const emit=defineEmits<{(e:'update:tableSearch',value:string):void;(e:'navigate'):void;(e:'new-table'):void;(e:'new-dashboard'):void;(e:'new-todo-list'):void;(e:'new-note-folder'):void;(e:'new-memo-category'):void;(e:'collapse'):void;(e:'new-checkin'):void;(e:'rename-checkin',key:number):void}>()
const route=useRoute(),router=useRouter(),navId=useId(),navScroll=ref<HTMLElement>()
const query=computed({get:()=>props.tableSearch,set:value=>emit('update:tableSearch',value)})
const normalized=computed(()=>query.value.trim().toLocaleLowerCase())
const bookmarks=ref<string[]>([])
const groups=computed<Group[]>(()=>[
 {key:'checkin',label:'打卡',path:'/checkins',icon:Calendar,createLabel:'新建打卡项目',childrenLabel:'打卡项目',items:[{label:'全部打卡',path:'/checkins'},...props.checkinTargets.map(t=>({label:t.name,path:`/checkins/items/${t.id}`,targetId:t.id}))]},
 {key:'visualizations',label:'数据可视化',path:'/visualizations',icon:DashboardIcon,createLabel:'新建看板',childrenLabel:'数据可视化看板',items:[{label:'全部看板',path:'/visualizations'},...props.dashboards.map(t=>({label:t.name,path:`/visualizations/${t.id}`}))]},
 {key:'data',label:'表格',path:'/data',icon:Collection,createLabel:'新建表格',childrenLabel:'表格项目',items:[{label:'全部表格',path:'/data'},...props.tables.map(t=>({label:t.name,path:`/data/${t.id}`}))]},
 {key:'todos',label:'待办',path:'/todos',icon:Todo,createLabel:'新建清单',childrenLabel:'待办清单',items:[{label:'全部待办',path:'/todos'},...props.todoLists.map(t=>({label:t.name,path:`/todos/${t.id}`,count:t.pending}))]},
 {key:'notes',label:'笔记',path:'/notes',icon:Document,createLabel:'新建文件夹',childrenLabel:'笔记文件夹',items:[{label:'全部笔记',path:'/notes'},{label:'未分类',path:'/notes/uncategorized',count:props.uncategorizedCount},...props.noteFolders.map(t=>({label:t.name,path:`/notes/${t.id}`,count:t.note_count}))]},
 {key:'memos',label:'便利贴',path:'/memos',icon:Memo,createLabel:'新建分类',childrenLabel:'便利贴分类',items:[{label:'全部便利贴',path:'/memos'},{label:'未分类',path:memoPath(null)},...props.memoCategories.map(name=>({label:name,path:memoPath(name)}))]},
 {key:'bookmarks',label:'网址导航',path:'/bookmarks',icon:Link,createLabel:'新建网址分类',childrenLabel:'网址分类',items:[{label:'全部网址',path:'/bookmarks'},{label:'未分类',path:'/bookmarks?category=__none'},...bookmarks.value.map(name=>({label:name,path:'/bookmarks?category='+encodeURIComponent(name)}))]},
])
const tools=[{label:'翻译',path:'/translate',icon:Translate},{label:'图片处理',path:'/images',icon:Picture}]
const visibleTools=computed(()=>tools.filter(t=>t.label.includes(normalized.value)))
function matchesGroup(group:Group){return group.label.toLocaleLowerCase().includes(normalized.value)}
function filteredItems(group:Group){return !normalized.value||matchesGroup(group)?group.items:group.items.filter(t=>t.label.toLocaleLowerCase().includes(normalized.value))}
const visibleGroups=computed(()=>groups.value.filter(g=>!normalized.value||matchesGroup(g)||filteredItems(g).length))
const currentGroup=computed(()=>groups.value.find(g=>route.path===g.path||route.path.startsWith(g.path+'/'))?.key)
function isActive(path:string){const target=router.resolve(path);return route.path===target.path&&JSON.stringify(Object.entries(route.query).filter(([k])=>['category','uncategorized'].includes(k)).sort())===JSON.stringify(Object.entries(target.query).sort())}
const storageKey=`wb_nav_expanded_v2:${session.user?.id??'local'}`
function readExpanded():string[]{try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(data)?data.filter(v=>typeof v==='string'):[]}catch{return []}}
const expanded=ref<string[]>(readExpanded()),showAll=ref<Record<string,boolean>>({})
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(expanded.value))}catch{/* navigation remains usable */}}
function isOpen(key:string){return !!normalized.value||expanded.value.includes(key)}
function ensureOpen(key:string){if(!expanded.value.includes(key)){expanded.value=[...expanded.value,key];persist()}}
function toggle(key:string){if(normalized.value){query.value='';expanded.value=expanded.value.filter(v=>v!==key);persist();return}expanded.value=expanded.value.includes(key)?expanded.value.filter(v=>v!==key):[...expanded.value,key];persist()}
function shownItems(group:Group){const items=filteredItems(group);return normalized.value||showAll.value[group.key]||items.findIndex(t=>isActive(t.path))>=8?items:items.slice(0,8)}
function go(path:string){query.value='';if(route.fullPath!==path)void router.push(path);emit('navigate')}
function openGroup(group:Group){ensureOpen(group.key);go(group.path)}
function create(key:string){switch(key){case 'checkin':emit('new-checkin');break;case 'visualizations':emit('new-dashboard');break;case 'data':emit('new-table');break;case 'todos':emit('new-todo-list');break;case 'notes':emit('new-note-folder');break;case 'memos':emit('new-memo-category');break;case 'bookmarks':void createBookmarkCategory()}}
async function loadBookmarks(){try{bookmarks.value=(await http.get('/bookmarks/categories')).data}catch{/* preserve last result */}}
async function createBookmarkCategory(){try{const {value}=await ElMessageBox.prompt('分类名称','新建网址分类',{inputPlaceholder:'例如：运营工具',inputValidator:v=>!!v?.trim()&&v.trim().length<=80||'请输入 1–80 个字符',confirmButtonText:'创建',cancelButtonText:'取消'});const {data}=await http.post('/bookmarks/categories',{name:value.trim()});window.dispatchEvent(new Event('wb-bookmarks-changed'));go('/bookmarks?category='+encodeURIComponent(data.name))}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiError(e).message)}}
watch(()=>route.path,()=>{if(currentGroup.value)ensureOpen(currentGroup.value)},{immediate:true})
watch([()=>route.fullPath,groups],async()=>{
 await nextTick()
 if(normalized.value)return
 const scroller=navScroll.value,selected=scroller?.querySelector<HTMLElement>('.child-link.active,.tool-link.active')
 if(!scroller||!selected)return
 const view=scroller.getBoundingClientRect(),item=selected.getBoundingClientRect()
 if(item.top<view.top)scroller.scrollTop+=item.top-view.top-8
 else if(item.bottom>view.bottom)scroller.scrollTop+=item.bottom-view.bottom+8
},{immediate:true})
onMounted(()=>{void loadBookmarks();window.addEventListener('wb-bookmarks-changed',loadBookmarks)})
onBeforeUnmount(()=>window.removeEventListener('wb-bookmarks-changed',loadBookmarks))
</script>

<style scoped>
.nexus-sidebar{background:var(--wb-sidebar-bg);box-sizing:border-box;overflow:hidden}
.nexus-sidebar .brand{height:60px;flex:none;padding:0 18px;border-bottom:0;font-size:21px;letter-spacing:-.5px;font-weight:700}
.collapse-nav{width:32px;height:32px;padding:0;margin-right:-6px;color:var(--wb-text-secondary)}
.nav-search{padding:0 12px 16px;flex:none}.nav-search :deep(.el-input__wrapper){min-height:36px;background:var(--wb-surface);box-shadow:0 0 0 1px var(--wb-border) inset;border-radius:8px}.nav-search :deep(input){font-size:12px}
.nav-scroll{flex:1;min-height:0;overflow:auto;padding:0 10px 16px;scrollbar-width:thin;scrollbar-gutter:stable}
.section-label{padding:0 10px 8px;font-size:11px;line-height:20px;font-weight:600;color:var(--wb-text-tertiary);letter-spacing:.5px}.tools-label{margin-top:16px;padding-top:14px;border-top:1px solid var(--wb-border)}
.nav-group{margin-bottom:4px}.group-row{display:flex;align-items:center;min-width:0;border-radius:8px;padding-right:2px;transition:background .12s}.group-row:hover{background:var(--wb-nav-hover)}
.nav-button,.nav-icon{appearance:none;border:0;background:transparent;color:var(--wb-text-secondary);font:inherit;cursor:pointer;min-width:0;text-align:left}
.nav-button:focus-visible,.nav-icon:focus-visible{outline:2px solid var(--wb-primary);outline-offset:-2px;border-radius:7px}
.group-link{display:flex;align-items:center;gap:10px;flex:1;min-height:42px;padding:8px 10px;font-size:13px;font-weight:500;border-radius:8px}.group-link>.el-icon{font-size:19px;flex:none}.group-link>span:not(.el-icon){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-icon{display:flex;align-items:center;justify-content:center;flex:none;width:30px;height:34px;border-radius:6px;padding:0}.nav-icon .el-icon{font-size:16px}.nav-icon:hover{background:var(--wb-surface);color:var(--wb-text)}.group-toggle .el-icon{font-size:13px;transition:transform .15s}.rotated{transform:rotate(90deg)}
.in-section .group-link{color:var(--wb-text);font-weight:600}.group-link.active{color:var(--wb-primary);background:var(--wb-nav-active)}
.group-children{position:relative;margin:2px 0 8px 19px;padding-left:12px;border-left:1px solid var(--wb-border)}
.child-row{display:flex;align-items:center;min-width:0;border-radius:7px;margin:2px 0;position:relative}.child-row:hover{background:var(--wb-nav-hover)}.child-row.selected{background:var(--wb-nav-active)}.child-row.selected::before{content:'';position:absolute;left:-14px;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--wb-primary)}
.child-link{display:flex;align-items:center;gap:8px;flex:1;min-height:36px;padding:8px 9px;font-size:12.5px;line-height:1.5;border-radius:7px}.child-link.active{color:var(--wb-primary);font-weight:600}.child-dot{width:4px;height:4px;border-radius:50%;background:var(--wb-text-tertiary);opacity:.6;flex:none}.active .child-dot{background:var(--wb-primary);opacity:1}
.child-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;flex:1;min-width:0}.nav-count{font-size:11px;color:var(--wb-text-tertiary);font-variant-numeric:tabular-nums;flex:none}
.rename-project{width:28px;height:32px;opacity:0;pointer-events:none}.child-row:hover .rename-project,.child-row:focus-within .rename-project{opacity:1;pointer-events:auto}
.show-more{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:7px 10px;font-size:12px;color:var(--wb-primary);border-radius:6px}.show-more:hover{background:var(--wb-nav-hover)}.show-more .el-icon{font-size:12px}.nav-empty,.search-empty{font-size:12px;line-height:1.7;color:var(--wb-text-tertiary);padding:10px}
.tool-link{display:flex;align-items:center;gap:10px;min-height:42px;width:100%;padding:8px 10px;font-size:13px;border-radius:8px}.tool-link .el-icon{font-size:19px}.tool-link:hover,.footer-link:hover{background:var(--wb-nav-hover)}.tool-link.active,.footer-link.active{color:var(--wb-primary);background:var(--wb-nav-active);font-weight:600}
.nav-footer{flex:none;display:flex;gap:6px;padding:10px;border-top:1px solid var(--wb-border);background:var(--wb-sidebar-bg)}.footer-link{display:flex;align-items:center;justify-content:center;gap:7px;flex:1;min-height:38px;border-radius:8px;font-size:12px}.footer-link .el-icon{font-size:18px}
@media(hover:none){.rename-project{opacity:1;pointer-events:auto}.nav-icon{width:34px;height:40px}.child-link{min-height:42px}}
@media(prefers-reduced-motion:reduce){.group-row,.group-toggle .el-icon{transition:none}}
</style>