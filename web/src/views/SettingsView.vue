<template>
  <div class="page">
    <div class="page-toolbar">
      <div class="title-15">设置</div>
    </div>

    <el-tabs :model-value="activeTab" class="settings-tabs" @tab-change="changeTab">
      <el-tab-pane label="通用设置" name="general" />
      <el-tab-pane label="回收站" name="trash" />
    </el-tabs>

    <TrashView v-if="activeTab === 'trash'" class="settings-trash" />
    <div v-else class="page-body">
      <el-card shadow="never" class="block">
        <div class="group-title">主题</div>
        <div class="row">
          <el-radio-group :model-value="session.theme" @change="changeTheme">
            <el-radio-button value="light">浅色</el-radio-button>
            <el-radio-button value="dark">深色</el-radio-button>
          </el-radio-group>
          <span class="text-13 secondary" style="margin-left: 10px">主题色</span>
          <el-color-picker
            :model-value="session.themeColor"
            :predefine="presetColors"
            @change="changeColor"
          />
          <el-button text size="small" @click="changeColor(DEFAULT_THEME_COLOR)">恢复默认</el-button>
          <div class="spacer" />
          <span class="text-12 muted">主题和颜色会保存到账号，换设备也一致</span>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="group-title">账号</div>
        <el-form label-position="top" style="max-width: 760px">
          <el-form-item label="用户名">
            <el-input :model-value="session.user?.username" disabled style="max-width: 420px" />
          </el-form-item>
          <div class="pwd-grid">
            <el-form-item label="原密码">
              <el-input v-model="passwordForm.old_password" type="password" show-password autocomplete="current-password" />
            </el-form-item>
            <el-form-item label="新密码（至少 8 位）">
              <el-input v-model="passwordForm.new_password" type="password" show-password autocomplete="new-password" />
            </el-form-item>
            <el-form-item label="确认新密码">
              <el-input v-model="passwordForm.confirm" type="password" show-password autocomplete="new-password" />
            </el-form-item>
          </div>
          <div class="row">
            <el-button type="primary" :loading="savingPassword" @click="changePassword">修改密码</el-button>
            <div class="spacer" />
            <el-button plain @click="handleLogout">退出登录</el-button>
          </div>
          <div class="text-12 muted" style="margin-top: 6px">改完后其他设备上的登录会失效，当前这台不受影响。</div>
        </el-form>
      </el-card>

      <AgentAccess />

      <div class="bottom-grid">
        <el-card shadow="never" class="block">
          <div class="group-title">翻译服务</div>
          <div class="row">
            <span class="text-13 secondary">
              百度、有道、DeepSeek 的密钥在翻译页「服务设置」里填，保存后只显示打码内容
            </span>
            <div class="spacer" />
            <el-button class="btn-tonal" @click="$router.push('/translate')">前往翻译页</el-button>
          </div>
        </el-card>

        <el-card shadow="never" class="block">
          <div class="group-title">系统状态</div>
          <div class="usage-grid">
            <div class="usage-item"><span class="muted">服务状态</span><span>{{ health.status || '未知' }}</span></div>
            <div class="usage-item"><span class="muted">数据存储</span><span>{{ health.database || '未知' }}</span></div>
            <div class="usage-item"><span class="muted">时区</span><span>Asia/Shanghai（北京时间）</span></div>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { apiError, http } from '@/api/client'
import { applyTheme, logout, session, setThemeColor } from '@/stores/session'
import { DEFAULT_THEME_COLOR } from '@/theme-color'
import AgentAccess from '@/components/AgentAccess.vue'
import TrashView from '@/views/TrashView.vue'

const router = useRouter()
const route = useRoute()
const activeTab = computed(() => route.name === 'settings-trash' ? 'trash' : 'general')
function changeTab(name: string | number) { router.push(name === 'trash' ? '/settings/trash' : '/settings') }
const passwordForm = reactive({ old_password: '', new_password: '', confirm: '' })
const savingPassword = ref(false)
const health = reactive<Record<string, any>>({})

const presetColors = ['#2383e2', '#37352f', '#787774', '#448361', '#337ea9', '#9065b0', '#c14c8a', '#cb912f']

async function changeColor(value: string | null) {
  if (!value) return
  try {
    await setThemeColor(value)
    ElMessage.success('主题色已更新')
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function changeTheme(value: any) {
  const theme = value === 'dark' ? 'dark' : 'light'
  applyTheme(theme)
  try {
    await http.put('/preferences', { theme })
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function changePassword() {
  if (!passwordForm.old_password || !passwordForm.new_password) {
    ElMessage.warning('请填写原密码和新密码')
    return
  }
  if (passwordForm.new_password.length < 8) {
    ElMessage.warning('新密码至少 8 位')
    return
  }
  if (passwordForm.new_password !== passwordForm.confirm) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  savingPassword.value = true
  try {
    await http.post('/auth/password', {
      old_password: passwordForm.old_password,
      new_password: passwordForm.new_password,
    })
    ElMessage.success('密码已修改')
    passwordForm.old_password = ''
    passwordForm.new_password = ''
    passwordForm.confirm = ''
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    savingPassword.value = false
  }
}

async function handleLogout() {
  await logout()
  router.replace('/login')
}

onMounted(async () => {
  try {
    const { data } = await http.get('/health')
    Object.assign(health, data)
  } catch {
    health.status = '不可用'
  }
})
</script>

<style scoped>
.settings-tabs { flex-shrink: 0; }
.settings-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.settings-trash { padding: 0; height: auto; min-height: 320px; flex: 1; }

.block {
  flex: 0 0 auto;
  margin-bottom: 10px;
}
.bottom-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.bottom-grid .block {
  margin-bottom: 0;
}
@media (max-width: 900px) {
  .bottom-grid {
    grid-template-columns: 1fr;
  }
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.pwd-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 12px;
}
@media (max-width: 900px) {
  .pwd-grid {
    grid-template-columns: 1fr;
  }
}
.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 8px 16px;
}
.usage-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
}
.usage-item .muted {
  flex: 0 0 82px;
}
</style>
