<template>
  <div class="page">
    <div class="page-toolbar">
      <el-button text :icon="ArrowLeft" @click="goBack">返回打卡</el-button>
      <div class="title-15">{{ target?.name || '资料' }}</div>
      <el-tag v-if="target?.status === 'archived'" size="small" type="info" effect="plain">已暂停</el-tag>
      <div class="spacer" />
      <div class="toolbar-actions">
        <el-button class="btn-tonal" :icon="Plus" @click="openRuleDialog()">添加任务</el-button>
        <el-button text :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="page-body scroll-area">
      <el-card shadow="never" class="block">
        <div class="group-title">资料</div>
        <el-form label-position="top" :model="form">
          <div class="form-grid">
            <el-form-item label="名称">
              <el-input v-model="form.name" maxlength="100" />
            </el-form-item>
            <el-form-item label="平台">
              <el-input v-model="form.platform" maxlength="100" placeholder="只是资料，不保存平台密码" />
            </el-form-item>
          </div>
          <el-form-item label="备注">
            <el-input v-model="form.note" type="textarea" :rows="2" maxlength="2000" show-word-limit />
          </el-form-item>
          <div class="toolbar-actions">
            <el-button type="primary" :loading="saving" @click="saveTarget">保存资料</el-button>
            <el-button v-if="target?.status === 'active'" @click="archiveTarget">暂停</el-button>
            <el-button v-else @click="restoreTarget">恢复</el-button>
          </div>
        </el-form>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="group-title">打卡任务</div>
        <el-table :data="rules" size="small" v-loading="loading">
          <el-table-column prop="title" label="任务" min-width="160" show-overflow-tooltip />
          <el-table-column prop="group_name" label="分类" width="110" />
          <el-table-column label="频率" width="100">
            <template #default="{ row }">
              {{ periodText(row.effective_period) }}
              <el-tooltip v-if="row.pending_period" :content="`${row.pending_effective_from} 起改为${periodText(row.pending_period)}`">
                <el-tag size="small" type="warning" effect="plain" style="margin-left: 4px">待生效</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.active" size="small" type="success" effect="plain">启用</el-tag>
              <el-tag v-else size="small" type="info" effect="plain">已停用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="210">
            <template #default="{ row }">
              <div class="actions-group">
                <el-button text size="small" @click="openRuleDialog(row)">编辑</el-button>
                <el-button text size="small" @click="openVersions(row)">改动历史</el-button>
                <el-button v-if="row.active" text size="small" @click="disableRule(row)">停用</el-button>
                <el-button v-else text size="small" @click="enableRule(row)">启用</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!rules.length" class="empty-hint">
          <div>还没有打卡任务</div>
          <el-button class="btn-tonal" @click="openRuleDialog()">添加第一个任务</el-button>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="ruleDialog" :title="editingRule ? '编辑任务' : '添加任务'" width="520px">
      <el-form label-position="top" :model="ruleForm">
        <el-form-item label="标题" required>
          <el-input v-model="ruleForm.title" maxlength="200" />
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="分类" required>
            <el-select v-model="ruleForm.group_id" placeholder="选择分类" style="width: 100%">
              <el-option v-for="g in groups" :key="g.id" :label="g.name" :value="g.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="频率">
            <el-select v-model="ruleForm.period" style="width: 100%">
              <el-option label="每天" value="daily" />
              <el-option label="每周" value="weekly" />
              <el-option label="每月" value="monthly" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="任务说明">
          <el-input v-model="ruleForm.description" type="textarea" :rows="3" maxlength="5000" show-word-limit />
        </el-form-item>
        <el-alert
          v-if="editingRule && ruleForm.period !== editingRule.effective_period"
          type="warning"
          :closable="false"
          show-icon
          title="改频率要等下一轮才生效：这一轮仍按原频率算，从下一轮起按新频率"
        />
      </el-form>
      <template #footer>
        <div class="toolbar-actions" style="justify-content: flex-end">
          <el-button @click="ruleDialog = false">取消</el-button>
          <el-button type="primary" :loading="savingRule" @click="saveRule">保存</el-button>
        </div>
      </template>
    </el-dialog>

    <el-drawer v-model="versionsOpen" title="任务改动历史" size="480px">
      <el-timeline v-if="versions.length">
        <el-timeline-item
          v-for="v in versions"
          :key="v.id"
          :timestamp="formatTime(v.created_at)"
          placement="top"
        >
          <div class="text-13"><b>{{ v.title }}</b> · {{ v.group_name }} · {{ periodText(v.period) }}</div>
          <div class="text-12 muted">{{ v.change_summary || '修改' }}</div>
          <div v-if="v.description" class="text-12 secondary" style="white-space: pre-wrap; margin-top: 2px">
            {{ v.description }}
          </div>
        </el-timeline-item>
      </el-timeline>
      <div v-else class="empty-hint">暂无改动历史</div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Plus, Refresh } from '@/icons'
