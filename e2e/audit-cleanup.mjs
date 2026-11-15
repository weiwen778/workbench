// 清理审计过程产生的临时数据（只删名字里带「审计」的条目）
import { chromium } from 'playwright'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).first().click()
await page.waitForURL(/checkins/, { timeout: 20000 })

async function call(method, path) {
  const cookies = await context.cookies()
  const csrf = cookies.find((c) => c.name === 'wb_csrf')?.value || ''
  const res = await page.request.fetch(`${base}/api/v1${path}`, { method, headers: { 'X-CSRF-Token': csrf } })
  return { status: res.status(), body: await res.json().catch(() => null) }
}
const arr = (data) => (Array.isArray(data) ? data : data?.items || data?.boards || [])

const removed = []
const dashboards = arr((await call('GET', '/dashboards')).body)
for (const board of dashboards) {
  if ((board.name || '').startsWith('审计')) {
    const res = await call('DELETE', `/dashboards/${board.id}`)
    removed.push(`dashboard ${board.id} ${board.name} -> ${res.status}`)
  }
}
const boards = arr((await call('GET', '/whiteboards')).body)
for (const board of boards) {
  if ((board.title || '').startsWith('审计')) {
    const res = await call('DELETE', `/whiteboards/${board.id}`)
    removed.push(`whiteboard ${board.id} ${board.title} -> ${res.status}`)
  }
}
const tables = arr((await call('GET', '/tables')).body)
for (const table of tables) {
  if ((table.name || '').startsWith('审计')) {
    const res = await call('DELETE', `/tables/${table.id}`)
    removed.push(`table ${table.id} ${table.name} -> ${res.status}`)
  }
}
const memos = arr((await call('GET', '/memos')).body)
for (const memo of memos) {
  if ((memo.title || '').startsWith('审计')) {
    const res = await call('DELETE', `/memos/${memo.id}`)
    removed.push(`memo ${memo.id} ${memo.title} -> ${res.status}`)
  }
}
const books = arr((await call('GET', '/bookmarks')).body)
for (const book of books) {
  const title = book.title || book.name || ''
  if (title.startsWith('审计')) {
    const res = await call('DELETE', `/bookmarks/${book.id}`)
    removed.push(`bookmark ${book.id} ${title} -> ${res.status}`)
  }
}
const notes = arr((await call('GET', '/notes')).body)
for (const note of notes) {
  const body = note.body || note.content || note.title || ''
  if (String(body).includes('审计笔记') || String(note.title || '').includes('审计')) {
    const res = await call('DELETE', `/notes/${note.id}`)
    removed.push(`note ${note.id} -> ${res.status}`)
  }
}
const lists = arr((await call('GET', '/todo-lists')).body)
for (const list of lists) {
  const detail = await call('GET', `/todos?list_id=${list.id}`)
  for (const todo of [...(detail.body?.pending || []), ...(detail.body?.completed || [])]) {
    if ((todo.title || '').startsWith('审计')) {
      await call('DELETE', `/todos/${todo.id}`)
      removed.push(`todo ${todo.id} ${todo.title}`)
    }
  }
}
console.log(removed.length ? removed.join('\n') : 'no leftovers')
await browser.close()
