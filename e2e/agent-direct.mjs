// Acceptance flow for direct Agent writes: create -> write -> inspect -> undo.
// Run against a disposable development database, never production.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, request } from 'playwright'

const base = process.env.WB_BASE || 'http://127.0.0.1:18999'
const shots = path.resolve(process.env.WB_SCREENSHOT_DIR || '../docs/screenshots')
fs.mkdirSync(shots, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const stamp = Date.now()
const agentName = `E2E 接管 Agent ${stamp}`
const listName = `Agent E2E 清单 ${stamp}`
let agent
try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill(process.env.WB_USER || 'admin')
  await page.getByPlaceholder('请输入密码').fill(process.env.WB_PASS || 'admin12345')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  await page.goto(base + '/settings/agents')
  await page.getByRole('button', { name: '创建令牌', exact: true }).first().click()
  const form = page.getByRole('dialog', { name: '创建 Agent 令牌', exact: true })
  await form.getByPlaceholder('例如：运营助手、报表 Agent').fill(agentName)

  await form.getByRole('combobox', { name: '权限预设' }).click()
  await page.getByRole('option', { name: /接管者/ }).click()
  const writeMode = await form.getByRole('combobox', { name: '写入模式' }).textContent()
  assert.ok(writeMode?.includes('直接写入'), `Expected direct mode, got: ${writeMode}`)

  const createdResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/agent-tokens') && response.request().method() === 'POST',
  )
  await form.getByRole('button', { name: '创建令牌', exact: true }).click()
  const created = await (await createdResponse).json()
  assert.ok(created.token.startsWith('wb_agent_'))
  assert.equal(created.write_mode, 'direct')

  const secret = page.getByRole('dialog', { name: '保存 Agent 令牌', exact: true })
  await secret.waitFor()
  assert.equal(await secret.getByRole('textbox').inputValue(), created.token)
  await secret.getByRole('button', { name: '我已保存', exact: true }).click()

  agent = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Authorization: 'Bearer ' + created.token },
  })
  const createdList = await agent.post('/api/v1/agent/todo-lists', { data: { name: listName } })
  assert.equal(createdList.status(), 201, await createdList.text())
  const list = await createdList.json()
  const runId = Number(createdList.headers()['x-agent-run-id'])
  assert.ok(runId > 0, 'Direct write must return X-Agent-Run-Id')

  await page.reload()
  await page.getByRole('heading', { name: /Agent 接入/ }).waitFor()
  await page.getByLabel('搜索操作记录').fill(listName)
  await page.getByRole('button', { name: '搜索', exact: true }).first().click()
  await page.getByText(listName, { exact: false }).first().waitFor()
  await page.getByRole('button', { name: '查看详情', exact: true }).first().click()

  const detail = page.getByRole('dialog', { name: /操作详情/ })
  await detail.waitFor()
  await detail.getByText(/\/todo-lists/).first().waitFor()
  await detail.getByRole('button', { name: '撤销这次写入', exact: true }).click()

  const confirm = page.getByRole('dialog', { name: '撤销 Agent 操作', exact: true })
  await confirm.waitFor()
  await confirm.getByRole('button', { name: '撤销这次写入', exact: true }).click()
  await page.getByText('已撤销这次 Agent 写入', { exact: true }).waitFor()

  const undone = await agent.get(`/api/v1/agent/runs/${runId}`)
  assert.equal(undone.status(), 200)
  assert.equal((await undone.json()).status, 'undone')

  const remaining = await agent.get('/api/v1/agent/todo-lists')
  assert.equal(remaining.status(), 200)
  const lists = await remaining.json()
  assert.ok(!lists.some((item) => item.id === list.id), 'Undo should remove the Agent-created todo list')

  await page.screenshot({ path: path.join(shots, 'agent-direct.png') })
  assert.deepEqual(errors, [])
  console.log('Agent direct flow passed: create, direct write, run log, detail, undo.')
} finally {
  await agent?.dispose()
  await browser.close()
}
