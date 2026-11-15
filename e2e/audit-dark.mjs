// 暗色主题全站巡检：对比度探针 + 白色残留检测 + 截图
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD
const outDir = process.env.WB_AUDIT_OUT || resolve(process.cwd(), '../.run/audit-dark')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 160)))

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).first().click()
await page.waitForURL(/checkins/, { timeout: 20000 })

// 固定切成暗色（走设置页，确保是账号级偏好）
await page.goto(`${base}/settings`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '深色', exact: true }).click()
await page.waitForTimeout(1800)

const PROBE = () => {
  const parse = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || '')
    if (!match) return null
    const parts = match[1].split(',').map((n) => parseFloat(n))
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const lum = (c) => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
  }
  const backdrop = (el) => {
    let node = el
    while (node) {
      const color = parse(getComputedStyle(node).backgroundColor)
      if (color && color.a > 0.5) return color
      node = node.parentElement
    }
    return { r: 255, g: 255, b: 255, a: 1 }
  }
  const issues = []
  const whites = []
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.3) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 6) continue
    const bg = parse(style.backgroundColor)
    if (bg && bg.a > 0.5 && lum(bg) > 0.75 && el.children.length === 0 && whites.length < 4) {
      whites.push({ tag: el.tagName.toLowerCase(), text: (el.innerText || '').slice(0, 24), bg: style.backgroundColor })
    }
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
    if (!ownText || issues.length >= 6) continue
    const fg = parse(style.color)
    if (!fg) continue
    const back = backdrop(el)
    const l1 = lum(fg)
    const l2 = lum(back)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const size = parseFloat(style.fontSize)
    const threshold = size >= 18 ? 3 : 4.5
    if (ratio < threshold) {
      issues.push({ tag: el.tagName.toLowerCase(), size, ratio: Number(ratio.toFixed(2)), fg: style.color, bg: `rgb(${back.r},${back.g},${back.b})`, text: (el.innerText || '').slice(0, 28) })
    }
  }
  return { issues, whites, bodyBg: getComputedStyle(document.body).backgroundColor }
}

const routes = ['/today', '/checkins', '/checkins/shops', '/checkins/social', '/data', '/dashboard', '/visualizations', '/todos', '/notes', '/memos', '/bookmarks', '/docs', '/images', '/convert', '/color', '/codes', '/whiteboards', '/translate', '/settings', '/settings/navigation', '/settings/trash', '/trash', '/tasks']
const findings = []
for (const route of routes) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1300)
  const data = await page.evaluate(PROBE)
  const name = route.replace(/\//g, '_')
  await page.screenshot({ path: resolve(outDir, `dark${name}.png`) })
  if (data.issues.length || data.whites.length) {
    findings.push({ route, ...data })
    console.log(`\n${route}  bodyBg=${data.bodyBg}`)
    for (const issue of data.issues) console.log(`  contrast ${issue.ratio} (${issue.size}px) ${issue.text} fg=${issue.fg} bg=${issue.bg}`)
    for (const white of data.whites) console.log(`  white-bg ${white.tag} ${white.bg} "${white.text}"`)
  }
}

// 还原浅色
await page.goto(`${base}/settings`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '浅色', exact: true }).click()
await page.waitForTimeout(1200)

writeFileSync(resolve(outDir, 'dark.json'), JSON.stringify({ findings, jsErrors }, null, 2))
console.log('\nroutes checked:', routes.length, 'routes with issues:', findings.length, 'js errors:', jsErrors.length)
await browser.close()
