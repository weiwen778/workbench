// Table render/scroll/edit performance regression harness.
// Usage: WB_BASE=http://127.0.0.1:18080 node e2e/table-render-performance.mjs
// Creates a disposable fixture table, measures frame timing + interaction latency,
// prints a machine-readable summary, and deletes the fixture when done.
import { chromium } from './node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD || 'admin12345'
const cpuThrottle = Number(process.env.WB_CPU_THROTTLE || 4)
const extraColumns = Number(process.env.WB_EXTRA_COLUMNS || 30)
const viewportWidth = Number(process.env.WB_VIEWPORT_WIDTH || 1440)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: viewportWidth, height: 900 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const percentile = (values, p) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}
const round = (value) => Math.round(value * 10) / 10

async function api(path, body, method = 'POST') {
  return page.evaluate(async ({ path, body, method }) => {
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|; )wb_csrf=([^;]*)/)?.[1] || '')
    const response = await fetch('/api/v1' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.status === 204 ? null : response.json()
  }, { path, body, method })
}

let tableID
try {
  await page.goto(base + '/login')
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(/checkins/, { timeout: 20000 })

  // Realistic operating-report shape: 10 business columns + actions.
  const table = await api('/tables', {
    name: '渲染性能回归 ' + Date.now(),
    fields: [
      { name: '日期', type: 'date' },
      { name: '店铺', type: 'short_text' },
      { name: '平台', type: 'select', options: [{ id: 'tmall', name: '天猫' }, { id: 'jd', name: '京东' }] },
      { name: '支付销售额', type: 'number' },
      { name: '退款金额', type: 'number' },
      { name: '净销售额', type: 'number' },
      { name: '订单数', type: 'number' },
      { name: '访客数', type: 'number' },
      { name: '转化率', type: 'number' },
      { name: '备注', type: 'long_text' },
      { name: '已核对', type: 'checkbox' },
      ...Array.from({ length: extraColumns }, (_, index) => ({ name: '附加指标' + (index + 1), type: index % 3 === 0 ? 'number' : 'short_text' })),
    ],
  })
  tableID = table.id
  const k = Object.fromEntries(table.fields.map((field) => [field.name, field.key]))
  const shops = ['天猫旗舰店', '京东专营店', '抖音自营店', '拼多多品牌店']
  for (let i = 1; i <= 120; i += 1) {
    await api(`/tables/${tableID}/records`, {
      data: {
        [k['日期']]: `2025-11-${String((i % 28) + 1).padStart(2, '0')}`,
        [k['店铺']]: shops[i % shops.length],
        [k['平台']]: i % 2 ? 'tmall' : 'jd',
        [k['支付销售额']]: String(10000 + i * 37.25),
        [k['退款金额']]: String((i % 9) * 83.5),
        [k['净销售额']]: String(9000 + i * 33.5),
        [k['订单数']]: String(50 + i),
        [k['访客数']]: String(2000 + i * 13),
        [k['转化率']]: String((2 + (i % 20) / 10).toFixed(2)),
        [k['备注']]: '第 ' + i + ' 行的备注内容，用于验证长文本换行与省略',
        [k['已核对']]: i % 3 === 0,
        ...Object.fromEntries(table.fields
          .filter((field) => field.name.startsWith('附加指标'))
          .map((field, index) => [field.key, index % 3 === 0 ? String(i * (index + 1) * 0.75) : `指标值 ${i}-${index + 1}`])),
      },
    })
  }

  await page.goto(base + '/data/' + tableID)
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 20000 })
  await page.waitForFunction(() => !document.querySelector('.MuiDataGrid-overlayLoading'))
  await page.waitForTimeout(400)

  await page.evaluate(() => {
    window.__perf = { frames: [], longTasks: [], recording: false }
    let last = performance.now()
    const tick = (now) => {
      window.__perf.frames.push(now - last)
      last = now
      if (window.__perf.recording) requestAnimationFrame(tick)
    }
    window.__perf.recording = true
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__perf.longTasks.push(entry.duration)
      }).observe({ entryTypes: ['longtask'] })
    } catch { /* longtask unsupported */ }
  })

  const grid = page.locator('.MuiDataGrid-root')
  const box = await grid.boundingBox()
  const centerX = box.x + Math.min(box.width / 2, 500)
  const centerY = box.y + box.height / 2

  // Vertical scrolling through the page.
  await page.mouse.move(centerX, centerY)
  for (let i = 0; i < 30; i += 1) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(18)
  }
  await page.waitForTimeout(250)
  const vertical = await page.evaluate(() => ({ frames: window.__perf.frames.splice(0), longTasks: window.__perf.longTasks.splice(0) }))

  // Horizontal scrolling across all columns.
  for (let i = 0; i < 30; i += 1) {
    await page.mouse.wheel(180, 0)
    await page.waitForTimeout(18)
  }
  await page.waitForTimeout(250)
  const horizontal = await page.evaluate(() => ({ frames: window.__perf.frames.splice(0), longTasks: window.__perf.longTasks.splice(0) }))

  // Row selection click latency (checkbox re-renders every row's cells today).
  // Row selection click latency, measured in-page to exclude Playwright actionability overhead.
  const clickDurations = await page.evaluate(async () => {
    const durations = []
    for (let i = 0; i < 8; i += 1) {
      const input = document.querySelectorAll('.MuiDataGrid-row')[i]?.querySelector('input[type="checkbox"]')
      if (!input) break
      const started = performance.now()
      input.click()
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      durations.push(performance.now() - started)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return durations
  })

  // Return to the top-left before measuring inline editing.
  await page.evaluate(() => {
    const scroller = document.querySelector('.MuiDataGrid-virtualScroller')
    if (scroller) { scroller.scrollLeft = 0; scroller.scrollTop = 0 }
  })
  await page.waitForTimeout(300)

  // Double-click inline edit: time until the editor input is in the DOM.
  const editDurations = await page.evaluate(async () => {
    const durations = []
    for (let i = 0; i < 6; i += 1) {
      const row = document.querySelectorAll('.MuiDataGrid-row')[i + 1]
      const cell = row?.querySelectorAll('.MuiDataGrid-cell')[2]
      const target = cell?.querySelector('.wb-table-cell-text')
      if (!cell || !target) break
      const started = performance.now()
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
      let elapsed = -1
      for (let frame = 0; frame < 120; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()))
        if (cell.querySelector('input')) { elapsed = performance.now() - started; break }
      }
      if (elapsed < 0) break
      durations.push(elapsed)
      const input = cell.querySelector('input')
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      for (let frame = 0; frame < 120; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()))
        if (!cell.querySelector('input')) break
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return durations
  })

  const layout = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect()
    const cells = [...document.querySelectorAll('.MuiDataGrid-cell')]
    const overflowingCells = cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1 && getComputedStyle(cell).overflowX !== 'hidden').length
    const interactive = [...document.querySelectorAll('button, input, [role="combobox"]')]
    const clamped = interactive.filter((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.width > 0 && (bounds.right > innerWidth + 1 || bounds.left < -1)
    })
    const toolbarButtons = [...document.querySelectorAll('button')].filter((button) => {
      const bounds = button.getBoundingClientRect()
      return bounds.top < 260 && bounds.bottom > 80
    })
    const toolbarBounds = toolbarButtons.reduce((acc, button) => {
      const bounds = button.getBoundingClientRect()
      return { top: Math.min(acc.top, bounds.top), bottom: Math.max(acc.bottom, bounds.bottom) }
    }, { top: Infinity, bottom: -Infinity })
    return {
      viewportWidth: innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
      grid: rect('.MuiDataGrid-root'),
      renderedCells: cells.length,
      overflowingCells,
      clippedInteractive: clamped.map((element) => (element.textContent || element.getAttribute('aria-label') || element.tagName).trim().slice(0, 30)),
      toolbarHeight: Number.isFinite(toolbarBounds.top) ? Math.round(toolbarBounds.bottom - toolbarBounds.top) : null,
    }
  })

  const summarize = (segment) => ({
    frames: segment.frames.length,
    median: round(percentile(segment.frames, 0.5)),
    p95: round(percentile(segment.frames, 0.95)),
    max: round(Math.max(0, ...segment.frames)),
    janky25: segment.frames.filter((value) => value > 25).length,
    janky50: segment.frames.filter((value) => value > 50).length,
    longTasks: segment.longTasks.length,
    longestTask: round(Math.max(0, ...segment.longTasks)),
  })

  const report = {
    base,
    url: page.url(),
    vertical: summarize(vertical),
    horizontal: summarize(horizontal),
    clickMs: { median: round(percentile(clickDurations, 0.5)), p95: round(percentile(clickDurations, 0.95)), max: round(Math.max(...clickDurations)) },
    editMs: { median: round(percentile(editDurations, 0.5)), p95: round(percentile(editDurations, 0.95)), max: round(Math.max(...editDurations)) },
    editCount: editDurations.length,
    layout,
    errors,
  }
  console.log(JSON.stringify(report, null, 2))

  assert.ok(report.clickMs.median <= 90, `点选中位 ${report.clickMs.median}ms 超过 90ms`)
  assert.equal(report.editCount, 6, `只测到 ${report.editCount} 次编辑，探针没有真正打开编辑器`)
  assert.ok(report.editMs.median <= 80, `双击编辑中位 ${report.editMs.median}ms 超过 80ms`)
  assert.ok(report.horizontal.janky25 <= 15, `横向滚动 >25ms 帧 ${report.horizontal.janky25} 超过 15`)
  assert.equal(report.layout.pageOverflowX, false, '页面出现横向溢出')
  assert.equal(report.layout.overflowingCells, 0, '单元格文字溢出')
  assert.deepEqual(errors, [], 'page errors occurred')
  process.exitCode = 0
} finally {
  try { if (tableID) await api(`/tables/${tableID}`, undefined, 'DELETE') } catch { /* fixture cleanup is best-effort */ }
  await browser.close()
}
