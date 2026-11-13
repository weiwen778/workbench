import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { base, password } from './react-env.mjs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('401')) errors.push(`console: ${message.text()}`)
})

async function api(method, path, body) {
  const cookies = await page.context().cookies()
  const csrf = cookies.find((cookie) => cookie.name === 'wb_csrf')?.value || ''
  const response = await page.request.fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    data: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok()) throw new Error(`${method} ${path} -> ${response.status()}`)
  return response.json().catch(() => null)
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.getByLabel('用户名').fill('admin')
await page.getByLabel('密码').fill(password)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForURL(/checkins/, { timeout: 15000 })
await page.waitForTimeout(900)

// 1. 统一搜索弹窗
await page.keyboard.press('Control+k')
await page.getByLabel('搜索内容').waitFor({ timeout: 5000 })
await page.getByLabel('搜索内容').fill('张三')
await page.getByText('表格记录').first().waitFor({ timeout: 15000 })
await page.keyboard.press('Escape')
await page.getByLabel('搜索内容').waitFor({ state: 'hidden', timeout: 5000 })
console.log('search dialog: OK')

// 2. 任务中心 / 操作记录弹窗
await page.getByRole('button', { name: '任务中心' }).first().click()
await page.getByRole('tab', { name: '任务中心' }).waitFor({ timeout: 5000 })
await page.getByRole('tab', { name: '操作记录' }).click()
await page.getByRole('button', { name: '回收站与恢复' }).waitFor({ timeout: 5000 })
await page.keyboard.press('Escape')
await page.getByRole('tab', { name: '任务中心' }).waitFor({ state: 'hidden', timeout: 5000 })
console.log('task dialog: OK')

