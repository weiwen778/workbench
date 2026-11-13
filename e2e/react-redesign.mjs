import { chromium } from 'playwright'
import { base, out, password } from './react-env.mjs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()) })

async function api(method, path, body) {
  const cookies = await page.context().cookies()
  const csrf = cookies.find((c) => c.name === 'wb_csrf')?.value || ''
  const response = await page.request.fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    data: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok()) throw new Error(`${method} ${path} ${response.status()}`)
  return response.json().catch(() => null)
}

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForURL(/checkins/, { timeout: 15000 })

const table = await api('POST', '/tables', { name: '界面重设计验证', note: '', fields: [{ name: '名称', type: 'short_text' }, { name: '数量', type: 'number' }] })
try {
  await page.goto(`${base}/data/${table.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const quick = page.getByPlaceholder('快速新增一行')
  await quick.fill('行A')
  await quick.press('Enter')
  await page.waitForTimeout(900)
  console.log('quick add:', (await page.locator('body').innerText()).includes('行A'))
  await page.getByText('行A', { exact: true }).click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+A')
  await page.keyboard.type('行B')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const bodyText = await page.locator('body').innerText()
  console.log('inline edit visible:', bodyText.includes('行B'), 'old gone:', !bodyText.includes('行A'))
  await page.screenshot({ path: `${out}/table-inline.png` })
} finally {
  await api('DELETE', `/tables/${table.id}`)
  const trash = await api('GET', '/trash')
  for (const item of trash.items || []) {
    if (item.kind === 'table' && item.entity_id === table.id) await api('DELETE', `/trash/table/${table.id}`)
  }
}
console.log('errors:', errors)
await browser.close()
