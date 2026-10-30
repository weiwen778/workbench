// Use a disposable development database; this creates tables, records and a temporary Agent token.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, request } from 'playwright'
const base = process.env.WB_BASE || 'http://127.0.0.1:18746'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Dashboard E2E only runs against a local disposable instance')
const shots = path.resolve(process.env.WB_SCREENSHOT_DIR || '../docs/screenshots')
fs.mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
let agent
const suffix = Date.now()
async function select(control, label) {
  await control.press('Enter')
  await page.getByRole('option', { name: label, exact: true }).click()
}
async function post(url, body, method = 'POST') {
  const csrf = (await context.cookies()).find(c => c.name === 'wb_csrf')?.value
  const response = await context.request.fetch(base + '/api/v1' + url, { method, headers: { 'X-CSRF-Token': csrf || '' }, data: body })
  assert.ok(response.ok(), await response.text())
  return response.json()
}
try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill(process.env.WB_USER || 'admin')
  await page.getByPlaceholder('请输入密码').fill(process.env.WB_PASS || 'admin12345')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/checkins/shops')
  assert.equal((await (await context.request.get(base + '/api/v1/dashboards')).json()).length, 0,
    'Use a fresh test database without dashboards; existing dashboards will not be removed')
  const table = await post('/tables', { name: '店铺经营日报 ' + suffix, fields: [
    { name: '日期', type: 'date' }, { name: '店铺', type: 'short_text' },
    { name: '销售额', type: 'number' }, { name: '订单数', type: 'number' },
    { name: '日报状态', type: 'select', options: [{ id: 'done', name: '已核对' }, { id: 'pending', name: '待核对' }] },
  ] })
  const keys = Object.fromEntries(table.fields.map(f => [f.name, f.key]))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const records = []
  for (let i = 0; i < 8; i++) {
    const day = new Date(today + 'T00:00:00Z'); day.setUTCDate(day.getUTCDate() - i)
    records.push(await post(`/tables/${table.id}/records`, { data: { [keys.日期]: day.toISOString().slice(0, 10), [keys.店铺]: ['天猫店', '抖音店', '京东店'][i % 3], [keys.销售额]: String((i + 1) * 1000), [keys.订单数]: String(i + 1), [keys.日报状态]: i % 2 ? 'pending' : 'done' } }))
  }
  await page.goto(base + `/data/${table.id}`)
  await page.getByRole('button', { name: '可视化', exact: true }).click()
  await page.getByRole('button', { name: '创建看板', exact: true }).click()
  const prompt = page.getByRole('dialog', { name: '新建看板', exact: true })
  await prompt.getByRole('textbox').fill('店铺经营总览 ' + suffix)
  await prompt.getByRole('button', { name: '创建', exact: true }).click()

  async function chart(title, kind, group, first = false) {
    if (!first) await page.getByRole('button', { name: '添加图表', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加图表', exact: true })
    await dialog.getByPlaceholder('例如：本月销售额、各店铺销售对比').fill(title)
    await dialog.getByText(kind, { exact: true }).click()
    if (!first) await select(dialog.getByRole('combobox', { name: '来源表格' }), table.name)
    if (kind !== '饼图') {
      await select(dialog.getByRole('combobox', { name: '汇总方式' }), '求和')
      await select(dialog.getByRole('combobox', { name: '统计列' }), '销售额')
    }
    if (group) await select(dialog.getByRole('combobox', { name: '分组列' }), group)
    const preview = page.waitForResponse(r => r.url().endsWith('/api/v1/dashboards/preview'))
    await dialog.getByRole('button', { name: '预览数据', exact: true }).click()
    assert.equal((await preview).status(), 200)
    await dialog.locator('.preview-box').waitFor()
    if (kind === '指标卡') assert.ok((await dialog.locator('.metric-value').textContent()).includes('36,000'))
    await dialog.getByRole('button', { name: '保存图表', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('region', { name: title, exact: true }).waitFor()
  }
  await chart('销售额合计', '指标卡', null, true)
  await chart('各店铺销售对比', '柱状图', '店铺')
  await chart('每日销售趋势', '折线图', '日期')
  await chart('日报核对状态', '饼图', '日报状态')
  await page.reload()
  const metric = page.getByRole('region', { name: '销售额合计', exact: true })
  await metric.getByText('36,000', { exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '各店铺销售对比', exact: true }).locator('rect').count(), 3)
  assert.equal(await page.getByRole('region', { name: '每日销售趋势', exact: true }).locator('circle').count(), 8)
  await page.getByRole('region', { name: '日报核对状态', exact: true }).getByText('查看数值', { exact: true }).click()
  await page.getByRole('region', { name: '日报核对状态', exact: true }).getByRole('cell', { name: '已核对', exact: true }).waitFor()
  await page.screenshot({ path: path.join(shots, 'dashboard-desktop.png') })
  await select(page.getByRole('combobox', { name: '统计时间' }), '最近 7 天')
  await metric.getByText('28,000', { exact: true }).waitFor()
  const token = await post('/agent-tokens', { name: 'Dashboard E2E', scopes: ['tables:write'] })
  agent = await request.newContext({ baseURL: base, extraHTTPHeaders: { Authorization: 'Bearer ' + token.token } })
  const update = await agent.patch(`/api/v1/agent/records/${records[0].id}`, { data: { version: records[0].version, data: { [keys.销售额]: '10000' } } })
  assert.equal(update.status(), 200)
  await page.getByRole('button', { name: '刷新数据', exact: true }).click()
  await metric.getByText('37,000', { exact: true }).waitFor()
  await metric.getByRole('button', { name: '销售额合计的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑图表', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑图表', exact: true })
  await edit.getByPlaceholder('例如：本月销售额、各店铺销售对比').fill('销售额总计')
  await edit.getByRole('button', { name: '保存图表', exact: true }).click()
  await edit.waitFor({ state: 'hidden' })
  await page.getByRole('region', { name: '销售额总计', exact: true }).waitFor()
  await post('/preferences', { theme: 'dark' }, 'PUT')
  await page.reload()
  await page.getByRole('region', { name: '销售额总计', exact: true }).waitFor()
  await page.getByRole('region', { name: '销售额总计', exact: true }).getByText('45,000', { exact: true }).waitFor()
  await page.locator('.el-loading-mask:visible').waitFor({ state: 'hidden' })
  await page.screenshot({ path: path.join(shots, 'dashboard-dark.png') })
  await post('/preferences', { theme: 'light' }, 'PUT')
  await page.reload()
  await page.getByRole('region', { name: '销售额总计', exact: true }).getByText('45,000', { exact: true }).waitFor()
  await page.locator('.el-loading-mask:visible').waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('region', { name: '销售额总计', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(shots, 'dashboard-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal page overflow on mobile')
  assert.deepEqual(errors, [])
  console.log('Dashboard E2E passed: table shortcut, 4 charts, preview/save/reload, date filter, Agent writeback, edit, dark and mobile layouts.')
} catch (error) {
  await page.screenshot({ path: path.join(shots, 'dashboard-failure.png') })
  throw error
} finally { await agent?.dispose(); await browser.close() }
