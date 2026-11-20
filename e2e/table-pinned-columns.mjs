// Regression: columns whose names merely contain "店" (e.g. 全店曝光) must not be
// mistaken for the pinned store column. A non-leading column injected into the
// community DataGrid's pinnedColumns renders a headerless duplicate over its neighbours.
// Usage: WB_BASE=http://127.0.0.1:18080 node e2e/table-pinned-columns.mjs
import { chromium } from './node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD || 'admin12345'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 780, height: 900 } })
// 固定列默认关闭，这个回归用例需要先打开开关才能覆盖旧错位路径。
await context.addInitScript(() => {
  try { localStorage.setItem('wb_table_pin_columns', '1') } catch { /* ignore */ }
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let tableID

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

try {
  await page.goto(base + '/login')
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(/checkins/, { timeout: 20000 })

  const table = await api('/tables', {
    name: '固定列回归 ' + Date.now(),
    fields: [
      { name: '周期', type: 'date' },
      { name: '起始日期', type: 'date' },
      { name: '结束日期', type: 'date' },
      { name: '全店曝光', type: 'number' },
      { name: '全店访客', type: 'number' },
      { name: '店铺', type: 'short_text' },
    ],
  })
  tableID = table.id
  const keys = Object.fromEntries(table.fields.map((field) => [field.name, field.key]))
  const starts = ['2025-08-24', '2025-08-31', '2025-09-07', '2025-09-14', '2025-09-21']
  for (const [index, start] of starts.entries()) {
    const end = new Date(Date.parse(start) + 6 * 86400000).toISOString().slice(0, 10)
    await api(`/tables/${tableID}/records`, {
      data: {
        [keys['周期']]: start,
        [keys['结束日期']]: end,
        [keys['全店曝光']]: String(1952 + index),
        [keys['全店访客']]: String(650 + index),
        [keys['店铺']]: '全店',
      },
    })
  }

  await page.goto(base + '/data/' + tableID)
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(300)

  const layout = await page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { x: Math.round(rect.x), width: Math.round(rect.width) }
    }
    const headers = [...document.querySelectorAll('.MuiDataGrid-columnHeader')].map((element) => ({
      field: element.getAttribute('data-field'),
      text: element.innerText.replace(/\s+/g, ' ').trim(),
      ...box(element),
    }))
    const row = document.querySelector('.MuiDataGrid-row')
    const cells = row
      ? [...row.querySelectorAll('.MuiDataGrid-cell')]
        .filter((element) => element.getAttribute('data-field'))
        .map((element) => ({
          field: element.getAttribute('data-field'),
          text: element.innerText.replace(/\s+/g, ' ').trim(),
          ...box(element),
        }))
      : []
    return { headers, cells }
  })

  // 指标列只应出现一次；旧实现会把「全店曝光」当作店铺列，额外复制一份到左侧且没有表头。
  assert.equal(
    layout.cells.filter((cell) => cell.field === keys['全店曝光']).length,
    1,
    '全店曝光被错误地重复渲染为固定列',
  )

  // 每个表头都应有同一字段、同一水平位置的单元格，不能有表头/表体错位。
  for (const header of layout.headers) {
    if (!header.field) continue
    const cell = layout.cells.find((item) => item.field === header.field)
    assert.ok(cell, `表头 ${header.field} 没有对应的单元格`)
    assert.ok(
      Math.abs(cell.x - header.x) <= 1,
      `表头 ${header.field} 与单元格错位：header.x=${header.x}, cell.x=${cell.x}`,
    )
  }

  // 除勾选列外，不应出现无表头的列。
  const unnamed = layout.headers.filter((header) => header.field !== '__check__' && !header.text)
  assert.deepEqual(unnamed.map((header) => header.field), [], '出现无表头列')

  assert.deepEqual(errors, [], 'page errors occurred')
  console.log('PASS pinned columns ignore metric names containing 店 and stay aligned with headers')
} finally {
  if (tableID) {
    try { await api(`/tables/${tableID}`, undefined, 'DELETE') } catch { /* best effort */ }
  }
  await browser.close()
}
