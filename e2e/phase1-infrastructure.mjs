// Regression for the first infrastructure phase in docs/开源组件选型与前端计算架构建议.md:
// Dexie document drafts (plus legacy migration and IndexedDB-unavailable
// fallback), and Comlink worker analysis.
// Run against a signed-in local server or the Vite dev server:
//   BASE_URL=http://127.0.0.1:5174 node phase1-infrastructure.mjs
import { chromium } from './node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5174'
const env = Object.fromEntries((await fs.readFile(new URL('../server/.env', import.meta.url), 'utf8'))
  .split('\n').filter((x) => x.includes('='))
  .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))

const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
})

async function signIn(page) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名', { exact: true }).fill(env.WB_ADMIN_USERNAME)
  await page.getByLabel('密码', { exact: true }).fill(env.WB_ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes('login'))
}

const readDrafts = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('nexus-workbench')
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const db = request.result
    if (!db.objectStoreNames.contains('documentDrafts')) { db.close(); resolve([]); return }
    const all = db.transaction('documentDrafts', 'readonly').objectStore('documentDrafts').getAll()
    all.onsuccess = () => { resolve(all.result); db.close() }
    all.onerror = () => { reject(all.error); db.close() }
  }
}))

async function testIndexedDbFallback() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await context.addInitScript(() => {
    const blocked = {
      open() { throw new Error('blocked for test') },
      deleteDatabase() { throw new Error('blocked for test') },
    }
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => blocked })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
  await page.goto(`${BASE}/docs?module=doc`)
  const editor = page.locator('[contenteditable="true"][aria-label="文档 Markdown 正文"]')
  await editor.waitFor()
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('wb_docs_document_draft')) localStorage.removeItem(key)
    }
  })
  await editor.click()
  await page.keyboard.type('# fallback draft\n\nindexeddb blocked')
  await page.waitForTimeout(1400)
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('wb_docs_document_draft_v2:'))
    return key ? localStorage.getItem(key) : null
  })
  assert.ok(stored && stored.includes('fallback draft'), 'localStorage fallback written')
  await page.reload()
  await page.getByText('发现浏览器本地草稿', { exact: false }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  assert.ok((await editor.innerText()).includes('fallback draft'))
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('wb_docs_document_draft_v2:')) localStorage.removeItem(key)
    }
  })
  assert.deepEqual(errors, [])
  await context.close()
  console.log(JSON.stringify({ result: 'PASS', fallback: 'localStorage', errors }))
}

async function main() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const errors = []
  const workers = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text())
  })
  page.on('worker', (worker) => workers.push(worker.url()))

  await signIn(page)

  // Dexie document draft: write, reload, restore prompt, discard.
  await page.goto(`${BASE}/docs?module=doc`)
  const editor = page.locator('[contenteditable="true"][aria-label="文档 Markdown 正文"]')
  await editor.waitFor()
  await page.evaluate(async () => {
    localStorage.removeItem('wb_docs_document_draft_v1')
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('nexus-workbench')
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  })
  await page.reload()
  await editor.waitFor()
  await editor.click()
  await page.keyboard.type('# Dexie 草稿\n\n保存到 IndexedDB。')
  await page.waitForTimeout(1400)
  const drafts = await readDrafts(page)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].schemaVersion, 1)
  assert.ok(drafts[0].userId > 0)
  assert.ok(drafts[0].markdown.includes('Dexie 草稿'))
  await page.reload()
  await page.getByText('发现浏览器本地草稿', { exact: false }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '丢弃', exact: true }).click()
  await page.waitForTimeout(400)
  assert.equal((await readDrafts(page)).length, 0)

  // Legacy localStorage draft is migrated for this account and removed.
  await page.evaluate(() => localStorage.setItem('wb_docs_document_draft_v1', JSON.stringify({
    title: '旧草稿', markdown: '# 来自 localStorage', format: 'markdown', savedAt: new Date().toISOString(),
  })))
  await page.reload()
  await page.getByText('发现浏览器本地草稿', { exact: false }).waitFor({ timeout: 10000 })
  const migrated = await readDrafts(page)
  assert.equal(migrated.length, 1)
  assert.ok(migrated[0].markdown.includes('来自 localStorage'))
  assert.equal(await page.evaluate(() => localStorage.getItem('wb_docs_document_draft_v1')), null)
  await page.getByRole('button', { name: '丢弃', exact: true }).click()

  // Worker analysis: counts cover the table, selectors recompute, pivot renders.
  const tables = await page.evaluate(async () => (await (await fetch('/api/v1/tables')).json()))
  const list = Array.isArray(tables) ? tables : tables.items || []
  const table = list.find((item) => (item.record_count || 0) > 0) || list[0]
  assert.ok(table, 'a table is available for analysis')
  await page.goto(`${BASE}/data/${table.id}`)
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '汇总与透视', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText(/全表 \d+ 行/).waitFor({ timeout: 30000 })
  const summaryGrid = dialog.locator('.MuiDataGrid-root').first()
  await summaryGrid.locator('.MuiDataGrid-row').first().waitFor({ timeout: 30000 })
  const total = Number(/全表 (\d+) 行/.exec(await dialog.getByText(/全表 \d+ 行/).textContent())?.[1])
  assert.ok(total > 0)
  const counts = await summaryGrid.locator('.MuiDataGrid-row [data-field="count"]').allTextContents()
  const visibleCount = counts.reduce((sum, value) => sum + Number(value || 0), 0)
  assert.ok(counts.length > 0 && visibleCount > 0 && visibleCount <= total)
  assert.ok(workers.length > 0, 'analysis worker started')

  const selectControl = (label) => dialog.locator('.MuiFormControl-root').filter({ hasText: label }).getByRole('combobox')
  await selectControl('计算方式').click()
  await page.getByRole('option', { name: '合计', exact: true }).click()
  await dialog.locator('.MuiDataGrid-row').first().waitFor()
  await page.waitForTimeout(400)
  const values = await summaryGrid.locator('.MuiDataGrid-row [data-field="value"]').allTextContents()
  assert.ok(values.length > 0)
  await selectControl('分析方式').click()
  await page.getByRole('option', { name: '交叉透视', exact: true }).click()
  await page.waitForTimeout(600)
  const headers = await dialog.locator('.MuiDataGrid-columnHeader').allTextContents()
  assert.ok(headers.includes('分组'))

  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', table: table.id, total, workers: workers.length, errors }))
}

try {
  await main()
  await testIndexedDbFallback()
} finally {
  await browser.close()
}
