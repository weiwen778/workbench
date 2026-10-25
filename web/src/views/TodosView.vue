<template>
  <div class="todos-layout">
    <!-- 清单栏 -->
    <div class="list-pane">
      <div class="pane-head">
        <span class="group-title" style="padding: 0">清单</span>
        <div class="spacer" />
        <el-button text :icon="Plus" size="small" title="新建清单" @click="createList" />
      </div>
      <div class="list-scroll">
        <div
          v-for="list in lists"
          :key="list.id"
          class="list-item"
          :class="{ active: list.id === currentListId }"
          @click="selectList(list.id)"
        >
          <span class="ellipsis-1">{{ list.name }}</span>
          <span class="text-12 muted">{{ list.pending }}</span>
          <el-dropdown trigger="click" @command="(cmd: string) => listCommand(cmd, list)">
            <el-button text size="small" :icon="MoreFilled" @click.stop />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete">删除清单</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-if="!lists.length" class="empty-hint" style="padding: 20px 8px">
          还没有清单<br />点右上角 + 新建
        </div>
      </div>
    </div>

    <!-- 任务区 -->
    <div class="task-pane">
      <div class="page-toolbar">
        <div class="title-15">{{ currentList?.name || '待办' }}</div>
        <el-radio-group v-model="sortMode" size="small" @change="changeSortMode">
          <el-radio-button value="auto">按截止时间</el-radio-button>
          <el-radio-button value="manual">手动排序</el-radio-button>
        </el-radio-group>
        <span class="text-12 muted">
          未完成 {{ counts.nodes_pending }} / 全部 {{ counts.nodes_total }}
        </span>
        <div class="spacer" />
        <el-button text :icon="Refresh" @click="load">刷新</el-button>
      </div>

      <div class="quick-add">
        <el-input
          v-model="newTitle"
          placeholder="添加待办，回车保存；只填标题也可以"
          maxlength="200"
          @keyup.enter="addTodo"
        >
          <template #append>
            <el-button :icon="Plus" :loading="adding" @click="addTodo" />
          </template>
        </el-input>
        <div class="quick-extra">
          <el-popover placement="bottom-start" :width="300" trigger="click">
            <template #reference>
              <el-button text size="small" :icon="Clock">
                {{ newDue.due_date ? dueText(newDue) : '设置截止' }}
              </el-button>
            </template>
            <div class="text-13" style="margin-bottom: 8px">截止时间（可不填）</div>
            <el-date-picker v-model="newDue.due_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            <el-time-picker
              v-model="newDue.due_time"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="可选具体时间"
              style="width: 100%; margin-top: 8px"
            />
            <div class="toolbar-actions" style="justify-content: flex-end; margin-top: 8px">
              <el-button size="small" @click="clearNewDue">清空</el-button>
            </div>
          </el-popover>
          <el-input v-model="newNote" placeholder="说明（可选）" size="small" style="width: 240px" />
        </div>
      </div>

      <div class="scroll-area" v-loading="loading">
        <div v-if="!currentList" class="empty-hint">请选择或新建一个清单</div>
        <template v-else>
          <div v-for="(item, index) in pending" :key="item.id" class="task-block">
            <div class="task-row" :class="{ overdue: item.overdue }">
              <el-tooltip
                :disabled="item.can_toggle"
                content="有子任务时完成状态由子任务决定，请逐项勾选子任务"
                placement="top"
              >
                <span>
                  <el-checkbox
                    :model-value="item.completed"
                    :disabled="!item.can_toggle"
                    size="large"
                    @change="toggle(item)"
                  />
                </span>
              </el-tooltip>

              <div class="task-main">
                <div class="task-title">
                  <span>{{ item.title }}</span>
                  <span v-if="item.subtask_total" class="text-12 muted">
                    子任务 {{ item.subtask_done }}/{{ item.subtask_total }}
                  </span>
                  <el-tag v-if="item.overdue" size="small" type="danger" effect="plain">逾期</el-tag>
                </div>
                <div class="task-meta">
                  <span v-if="item.due_date">
                    <el-icon><Clock /></el-icon>
                    {{ dueText(item) }}
                  </span>
                  <span v-if="item.note" class="note-text">{{ item.note }}</span>
                </div>

                <!-- 子任务 -->
                <div v-if="item.children.length || subOpen[item.id]" class="subtasks">
                  <div v-for="child in item.children" :key="child.id" class="subtask-row">
                    <el-checkbox :model-value="child.completed" size="small" @change="toggleChild(child)" />
                    <span :class="{ done: child.completed }">{{ child.title }}</span>
                    <div class="spacer" />
                    <el-button text size="small" :icon="Delete" title="删除子任务" @click="removeTodo(child)" />
                  </div>
                  <div class="subtask-add">
                    <el-input
                      v-model="subDraft[item.id]"
                      size="small"
                      placeholder="添加子任务，回车保存"
                      maxlength="200"
                      @keyup.enter="addSubtask(item)"
                    />
                  </div>
                </div>
              </div>

              <div class="task-actions">
                <el-button
                  v-if="!item.children.length"
                  text
                  size="small"
                  :icon="Plus"
                  title="添加子任务"
                  @click="subOpen[item.id] = !subOpen[item.id]"
                />
                <el-button
                  text
                  size="small"
                  :icon="ArrowUp"
                  :disabled="sortMode !== 'manual' || index === 0"
                  title="上移"
                  @click="move(index, -1)"
                />
                <el-button
                  text
                  size="small"
                  :icon="ArrowDown"
                  :disabled="sortMode !== 'manual' || index === pending.length - 1"
                  title="下移"
                  @click="move(index, 1)"
                />
                <el-popover
                  placement="bottom-end"
                  :width="300"
                  trigger="click"
                  @show="openEdit(item)"
                >
                  <template #reference>
                    <el-button text size="small" :icon="Edit" title="编辑" />
                  </template>
                  <div class="text-13" style="margin-bottom: 6px">编辑待办</div>
                  <el-input v-model="editForm.title" maxlength="200" placeholder="标题" />
                  <el-input
                    v-model="editForm.note"
                    type="textarea"
                    :rows="3"
                    maxlength="5000"
                    placeholder="说明"
                    style="margin-top: 8px"
                  />
                  <el-date-picker
                    v-model="editForm.due_date"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="截止日期"
                    style="width: 100%; margin-top: 8px"
                  />
                  <el-time-picker
                    v-model="editForm.due_time"
                    format="HH:mm"
                    value-format="HH:mm"
                    placeholder="具体时间（可选）"
                    style="width: 100%; margin-top: 8px"
                  />
                  <div class="toolbar-actions" style="justify-content: flex-end; margin-top: 8px">
                    <el-button size="small" @click="clearEditDue">清空截止</el-button>
                    <el-button size="small" type="primary" @click="saveEdit(item)">保存</el-button>
                  </div>
                </el-popover>
                <el-button text size="small" :icon="Delete" title="删除" @click="removeTodo(item)" />
              </div>
            </div>
          </div>

          <div v-if="!pending.length && !completed.length" class="empty-hint">
            这个清单还没有待办，在上面输入标题回车即可添加
          </div>

          <!-- 已完成区 -->
          <div v-if="completed.length" class="completed-block">
            <div class="completed-head" @click="completedOpen = !completedOpen">
              <el-icon><component :is="completedOpen ? ArrowDown : ArrowRight" /></el-icon>
              <span>已完成 {{ completed.length }}</span>
            </div>
            <div v-show="completedOpen">
              <div v-for="item in completed" :key="item.id" class="task-row completed">
                <el-checkbox
                  :model-value="true"
                  :disabled="!item.can_toggle"
                  size="large"
                  @change="toggle(item)"
                />
                <div class="task-main">
                  <div class="task-title done">{{ item.title }}</div>
                  <div class="task-meta">
                    <span v-if="item.completed_at">完成于 {{ formatTime(item.completed_at) }}</span>
                  </div>
                  <div v-if="item.children.length" class="subtasks">
                    <div v-for="child in item.children" :key="child.id" class="subtask-row">
                      <el-checkbox :model-value="child.completed" size="small" @change="toggleChild(child)" />
                      <span :class="{ done: child.completed }">{{ child.title }}</span>
                    </div>
                  </div>
                </div>
                <div class="task-actions">
                  <el-button text size="small" :icon="Delete" title="删除" @click="removeTodo(item)" />
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Delete,
  Edit,
  MoreFilled,
  Plus,
  Refresh,
} from '@element-plus/icons-vue'
import { apiError, http } from '@/api/client'

