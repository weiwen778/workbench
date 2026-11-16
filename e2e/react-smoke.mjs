import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { base, out, password } from './react-env.mjs'

await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('401')) errors.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
}

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForURL(/checkins/, { timeout: 15000 })
await page.waitForTimeout(1200)

const routes = [
  ['today', '/today'],
  ['checkins', '/checkins/shops'],
  ['checkins-all', '/checkins'],
  ['todos', '/todos'],
  ['visualizations', '/visualizations'],
  ['data', '/data'],
  ['table-detail', '/data/1'],
  ['notes', '/notes'],
  ['memos', '/memos'],
  ['translate', '/translate'],
  ['images', '/images'],
  ['bookmarks', '/bookmarks'],
  ['tasks', '/tasks'],
  ['search', '/search'],
  ['activity', '/activity'],
  ['settings', '/settings'],
  ['settings-agents', '/settings/agents'],
  ['settings-translation', '/settings/translation'],
  ['settings-system', '/settings/system'],
  ['settings-trash', '/settings/trash'],
]

for (const [name, path] of routes) {
  const before = errors.length
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await shot(name)
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)
  console.log(`${path} -> ${errors.length === before ? 'OK' : 'ERRORS'} | ${text}`)
}

console.log('\nERRORS:')
for (const error of errors.slice(0, 60)) console.log(error)
await browser.close()
