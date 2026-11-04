<template>
  <div ref="todoRoot" class="todos-layout">
    <!-- 任务区 -->
    <div class="task-pane">
      <div class="page-toolbar">
        <el-dropdown v-if="currentList" trigger="click" @command="(command: string) => listCommand(command, currentList)">
          <el-button text :icon="MoreFilled" aria-label="清单操作" />
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="rename">重命名清单</el-dropdown-item><el-dropdown-item command="delete">删除清单</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
        <el-radio-group :disabled="!currentList" v-model="sortMode" size="small" @change="changeSortMode">
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
          :disabled="!currentList"
          placeholder="添加待办，回车保存；只填标题也可以"
          maxlength="200"
          @keyup.enter="addTodo"
        >
          <template #append>
            <el-button :icon="Plus" :loading="adding" @click="addTodo" />
          </template>
        </el-input>
        <div class="quick-extra">
          <el-popover placement="bottom-start" :width="300" trigger="click" :persistent="false">
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
        <el-alert v-if="loadError" :title="loadError" type="error" :closable="false"><el-button text @click="load">重试加载</el-button></el-alert>
        <div v-if="!currentList" class="empty-hint"><div>{{ missingList ? '清单不存在或已删除，请从左侧选择其他清单' : '从左侧选择清单，或新建一个清单开始记录' }}</div><el-button style="margin-top: 12px" @click="createList">新建清单</el-button></div>
        <template v-else>
          <el-pagination v-if="counts.top_pending>50" v-model:current-page="pendingPage" :page-size="50" :total="counts.top_pending" layout="total,prev,pager,next" @current-change="load"/>
          <TransitionGroup v-if="loaded" name="wb-task" tag="div" class="task-list">
          <div v-for="(item, index) in pending" :key="item.id" class="task-block" :class="{ 'is-completing': completingIds.has(item.id) }" :aria-busy="togglingIds.has(item.id)">
            <div class="task-row" :class="{ overdue: item.overdue }">
              <el-tooltip
                :disabled="item.can_toggle"
                content="有子任务时，完成情况看子任务，请一个个勾选"
                placement="top"
              >
                <span>
                  <el-checkbox
                    :key="checkboxVersions[item.id] || 0"
                    :data-todo-id="item.id"
                    :model-value="item.completed || completingIds.has(item.id)"
                    :disabled="!item.can_toggle || togglingIds.has(item.id)"
                    size="large"
                    @change="toggle(item)"
                  />
                </span>
              </el-tooltip>

              <div class="task-main">
                <div class="task-title">
                  <span class="todo-label">{{ item.title }}</span>
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
                  <div v-for="child in item.children" :key="child.id" class="subtask-row" :class="{ 'is-completing': completingIds.has(child.id) }">
                    <el-checkbox :key="checkboxVersions[child.id] || 0" :data-todo-id="child.id" :model-value="child.completed || completingIds.has(child.id)" :disabled="togglingIds.has(child.id)" size="small" @change="toggleChild(child)" />
                    <span class="todo-label" :class="{ done: child.completed }">{{ child.title }}</span>
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
                  v-if="sortMode==='manual'"
                  text
                  size="small"
                  :icon="ArrowUp"
                  :disabled="sortMode !== 'manual' || index === 0"
                  title="上移"
                  @click="move(index, -1)"
                />
                <el-button
                  v-if="sortMode==='manual'"
                  text
                  size="small"
                  :icon="ArrowDown"
                  :disabled="sortMode !== 'manual' || index === pending.length - 1"
                  title="下移"
                  @click="move(index, 1)"
                />
                <el-button text size="small" :icon="Edit" title="编辑" aria-label="编辑待办" @click="openEdit(item)" />
                <el-button text size="small" :icon="Delete" title="删除" @click="removeTodo(item)" />
              </div>
            </div>
          </div>

          </TransitionGroup>

          <div v-if="!pending.length && !completed.length" class="empty-hint">
            这个清单还没有待办，在上面输入标题回车即可添加
          </div>

          <!-- 已完成区 -->
          <div v-if="completed.length" class="completed-block">
            <button type="button" class="completed-head" :aria-expanded="completedOpen" @click="completedOpen = !completedOpen">
              <el-icon><component :is="completedOpen ? ArrowDown : ArrowRight" /></el-icon>
              <span>已完成 {{ counts.top_done }}</span>
            </button>
            <div v-if="completedOpen">
              <el-pagination v-if="counts.top_done>50" v-model:current-page="donePage" :page-size="50" :total="counts.top_done" layout="total,prev,pager,next" @current-change="load"/>
              <div v-for="item in completed" :key="item.id" class="task-row completed">
                <el-checkbox
                  :key="checkboxVersions[item.id] || 0"
                  :data-todo-id="item.id"
                  :model-value="true"
                  :disabled="!item.can_toggle || togglingIds.has(item.id)"
                  size="large"
                  @change="toggle(item)"
                />
                <div class="task-main">
                  <div class="task-title done">{{ item.title }}</div>
                  <div class="task-meta">
                    <span v-if="item.completed_at">完成于 {{ formatTime(item.completed_at) }}</span>
                  </div>
                  <div v-if="item.children.length" class="subtasks">
                    <div v-for="child in item.children" :key="child.id" class="subtask-row" :class="{ 'is-completing': completingIds.has(child.id) }">
                      <el-checkbox :key="checkboxVersions[child.id] || 0" :data-todo-id="child.id" :model-value="child.completed || completingIds.has(child.id)" :disabled="togglingIds.has(child.id)" size="small" @change="toggleChild(child)" />
                      <span class="todo-label" :class="{ done: child.completed }">{{ child.title }}</span>
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
  <el-dialog v-if="editingItem" v-model="editOpen" title="编辑待办" width="min(520px,94vw)" :close-on-click-modal="false" @closed="!editOpen && (editingItem=null)">
    <el-form label-position="top" :disabled="editingSaving" @submit.prevent="saveEdit(editingItem)">
      <el-form-item label="标题" required><el-input v-model="editForm.title" maxlength="200" placeholder="标题"/></el-form-item>
      <el-form-item label="说明"><el-input v-model="editForm.note" type="textarea" :rows="3" maxlength="5000" placeholder="说明"/></el-form-item>
      <el-form-item label="截止日期"><el-date-picker v-model="editForm.due_date" type="date" value-format="YYYY-MM-DD" placeholder="截止日期" style="width:100%"/></el-form-item>
      <el-form-item label="具体时间（可选）"><el-time-picker v-model="editForm.due_time" format="HH:mm" value-format="HH:mm" placeholder="具体时间（可选）" style="width:100%"/></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="editingSaving" @click="clearEditDue">清空截止</el-button><el-button :disabled="editingSaving" @click="editOpen=false">取消</el-button><el-button type="primary" :loading="editingSaving" @click="saveEdit(editingItem)">保存</el-button></template>
  </el-dialog>

