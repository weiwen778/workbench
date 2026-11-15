// 全页面 UI 巡检：桌面/平板/移动三档截图 + 溢出/报错/坏图/白屏检测
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD
const outDir = process.env.WB_AUDIT_OUT || resolve(process.cwd(), '../.run/audit')
if (!password) throw new Error('WB_E2E_PASSWORD 未设置')

const DESKTOP = { name: 'desktop', width: 1440, height: 900 }
const TABLET = { name: 'tablet', width: 820, height: 1180 }
const MOBILE = { name: 'mobile', width: 390, height: 844 }

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height } })
const page = await context.newPage()

let current = 'login'
const consoleErrors = []
const pageErrors = []
const failedRequests = []
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const text = message.text()
  if (text.includes('401') || text.includes('409') || text.includes('favicon')) return
  consoleErrors.push({ route: current, text: text.slice(0, 400) })
})
page.on('pageerror', (error) => pageErrors.push({ route: current, text: String(error.message).slice(0, 400) }))
page.on('response', (response) => {
  const status = response.status()
  if (status < 400) return
  const url = response.url()
  if (status === 401 || status === 409) return
  failedRequests.push({ route: current, status, url: url.replace(base, '') })
})

async function login() {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).first().click()
  await page.waitForURL(/checkins/, { timeout: 20000 })
  await page.waitForTimeout(800)
}

async function api(path) {
  const cookies = await context.cookies()
  const csrf = cookies.find((cookie) => cookie.name === 'wb_csrf')?.value || ''
  const response = await page.request.fetch(`${base}/api/v1${path}`, { headers: { 'X-CSRF-Token': csrf } })
  if (!response.ok()) return null
  return response.json().catch(() => null)
}
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.results || [])

await login()
const tables = listOf(await api('/tables'))
const dashboards = listOf(await api('/dashboards'))
const boards = listOf(await api('/whiteboards'))
const docs = listOf(await api('/document-projects'))
const folders = listOf(await api('/note-folders'))
const lists = listOf(await api('/todo-lists'))

const routes = [
  { name: 'login', path: '/login', auth: false },
  { name: 'today', path: '/today' },
  { name: 'checkins', path: '/checkins' },
  { name: 'checkins-shops', path: '/checkins/shops' },
  { name: 'checkins-social', path: '/checkins/social' },
  { name: 'data', path: '/data' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'visualizations', path: '/visualizations' },
  { name: 'todos', path: '/todos' },
  { name: 'notes', path: '/notes' },
  { name: 'memos', path: '/memos' },
  { name: 'bookmarks', path: '/bookmarks' },
  { name: 'docs', path: '/docs' },
  { name: 'images', path: '/images' },
  { name: 'convert', path: '/convert' },
  { name: 'color', path: '/color' },
  { name: 'codes', path: '/codes' },
  { name: 'whiteboards', path: '/whiteboards' },
  { name: 'translate', path: '/translate' },
  { name: 'search', path: '/search' },
  { name: 'tasks', path: '/tasks' },
  { name: 'activity', path: '/activity' },
  { name: 'settings', path: '/settings' },
  { name: 'settings-navigation', path: '/settings/navigation' },
  { name: 'settings-trash', path: '/settings/trash' },
  { name: 'trash', path: '/trash' },
]
if (tables[0]?.id) routes.push({ name: 'data-detail', path: `/data/${tables[0].id}` })
if (dashboards[0]?.id) routes.push({ name: 'visualizations-detail', path: `/visualizations/${dashboards[0].id}` })
if (boards[0]?.id) routes.push({ name: 'whiteboards-detail', path: `/whiteboards/${boards[0].id}` })
if (docs[0]?.id) routes.push({ name: 'docs-detail', path: `/docs?project=${docs[0].id}` })
if (folders[0]?.key || folders[0]?.id) routes.push({ name: 'notes-folder', path: `/notes/${folders[0].key ?? folders[0].id}` })
if (lists[0]?.id) routes.push({ name: 'todos-detail', path: `/todos/${lists[0].id}` })

