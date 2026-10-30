import { createApp } from 'vue'
import { ElLoading } from 'element-plus'

// 引入顺序固定：组件库基线 → 暗色变量 → 项目主题（必须最后）
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(router)
app.directive('loading', ElLoading.directive)
app.mount('#app')