import { apiError, http } from '@/api/client'

const route = useRoute()
const router = useRouter()
const targetId = Number(route.params.id)

const target = ref<any>(null)
const rules = ref<any[]>([])
const groups = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const form = reactive({ name: '', platform: '', note: '' })

const ruleDialog = ref(false)
const editingRule = ref<any>(null)
const savingRule = ref(false)
const ruleForm = reactive<{ title: string; group_id: number | null; period: string; description: string }>({
  title: '',
  group_id: null,
  period: 'daily',
  description: '',
})

const versionsOpen = ref(false)
const versions = ref<any[]>([])

function periodText(value: string) {
  return { daily: '每天', weekly: '每周', monthly: '每月' }[value] || value
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

function goBack() {
  router.push(`/checkins/items/${targetId}`)
}

async function loadAll() {
  loading.value = true
  try {
    const [{ data: detail }, { data: ruleList }, { data: groupList }] = await Promise.all([
      http.get(`/work-targets/${targetId}`),
      http.get(`/work-targets/${targetId}/rules`),
      http.get('/checkin-groups'),
    ])
    target.value = detail
    window.dispatchEvent(new Event('wb:checkins-changed'))
    form.name = detail.name
    form.platform = detail.platform || ''
    form.note = detail.note || ''
    rules.value = ruleList
    groups.value = groupList
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

async function saveTarget() {
  saving.value = true
  try {
    await http.patch(`/work-targets/${targetId}`, {
      name: form.name.trim(),
      platform: form.platform.trim() || null,
      note: form.note,
    })
    ElMessage.success('资料已保存')
    await loadAll()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    saving.value = false
  }
}

async function archiveTarget() {
  try {
    await ElMessageBox.confirm('暂停后从日常清单里隐藏，不再生成新的打卡；已有记录保留，只能查看。', '暂停打卡', {
      type: 'warning',
      confirmButtonText: '暂停打卡',
      cancelButtonText: '取消',
    })
    await http.post(`/work-targets/${targetId}/archive`)
    await loadAll()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function restoreTarget() {
  try {
    await http.post(`/work-targets/${targetId}/restore`)
    ElMessage.success('已恢复')
    await loadAll()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function openRuleDialog(rule?: any) {
  editingRule.value = rule || null
  ruleForm.title = rule?.title || ''
  ruleForm.group_id = rule?.group_id || groups.value[0]?.id || null
  ruleForm.period = rule?.effective_period || 'daily'
  ruleForm.description = rule?.description || ''
  if (!groups.value.length) {
    ElMessage.warning('请先在打卡页添加分类')
    return
  }
  ruleDialog.value = true
}

async function saveRule() {
  if (!ruleForm.title.trim() || !ruleForm.group_id) {
    ElMessage.warning('请填写标题并选择分类')
    return
  }
  savingRule.value = true
  try {
    if (editingRule.value) {
      const payload: Record<string, any> = {
        title: ruleForm.title.trim(),
        group_id: ruleForm.group_id,
        period: ruleForm.period,
        description: ruleForm.description,
      }
      const { data } = await http.patch(`/checkin-rules/${editingRule.value.id}`, payload)
      if (data.period_change?.pending) {
        ElMessage.success(`已保存，${data.period_change.effective_from} 起按新频率执行`)
      } else {
        window.dispatchEvent(new Event('wb:checkins-changed'));ElMessage.success('已保存')
      }
    } else {
      await http.post(`/work-targets/${targetId}/rules`, {
        group_id: ruleForm.group_id,
        title: ruleForm.title.trim(),
        period: ruleForm.period,
        description: ruleForm.description,
      })
      ElMessage.success('已添加，马上出现在这一轮里')
    }
    ruleDialog.value = false
    await loadAll()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    savingRule.value = false
  }
}

async function disableRule(rule: any) {
  try {
    await ElMessageBox.confirm(
      '停用后不再生成新的打卡任务，已有记录按原来的频率保留。',
      '停用任务',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' },
    )
    await http.delete(`/checkin-rules/${rule.id}`)
    await loadAll()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function enableRule(rule: any) {
  try {
    await http.patch(`/checkin-rules/${rule.id}`, { active: true })
    await loadAll()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function openVersions(rule: any) {
  versionsOpen.value = true
  try {
    const { data } = await http.get(`/checkin-rules/${rule.id}/versions`)
    versions.value = data
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

onMounted(loadAll)
</script>

<style scoped>
.block {
  margin-bottom: 10px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
