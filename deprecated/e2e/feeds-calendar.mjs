import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import fs from 'node:fs'

fs.mkdirSync('../.run/feeds-e2e', { recursive: true })
const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(process.env.WB_E2E_PASSWORD || 'admin12345')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  await page.goto(base + '/feeds?tab=calendar')
  // 五个区块：日历 + 四个数据栏
  await page.getByText('订阅文章', { exact: true }).waitFor()
  await page.getByText('阿里国际站规则', { exact: true }).waitFor()
  await page.getByText('1688 规则', { exact: true }).waitFor()
  await page.getByText('常用平台入口', { exact: true }).waitFor()

  // 抓取时间线：有成功快照显示相对时间，否则显示未抓取提示
  const stamp = page.getByText(/最近抓取|尚未成功抓取赛事/).first()
  await stamp.waitFor()
  const stampText = (await stamp.textContent()) || ''
  assert.match(stampText, /最近抓取|尚未成功抓取赛事/)

  // 日历网格 6 周
  assert.ok(await page.getByText('一', { exact: true }).count())

  // 超出 RunSignup 90 天窗口时应出现提示
  const windowHint = page.getByText(/查询范围超出 RunSignup 抓取窗口/)
  assert.equal(await windowHint.count(), 0)
  const next = page.getByRole('button', { name: '下月' })
  for (let i = 0; i < 4; i += 1) {
    await next.click()
    await page.waitForTimeout(120)
  }
  await windowHint.first().waitFor({ timeout: 15_000 })
  await page.screenshot({ path: '../.run/feeds-e2e/window-exceeded.png' })

  // 回到本月，提示消失
  await page.getByRole('button', { name: '今天' }).click()
  await page.waitForTimeout(400)
  await windowHint.first().waitFor({ state: 'hidden', timeout: 15_000 })

  // 刷新赛事：只断言请求成功与页面不报错（冷却提示属于正常交互）
  const refreshResponse = page.waitForResponse(
    (r) => r.url().includes('/api/v1/feeds/common/runsignup/refresh') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '刷新赛事' }).click()
  const response = await refreshResponse
  assert.ok([200, 202].includes(response.status()))
  assert.ok(response.json())

  await page.waitForTimeout(1200)
  await page.screenshot({ path: '../.run/feeds-e2e/calendar.png' })

  // 窄屏不出现整页横向滚动
  await page.setViewportSize({ width: 820, height: 900 })
  await page.waitForTimeout(400)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

  assert.deepEqual(errors, [])
  console.log('PASS: feeds calendar 5 blocks, fetch timestamp, 90-day window hint, refresh request, 820px layout.')
} catch (error) {
  await page.screenshot({ path: '../.run/feeds-e2e/failure.png' })
  throw error
} finally {
  await browser.close()
}
