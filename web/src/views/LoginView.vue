<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-title">个人工作台</div>
      <el-form :model="form" @submit.prevent="submit">
        <el-form-item>
          <el-input
            v-model="form.username"
            autocomplete="username"
            placeholder="请输入用户名"
            aria-label="用户名"
          />
        </el-form-item>
        <el-form-item :error="errorText">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入密码"
            aria-label="密码"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" class="login-submit" :loading="loading" native-type="submit">
          登录
        </el-button>
      </el-form>
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
  text-align: center;
  margin-bottom: 22px;
}
.login-submit {
  width: 100%;
  margin-top: 4px;
}
</style>
