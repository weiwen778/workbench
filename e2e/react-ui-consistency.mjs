import { chromium } from 'playwright'
import { base, password } from './react-env.mjs'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('401')) errors.push(`console: ${message.text()}`)
})

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function login() {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/checkins/, { timeout: 15000 })
  await page.waitForTimeout(600)
}

await login()

const rail = page.locator('nav[aria-label="主导航"]')
expect(await rail.count() === 1, '桌面端主导航未出现')
const railMetrics = await rail.evaluate((element) => ({
  scrollHeight: element.scrollHeight,
  clientHeight: element.clientHeight,
  overflow: getComputedStyle(element).overflowY,
}))
expect(['visible', 'hidden'].includes(railMetrics.overflow), '主导航不应使用滚动容器')
expect(railMetrics.scrollHeight <= railMetrics.clientHeight + 1, '主导航出现滚动')
expect((await rail.innerText()).includes('全部功能'), '主导航缺少全部功能入口')

// 宽窄切换并持久化
await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
await page.waitForTimeout(250)
expect((await rail.evaluate((element) => element.clientWidth)) >= 200, '宽版侧栏宽度不正确')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
expect((await rail.evaluate((element) => element.clientWidth)) >= 200, '宽版模式没有持久化')
await page.getByLabel('打卡二级导航').waitFor()
expect(await page.getByRole('button', { name: /^收藏/ }).count() === 0, '侧栏不应外显收藏按钮')
expect(await page.getByRole('button', { name: /^置顶/ }).count() === 0, '侧栏不应外显置顶按钮')
await page.getByRole('button', { name: '打卡', exact: true }).click()
await page.waitForTimeout(300)
expect(await page.getByLabel('打卡二级导航').count() === 0, '点击一级项没有收起二级导航')
await page.getByRole('button', { name: '打卡', exact: true }).click()
await page.getByLabel('打卡二级导航').waitFor()

// 管理导航：拖动排序、取消固定、重新固定、恢复默认
await page.getByRole('button', { name: '全部功能' }).click()
await page.getByRole('button', { name: '管理导航' }).click()
await page.getByRole('dialog').waitFor()
await page.waitForTimeout(300)
const dragFrom = await page.getByRole('button', { name: '拖动打卡排序', exact: true }).boundingBox()
const dragTo = await page.getByRole('button', { name: '拖动表格排序', exact: true }).boundingBox()
expect(dragFrom && dragTo, '管理导航缺少拖动把手')
if (dragFrom && dragTo) {
  await page.mouse.move(dragFrom.x + dragFrom.width / 2, dragFrom.y + dragFrom.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragTo.x + dragTo.width / 2, dragTo.y + dragTo.height + 8, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(350)
}
const orderAfterDrag = await page.getByRole('button', { name: '拖动打卡排序', exact: true }).boundingBox()
expect(orderAfterDrag && orderAfterDrag.y > dragFrom.y + 4, '拖动后侧栏顺序没有变化')
await page.getByRole('button', { name: '取消固定文档工作台', exact: true }).click()
await page.getByRole('button', { name: '固定白板', exact: true }).click()
await page.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)
const changedRail = await rail.innerText()
expect(changedRail.includes('白板'), '固定白板后侧栏没有出现白板')
expect(!changedRail.includes('文档工作台'), '取消固定文档工作台后侧栏仍然显示')
await page.getByRole('button', { name: '全部功能' }).click()
await page.getByRole('button', { name: '管理导航' }).click()
await page.getByRole('button', { name: '恢复默认' }).click()
await page.getByRole('button', { name: '完成' }).click()
await page.waitForTimeout(300)
expect((await rail.innerText()).includes('文档工作台'), '恢复默认后文档工作台未回到侧栏')

