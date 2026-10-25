<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-title">个人工作台</div>
      <div class="login-sub muted">登录后按工作类型集中处理店铺与社媒的周期工作</div>
      <el-form label-position="top" :model="form" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" autocomplete="username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" :error="errorText">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入密码"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" class="login-submit" :loading="loading" native-type="submit">
          登录
        </el-button>
      </el-form>
      <div class="login-foot muted text-12">会话保持 30 天，关闭浏览器后重新打开仍可使用</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiError } from '@/api/client'
import { login } from '@/stores/session'

const router = useRouter()
const route = useRoute()

const form = reactive({ username: '', password: '' })
const loading = ref(false)
const errorText = ref('')

async function submit() {
  if (!form.username.trim() || !form.password) {
    errorText.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    await login(form.username.trim(), form.password)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/checkins/shops'
    router.replace(redirect)
  } catch (error) {
    errorText.value = apiError(error).message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--wb-bg);
  padding: 24px;
}
.login-card {
  width: 360px;
  max-width: 100%;
  background: var(--wb-surface);
  border: 1px solid var(--wb-border);
  border-radius: 12px;
  padding: 26px 24px 20px;
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.06);
}
.login-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 6px;
}
.login-sub {
  font-size: 13px;
  margin-bottom: 18px;
  line-height: 1.6;
}
.login-submit {
  width: 100%;
  margin-top: 4px;
}
.login-foot {
  margin-top: 14px;
  text-align: center;
}
</style>
