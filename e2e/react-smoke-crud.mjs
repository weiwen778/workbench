import { chromium } from 'playwright'
import { base, out, password } from './react-env.mjs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('401')) errors.push(`console: ${message.text()}`) })

async function api(method, path, body) {
  const cookies = await page.context().cookies()
  const csrf = cookies.find((cookie) => cookie.name === 'wb_csrf')?.value || ''
  const response = await page.request.fetch(`${base}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    data: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok()) throw new Error(`${method} ${path} -> ${response.status()}`)
  return response.json().catch(() => null)
}

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForURL(/checkins/, { timeout: 15000 })

try {
  await page.goto(`${base}/todos`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const create = page.getByRole('button', { name: '新建清单' })
  if (await create.count()) {
    await create.first().click()
    await page.locator('.MuiDialog-paper input').first().fill('React迁移验证清单')
    await page.getByRole('button', { name: '创建' }).click()
    await page.waitForTimeout(700)
  }
  await page.getByPlaceholder('添加待办，回车保存').fill('验证待办')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  console.log('todo added:', (await page.locator('body').innerText()).includes('验证待办'))
  await page.locator('[data-todo-id] input[type=checkbox]').first().click()
  await page.waitForTimeout(1500)
  const text = await page.locator('body').innerText()
  console.log('todo completed text:', text.includes('已完成 1'), text.includes('验证待办'))
  await page.screenshot({ path: `${out}/todos.png` })
} finally {
  const lists = await api('GET', '/todo-lists')
  for (const list of lists) if (list.name.includes('React迁移验证')) await api('DELETE', `/todo-lists/${list.id}`)
  const trash = await api('GET', '/trash')
  for (const item of trash.items || []) if (item.kind === 'todo_list' && item.name.includes('React迁移验证')) await api('DELETE', `/trash/todo_list/${item.entity_id}`)
}

// Memos
try {
  await page.goto(`${base}/memos`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '新建便利贴' }).click()
  await page.getByPlaceholder('不填则显示为无标题便利贴').fill('验证便利贴')
  await page.getByPlaceholder('随手记内容，Ctrl / Command + Enter 保存').fill('React 迁移验证内容')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(1000)
  console.log('memo added:', (await page.locator('body').innerText()).includes('验证便利贴'))
  await page.screenshot({ path: `${out}/memos.png` })
  // 工具栏与卡片都有「更多便利贴操作」，限定到目标卡片，避免点到工具栏的更多菜单
  const card = page.locator('.MuiCard-root', { hasText: '验证便利贴' }).first()
  await card.getByRole('button', { name: '更多便利贴操作' }).click()
  await page.getByRole('menuitem', { name: '删除便利贴' }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(1000)
} finally {
  const trash = await api('GET', '/trash')
  for (const item of trash.items || []) if (item.kind === 'memo' && item.name.includes('验证便利贴')) await api('DELETE', `/trash/memo/${item.entity_id}`)
}

console.log('\nERRORS:')
for (const error of errors.slice(0, 30)) console.log(error)
await browser.close()
