// Cold-route browser measurement. Requires a running Nexus instance and a
// disposable test account; never point this at production data.
import { chromium } from './node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'

const base = (process.env.WB_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '')
const user = process.env.WB_ADMIN_USERNAME || 'admin'
const password = process.env.WB_ADMIN_PASSWORD || ''
if (!password) throw new Error('Set WB_ADMIN_PASSWORD before running this measurement')
const routes = (process.env.WB_PERF_ROUTES || '/data,/docs,/docs?module=sheet,/docs?module=doc,/notes').split(',')
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
await page.addInitScript(() => {
  window.__longTasks = []
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  } catch { /* browser without longtask support */ }
})
await page.goto(base + '/login')
await page.getByLabel('用户名', { exact: true }).fill(user)
await page.getByLabel('密码', { exact: true }).fill(password)
await page.getByRole('button', { name: '登录', exact: true }).click()
await page.waitForURL((url) => !url.pathname.includes('login'))

const rows = []
for (const route of routes) {
  const samples = []
  for (let index = 0; index < 3; index += 1) {
    await page.goto(base + route, { waitUntil: 'load' })
    await page.waitForTimeout(1600)
    samples.push(await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const resources = performance.getEntriesByType('resource')
      const sum = (list) => list.reduce((total, entry) => total + (entry.transferSize || 0), 0)
      return {
        dcl: navigation.domContentLoadedEventEnd,
        load: navigation.loadEventEnd,
        resources: resources.length,
        transfer: sum(resources) + (navigation.transferSize || 0),
        js: sum(resources.filter((entry) => /\.js(\?|$)/.test(entry.name))),
        longTasks: window.__longTasks || [],
      }
    }))
  }
  const median = (key) => samples.map((sample) => sample[key]).sort((a, b) => a - b)[1]
  const longTasks = samples.flatMap((sample) => sample.longTasks)
  rows.push({
    route,
    dcl_ms: Math.round(median('dcl')),
    load_ms: Math.round(median('load')),
    resources: median('resources'),
    transfer_kb: Math.round(median('transfer') / 1024),
    js_kb: Math.round(median('js') / 1024),
    long_tasks: longTasks.length,
    max_long_task_ms: longTasks.length ? Math.round(Math.max(...longTasks)) : 0,
  })
}
const target = process.env.WB_OUTPUT || '../.run/route-performance.json'
await fs.mkdir(new URL('../.run/', import.meta.url), { recursive: true })
await fs.writeFile(target, JSON.stringify(rows, null, 2))
console.log(JSON.stringify(rows, null, 2))
await browser.close()
