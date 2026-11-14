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
    // 领养成功后卡片立刻卸载，提示由 hook 级 onSuccess 发出，必须仍能看到。
    await page.getByText('领养成功', { exact: true }).waitFor({ timeout: 10_000 })
  }
  await page.locator('h5').first().waitFor()
  await page.waitForFunction(() => document.title.startsWith('宠物'))

  await page.getByRole('button', { name: '改名', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '给狗狗改名' })
  await dialog.getByLabel('名字').fill('豆豆')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '豆豆' }).waitFor()

  // 状态面板和动作
  await page.getByText('饱腹', { exact: true }).waitFor()
  const feed = page.getByRole('button', { name: /喂食/ })
  const feedResponse = page.waitForResponse((r) => r.url().endsWith('/api/v1/pet/actions') && r.request().method() === 'POST')
  await feed.click()
  assert.equal((await feedResponse).status(), 200)
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('喂食'))
    return el?.hasAttribute('disabled')
  })

  await page.getByRole('button', { name: /睡觉/ }).click()
  // 状态栏把阶段和状态放在同一行（幼犬 · 睡觉中），这里用子串匹配而不是 exact。
  await page.getByText('睡觉中').waitFor()
  assert.ok(await feed.isDisabled())
  await page.getByRole('button', { name: /叫醒/ }).click()
  await page.getByText('睡觉中').waitFor({ state: 'hidden' })

  const petButton = page.getByRole('button', { name: '抚摸', exact: true })
  const petResponse = page.waitForResponse((r) => r.url().endsWith('/api/v1/pet/actions'))
  await petButton.click()
  await petResponse
  await page.screenshot({ path: '../.run/pet-e2e/actions.png' })

  await page.reload()
  await page.getByRole('heading', { name: '豆豆' }).waitFor()
  await page.screenshot({ path: '../.run/pet-e2e/shell.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: pet adoption, rename, reload, needs panel, feed cooldown, sleep/wake and petting.')
} catch (error) {
  await page.screenshot({ path: '../.run/pet-e2e/failure.png' })
  throw error
} finally {
  await browser.close()
}