const lists = ref<any[]>([])
const currentListId = ref<number | null>(null)
const currentList = computed(() => lists.value.find((l) => l.id === currentListId.value) || null)
const pending = ref<any[]>([])
const completed = ref<any[]>([])
const counts = ref({ nodes_total: 0, nodes_pending: 0, nodes_done: 0 })
const sortMode = ref<'auto' | 'manual'>('auto')
const loading = ref(false)
const adding = ref(false)
const completedOpen = ref(true)

const newTitle = ref('')
const newNote = ref('')
const newDue = reactive<{ due_date: string | null; due_time: string | null }>({ due_date: null, due_time: null })
const subDraft = reactive<Record<number, string>>({})
const subOpen = reactive<Record<number, boolean>>({})
const editForm = reactive<{ title: string; note: string; due_date: string | null; due_time: string | null }>({
  title: '',
  note: '',
  due_date: null,
  due_time: null,
})

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

function dueText(item: any) {
  if (!item.due_date) return ''
  return item.due_time ? `${item.due_date} ${item.due_time}` : item.due_date
}

async function loadLists() {
  const { data } = await http.get('/todo-lists')
  lists.value = data
  if (!currentListId.value && data.length) {
    currentListId.value = data[0].id
    sortMode.value = data[0].sort_mode
  }
}