</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
} from '@/icons'
import { apiError, http } from '@/api/client'

const lists = ref<any[]>([])
const route = useRoute(), router = useRouter()
const currentListId = ref<number | null>(Number(route.params.listId) || null)
const missingList = ref(false)
const currentList = computed(() => lists.value.find((l) => l.id === currentListId.value) || null)
const focusTarget=ref<number|undefined>(route.query.focus?Number(route.query.focus):undefined)
const pendingPage=ref(1),donePage=ref(1)
const pending = shallowRef<any[]>([])
const completed = shallowRef<any[]>([])
const counts = ref({ nodes_total: 0, nodes_pending: 0, nodes_done: 0,top_pending:0,top_done:0 })
const sortMode = ref<'auto' | 'manual'>('auto')
const loading = ref(true)
const loaded=ref(false),loadError=ref('')
let loadRequest=0
const adding = ref(false)
const completedOpen = ref(false)
const editingItem=shallowRef<any>(null),editOpen=ref(false),editingSaving=ref(false)
const todoRoot = ref<HTMLElement>()
const checkboxVersions = reactive<Record<number, number>>({})
const togglingIds = reactive(new Set<number>())
const completingIds = reactive(new Set<number>())
// Feedback follows a successful write. Pending timers are cancelled on navigation.
let viewActive = true
const completionTimers = new Map<number, () => void>()
function completionFeedback() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
  return new Promise<void>(resolve => {
    const finish = () => { window.clearTimeout(timer); completionTimers.delete(timer); resolve() }
    const timer = window.setTimeout(finish, 180)
    completionTimers.set(timer, finish)
  })
}
onUnmounted(() => {
  viewActive = false
  for (const finish of completionTimers.values()) finish()
})

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
  const selected = data.find((list: any) => list.id === Number(route.params.listId))
  currentListId.value = selected?.id || null
  missingList.value = !!route.params.listId && !selected
  if (selected) sortMode.value = selected.sort_mode
}

