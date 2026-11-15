// 深度巡检：窄屏溢出、暗色主题、关键弹窗
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD
const outDir = process.env.WB_AUDIT_OUT || resolve(process.cwd(), '../.run/audit2')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (t.includes('401') || t.includes('409')) return
  consoleErrors.push(t.slice(0, 300))
})
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 300)))

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).first().click()
await page.waitForURL(/checkins/, { timeout: 20000 })
await page.waitForTimeout(500)

const routes = ['/today', '/checkins', '/checkins/shops', '/data', '/dashboard', '/visualizations', '/todos', '/notes', '/memos', '/bookmarks', '/docs', '/images', '/convert', '/color', '/codes', '/whiteboards', '/translate', '/settings', '/settings/navigation', '/settings/trash', '/settings/appearance', '/trash', '/tasks']

const OVERFLOW = () => {
  const vw = window.innerWidth
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    if (offenders.length >= 5) break
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 10) continue
    if (rect.right > vw + 4) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join('.'),
        right: Math.round(rect.right),
        w: Math.round(rect.width),
        text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
      })
    }
  }
  return { doc: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw, offenders }
}

const narrow = []
for (const width of [360, 320]) {
  await page.setViewportSize({ width, height: 800 })
  for (const route of routes) {
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    const data = await page.evaluate(OVERFLOW)
    if (data.doc > 1 || data.offenders.length) {
      narrow.push({ width, route, ...data })
      await page.screenshot({ path: resolve(outDir, `narrow-${width}-${route.replace(/\//g, '_') || 'root'}.png`), fullPage: false })
    }
  }
}

// 暗色主题
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: '切换主题' }).first().click()
await page.waitForTimeout(800)
const darkShots = ['/dashboard', '/data', '/notes', '/docs', '/settings', '/checkins', '/todos', '/translate']
for (const route of darkShots) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1100)
  await page.screenshot({ path: resolve(outDir, `dark-${route.replace(/\//g, '_') || 'root'}.png`) })
}
// 恢复浅色
await page.getByRole('button', { name: '切换主题' }).first().click()
await page.waitForTimeout(500)

// 关键弹窗
const dialogs = []
const openDialog = async (route, name, action) => {
  const record = { route, name }
  try {
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    await action()
    await page.waitForTimeout(700)
    record.dialog = await page.locator('.MuiDialog-root, .MuiMenu-root, .MuiDrawer-root').count()
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector('.MuiDialog-paper')
      if (!dialog) return null
      const rect = dialog.getBoundingClientRect()
      const body = dialog.querySelector('.MuiDialogContent-root')
      return {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        x: Math.round(rect.x),
        contentScroll: body ? body.scrollHeight - body.clientHeight : 0,
        overflowRight: Math.round(rect.right) - window.innerWidth,
        text: (dialog.innerText || '').replace(/\s+/g, ' ').slice(0, 100),
      }
    })
    record.metrics = metrics
    await page.screenshot({ path: resolve(outDir, `dialog-${name}.png`) })
    await page.keyboard.press('Escape')
  } catch (error) {
    record.error = String(error.message).slice(0, 200)
  }
  dialogs.push(record)
}

await openDialog('/data', 'new-table', async () => { await page.getByRole('button', { name: /新建表格/ }).first().click() })
await openDialog('/visualizations', 'new-board', async () => { await page.getByRole('button', { name: /新建看板/ }).first().click() })
await openDialog('/checkins', 'manage-targets', async () => { await page.getByRole('button', { name: /管理打卡项目/ }).first().click() })
await openDialog('/todos', 'new-list', async () => { await page.getByRole('button', { name: /新建清单/ }).first().click() })
await openDialog('/memos', 'new-memo', async () => { await page.getByRole('button', { name: /新建便利贴/ }).first().click() })
await openDialog('/bookmarks', 'new-bookmark', async () => { await page.getByRole('button', { name: /新增|新建|添加/ }).first().click() })
await openDialog('/notes', 'new-note', async () => { await page.getByRole('button', { name: /新建笔记/ }).first().click() })
await openDialog('/whiteboards', 'new-board-wb', async () => { await page.getByRole('button', { name: /新建白板/ }).first().click() })
await openDialog('/checkins', 'task-center', async () => { await page.getByRole('button', { name: /任务中心/ }).first().click() })
await openDialog('/checkins', 'search', async () => { await page.keyboard.press('Control+k') })
await openDialog('/settings', 'settings-appearance', async () => { await page.getByText('外观', { exact: true }).first().click() })
await openDialog('/docs', 'docs-workbook', async () => { await page.getByRole('tab', { name: /工作簿/ }).first().click() })
await openDialog('/docs', 'docs-markdown', async () => { await page.getByRole('tab', { name: /Markdown/ }).first().click() })
await openDialog('/images', 'images-tabs', async () => { await page.waitForTimeout(200) })

// 移动端弹窗
await page.setViewportSize({ width: 390, height: 844 })
await openDialog('/data', 'mobile-new-table', async () => { await page.getByRole('button', { name: /新建表格/ }).first().click() })
await openDialog('/checkins', 'mobile-manage-targets', async () => { await page.getByRole('button', { name: /管理打卡项目/ }).first().click() })

writeFileSync(resolve(outDir, 'deep.json'), JSON.stringify({ narrow, dialogs, consoleErrors }, null, 2))
console.log('narrow overflow records:', narrow.length)
for (const item of narrow) {
  console.log(`  [${item.width}] ${item.route} doc=${item.doc}`)
  for (const o of item.offenders.slice(0, 3)) console.log(`      ${o.tag}.${o.cls} right=${o.right} w=${o.w} "${o.text}"`)
}
console.log('dialogs:', dialogs.length)
for (const item of dialogs) {
  console.log(`  ${item.name} @${item.route} dialog=${item.dialog} ${item.error ? 'ERR=' + item.error : ''} ${item.metrics ? JSON.stringify(item.metrics) : ''}`)
}
console.log('console errors:', consoleErrors.length)
for (const e of consoleErrors.slice(0, 10)) console.log('  ' + e)
await browser.close()