async function load() {
  if (!currentListId.value) {
    await loadLists()
  }
  if (!currentListId.value) return
  loading.value = true
  try {
    const { data } = await http.get('/todos', { params: { list_id: currentListId.value } })
    pending.value = data.pending
    completed.value = data.completed
    counts.value = data.counts
    lists.value = data.lists
    sortMode.value = data.list.sort_mode
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    loading.value = false
  }
}

function selectList(id: number) {
  currentListId.value = id
  const list = lists.value.find((l) => l.id === id)
  sortMode.value = list?.sort_mode || 'auto'
  load()
}

async function createList() {
  try {
    const { value } = await ElMessageBox.prompt('清单名称', '新建清单', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '请输入名称',
      inputValue: '工作',
    })
    const { data } = await http.post('/todo-lists', { name: value.trim() })
    await loadLists()
    currentListId.value = data.id
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

async function listCommand(command: string, list: any) {
  if (command === 'rename') {
    try {
      const { value } = await ElMessageBox.prompt('清单名称', '重命名', {
        inputValue: list.name,
        inputPattern: /\S+/,
        inputErrorMessage: '请输入名称',
      })
      await http.patch(`/todo-lists/${list.id}`, { name: value.trim() })
      await load()
    } catch (error: any) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(apiError(error).message)
    }
    return
  }
  if (command === 'delete') {
    try {
      const { data } = await http.get(`/todo-lists/${list.id}/delete-preview`)
      await ElMessageBox.confirm(
        `清单「${data.list_name}」包含 ${data.top_total} 个顶层待办、${data.subtask_total} 个子任务（含已完成）。删除后不能从回收站恢复。`,
        '删除清单',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
      await http.delete(`/todo-lists/${list.id}`)
      if (currentListId.value === list.id) currentListId.value = null
      await loadLists()
      await load()
      ElMessage.success('已删除')
    } catch (error: any) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(apiError(error).message)
    }
  }
}

