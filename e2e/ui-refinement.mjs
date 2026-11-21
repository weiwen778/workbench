// UI 收口回归：无页头大标题、行操作 hover/focus、手机筛选折叠。
// Usage: WB_BASE=http://127.0.0.1:5174 node e2e/ui-refinement.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const base = process.env.WB_BASE || 'http://127.0.0.1:5174'
const password = process.env.WB_E2E_PASSWORD || 'admin12345'
const browser = await chromium.launch({ headless: true })
const errors = []

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(/checkins/, { timeout: 20000 })
  await page.waitForTimeout(500)
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await desktop.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page)

  const header = page.locator('header.MuiAppBar-root')
  const headerBox = await header.boundingBox()
  assert.ok(headerBox && headerBox.height <= 60, `AppBar 过高：${headerBox?.height}`)

  assert.equal(await page.locator('[data-page-title="true"]').count(), 0, '页面不应再显示独立大标题')
  await page.locator('[data-module-toolbar="true"]').first().waitFor({ timeout: 10000 })

  await page.goto(`${base}/data`, { waitUntil: 'networkidle' })
  const tableId = await page.evaluate(async () => {
    const response = await fetch('/api/v1/tables')
    const payload = await response.json()
    return Array.isArray(payload) ? payload[0]?.id : payload?.items?.[0]?.id
  })
  assert.ok(tableId, '没有可用表格')
  await page.goto(`${base}/data/${tableId}`, { waitUntil: 'networkidle' })
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 20000 })
  const row = page.locator('.MuiDataGrid-row').first()
  const rowAction = row.getByRole('button', { name: '行操作' }).first()
  await rowAction.waitFor()
  assert.ok(await rowAction.isVisible(), '表格行操作应常显')

  await page.goto(`${base}/memos`, { waitUntil: 'networkidle' })
  const card = page.locator('.memo-card').first()
  await card.waitFor({ timeout: 20000 })
  const cardActions = card.locator('.wb-card-actions').first()
  await cardActions.waitFor()
  assert.equal(await cardActions.evaluate((el) => getComputedStyle(el).opacity), '0', '便利贴操作默认应隐藏')
  await card.hover()
  await page.waitForTimeout(250)
  assert.equal(await cardActions.evaluate((el) => getComputedStyle(el).opacity), '1', '便利贴操作 hover 后应显示')

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const phone = await mobile.newPage()
  phone.on('pageerror', (error) => errors.push(error.message))
  await login(phone)
  const filterButton = phone.getByRole('button', { name: /^筛选/ }).first()
  await filterButton.waitFor({ timeout: 10000 })
  await filterButton.click()
  await phone.getByLabel('状态').waitFor({ timeout: 5000 })
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 1, `手机端出现横向溢出：${overflow}px`)

  assert.deepEqual(errors, [], `页面报错：${errors.join(' | ')}`)
  console.log('PASS ui refinement structure, hover actions, mobile filter')
} finally {
  await browser.close()
}
