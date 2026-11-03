<template><div class="heavy-error" role="alert"><p>组件加载失败，请检查连接后重新加载。</p><el-button @click="reload">重新加载页面</el-button></div></template><script setup lang="ts">
const reload=()=>window.location.reload();
</script><style scoped>.heavy-error{text-align:center;padding:40px;color:var(--el-color-danger)}</style>