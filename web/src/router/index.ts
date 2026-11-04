import { createRouter, createWebHistory } from 'vue-router'
import { loadSession, session } from '@/stores/session'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
  { path: '/', redirect: '/checkins' },
  { path:'/checkins',name:'checkins',component:()=>import('@/views/CheckinView.vue'),meta:{title:'打卡'} },
  { path:'/checkins/items/:targetId',name:'checkin-item',component:()=>import('@/views/CheckinView.vue'),meta:{title:'打卡'} },
  {
    path: '/checkins/shops',
    name: 'shops',
    component: () => import('@/views/CheckinView.vue'),
    meta: { title: '打卡', kind: 'shop' },
  },
  {
    path: '/checkins/social',
    name: 'social',
    component: () => import('@/views/CheckinView.vue'),
    meta: { title: '打卡', kind: 'social' },
  },
  {
    path: '/checkins/targets/:id',
    name: 'target',
    component: () => import('@/views/TargetDetailView.vue'),
    meta: { title: '资料' },
  },
  { path: '/todos/:listId?', name: 'todos', component: () => import('@/views/TodosView.vue'), meta: { title: '待办' } },
  { path: '/dashboard', redirect: (to: any) => ({ path: '/visualizations', query: to.query }) },
  { path: '/visualizations/:dashboardId?', name: 'visualizations', component: () => import('@/views/DashboardView.vue'), meta: { title: '数据可视化' } },
  { path: '/data/virtual/new', redirect: '/data' },
  { path: '/data/:tableId/virtual/edit', redirect: '/data' },
  { path: '/data', name: 'data', component: () => import('@/views/TablesView.vue'), meta: { title: '表格' } },
  {
    path: '/data/:tableId',
    name: 'table',
    component: () => import('@/views/TableRouteView.vue'),
    meta: { title: '表格' },
  },
  { path: '/notes/:folderKey?', name: 'notes', component: () => import('@/views/NotesView.vue'), meta: { title: '笔记' } },
  { path: '/memos', name: 'memos', component: () => import('@/views/MemosView.vue'), meta: { title: '便利贴' } },
  { path: '/translate', name: 'translate', component: () => import('@/views/TranslateView.vue'), meta: { title: '翻译' } },
  { path: '/images', name: 'images', component: () => import('@/views/ImageToolsView.vue'), meta: { title: '图片处理' } },
  { path: '/bookmarks', name: 'bookmarks', component: () => import('@/views/BookmarksView.vue'), meta: { title: '网址导航' } },
  ...['tasks','search','activity'].map(path=>({path:'/'+path,name:path,component:()=>import('@/views/WorkspaceToolsView.vue'),meta:{title:path==='search'?'统一搜索':path==='activity'?'操作记录':'任务中心'}})),
  { path: '/trash', redirect: '/settings/trash' },
  { path: '/settings/trash', name: 'settings-trash', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置 · 回收站' } },
  { path: '/settings/:section(appearance|navigation|account|agents|translation|system|ai)', name: 'settings-section', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } },
  { path: '/:pathMatch(.*)*', redirect: '/checkins/shops' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (!session.loaded) {
    await loadSession()
  }
  document.title = `${to.meta.title || 'Nexus'} · Nexus`
  if (to.meta.public) {
    return session.user ? { path: '/checkins/shops' } : true
  }
  if (!session.user) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