// 其他分类模块也应显示二级导航
await page.goto(`${base}/todos`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByLabel('待办二级导航').waitFor()
await page.goto(`${base}/notes`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByLabel('笔记二级导航').waitFor()

// 全部功能面板
await page.getByRole('button', { name: '全部功能' }).click()
await page.getByText('全部功能', { exact: true }).first().waitFor()
await page.waitForTimeout(250)
await page.screenshot({ path: '../.run/ui-consistency-all-nav.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 表格列表：卡片本身是唯一打开入口，不再有打开按钮
await page.goto(`${base}/data`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByLabel('表格二级导航').waitFor()
expect(await page.getByRole('button', { name: /^打开表格/ }).count() > 0, '表格卡片缺少可访问的打开入口')
expect(await page.getByRole('button', { name: '打开', exact: true }).count() === 0, '表格列表仍有重复的打开按钮')

// 表格详情：显示偏好收进视图菜单
await page.goto(`${base}/data/1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
expect(await page.getByRole('button', { name: '窄行高' }).count() === 0, '行高控制仍然平铺在工具栏')
await page.getByRole('button', { name: '视图' }).click()
await page.getByText('斑马纹').waitFor()
await page.screenshot({ path: '../.run/ui-consistency-table-view.png' })
await page.keyboard.press('Escape')

// 便利贴：管理分类收进更多菜单
await page.goto(`${base}/memos`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByLabel('便利贴二级导航').waitFor()
expect(await page.getByRole('button', { name: /^收藏/ }).count() === 0, '便利贴二级导航不应外显收藏按钮')
await page.getByRole('button', { name: '更多便利贴操作' }).first().click()
await page.getByRole('menuitem', { name: '管理分类' }).click()
await page.getByText('便利贴分类管理').waitFor()
await page.keyboard.press('Escape')

// 网址：管理分类收进更多菜单
await page.goto(`${base}/bookmarks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '更多网址操作' }).click()
await page.getByRole('menuitem', { name: '管理分类' }).click()
await page.getByText('网址分类管理').waitFor()
await page.keyboard.press('Escape')

// 打卡：行操作收进菜单
await page.goto(`${base}/checkins`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: '管理打卡项目' }).click()
await page.getByText('打卡项目与分类').waitFor()
const targetMenu = page.locator('button[aria-label$="的操作"]').first()
await targetMenu.click()
await page.getByRole('menuitem', { name: '资料与任务' }).waitFor()
await page.screenshot({ path: '../.run/ui-consistency-checkin-menu.png' })
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

// 看板详情：刷新/重命名/新建收进菜单
await page.goto(`${base}/visualizations`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByLabel('看板二级导航').waitFor()
await page.getByRole('button', { name: /^打开看板/ }).first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '看板操作' }).click()
await page.getByRole('menuitem', { name: '重命名当前看板' }).waitFor()
await page.keyboard.press('Escape')

// 设置：新目录与侧栏宽度联动
await page.goto(`${base}/settings/navigation`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const settingsRail = page.locator('nav[aria-label="主导航"]')
await page.getByRole('button', { name: '窄版' }).click()
await page.waitForTimeout(300)
expect((await settingsRail.evaluate((element) => element.clientWidth)) < 100, '设置里的窄版没有同步到侧栏')
await page.getByRole('button', { name: '宽版' }).click()
await page.waitForTimeout(300)
expect((await settingsRail.evaluate((element) => element.clientWidth)) >= 200, '设置里的宽版没有同步到侧栏')
const settingsText = await page.getByLabel('设置分类').innerText()
expect(!settingsText.includes('导航与命名') && !settingsText.includes('系统与备份'), '设置目录仍包含旧分组')
await page.goto(`${base}/settings/content`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: '内容显示' }).waitFor()
await page.screenshot({ path: '../.run/ui-consistency-settings-content.png' })

// 移动端：不再出现双列导航
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${base}/checkins`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
expect(await page.locator('nav[aria-label="主导航"]').count() === 0, '移动端仍渲染桌面主导航')
await page.getByRole('button', { name: '更多' }).click()
await page.getByText('全部功能', { exact: true }).first().waitFor()
await page.screenshot({ path: '../.run/ui-consistency-mobile-nav.png' })

expect(errors.length === 0, `控制台错误：${errors.join('\n')}`)
console.log('ui consistency: OK')
await browser.close()
