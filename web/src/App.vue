<template>
  <router-view v-if="isPublic" />
  <AppLayout v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'

const route = useRoute()
const isPublic = computed(() => route.meta.public === true)
</script>