async function load() {
  if (!currentListId.value||!viewActive) return
  const request=++loadRequest,focus=focusTarget.value
  loading.value = true
  try {
    const { data } = await http.get('/todos', { params: { list_id: currentListId.value,page:pendingPage.value,completed_page:donePage.value,page_size:50,focus:focusTarget.value } })
    if(!viewActive||request!==loadRequest)return
    focusTarget.value=undefined
    if(focus&&data.completed.some((item:any)=>item.id===focus||item.children.some((child:any)=>child.id===focus)))completedOpen.value=true
    missingList.value=false;loadError.value=''
    pendingPage.value=data.page||1;donePage.value=data.completed_page||1
    pending.value = data.pending
    completed.value = data.completed
    counts.value = data.counts
    lists.value = data.lists
    window.dispatchEvent(new CustomEvent('wb:todos-changed',{detail:{lists:data.lists}}))
    sortMode.value = data.list.sort_mode
  } catch (error:any) {
    if(viewActive&&request===loadRequest){loadError.value=apiError(error).message;missingList.value=error?.response?.status===404;ElMessage.error(loadError.value)}
  } finally {
    if(viewActive&&request===loadRequest){loading.value=false;loaded.value=true}
  }
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
    window.dispatchEvent(new Event('wb:todos-changed'))
    router.push(`/todos/${data.id}`)
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
        `清单「${data.list_name}」里有 ${data.top_total} 个待办、${data.subtask_total} 个子任务（含已完成的）。删除后可在回收站中恢复，保留 30 天。`,
        '删除清单',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
      await http.delete(`/todo-lists/${list.id}`)
      await loadLists()
      window.dispatchEvent(new Event('wb:todos-changed'))
      router.replace(lists.value.length ? `/todos/${lists.value[0].id}` : '/todos')
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
    if(route.query.focus){await nextTick();const target=document.querySelector<HTMLElement>(`[data-todo-id="${Number(route.query.focus)}"]`);target?.scrollIntoView({block:'center'});target?.closest('.task-row')?.classList.add('search-focus')}
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
    if(route.query.focus){await nextTick();const target=document.querySelector<HTMLElement>(`[data-todo-id="${Number(route.query.focus)}"]`);target?.scrollIntoView({block:'center'});target?.closest('.task-row')?.classList.add('search-focus')}
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

async function toggle(item: any) {
  if (!item.can_toggle || togglingIds.has(item.id)) return
  await toggleCompletion(item)
}

async function toggleChild(child: any) {
  if (togglingIds.has(child.id)) return
  await toggleCompletion(child)
}

async function toggleCompletion(item: any) {
  togglingIds.add(item.id)
  try {
    await http.post(`/todos/${item.id}/${item.completed ? 'cancel' : 'complete'}`)
    if (!viewActive) return
    if (!item.completed) {
      completingIds.add(item.id)
      await completionFeedback()
    }
    if (viewActive) await load()
  } catch (error) {
    if (viewActive) {
      // Native checkbox input may have changed even while the prop stayed false.
      // Remount only the failed control to restore its confirmed value and focus.
      const restoreFocus = document.activeElement?.closest(`[data-todo-id="${item.id}"]`)
      checkboxVersions[item.id] = (checkboxVersions[item.id] || 0) + 1
      await nextTick()
      if (restoreFocus) todoRoot.value?.querySelector<HTMLInputElement>(`[data-todo-id="${item.id}"] input`)?.focus({ preventScroll: true })
      ElMessage.error(apiError(error).message)
    }
  } finally {
    togglingIds.delete(item.id)
    completingIds.delete(item.id)
  }
}

async function changeSortMode(value: string) {
  try {
    await http.patch(`/todo-lists/${currentListId.value}`, { sort_mode: value })
    await load()
    if(route.query.focus){await nextTick();const target=document.querySelector<HTMLElement>(`[data-todo-id="${Number(route.query.focus)}"]`);target?.scrollIntoView({block:'center'});target?.closest('.task-row')?.classList.add('search-focus')}
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
    await http.post('/todos/reorder', { start_index:(pendingPage.value-1)*50, list_id: currentListId.value, order })
    await load()
    if(route.query.focus){await nextTick();const target=document.querySelector<HTMLElement>(`[data-todo-id="${Number(route.query.focus)}"]`);target?.scrollIntoView({block:'center'});target?.closest('.task-row')?.classList.add('search-focus')}
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
}

function openEdit(item: any) {
  editingItem.value=item;editOpen.value=true
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
  if(!item||editingSaving.value)return
  if(!editForm.title.trim()){ElMessage.warning('标题不能为空');return}
  editingSaving.value=true
  try {
    const payload: Record<string, any> = { title: editForm.title.trim(), note: editForm.note }
    if (editForm.due_date) {
      payload.due_date = editForm.due_date
      payload.due_time = editForm.due_time
    } else {
      payload.clear_due = true
    }
    await http.patch(`/todos/${item.id}`, payload)
    editOpen.value=false
    await load()
    if(route.query.focus){await nextTick();const target=document.querySelector<HTMLElement>(`[data-todo-id="${Number(route.query.focus)}"]`);target?.scrollIntoView({block:'center'});target?.closest('.task-row')?.classList.add('search-focus')}
  } catch (error) {
    ElMessage.error(apiError(error).message)
  } finally {editingSaving.value=false}
}

async function removeTodo(item: any) {
  try {
    const suffix = item.children?.length ? `及其 ${item.children.length} 个子任务` : ''
    await ElMessageBox.confirm(`删除「${item.title}」${suffix}？删除后可在回收站恢复，保留 30 天。`, '删除待办', {
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
    if(!route.params.listId){
      await loadLists()
      if(lists.value.length){await router.replace(`/todos/${lists.value[0].id}`);return}
      loading.value=false;loaded.value=true;return
    }
    await load()
    if(route.query.focus){await nextTick();const target=document.querySelector<HTMLElement>(`[data-todo-id="${Number(route.query.focus)}"]`);target?.scrollIntoView({block:'center'});target?.closest('.task-row')?.classList.add('search-focus')}
  } catch (error) {
    ElMessage.error(apiError(error).message)
  }
})
</script>

<style scoped>
.completed-head{border:0;background:transparent;font:inherit;color:inherit;width:100%;text-align:left}

.search-focus{outline:2px solid var(--wb-primary);outline-offset:3px;border-radius:4px}
.todos-layout {
  display: flex;
  height: 100%;
  min-height: 0;
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
@media (max-width: 700px) {
  .task-pane { padding: 10px; }
  .task-row { flex-wrap: wrap; }
  .task-main { min-width: 0; flex-basis: calc(100% - 40px); }
  .task-actions { margin-left: auto; }
  .note-text { max-width: 100%; }
}
</style>
