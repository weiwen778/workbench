// Regression: hovering a card in the first row must not get its top border clipped
// by the memo board's scroll container. The board needs top padding for the 2px lift.
// Usage: WB_BASE=http://127.0.0.1:18080 node e2e/memo-card-hover.mjs
import { chromium } from './node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD || 'admin12345'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const created = []

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

try {
  await page.goto(base + '/login')
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(/checkins/, { timeout: 20000 })

  const stamp = Date.now()
  for (let index = 0; index < 4; index += 1) {
    const memo = await api('/memos', {
      title: `悬停回归 ${stamp}-${index}`,
      content: `第 ${index + 1} 张回归便利贴，用来检查第一行卡片 hover 时上边框是否被裁掉。`,
      color: 'default',
    })
    created.push(memo.id)
  }

  await page.goto(base + '/memos')
  await page.locator('.memo-board .MuiPaper-root').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(400)

  const board = page.locator('.memo-board')
  await page.locator('.memo-board .MuiPaper-root').first().hover()
  await page.waitForTimeout(500)

  const layout = await page.evaluate(() => {
    const board = document.querySelector('.memo-board')
    const card = document.querySelector('.memo-board .MuiPaper-root')
    const boardRect = board.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return {
      boardTop: boardRect.top,
      cardTop: cardRect.top,
      scrollTop: board.scrollTop,
      translateY: getComputedStyle(card).transform,
      borderTopColor: getComputedStyle(card).borderTopColor,
      borderLeftColor: getComputedStyle(card).borderLeftColor,
    }
  })

  assert.equal(layout.scrollTop, 0, '便利贴看板初始应停在顶部')
  assert.ok(
    layout.cardTop >= layout.boardTop,
    `第一行卡片 hover 上浮后被滚动容器裁切：cardTop=${layout.cardTop}, boardTop=${layout.boardTop}`,
  )
  assert.ok(
    layout.cardTop < layout.boardTop + 20,
    `看板顶部留白过大：cardTop=${layout.cardTop}, boardTop=${layout.boardTop}`,
  )
  assert.notEqual(layout.borderTopColor, 'rgba(0, 0, 0, 0)', '卡片上边框颜色异常')
  assert.equal(layout.borderTopColor, layout.borderLeftColor, 'hover 时上边框与侧边框颜色应一致')

  assert.deepEqual(errors, [], 'page errors occurred')
  console.log('PASS first-row memo card keeps its top border while hovered')
} finally {
  for (const id of created) {
    try { await api(`/memos/${id}`, undefined, 'DELETE') } catch { /* best effort */ }
  }
  await browser.close()
}
