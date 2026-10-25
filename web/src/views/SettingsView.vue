<template>
  <div class="page">
    <div class="page-toolbar">
      <div class="title-15">设置</div>
    </div>

    <div class="page-body scroll-area">
      <el-card shadow="never" class="block">
        <div class="group-title">主题</div>
        <div class="row">
          <span class="text-13 secondary">浅色／深色会保存到账号，桌面和平板读取同一偏好</span>
          <div class="spacer" />
          <el-radio-group :model-value="session.theme" @change="changeTheme">
            <el-radio-button value="light">浅色</el-radio-button>
            <el-radio-button value="dark">深色</el-radio-button>
          </el-radio-group>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="group-title">账号</div>
        <el-form label-position="top" style="max-width: 420px">
          <el-form-item label="用户名">
            <el-input :model-value="session.user?.username" disabled />
          </el-form-item>
          <el-form-item label="原密码">
            <el-input v-model="passwordForm.old_password" type="password" show-password autocomplete="current-password" />
          </el-form-item>
          <el-form-item label="新密码（至少 8 位）">
            <el-input v-model="passwordForm.new_password" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="passwordForm.confirm" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-button type="primary" :loading="savingPassword" @click="changePassword">修改密码</el-button>
          <div class="text-12 muted" style="margin-top: 6px">修改后其他设备的登录会话会失效，当前会话保留。</div>
        </el-form>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="group-title">翻译服务</div>
        <div class="row">
          <span class="text-13 secondary">
            百度、有道、DeepSeek 的凭据在翻译页的「服务设置」中维护，保存后只显示脱敏内容
          </span>
          <div class="spacer" />
          <el-button class="btn-tonal" @click="$router.push('/translate')">前往翻译页</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="group-title">使用说明</div>
        <div class="usage-grid">
          <div v-for="item in usage" :key="item.k" class="usage-item">
            <span class="muted">{{ item.k }}</span>
            <span>{{ item.v }}</span>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="group-title">运行信息</div>
        <div class="usage-grid">
          <div class="usage-item"><span class="muted">服务状态</span><span>{{ health.status || '未知' }}</span></div>
          <div class="usage-item"><span class="muted">数据库</span><span>{{ health.database || '未知' }}</span></div>
          <div class="usage-item"><span class="muted">时区</span><span>Asia/Shanghai（北京时间）</span></div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiError, http } from '@/api/client'
import { applyTheme, session } from '@/stores/session'

const passwordForm = reactive({ old_password: '', new_password: '', confirm: '' })
const savingPassword = ref(false)
const health = reactive<Record<string, any>>({})

const usage = [
  { k: '每天的工作', v: '登录后默认进入店铺打卡／今日，按分组处理，完成后手动打勾；日／周／月切换在顶部' },
  { k: '周期规则', v: '每日事项当天有效，每周从周一 00:00 起，每月按自然月；周期结束后只读，不能补打卡' },
  { k: '待办', v: '父任务有子任务时完成状态由子任务决定；逾期仍可完成，不会自动移入历史' },
  { k: '数据表', v: '点击一行打开表单修改；筛选与排序只在本次生效，重新进入按默认规则加载' },
  { k: '附件', v: '每个附件字段一个文件，单个文件最大 20 MB；预览和下载都需要登录' },
  { k: '笔记', v: '停止输入约 1.5 秒自动保存，手动保存与每 5 分钟会保留历史版本，最多 100 个' },
  { k: '回收站', v: '数据表、记录、笔记、便签保留 30 天；待办、打卡对象不进入回收站' },
  { k: '翻译', v: '三家服务分别配置；译文只读，历史在页面下方，只支持查看和复制' },
]

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
.block {
  margin-bottom: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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
