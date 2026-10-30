<template>
  <el-config-provider :locale="zhCn">
    <router-view v-if="isPublic" />
    <AppLayout v-else />
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useRoute } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'

const route = useRoute()
const isPublic = computed(() => route.meta.public === true)
</script>
