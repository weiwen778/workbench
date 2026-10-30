import { createRouter, createWebHistory } from 'vue-router'
import { loadSession, session } from '@/stores/session'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
  { path: '/', redirect: '/checkins/shops' },
  {
    path: '/checkins/shops',
    name: 'shops',
    component: () => import('@/views/CheckinView.vue'),
    meta: { title: '店铺打卡', kind: 'shop' },
  },
  {
    path: '/checkins/social',
    name: 'social',
    component: () => import('@/views/CheckinView.vue'),
    meta: { title: '社媒打卡', kind: 'social' },
  },
  {
    path: '/checkins/targets/:id',
    name: 'target',
    component: () => import('@/views/TargetDetailView.vue'),
    meta: { title: '资料' },
  },
  { path: '/todos', name: 'todos', component: () => import('@/views/TodosView.vue'), meta: { title: '待办' } },
  { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '经营驾驶舱' } },
  { path: '/data', name: 'data', component: () => import('@/views/TablesView.vue'), meta: { title: '表格' } },
  {
    path: '/data/:tableId',
    name: 'table',
    component: () => import('@/views/TableDataView.vue'),
    meta: { title: '表格' },
  },
  { path: '/notes', name: 'notes', component: () => import('@/views/NotesView.vue'), meta: { title: '笔记' } },
  { path: '/memos', name: 'memos', component: () => import('@/views/MemosView.vue'), meta: { title: '便利贴' } },
  { path: '/translate', name: 'translate', component: () => import('@/views/TranslateView.vue'), meta: { title: '翻译' } },
  { path: '/trash', name: 'trash', component: () => import('@/views/TrashView.vue'), meta: { title: '回收站' } },
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
  document.title = `${to.meta.title || '个人工作台'} · 个人工作台`
  if (to.meta.public) {
    return session.user ? { path: '/checkins/shops' } : true
  }
  if (!session.user) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
