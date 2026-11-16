import assert from 'node:assert/strict'
import { chromium, request } from 'playwright'
import { base, password } from './react-env.mjs'

const browser = await chromium.launch()
let agent
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/checkins')

  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'wb_csrf').value
  async function api(path, method = 'GET', data) {
    const response = await page.request.fetch(base + '/api/v1' + path, {
      method, data, headers: { 'X-CSRF-Token': csrf },
    })
    assert.ok(response.ok(), await response.text())
    return response.json()
  }
  const token = await api('/agent-tokens', 'POST', { name: '浏览器审核测试', scopes: ['all:stage'], write_mode: 'review' })
  agent = await request.newContext({ baseURL: base, extraHTTPHeaders: { Authorization: 'Bearer ' + token.token } })

  async function submit(name) {
    const response = await agent.post('/api/v1/agent/todo-lists', { data: { name } })
    assert.equal(response.status(), 202, await response.text())
    const change = await response.json()
    assert.equal(change.status, 'pending')
    assert.ok(!(await api('/todo-lists')).some((list) => list.name === name))
    return change
  }
  async function openChange(change) {
    await page.goto(base + '/settings/agents')
    await page.getByLabel('搜索暂存').fill(change.title)
    await page.getByLabel('搜索暂存').press('Enter')
    await page.getByRole('button', { name: '查看详情', exact: true }).last().click()
    const dialog = page.getByRole('dialog', { name: /变更详情/ })
    await dialog.getByText('/todo-lists', { exact: true }).waitFor()
    return dialog
  }

  const approvedName = '浏览器测试审核通过'
  const approved = await submit(approvedName)
  const approveDialog = await openChange(approved)
  await approveDialog.getByRole('button', { name: '通过并合并', exact: true }).click()
  await page.getByText('已通过并合并', { exact: true }).waitFor()
  assert.ok((await api('/todo-lists')).some((list) => list.name === approvedName))

  const rejectedName = '浏览器测试审核驳回'
  const rejected = await submit(rejectedName)
  const rejectDialog = await openChange(rejected)
  await rejectDialog.getByLabel('审核备注（可选）').fill('测试驳回')
  await rejectDialog.getByRole('button', { name: '驳回', exact: true }).click()
  await page.getByText('已驳回', { exact: true }).last().waitFor()
  assert.equal((await api('/agent-changes/' + rejected.id)).status, 'rejected')
  assert.ok(!(await api('/todo-lists')).some((list) => list.name === rejectedName))
  assert.deepEqual(errors, [])
  console.log('Agent review flow passed: staged writes, approval, rejection and persistent state.')
} finally {
  await agent?.dispose()
  await browser.close()
}
