// 主流程功能验证：每个模块走一次真实「创建 → 校验 → 清理」闭环
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD
const outDir = process.env.WB_AUDIT_OUT || resolve(process.cwd(), '../.run/audit3')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) jsErrors.push(m.text().slice(0, 200)) })

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`)
}

async function api(method, path, body) {
  const cookies = await context.cookies()
  const csrf = cookies.find((c) => c.name === 'wb_csrf')?.value || ''
  const res = await page.request.fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    data: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text }
  return { ok: res.ok(), status: res.status(), body: json }
}
const listOf = (data) => (Array.isArray(data) ? data : data?.items || [])

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).first().click()
await page.waitForURL(/checkins/, { timeout: 20000 })
await page.waitForTimeout(500)

// 1. 待办：新增 → 勾选完成 → 删除
try {
  await page.goto(`${base}/todos`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const title = `审计待办 ${Date.now()}`
  await page.getByPlaceholder('添加待办，回车保存').fill(title)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const visible = (await page.locator('body').innerText()).includes(title)
  const lists = listOf((await api('GET', '/todo-lists')).body)
  const listId = lists[0]?.id
  const before = await api('GET', `/todos?list_id=${listId}`)
  const pendingItem = (before.body.pending || []).find((t) => t.title === title)
  const row = page.locator('[data-todo-id]').filter({ hasText: title }).first()
  await row.locator('input[type=checkbox]').first().click({ force: true })
  await page.waitForTimeout(1500)
  const after = await api('GET', `/todos?list_id=${listId}`)
  const doneItem = (after.body.completed || []).find((t) => t.title === title)
  record('待办 新增+完成', visible && Boolean(pendingItem) && Boolean(doneItem?.completed_at), `pending=${Boolean(pendingItem)} completed_at=${doneItem?.completed_at || '-'}`)
  const created = doneItem || pendingItem
  await page.screenshot({ path: resolve(outDir, 'flow-todos.png') })
} catch (error) { record('待办 新增+完成', false, String(error.message).slice(0, 160)) }

// 2. 便利贴：新建 → 保存 → 校验 → 删除
try {
  await page.goto(`${base}/memos`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  const title = `审计便利贴 ${Date.now() % 100000}`
  await page.getByRole('button', { name: /新建便利贴/ }).first().click()
  await page.getByPlaceholder('不填则显示为无标题便利贴').fill(title)
  await page.getByPlaceholder(/随手记内容/).fill('审计用内容')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(1200)
  const memos = await api('GET', '/memos')
  const created = listOf(memos.body).find((m) => m.title === title)
  record('便利贴 新建', Boolean(created) && (await page.locator('body').innerText()).includes(title), `id=${created?.id}`)
  if (created) await api('DELETE', `/memos/${created.id}`)
  await page.screenshot({ path: resolve(outDir, 'flow-memos.png') })
} catch (error) { record('便利贴 新建', false, String(error.message).slice(0, 160)) }

// 3. 网址：新增 → 校验 → 删除
try {
  await page.goto(`${base}/bookmarks`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  const title = `审计网址 ${Date.now() % 100000}`
  await page.getByRole('button', { name: /添加网址|新增|新建/ }).first().click()
  await page.getByPlaceholder('https://example.com').fill('https://example.com')
  await page.getByPlaceholder('留空时使用域名').fill(title)
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(1200)
  const books = await api('GET', '/bookmarks')
  const created = listOf(books.body).find((b) => b.title === title || b.name === title)
  record('网址 新增', Boolean(created), `id=${created?.id}`)
  if (created) await api('DELETE', `/bookmarks/${created.id}`)
  await page.screenshot({ path: resolve(outDir, 'flow-bookmarks.png') })
} catch (error) { record('网址 新增', false, String(error.message).slice(0, 160)) }

// 4. 笔记：新建 → 输入 → 自动保存 → 删除
try {
  await page.goto(`${base}/notes`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  const before = listOf((await api('GET', '/notes')).body).length
  await page.getByRole('button', { name: /新建笔记/ }).first().click()
  await page.waitForTimeout(1200)
  const editor = page.locator('.cm-content, textarea').first()
  await editor.click()
  const marker = `审计笔记 ${Date.now() % 100000}`
  await page.keyboard.type(marker)
  await page.waitForTimeout(2500)
  const after = listOf((await api('GET', '/notes')).body)
  const created = after.find((n) => (n.body || n.content || '').includes(marker))
  record('笔记 新建+自动保存', after.length >= before && Boolean(created), `before=${before} after=${after.length}`)
  if (created) await api('DELETE', `/notes/${created.id}`)
  await page.screenshot({ path: resolve(outDir, 'flow-notes.png') })
} catch (error) { record('笔记 新建+自动保存', false, String(error.message).slice(0, 160)) }

// 5. 表格：新建（含一列）→ 打开 → 校验 → 删除
try {
  await page.goto(`${base}/data`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const name = `审计表格 ${Date.now() % 100000}`
  await page.getByRole('button', { name: /新建表格/ }).first().click()
  await page.getByPlaceholder('例如：商品台账').fill(name)
  await page.getByRole('button', { name: '添加一列' }).click()
  await page.waitForTimeout(300)
  const columnInput = page.locator('.MuiDialog-paper input[type=text]').nth(1)
  if (await columnInput.count()) await columnInput.fill('字段A')
  await page.getByRole('button', { name: /创建并打开/ }).click()
  await page.waitForTimeout(2500)
  const url = page.url()
  const tables = await api('GET', '/tables')
  const created = listOf(tables.body).find((t) => t.name === name)
  const gridMounted = await page.locator('.MuiDataGrid-root').count()
  record('表格 新建+打开', Boolean(created) && gridMounted > 0, `id=${created?.id} url=${url.replace(base, '')} grid=${gridMounted}`)
  await page.screenshot({ path: resolve(outDir, 'flow-table.png') })
  if (created) await api('DELETE', `/tables/${created.id}`)
} catch (error) { record('表格 新建+打开', false, String(error.message).slice(0, 160)) }

// 6. 看板：新建 → 打开 → 删除
try {
  await page.goto(`${base}/visualizations`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const name = `审计看板 ${Date.now() % 100000}`
  await page.getByRole('button', { name: /新建看板/ }).first().click()
  await page.getByPlaceholder('例如：天猫旗舰店、抖音店铺').fill(name)
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(1800)
  const opened = /\/visualizations\/(\d+)/.exec(page.url())
  const created = opened ? { id: Number(opened[1]) } : null
  record('看板 新建+打开', Boolean(created), `id=${created?.id} url=${page.url().replace(base, '')}`)
  await page.screenshot({ path: resolve(outDir, 'flow-board.png') })
  if (created) await api('DELETE', `/dashboards/${created.id}`)
} catch (error) { record('看板 新建+打开', false, String(error.message).slice(0, 160)) }

// 7. 白板：新建 → 打开画布 → 删除
try {
  await page.goto(`${base}/whiteboards`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const name = `审计白板 ${Date.now() % 100000}`
  await page.getByRole('button', { name: /新建白板/ }).first().click()
  await page.locator('.MuiDialog-paper input').first().fill(name)
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(3500)
  const canvas = await page.locator('canvas').count()
  const boards = await api('GET', '/whiteboards')
  const created = listOf(boards.body).find((b) => b.title === name)
  record('白板 新建+画布', Boolean(created) && canvas > 0, `id=${created?.id} canvas=${canvas}`)
  await page.screenshot({ path: resolve(outDir, 'flow-whiteboard.png') })
  if (created) await api('DELETE', `/whiteboards/${created.id}`)
} catch (error) { record('白板 新建+画布', false, String(error.message).slice(0, 160)) }

// 8. 打卡：切换一项 → 校验 → 还原
try {
  await page.goto(`${base}/checkins`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const boxes = page.locator('input[type=checkbox]')
  const total = await boxes.count()
  let changed = null
  for (let i = 0; i < Math.min(total, 6); i += 1) {
    const box = boxes.nth(i)
    const before = await box.isChecked().catch(() => null)
    if (before === null) continue
    await box.click({ force: true })
    await page.waitForTimeout(1200)
    const after = await box.isChecked().catch(() => null)
    if (after !== before) {
      changed = { index: i, before, after }
      await box.click({ force: true })
      await page.waitForTimeout(900)
      break
    }
  }
  record('打卡 勾选/取消', Boolean(changed), JSON.stringify(changed))
  await page.screenshot({ path: resolve(outDir, 'flow-checkins.png') })
} catch (error) { record('打卡 勾选/取消', false, String(error.message).slice(0, 160)) }

// 9. 文档工作台：三个页签依次切换并挂载编辑器
try {
  await page.goto(`${base}/docs`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const pdf = await page.locator('text=打开 PDF').count()
  await page.getByRole('tab', { name: /工作簿/ }).click()
  await page.waitForTimeout(2500)
  const univer = await page.locator('canvas, .univer-canvas, [data-u-comp]').count()
  await page.getByRole('tab', { name: /Markdown/ }).click()
  await page.waitForTimeout(1500)
  const mdEditor = await page.locator('.cm-content').count()
  record('文档 三页签挂载', pdf > 0 && (univer > 0 || mdEditor > 0), `pdf=${pdf} univer=${univer} md=${mdEditor}`)
  await page.screenshot({ path: resolve(outDir, 'flow-docs.png') })
} catch (error) { record('文档 三页签挂载', false, String(error.message).slice(0, 160)) }

// 10. 二维码：输入内容 → 生成
try {
  await page.goto(`${base}/codes`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const input = page.locator('textarea, input[type=text]').first()
  await input.fill('https://example.com/audit')
  await page.waitForTimeout(1500)
  const images = await page.locator('canvas, svg:not([data-testid])').count()
  record('二维码 生成', images > 0, `render nodes=${images}`)
  await page.screenshot({ path: resolve(outDir, 'flow-codes.png') })
} catch (error) { record('二维码 生成', false, String(error.message).slice(0, 160)) }

// 11. 搜索：Ctrl+K → 输入关键词 → 有结果或空态
try {
  await page.goto(`${base}/checkins`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.keyboard.press('Control+k')
  await page.getByLabel('搜索内容').waitFor({ timeout: 5000 })
  await page.getByLabel('搜索内容').fill('模拟')
  await page.waitForTimeout(1800)
  const dialogText = await page.locator('.MuiDialog-paper').innerText()
  record('统一搜索', dialogText.length > 10, dialogText.replace(/\s+/g, ' ').slice(0, 80))
  await page.screenshot({ path: resolve(outDir, 'flow-search.png') })
  await page.keyboard.press('Escape')
} catch (error) { record('统一搜索', false, String(error.message).slice(0, 160)) }

// 12. 设置：切换「外观」某项后落库
try {
  await page.goto(`${base}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const before = await bg()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForTimeout(1600)
  const dark = await bg()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)
  const persisted = await bg()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await page.waitForTimeout(1400)
  const restored = await bg()
  record('设置 主题切换+持久化', before !== dark && dark === persisted && restored === before,
    `before=${before} dark=${dark} afterReload=${persisted} restored=${restored}`)
  await page.screenshot({ path: resolve(outDir, 'flow-settings.png') })
} catch (error) { record('设置 偏好持久化', false, String(error.message).slice(0, 160)) }

writeFileSync(resolve(outDir, 'flows.json'), JSON.stringify({ results, jsErrors }, null, 2))
console.log('\nJS errors:', jsErrors.length)
for (const e of jsErrors.slice(0, 12)) console.log('  ' + e)
const failed = results.filter((r) => !r.ok).length
console.log(`\nsummary: ${results.length - failed}/${results.length} passed`)
await browser.close()
