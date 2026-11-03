<template>
 <section class="backup-panel setting-card">
  <div class="heading"><div><h3>备份与恢复</h3><p>完整备份包含数据库、附件及服务加密配置。备份文件经过加密，恢复密钥需要另行保存。</p></div><el-button type="primary" :loading="creating" @click="create">立即备份</el-button></div>
  <el-alert v-if="failure" type="error" :title="failure" :closable="false"/>
  <p class="text-13 secondary">{{ config.enabled?`每 ${config.interval_hours} 小时自动备份，保留最近 ${config.keep} 份。`:'自动备份已关闭。' }} 执行进度和失败原因可在任务中心查看。</p>
  <div class="actions"><el-button @click="router.push('/tasks')">打开任务中心</el-button><el-link href="/api/v1/backups/recovery-key" type="primary">下载恢复密钥</el-link><el-button text @click="load">刷新备份列表</el-button></div>
  <el-alert type="info" :closable="false" title="请将备份和恢复密钥分别保存到其他安全位置。本机备份无法覆盖整台电脑或磁盘损坏的情况。恢复前应停止目标服务，并恢复到空数据库和空附件目录。"/>
  <details><summary>如何恢复备份</summary><p class="text-13 secondary">先停止目标服务，准备空数据库与空附件目录，再使用项目恢复工具校验并恢复。完整步骤见项目 docs/备份与恢复.md。恢复会撤销旧登录会话和 Agent 令牌，未完成任务不会自动重放。</p></details>
  <el-table :data="config.items" empty-text="尚无完整备份" v-loading="loading"><el-table-column label="创建时间" min-width="160"><template #default="{row}">{{ new Date(row.created_at).toLocaleString('zh-CN') }}</template></el-table-column><el-table-column label="大小" width="100"><template #default="{row}">{{ (row.size/1024/1024).toFixed(1) }} MB</template></el-table-column><el-table-column prop="file_count" label="附件数" width="90"/><el-table-column label="操作" min-width="180"><template #default="{row}"><el-link :href="`/api/v1/backups/${row.id}/download`" type="primary">下载备份</el-link><el-button text @click="verify(row)">校验完整性</el-button></template></el-table-column></el-table>
 </section>
</template>
<script setup lang="ts">
import {ref,onMounted} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {http,apiError} from '@/api/client'
const router=useRouter(),config=ref<any>({items:[],enabled:false}),failure=ref(''),loading=ref(false),creating=ref(false)
async function load(){loading.value=true;try{config.value=(await http.get('/backups')).data}catch(e){failure.value=apiError(e).message}finally{loading.value=false}}
async function create(){creating.value=true;try{await http.post('/backups');ElMessage.success('已加入后台备份队列，可在任务中心查看进度')}catch(e){ElMessage.error(apiError(e).message)}finally{creating.value=false}}
async function verify(row:any){try{await http.post(`/backups/${row.id}/verify`);ElMessage.success('已提交校验任务，请在任务中心查看结果')}catch(e){ElMessage.error(apiError(e).message)}}
onMounted(load)
</script>
<style scoped>.heading{display:flex;gap:16px;justify-content:space-between;align-items:center;flex-wrap:wrap}.heading h3{font-size:14px;margin:0 0 8px}.heading p{font-size:12px;color:var(--wb-text-secondary);margin:0;line-height:1.8}.actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:12px 0}.backup-panel :deep(.el-alert){margin:12px 0}</style>