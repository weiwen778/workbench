import { chromium } from 'playwright'
import { base, password } from './react-env.mjs'

// 统一操作栏回归：主操作固定右上角，右侧顺序为「筛选 → 刷新 → 更多 → 主操作」。
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForURL(/checkins/, { timeout: 15000 })
await page.waitForTimeout(600)

const pages = [
  ['打卡', '/checkins', true],
  ['待办', '/todos', true],
  ['笔记', '/notes', true],
  ['便利贴', '/memos', true],
  ['网址导航', '/bookmarks', true],
  ['表格', '/data', true],
  ['看板', '/visualizations', true],
  ['白板', '/whiteboards', true],
  ['翻译', '/translate', true],
  ['图片处理', '/images', true],
  ['格式转换', '/convert', true],
  ['取色', '/color', true],
  ['二维码', '/codes', false],
  ['文档工作台', '/docs', false],
]
const details = [
  ['表格详情', '/data/1'],
  ['看板详情', '/visualizations/1'],
  ['打卡资料', '/checkins/targets/1'],
]

async function readToolbar(path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
  await page.locator('[data-module-toolbar="true"]').first().waitFor({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(250)
  return page.evaluate(() => {
    const toolbar = document.querySelector('[data-module-toolbar="true"]')
    if (!toolbar) return { missing: true }
    const box = toolbar.getBoundingClientRect()
    const slots = [...toolbar.querySelectorAll('[data-toolbar-slot]')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { name: node.getAttribute('data-toolbar-slot'), x: Math.round(rect.x), right: Math.round(rect.right) }
    })
    return {
      missing: false,
      right: Math.round(box.right),
      slots,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }
  })
}

function verify(name, report, hasPrimary) {
  if (report.missing) { failures.push(`${name}：缺少统一操作栏`); return }
  const names = report.slots.map((slot) => slot.name)
  const before = (first, second) => !names.includes(first) || !names.includes(second) || names.indexOf(first) < names.indexOf(second)
  check(before('filters', 'refresh'), `${name}：刷新不在筛选之后`)
  check(before('refresh', 'more'), `${name}：更多不在刷新之后`)
  check(before('more', 'primary'), `${name}：主操作不在更多之后`)
  const primary = report.slots.find((slot) => slot.name === 'primary')
  // shadcn 版把主操作移到了页头；只有仍在操作栏里时才检查贴右。
  if (primary) check(report.right - primary.right <= 32, `${name}：主操作没有贴右（${report.right - primary.right}px）`)

  check(report.scrollWidth <= report.clientWidth + 1, `${name}：页面横向溢出`)
}

for (const [name, path, hasPrimary] of pages) {
  const report = await readToolbar(path)
  verify(name, report, hasPrimary)
  if (!report.missing) {
    console.log(`${name.padEnd(6)} ${report.slots.map((slot) => `${slot.name}@${slot.x}`).join(' → ')}`)
  }
}
for (const [name, path] of details) {
  const report = await readToolbar(path)
  if (report.missing) continue
  verify(name, report, true)
  console.log(`${name.padEnd(6)} ${report.slots.map((slot) => `${slot.name}@${slot.x}`).join(' → ')}`)
}

await page.setViewportSize({ width: 390, height: 844 })
for (const [name, path, hasPrimary] of pages) {
  const report = await readToolbar(path)
  if (report.missing) { failures.push(`${name} 窄屏：缺少统一操作栏`); continue }
  const primary = report.slots.find((slot) => slot.name === 'primary')
  if (primary) check(primary.right <= report.right + 1 && primary.right >= report.right - 40, `${name} 窄屏：主操作未靠右`)
  check(report.scrollWidth <= report.clientWidth + 1, `${name} 窄屏：页面横向溢出`)
}

await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(`${base}/data`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.screenshot({ path: '../.run/module-toolbar.png' })

console.log('\n统一操作栏：')
if (!failures.length) console.log('OK')
else failures.forEach((failure) => console.log(`FAIL ${failure}`))
await browser.close()
if (failures.length) process.exitCode = 1