// 3. 表格资料库：搜索 / 视图切换
await page.goto(`${base}/data`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.getByLabel('卡片视图').click()
await page.getByPlaceholder(/搜索表格名称/).fill('测试1')
await page.waitForTimeout(300)
let libraryText = await page.locator('body').innerText()
expect(libraryText.includes('测试1'), '表格搜索没有结果')
expect(!libraryText.includes('测试001'), '表格搜索没有过滤其他表格')
await page.getByPlaceholder(/搜索表格名称/).fill('')
await page.getByLabel('列表视图').click()
await page.waitForTimeout(300)
libraryText = await page.locator('body').innerText()
expect(libraryText.includes('测试1') && /\d+ 列 · \d+ 条/.test(libraryText), '表格列表视图缺少行内容')
await page.getByLabel('卡片视图').click()
console.log('table library: OK')

// 4. 模块下拉
let tableId = 7
const tables = await api('GET', '/tables')
const testTable = tables.find((table) => table.name === '测试1') || tables[0]
if (testTable) tableId = testTable.id
await page.goto(`${base}/data/${tableId}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('nav[aria-label="表格导航"] button').first().click()
await page.getByRole('menuitem', { name: '全部' }).waitFor({ timeout: 5000 })
await page.keyboard.press('Escape')
console.log('module dropdown: OK')

// 4. 表格 AI 填入（只识别，不写入）
await page.getByRole('button', { name: /AI 填入/ }).click()
await page.getByRole('button', { name: '乱文本识别' }).click()
await page.getByLabel('粘贴杂乱文本').fill('张三是一名居住在广东省中山市的男士，联系电话为 123123123123，电子邮箱地址为 12313123@qq.com；该条个人资料档案创建于 2034 年 2 月 3 日。')
const startedAt = Date.now()
await page.getByRole('button', { name: '开始识别' }).click()
await page.getByText('核对数据').waitFor({ timeout: 120000 })
const elapsed = Date.now() - startedAt
const nameValue = await page.locator('.MuiDialog-root').getByLabel(/姓名|名字/).first().inputValue()
expect(nameValue === '张三', `AI 文本识别没有生成张三，实际为 ${nameValue}`)
expect(elapsed < 3000, `常见文本识别过慢：${elapsed}ms`)
expect((await page.locator('.MuiDialog-root').innerText()).includes('本地快速识别'), '没有命中本地快速识别')
await page.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(400)

// Ctrl+V 粘贴图片
await page.getByRole('button', { name: /AI 填入/ }).click()
await page.waitForTimeout(300)
const imageBase64 = readFileSync(new URL('./fixtures/ai-table-sample.png', import.meta.url)).toString('base64')
const pasteEvent = await page.evaluateHandle(async (base64) => {
  const response = await fetch('data:image/png;base64,' + base64)
  const blob = await response.blob()
  const file = new File([blob], 'pasted.png', { type: 'image/png' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  return new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
}, imageBase64)
await page.evaluate((event) => window.dispatchEvent(event), pasteEvent)
await page.locator('.MuiDialog-root img[alt="待识别图片"]').waitFor({ timeout: 5000 })
await page.getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(500)
console.log(`table ai fill: OK (${elapsed}ms, paste OK)`)

// 5. 看板资料库
await page.goto(`${base}/visualizations`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
expect(await page.getByPlaceholder('搜索看板名称').count() === 1, '看板列表缺少搜索')
await page.getByLabel('列表视图').click()
await page.waitForTimeout(300)
expect((await page.locator('body').innerText()).includes('图表'), '看板列表视图缺少列')
await page.getByLabel('卡片视图').click()
console.log('board library: OK')

// 6. 看板 AI 生成（只生成预览，不添加）
const boards = await api('GET', '/dashboards')
let board = boards.find((item) => item.name === '123') || boards[0]
let temporaryBoard = null
if (!board) {
  board = await api('POST', '/dashboards', { name: 'E2E 临时看板' })
  temporaryBoard = board
}
try {
  await page.goto(`${base}/visualizations/${board.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /AI 生成/ }).click()
  await page.getByLabel('你想看到什么数据？').fill('每天新增记录的趋势')
  await page.getByRole('button', { name: '生成图表' }).click()
  await page.getByRole('button', { name: /全部添加（/ }).waitFor({ timeout: 120000 })
  expect((await page.locator('.MuiDialog-root').innerText()).includes('趋势'), '看板 AI 没有生成趋势图')
  await page.getByRole('button', { name: '取消' }).click()
  console.log('dashboard ai: OK')
} finally {
  if (temporaryBoard) await api('DELETE', `/dashboards/${temporaryBoard.id}?version=${temporaryBoard.version}`).catch(() => null)
}