async function addTodo() {
  if (!currentListId.value || !newTitle.value.trim()) return
  adding.value = true
  try {
    await http.post('/todos', {
      list_id: currentListId.value,
      title: newTitle.value.trim(),
      note: newNote.value.trim() || null,
      due_date: newDue.due_date,
      due_time: newDue.due_time,
    })
    newTitle.value = ''
    newNote.value = ''
    clearNewDue()
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {
    adding.value = false
  }
}

function clearNewDue() {
  newDue.due_date = null
  newDue.due_time = null
}

async function addSubtask(parent: any) {
  const title = (subDraft[parent.id] || '').trim()
  if (!title) return
  try {
    await http.post('/todos', { list_id: currentListId.value, parent_id: parent.id, title })
    subDraft[parent.id] = ''
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function toggle(item: any) {
  try {
    if (item.completed) {
      await http.post(`/todos/${item.id}/cancel`)
    } else {
      await http.post(`/todos/${item.id}/complete`)
    }
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function toggleChild(child: any) {
  try {
    if (child.completed) {
      await http.post(`/todos/${child.id}/cancel`)
    } else {
      await http.post(`/todos/${child.id}/complete`)
    }
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function changeSortMode(value: string) {
  try {
    await http.patch(`/todo-lists/${currentListId.value}`, { sort_mode: value })
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function move(index: number, offset: number) {
  const order = pending.value.map((item) => item.id)
  const target = index + offset
  if (target < 0 || target >= order.length) return
  ;[order[index], order[target]] = [order[target], order[index]]
  try {
    await http.post('/todos/reorder', { list_id: currentListId.value, order })
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function openEdit(item: any) {
  editForm.title = item.title
  editForm.note = item.note || ''
  editForm.due_date = item.due_date
  editForm.due_time = item.due_time
}

function clearEditDue() {
  editForm.due_date = null
  editForm.due_time = null
}

async function saveEdit(item: any) {
  try {
    const payload: Record<string, any> = { title: editForm.title.trim(), note: editForm.note }
    if (editForm.due_date) {
      payload.due_date = editForm.due_date
      payload.due_time = editForm.due_time
    } else {
      payload.clear_due = true
    }
    await http.patch(`/todos/${item.id}`, payload)
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function removeTodo(item: any) {
  try {
    const suffix = item.children?.length ? `及其 ${item.children.length} 个子任务` : ''
    await ElMessageBox.confirm(`删除「${item.title}」${suffix}？删除后不能从回收站恢复。`, '删除待办', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await http.delete(`/todos/${item.id}`)
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(apiError(error).message)
  }
}

onMounted(async () => {
  try {
    await loadLists()
    await load()
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
})
</script>

<style scoped>
.todos-layout {
  display: flex;
  height: 100%;
  min-height: 0;
}
.list-pane {
  width: 210px;
  flex: 0 0 210px;
  border-right: 1px solid var(--wb-border);
  background: var(--wb-surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pane-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px 6px;
}
.list-scroll {
  flex: 1;
  overflow: auto;
  padding: 0 6px 8px;
}
.list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13.5px;
}
.list-item:hover {
  background: var(--el-color-primary-light-9);
}
.list-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--wb-primary);
  font-weight: 600;
}
.task-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 8px;
}
.quick-add {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quick-extra {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.task-block {
  background: var(--wb-surface);
  border: 1px solid var(--wb-border);
  border-radius: 10px;
  margin-bottom: 6px;
}
.task-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  min-height: 44px;
}
.task-row.overdue {
  border-left: 3px solid var(--el-color-danger);
}
.task-main {
  flex: 1;
  min-width: 0;
}
.task-title {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.task-title.done {
  color: var(--wb-text-tertiary);
  text-decoration: line-through;
}
.task-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--wb-text-tertiary);
  margin-top: 2px;
  flex-wrap: wrap;
}
.task-meta .el-icon {
  vertical-align: -2px;
}
.note-text {
  color: var(--wb-text-secondary);
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.subtasks {
  margin-top: 6px;
  padding-left: 4px;
  border-left: 2px solid var(--wb-border);
}
.subtask-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  min-height: 32px;
  padding-left: 6px;
}
.subtask-row .done {
  color: var(--wb-text-tertiary);
  text-decoration: line-through;
}
.subtask-add {
  padding: 4px 6px 2px;
  max-width: 320px;
}
.completed-block {
  margin-top: 10px;
  border-top: 1px dashed var(--wb-border);
  padding-top: 6px;
}
.completed-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--wb-text-secondary);
  cursor: pointer;
  padding: 4px;
}
.task-row.completed {
  opacity: 0.8;
}
@media (max-width: 900px) {
  .list-pane {
    width: 168px;
    flex-basis: 168px;
  }
}
</style>
