import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.WB_BASE || 'http://127.0.0.1:18080'
const USER = process.env.WB_USER || 'admin'
const PASS = process.env.WB_PASS || 'admin12345'
const SHOT_DIR = path.resolve('../docs/screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const problems = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

async function shot(name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false })
}

async function step(name, fn) {
  process.stdout.write(`→ ${name} ... `)
  try {
    await fn()
    console.log('OK')
  } catch (error) {
    console.log(`FAIL: ${error.message.split('\n')[0]}`)
    problems.push({ step: name, error: error.message.split('\n')[0] })
    await shot(`fail-${name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}`)
  }
}

async function goto(pathname) {
  await page.goto(`${BASE}${pathname}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
}

await step('登录', async () => {
  await goto('/login')
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/checkins/shops')
  await page.waitForTimeout(500)
  await shot('01-店铺打卡-空状态')
})

let createdTarget = false
let createdRule = false

await step('创建分组与店铺', async () => {
  await page.getByRole('button', { name: '管理对象' }).click()
  const drawer = page.locator('.el-drawer').first()
  await drawer.waitFor({ state: 'visible' })
  await drawer.getByPlaceholder('新分组名称').fill('订单处理')
  await drawer.getByRole('button', { name: '添加分组' }).click()
  await page.waitForTimeout(400)
  await drawer.getByPlaceholder('名称', { exact: true }).fill('天猫旗舰店')
  await drawer.getByPlaceholder('平台（可选）').fill('天猫')
  await drawer.getByRole('button', { name: '添加店铺' }).click()
  await page.waitForTimeout(600)
  await shot('02-管理对象')
  createdTarget = (await drawer.getByText('天猫旗舰店').count()) > 0
  if (!createdTarget) throw new Error('店铺未出现在列表中')
})

await step('进入对象添加打卡事项', async () => {
  const drawer = page.locator('.el-drawer').first()
  await drawer.getByRole('button', { name: '资料与事项' }).first().click()
  await page.waitForURL('**/checkins/targets/**')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '添加事项' }).click()
  const dialog = page.locator('.el-dialog:visible')
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('.el-form-item', { hasText: '标题' }).locator('input').fill('检查新订单')
  await dialog.locator('.el-select').first().click({ timeout: 5000 })
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: '订单处理' }).first().click({ timeout: 5000 })
  await dialog.locator('.el-form-item', { hasText: '事项说明' }).locator('textarea').fill('查看待发货订单，核对退款')
  await dialog.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(700)
  await shot('03-对象资料与事项')
  createdRule = (await page.getByText('检查新订单').count()) > 0
  if (!createdRule) throw new Error('事项未创建')
})

await step('打卡勾选并查看统计', async () => {
  await goto('/checkins/shops')
  await page.waitForTimeout(600)
  const before = await page.locator('.page-toolbar').innerText()
  await page.locator('.checkin-row .el-checkbox').first().click()
  await page.waitForTimeout(700)
  const after = await page.locator('.page-toolbar').innerText()
  await shot('04-店铺打卡-已完成')
  if (!/完成\s*1\s*\/\s*1/.test(after.replace(/\s+/g, ' '))) {
    throw new Error(`统计未更新：${before.replace(/\s+/g, ' ')} → ${after.replace(/\s+/g, ' ')}`)
  }
})

await step('待办：清单、任务、子任务联动', async () => {
  await goto('/todos')
  await page.locator('.list-pane').getByRole('button').first().click()
  const box = page.locator('.el-message-box')
  await box.locator('input').fill('工作')
  await box.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(600)
  await page.getByPlaceholder('添加待办，回车保存；只填标题也可以').fill('上架新品')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  await page.locator('.task-row .task-actions button[title="添加子任务"]').first().click({ timeout: 5000 })
  await page.waitForTimeout(300)
  await page.locator('.subtask-add input').first().fill('拍图')
  await page.locator('.subtask-add input').first().press('Enter')
  await page.waitForTimeout(500)
  await page.locator('.subtask-add input').first().fill('写文案')
  await page.locator('.subtask-add input').first().press('Enter')
  await page.waitForTimeout(600)
  await page.locator('.subtask-row .el-checkbox').first().click()
  await page.waitForTimeout(500)
  await shot('05-待办-子任务')
  await page.locator('.subtask-row .el-checkbox').nth(1).click()
  await page.waitForTimeout(700)
  const text = await page.locator('.task-pane').innerText()
  await shot('06-待办-已完成区')
  if (!text.includes('已完成 1')) throw new Error('父任务未自动完成')
})

await step('数据表：建表、加字段、加数据', async () => {
  await goto('/data')
  await page.getByRole('button', { name: '新建数据表' }).click()
  const dialog = page.locator('.el-dialog:visible')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByPlaceholder('例如：商品台账').fill('商品台账')
  await dialog.getByRole('button', { name: '添加字段' }).click()
  await dialog.getByPlaceholder('字段名').first().fill('SKU')
  await dialog.getByRole('button', { name: '添加字段' }).click()
  await dialog.getByPlaceholder('字段名').nth(1).fill('价格')
  await dialog.locator('.field-row .el-select').nth(1).click({ timeout: 5000 })
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: '数字' }).first().click({ timeout: 5000 })
  await page.waitForTimeout(200)
  await dialog.getByRole('button', { name: '创建并打开' }).click({ timeout: 5000 })
  await page.waitForURL('**/data/**')
  await page.waitForTimeout(700)

  await page.getByRole('button', { name: '添加数据' }).click()
  const drawer = page.locator('.el-drawer').first()
  await drawer.waitFor({ state: 'visible' })
  await drawer.locator('.el-form-item', { hasText: 'SKU' }).locator('input').fill('00123')
  await drawer.locator('.el-form-item', { hasText: '价格' }).locator('input').fill('12.50')
  await drawer.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(700)
  const body = await page.locator('.page').innerText()
  await shot('07-数据表')
  if (!body.includes('00123')) throw new Error('数据记录未出现在表格中')
})

await step('数据表：筛选与 Excel 导入', async () => {
  await goto('/data/1')
  await page.waitForTimeout(600)

  // 筛选：SKU 包含 A-
  await page.getByRole('button', { name: '添加条件' }).click()
  await page.waitForTimeout(300)
  const filterInput = page.locator('.filter-bar input').last()
  await filterInput.fill('A-')
  await page.getByRole('button', { name: '查询' }).click()
  await page.waitForTimeout(700)
  const emptyHint = await page.locator('.pager').innerText()
  if (!emptyHint.includes('没有匹配')) throw new Error('筛选条件未生效（应为 0 条）')
  await page.getByRole('button', { name: '重置' }).click()
  await page.waitForTimeout(600)

  // 导入：上传 fixture
  await page.getByRole('button', { name: '导入' }).click()
  const dialog = page.locator('.el-dialog:visible')
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('input[type=file]').setInputFiles('fixtures/sample.xlsx')
  await page.waitForTimeout(1200)
  const beforeRows = await page.locator('.table-scroll .el-table__row').count()
  await dialog.getByRole('button', { name: '确认导入' }).click({ timeout: 8000 })
  await page.waitForTimeout(1500)
  const afterRows = await page.locator('.table-scroll .el-table__row').count()
  await shot('07b-数据表-导入后')
  if (afterRows <= beforeRows) throw new Error(`导入后行数未增加：${beforeRows} → ${afterRows}`)
})

await step('删除记录并在回收站恢复', async () => {
  const rowText = await page.locator('.el-table__row').first().innerText()
  await page.locator('.el-table__row').first().getByRole('button', { name: '删除' }).click()
  const box = page.locator('.el-message-box')
  await box.waitFor({ state: 'visible' })
  await box.getByRole('button', { name: '删除' }).click()
  await page.waitForTimeout(800)

  await goto('/trash')
  await page.waitForTimeout(500)
  const trashText = await page.locator('.page').innerText()
  if (!trashText.includes('数据记录')) throw new Error('回收站没有数据记录')
  await page.getByRole('button', { name: '恢复' }).first().click()
  await page.waitForTimeout(900)
  const after = await page.locator('.page').innerText()
  if (!after.includes('回收站是空的')) throw new Error('恢复后回收站应清空')
  await shot('12b-回收站-恢复后')
  if (!rowText.trim()) throw new Error('未取到行内容')
})

await step('打卡历史抽屉', async () => {
  await goto('/checkins/shops')
  await page.getByRole('button', { name: '历史' }).click()
  const drawer = page.locator('.el-drawer').last()
  await drawer.waitFor({ state: 'visible' })
  await page.waitForTimeout(800)
  const text = await drawer.innerText()
  await shot('18-打卡历史')
  if (!text.includes('已完成')) throw new Error('历史抽屉没有记录')
  await page.keyboard.press('Escape')
})

await step('侧栏收起为图标栏', async () => {
  await goto('/checkins/shops')
  await page.locator('.wb-sidebar .brand button').click()
  await page.waitForTimeout(600)
  const iconbar = await page.locator('.wb-iconbar').count()
  if (!iconbar) throw new Error('图标栏未出现')
  await shot('19-图标栏')
  await page.locator('.wb-iconbar .icon-btn').first().click()
  await page.waitForTimeout(500)
})

await step('便签：新建并显示分类', async () => {
  await goto('/memos')
  await page.getByRole('button', { name: '新建便签' }).click()
  const dialog = page.locator('.el-dialog:visible')
  await dialog.getByPlaceholder('不填则显示为无标题便签').fill('供应商张老板')
  await dialog.getByPlaceholder('随手记内容，Ctrl / Command + Enter 保存').fill('13800000000\n备货 3 天')
  const catInput = dialog.locator('.el-form-item', { hasText: '分类（可选）' }).locator('input')
  await catInput.click({ timeout: 5000 })
  await catInput.fill('采购')
  await page.waitForTimeout(400)
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item', { hasText: '采购' }).first().click({ timeout: 5000 })
  await page.waitForTimeout(200)
  await dialog.getByRole('button', { name: '保存' }).click({ timeout: 5000 })
  await page.waitForTimeout(700)
  await shot('08-便签')
  const text = await page.locator('.page').innerText()
  if (!text.includes('供应商张老板') || !text.includes('采购')) throw new Error('便签或分类未显示')
})

await step('笔记：新建、自动保存、预览', async () => {
  await goto('/notes')
  await page.getByRole('button', { name: '新建笔记' }).click()
  await page.waitForTimeout(600)
  await page.locator('.title-input input').fill('退货处理流程')
  const editor = page.locator('.editor-col textarea')
  await editor.fill('# 退货处理\n\n1. 核对订单号\n2. 拍照留证\n\n- 7 天内可退\n- 保留聊天记录\n\n> 注意：先沟通再操作')
  await page.waitForTimeout(2200)
  await shot('09-笔记')
  const state = await page.locator('.save-state').innerText()
  if (!state.includes('已保存')) throw new Error(`自动保存状态异常：${state}`)
})

await step('翻译页布局', async () => {
  await goto('/translate')
  await page.waitForTimeout(500)
  await shot('10-翻译')
  const paneCount = await page.locator('.translate-pane').count()
  if (paneCount !== 2) throw new Error('原文／译文双栏未渲染')
})

await step('服务设置面板', async () => {
  await page.getByRole('button', { name: '服务设置' }).click()
  const drawer = page.locator('.el-drawer').last()
  await drawer.waitFor({ state: 'visible' })
  await page.waitForTimeout(400)
  await shot('11-翻译服务设置')
})

await step('回收站与设置页', async () => {
  await page.keyboard.press('Escape')
  await goto('/trash')
  await shot('12-回收站')
  await goto('/settings')
  await page.waitForTimeout(400)
  await shot('13-设置')
})

await step('深色主题', async () => {
  // 通过界面切换主题（偏好保存在服务端）
  await goto('/checkins/shops')
  await page.locator('.wb-topbar .el-button').first().click()
  await page.waitForTimeout(800)
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if (!isDark) throw new Error('点击后未进入深色主题')
  await shot('14-深色-店铺打卡')
  await goto('/data/1')
  await page.waitForTimeout(600)
  await shot('14b-深色-数据表')
  await goto('/settings')
  await page.waitForTimeout(500)
  await shot('14c-深色-设置')
  // 切回浅色，避免影响后续截图
  await page.locator('.wb-topbar .el-button').first().click()
  await page.waitForTimeout(600)
})

await step('平板竖屏 768×1024', async () => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await goto('/checkins/shops')
  await page.waitForTimeout(600)
  await shot('15-平板-店铺打卡')
  await goto('/todos')
  await page.waitForTimeout(600)
  await shot('16-平板-待办')
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
  if (bodyWidth > 790) throw new Error(`整页出现横向滚动：${bodyWidth}px`)
})

await step('紧凑桌面 1280×800', async () => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await goto('/data')
  await page.waitForTimeout(600)
  await shot('17-桌面1280-数据表')
})

const realErrors = consoleErrors.filter(
  (text) =>
    !text.includes('favicon') &&
    !text.includes('status of 404') &&
    // 首次进入登录页前会探测 /auth/me，未登录返回 401 属于正常流程
    !text.includes('status of 401'),
)
if (realErrors.length) {
  problems.push({ step: '浏览器控制台', error: realErrors.join(' | ').slice(0, 500) })
}

await browser.close()

console.log('\n===== 结果 =====')
if (problems.length) {
  for (const item of problems) console.log(`✗ ${item.step}: ${item.error}`)
  process.exitCode = 1
} else {
  console.log('全部 UI 步骤通过，截图已保存到 docs/screenshots')
}