// 6. 翻译服务列表
await page.goto(`${base}/settings/translation`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const translationText = await page.locator('main').innerText()
for (const name of ['百度翻译', '有道翻译', 'DeepSeek', '智谱 GLM', 'OpenAI 兼容', 'DeepL', 'MyMemory（免费）', 'LibreTranslate']) {
  expect(translationText.includes(name), `翻译服务缺少 ${name}`)
}
await page.goto(`${base}/translate`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const translateText = await page.locator('body').innerText()
expect(translateText.includes('Ctrl / ⌘ + Enter'), '翻译页缺少快捷键提示')
expect(translateText.includes('译文会显示在这里'), '翻译页缺少译文空状态')
expect(await page.getByLabel('清空翻译历史').count() === 1, '翻译页缺少清空历史入口')
console.log('translation providers: OK')

// 7. Agent 接入
await page.goto(`${base}/settings/agents`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const agentText = await page.locator('main').innerText()
expect(agentText.includes('Agent 暂存区'), 'Agent 暂存区不存在')
expect(agentText.includes('复制接入说明'), 'Agent 接入说明入口不存在')
console.log('agent settings: OK')

// 8. 图片编辑器：上传、标注、拼图、切图
await page.setViewportSize({ width: 1440, height: 1000 })
await page.goto(`${base}/images`, { waitUntil: 'networkidle' })
await page.locator('input[type=file]').first().setInputFiles([{
  name: 'image-e2e.png', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/ai-table-sample.png', import.meta.url)),
}])
await page.waitForTimeout(900)
const tabs = await page.getByRole('tab').allInnerTexts()
expect(['调整', '色彩', '标记', '文字', '拼图', '切图', '导出'].every((label) => tabs.includes(label)), '图片编辑器分类不完整')
expect(!(await page.locator('body').innerText()).includes('拉伸到尺寸'), '图片编辑器仍存在拉伸选项')
await page.getByRole('button', { name: /裁剪旋转/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: '左转 90°' }).click()
await page.waitForTimeout(300)
const angle = Number(await page.locator('input[type=range]').first().inputValue())
expect(angle >= -180 && angle <= 180, `旋转角度超出滑块范围：${angle}`)
await page.getByRole('button', { name: '右转 90°' }).click()
await page.waitForTimeout(300)
console.log('image rotation: OK')
await page.getByRole('button', { name: /天猫\/淘宝主图/ }).click()
await page.waitForTimeout(600)
const fittedRatio = await page.evaluate(() => {
  for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX >= 0) return (maxX - minX + 1) / (maxY - minY + 1)
  }
  return 0
})
expect(Math.abs(fittedRatio - 520 / 435) < 0.05, `方形画布导致图片比例改变：${fittedRatio.toFixed(3)}`)
console.log('image ratio: OK')
await page.getByRole('tab', { name: '标记' }).click()
await page.waitForTimeout(300)
const overlay = page.locator('canvas').last()
const box = await overlay.boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 6 })
  await page.mouse.up()
}
await page.waitForTimeout(300)
expect((await page.locator('body').innerText()).includes('当前标注：1 个'), '图片标注没有生效')
await page.getByRole('tab', { name: '拼图' }).click()
const collageDownload = page.waitForEvent('download', { timeout: 30000 })
await page.getByRole('button', { name: '生成拼图并下载' }).click()
await collageDownload
await page.getByRole('tab', { name: '切图' }).click()
const sliceDownload = page.waitForEvent('download', { timeout: 30000 })
await page.getByRole('button', { name: '切图并下载 ZIP' }).click()
await sliceDownload
console.log('image editor: OK')

// 8.1 竖图预览必须完整显示且保持比例
await page.locator('input[type=file]').first().setInputFiles([{
  name: 'portrait-e2e.png', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/portrait-large.png', import.meta.url)),
}])
await page.waitForTimeout(500)
await page.getByText('portrait-e2e.png').click()
await page.waitForTimeout(700)
const portraitFit = await page.evaluate(() => {
  const canvas = document.querySelector('canvas[aria-label="图片处理预览"]')
  if (!canvas) return null
  const box = canvas.getBoundingClientRect()
  const area = canvas.parentElement.parentElement.getBoundingClientRect()
  return { cssRatio: box.width / box.height, attrRatio: canvas.width / canvas.height, fits: box.height <= area.height + 1 && box.width <= area.width + 1 }
})
expect(Boolean(portraitFit?.fits), '竖图预览超出可视区域')
expect(Math.abs((portraitFit?.cssRatio || 0) - (portraitFit?.attrRatio || 1)) < 0.01, '竖图预览比例被改变')
console.log('image portrait fit: OK')

// 9. 移动端：搜索和任务按钮
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${base}/checkins`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.getByLabel('搜索').click()
await page.getByLabel('搜索内容').waitFor({ timeout: 5000 })
await page.keyboard.press('Escape')
await page.getByRole('button', { name: '任务中心' }).first().click()
await page.getByRole('tab', { name: '任务中心' }).waitFor({ timeout: 5000 })
await page.keyboard.press('Escape')
console.log('mobile dialogs: OK')

console.log('\nERRORS:')
for (const error of errors) console.log(error)
expect(errors.length === 0, `页面出现 ${errors.length} 个错误`)
await browser.close()
console.log('react-full: PASS')
