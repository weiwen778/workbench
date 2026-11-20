// Behaviour regression for table selection and inline editing.
// Usage: WB_E2E_PASSWORD=... node e2e/table-selection-edit.mjs
import { chromium } from './node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD || 'admin12345'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
const createdTables = []
let putCount = 0
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  if (request.method() === 'PUT' && request.url().includes('/api/v1/records/')) putCount += 1
})

async function api(path, body, method = 'POST') {
  return page.evaluate(async ({ path, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|; )wb_csrf=([^;]*)/)?.[1] || '')
    const response = await fetch('/api/v1' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.status === 204 ? null : response.json()
  }, { path, body, method })
}

async function createTable(fields, rows = []) {
  const table = await api('/tables', { name: '选择编辑回归 ' + Date.now() + ' ' + fields.length, fields })
  createdTables.push(table.id)
  const keys = Object.fromEntries(table.fields.map((field) => [field.name, field.key]))
  for (const data of rows) {
    const mapped = Object.fromEntries(Object.entries(data).map(([name, value]) => [keys[name], value]))
    await api(`/tables/${table.id}/records`, { data: mapped })
  }
  return { table, keys }
}

async function waitForRowCount(total) {
  await page.getByText(`共 ${total} 行`, { exact: true }).waitFor({ timeout: 15000 })
}

const rowCheckbox = (index) => page.locator('.MuiDataGrid-row').nth(index).locator('input[type="checkbox"]')
const headerCheckbox = page.locator('.MuiDataGrid-columnHeaders input[type="checkbox"]')
const nameCell = (index) => page.locator('.MuiDataGrid-row').nth(index).locator('.MuiDataGrid-cell').nth(3)

try {
  await page.goto(base + '/login')
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(/checkins/, { timeout: 20000 })

  const rows = Array.from({ length: 60 }, (_, index) => ({
    日期: `2025-11-${String((index % 28) + 1).padStart(2, '0')}`,
    店铺: '门店' + (index % 3),
    名称: '记录' + (index + 1),
    数量: String(index + 1),
    备注: '备注' + (index + 1),
  }))
  const { table, keys } = await createTable([
    { name: '日期', type: 'date' },
    { name: '店铺', type: 'short_text' },
    { name: '名称', type: 'short_text' },
    { name: '数量', type: 'number' },
    { name: '备注', type: 'long_text' },
  ], rows)

  await page.goto(base + '/data/' + table.id)
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 20000 })
  await waitForRowCount(60)

  // 当前页勾选 2 行
  await rowCheckbox(0).click()
  await rowCheckbox(1).click()
  await page.getByRole('button', { name: '删除选中的 2 行', exact: true }).waitFor()

  // 表头全选只作用于当前页
  await headerCheckbox.click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '删除选中的 50 行', exact: true }).waitFor()
  await headerCheckbox.click()
  await page.waitForFunction(() => !document.body.innerText.includes('删除选中的'))

  // 第 2 页选 1 行，再回到第 1 页：表头全选不能清掉其他页的选择
  const pageButton = (number) => page.locator('.MuiPagination-root button').filter({ hasText: new RegExp(`^${number}$`) })
  await pageButton(2).click()
  await page.waitForTimeout(700)
  await rowCheckbox(0).click()
  await page.getByRole('button', { name: '删除选中的 1 行', exact: true }).waitFor()
  await pageButton(1).click()
  await page.waitForTimeout(700)
  await headerCheckbox.click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '删除选中的 51 行', exact: true }).waitFor()
  await headerCheckbox.click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '删除选中的 1 行', exact: true }).waitFor()

  // 跨页选择保留：第 1 页再选 2 行，共 3 行
  await rowCheckbox(0).click()
  await rowCheckbox(1).click()
  await page.getByRole('button', { name: '删除选中的 3 行', exact: true }).waitFor()

  // 固定列默认关闭：只有选择列固定；打开「视图 → 固定日期/店铺列」后才固定日期/店铺。
  const pinnedHeaderFields = () => page.locator('.MuiDataGrid-columnHeader--pinnedLeft').evaluateAll((headers) => headers.map((header) => header.getAttribute('data-field')))
  assert.deepEqual(await pinnedHeaderFields(), ['__check__'], '固定列默认应为关闭')
  await page.getByRole('button', { name: '视图', exact: true }).click()
  await page.getByText('固定日期/店铺列', { exact: true }).locator('..').locator('input[type="checkbox"]').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  assert.ok((await pinnedHeaderFields()).length >= 3, '打开固定列开关后日期/店铺列没有固定')
  assert.ok(await page.locator('.MuiDataGrid-cell--pinnedRight').count() >= 1, '右侧操作列未固定')

  // Enter 保存，只允许一次 PUT
  await nameCell(0).dblclick()
  const editor = page.locator('.MuiDataGrid-cell .MuiInputBase-input').first()
  await editor.waitFor({ timeout: 5000 })
  await editor.fill('改后名称')
  await editor.press('Enter')
  await page.locator('.MuiDataGrid-row').first().getByText('改后名称', { exact: true }).waitFor()
  await page.waitForTimeout(400)
  assert.equal(putCount, 1, 'Enter 保存后又因为 blur 重复提交')

  const saved = await api(`/tables/${table.id}/records?page=1&page_size=50`, undefined, 'GET')
  assert.equal(saved.items[0].data[keys['名称']], '改后名称', '编辑结果没有写入服务端')

  // Escape 取消，不产生 PUT
  const putsBeforeEscape = putCount
  await nameCell(1).dblclick()
  await editor.waitFor({ timeout: 5000 })
  await editor.fill('不应保存')
  await editor.press('Escape')
  await page.waitForTimeout(500)
  assert.equal(putCount, putsBeforeEscape, 'Escape 取消了却仍然保存')
  await page.locator('.MuiDataGrid-row').nth(1).getByText('记录2', { exact: true }).waitFor()

  // 跨页选中的 3 行一起删除
  await page.getByRole('button', { name: '删除选中的 3 行', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '删除行', exact: true })
  await confirm.waitFor()
  await confirm.getByRole('button', { name: '删除', exact: true }).click()
  await waitForRowCount(57)

  // 空表
  const empty = await createTable([{ name: '名称', type: 'short_text' }])
  await page.goto(base + '/data/' + empty.table.id)
  await page.getByText(/暂无数据|没有符合条件的内容/).first().waitFor({ timeout: 15000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, '空表页面横向溢出')

  // 200 字段宽表
  const wide = await createTable(
    Array.from({ length: 200 }, (_, index) => ({ name: '字段' + (index + 1), type: 'short_text' })),
    [Object.fromEntries(Array.from({ length: 200 }, (_, index) => ['字段' + (index + 1), '值' + (index + 1)]))],
  )
  await page.goto(base + '/data/' + wide.table.id)
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 30000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, '200 列宽表页面横向溢出')

  assert.deepEqual(errors, [], 'page errors occurred')
  console.log('PASS selection (page/cross-page/select-all), inline edit (Enter/Escape/single PUT), batch delete, pinned columns, empty and 200-column tables')
} finally {
  for (const id of createdTables) {
    try { await api(`/tables/${id}`, undefined, 'DELETE') } catch { /* best effort */ }
  }
  await browser.close()
}
