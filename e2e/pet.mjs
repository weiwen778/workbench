import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import fs from 'node:fs'

fs.mkdirSync('../.run/pet-e2e', { recursive: true })
const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(process.env.WB_E2E_PASSWORD || 'admin12345')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  // 新库没有打卡目标，登录后落在 /checkins；只要求离开登录页。
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  const before = await context.request.get(base + '/api/v1/pet')
  const hadPet = Boolean((await before.json()).pet)

  await page.goto(base + '/pet')
  if (!hadPet) {
    await page.getByRole('heading', { name: '领养一只狗' }).waitFor()
    await page.getByLabel('给狗狗起个名字').fill('测试旺财')
    await page.getByRole('button', { name: '领养', exact: true }).click()
  }
  await page.locator('h5').first().waitFor()

  await page.getByRole('button', { name: '改名', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '给狗狗改名' })
  await dialog.getByLabel('名字').fill('豆豆')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '豆豆' }).waitFor()

  await page.reload()
  await page.getByRole('heading', { name: '豆豆' }).waitFor()
  await page.screenshot({ path: '../.run/pet-e2e/shell.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: pet adoption, rename, reload and navigation shell.')
} catch (error) {
  await page.screenshot({ path: '../.run/pet-e2e/failure.png' })
  throw error
} finally {
  await browser.close()
}