const PROBE = () => {
  const vw = window.innerWidth
  const de = document.documentElement
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
  const offenders = []
  const all = document.querySelectorAll('body *')
  for (const el of all) {
    if (offenders.length >= 6) break
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 24 || rect.height < 8) continue
    if (style.position === 'fixed') continue
    if (rect.right > vw + 4) {
      const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 60),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
      })
    }
  }
  const brokenImages = []
  for (const img of document.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth === 0 && img.src) brokenImages.push(img.getAttribute('src')?.slice(0, 120))
  }
  const clip = []
  for (const el of document.querySelectorAll('h1,h2,h3,p,span,td,th,button')) {
    if (clip.length >= 5) break
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const over = el.scrollHeight - el.clientHeight
    if (el.clientHeight > 0 && over >= 3 && style.overflow === 'hidden' && (el.innerText || '').length > 12) {
      clip.push({ tag: el.tagName.toLowerCase(), over, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50) })
    }
  }
  return {
    vw,
    docScrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    horizontalOverflow: Math.max(de.scrollWidth, document.body.scrollWidth) - vw,
    textLength: bodyText.length,
    headings: [...document.querySelectorAll('h1,h2,[role=heading]')].slice(0, 3).map((h) => (h.innerText || '').trim().slice(0, 40)),
    sample: bodyText.slice(0, 160),
    offenders,
    brokenImages,
    clip,
  }
}

const findings = []
const shot = async (viewport, name) => {
  const dir = resolve(outDir, viewport.name)
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true })
}

for (const viewport of [DESKTOP, MOBILE]) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  for (const route of routes) {
    if (route.name === 'login') {
      await context.clearCookies()
      current = route.name
      await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)
      const probe = await page.evaluate(PROBE)
      findings.push({ viewport: viewport.name, route: route.name, path: route.path, ...probe })
      await shot(viewport, route.name)
      await login()
      continue
    }
    current = route.name
    const record = { viewport: viewport.name, route: route.name, path: route.path }
    try {
      await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 25000 })
      await page.waitForTimeout(1400)
      const probe = await page.evaluate(PROBE)
      Object.assign(record, probe)
      if (probe.textLength < 80) record.blank = true
      const body = await page.evaluate(() => document.body.innerText)
      if (/出错了|Something went wrong|Unexpected Application Error|页面崩溃/.test(body)) record.errorBoundary = true
      await shot(viewport, route.name)
    } catch (error) {
      record.navigationError = String(error.message).slice(0, 300)
    }
    findings.push(record)
  }
}

// 平板档只覆盖布局最敏感的几个页面
await page.setViewportSize({ width: TABLET.width, height: TABLET.height })
for (const name of ['today', 'checkins', 'data', 'dashboard', 'docs', 'settings', 'notes', 'todos']) {
  const route = routes.find((item) => item.name === name)
  current = route.name
  const record = { viewport: TABLET.name, route: route.name, path: route.path }
  try {
    await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 25000 })
    await page.waitForTimeout(1200)
    const probe = await page.evaluate(PROBE)
    Object.assign(record, probe)
    if (probe.textLength < 80) record.blank = true
    await shot(TABLET, route.name)
  } catch (error) {
    record.navigationError = String(error.message).slice(0, 300)
  }
  findings.push(record)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'findings.json'), JSON.stringify({ findings, consoleErrors, pageErrors, failedRequests }, null, 2))

const problems = findings.filter((f) => f.blank || f.errorBoundary || f.navigationError || f.horizontalOverflow > 1 || (f.offenders?.length ?? 0) > 0 || (f.brokenImages?.length ?? 0) > 0 || (f.clip?.length ?? 0) > 0)
console.log('routes checked:', findings.length)
console.log('problem records:', problems.length)
for (const item of problems) {
  console.log(`\n[${item.viewport}] ${item.route} ${item.path}`)
  console.log(`  overflow=${item.horizontalOverflow} textLen=${item.textLength} blank=${!!item.blank} boundary=${!!item.errorBoundary} nav=${item.navigationError || '-'}`)
  for (const offender of (item.offenders || []).slice(0, 4)) console.log(`  overflow-el ${offender.tag}.${offender.cls} right=${offender.right} text="${offender.text}"`)
  for (const image of item.brokenImages || []) console.log(`  broken-img ${image}`)
  for (const c of item.clip || []) console.log(`  clipped ${c.tag} over=${c.over} text="${c.text}"`)
}
console.log('\nconsole errors:', consoleErrors.length)
for (const item of consoleErrors.slice(0, 20)) console.log(`  [${item.route}] ${item.text}`)
console.log('page errors:', pageErrors.length)
for (const item of pageErrors.slice(0, 20)) console.log(`  [${item.route}] ${item.text}`)
console.log('failed requests:', failedRequests.length)
for (const item of failedRequests.slice(0, 20)) console.log(`  [${item.route}] ${item.status} ${item.url}`)

await browser.close()
