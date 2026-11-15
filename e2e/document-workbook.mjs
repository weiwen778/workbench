import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { base, password } from './react-env.mjs'

const require = createRequire(new URL('../web-react/package.json', import.meta.url))
const XLSX = require('xlsx')

const origin = base
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['first-marker', 3, { t: 'n', v: 6, f: 'B1*2', z: '0.00' }]]), '源表一')
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['second-marker', 9]]), '源表二')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(12000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(origin + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/checkins')
  console.log('Playwright login and default route passed.')
  await page.goto(origin + '/docs?module=sheet')
  await page.getByTestId('univer-host').locator('canvas').first().waitFor()
  await page.locator('input[type=file]').setInputFiles({ name: 'overview-workbook.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) })
  await page.getByText('2 个工作表', { exact: true }).waitFor()
  await page.getByText('源表二', { exact: true }).click()
  const savedResponse = page.waitForResponse(res => res.url() === origin + '/api/v1/document-projects' && res.request().method() === 'POST')
  await page.keyboard.press('Control+s')
  const saved = await savedResponse
  assert.equal(saved.status(), 201, await saved.text())
  assert.deepEqual((await saved.json()).attachments.map(file => file.name).sort(), ['overview-workbook.univer.json', 'overview-workbook.xlsx'])
  await page.getByText('项目已创建').waitFor()
  await page.reload()
  await page.getByTestId('univer-host').locator('canvas').first().waitFor()
  await page.getByRole('button', { name: '项目', exact: true }).click()
  await page.getByRole('dialog').getByText('overview-workbook', { exact: true }).click()
  await page.getByText('2 个工作表', { exact: true }).waitFor()
  async function exportWorkbook(label) {
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const event = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: label }).click()
    const download = await event
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
  }
  const exported = XLSX.read(await exportWorkbook(/导出 XLSX/), { type: 'buffer', cellFormula: true, cellNF: true })
  assert.deepEqual(exported.SheetNames, ['源表一', '源表二'])
  assert.equal(exported.Sheets['源表一'].C1.f, 'B1*2')
  assert.equal(exported.Sheets['源表一'].C1.z, '0.00')
  console.log('Workbook XLSX import, two-attachment save, reload/reopen, and XLSX export passed.')
  const csv = (await exportWorkbook(/导出 CSV/)).toString('utf8')
  assert.match(csv, /second-marker/, 'CSV should export the selected second sheet')
  assert.doesNotMatch(csv, /first-marker/)
  assert.equal((await exportWorkbook(/导出 TSV/)).toString('utf8').trim(), 'second-marker\t9')
  await page.getByTestId('univer-host').locator('[data-u-comp="sheet-bar-append-button"]').first().click()
  await page.getByText('3 个工作表', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '工作簿标题' }).fill('长'.repeat(200))
  const updatedResponse = page.waitForResponse(res => res.url().includes('/api/v1/document-projects/') && res.request().method() === 'PUT')
  await page.keyboard.press('Meta+s')
  const updated = await updatedResponse
  assert.ok(updated.ok(), await updated.text())
  const project = await updated.json()
  assert.equal(project.state.sheets, 3)
  assert.ok(project.attachments.some((file) => file.name.endsWith('.univer.json')))
  assert.ok(project.attachments.some((file) => file.name.endsWith('.xlsx')))
  console.log('CSV and TSV follow the active sheet, and both save shortcuts work.')
  assert.deepEqual(pageErrors, [])
} finally {
  await browser.close()
}
