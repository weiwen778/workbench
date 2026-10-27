import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.WB_BASE || 'http://127.0.0.1:18081'
const USER = process.env.WB_USER || 'admin'
const PASS = process.env.WB_PASS || 'admin12345'
const CHROME = process.env.WB_CHROME || '/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'
const FIX = '/tmp/wb-e2e'
const SHOT_DIR = path.resolve('../docs/screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const results = []
const realErrors = []

const browser = await chromium.launch({ executablePath: CHROME })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  acceptDownloads: true,
})
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => realErrors.push(`页面异常: ${e.message}`))
// 登录前对 /auth/me、/tables 的探测性 401 属于正常行为，不算缺陷
page.on('response', (r) => {
  if (r.status() >= 500) realErrors.push(`服务端 5xx: ${r.status()} ${r.request().method()} ${r.url()}`)
})

const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `verify-${name}.png`), fullPage: false })

async function step(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  OK   ${name}`)
  } catch (error) {
    const msg = String(error.message || error).split('\n')[0]
    results.push({ name, ok: false, err: msg })
    console.log(`  FAIL ${name} → ${msg}`)
    try { await shot(`fail-${results.length}`) } catch {}
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg) }
async function goto(p) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
}
const bodyText = () => page.locator('body').innerText()
async function waitText(text, timeout = 15000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout })
}
async function login() {
  await goto('/login')
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/checkins/shops', { timeout: 15000 })
  await page.waitForTimeout(700)
}
async function clickBtn(name) {
  await page.getByRole('button', { name, exact: true }).first().click()
  await page.waitForTimeout(500)
}
async function closeDialog() {
  const btn = page.locator('.el-dialog:visible').getByRole('button', { name: '关闭', exact: true })
  if (await btn.count()) await btn.first().click()
  else await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}
const dialogInput = () => page.locator('.el-dialog:visible input[type=file]').last()

console.log('\n【1】登录与全站用词')
await step('未登录时登录页副标题已是通俗说法', async () => {
  const fresh = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' })
  const p2 = await fresh.newPage()
  await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  const t = await p2.locator('body').innerText()
  assert(t.includes('按店铺和社媒分别处理每天的打卡'), '副标题未更新')
  assert(t.includes('登录状态保持 30 天'), '会话说法未更新')
  await fresh.close()
})

await step('登录进入店铺打卡', async () => {
  await login()
  assert(page.url().includes('/checkins/shops'), '未跳转')
})

await step('打卡页无「对象」且有「管理店铺」', async () => {
  const t = await bodyText()
  assert(!t.includes('对象'), '仍有「对象」')
  assert(t.includes('管理店铺'), '缺少「管理店铺」')
  await shot('01-店铺打卡')
})

console.log('\n【2】打卡 JSON 导入 + 模板下载')
await step('打开导入对话框', async () => {
  await clickBtn('导入')
  await waitText('导入店铺')
  await shot('02-打卡导入对话框')
})

await step('下载模板：文件名与内容正确', async () => {
  const dialog = page.locator('.el-dialog:visible').first()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    dialog.getByRole('button', { name: '下载模板', exact: true }).click(),
  ])
  const name = download.suggestedFilename()
  const dest = path.join(FIX, 'tpl-shop.json')
  await download.saveAs(dest)
  const data = JSON.parse(fs.readFileSync(dest, 'utf8'))
  assert(name.endsWith('.json'), `扩展名不对：${name}`)
  assert(name.includes('店铺'), `文件名不含店铺：${name}`)
  assert(Array.isArray(data['_说明']), '缺 _说明')
  assert(Array.isArray(data['店铺']), '缺店铺列表')
  console.log(`       文件名 = ${name}`)
})

await step('上传 JSON 一次建好店铺+分类+任务', async () => {
  await dialogInput().setInputFiles(path.join(FIX, '打卡.json'))
  await waitText('已导入 1 个店铺')
  const t = await bodyText()
  assert(t.includes('2 个分类'), '分类数不对')
  assert(t.includes('2 个任务'), '任务数不对')
  await shot('03-打卡导入结果')
})

await step('再导一次：跳过同名任务（幂等）', async () => {
  await closeDialog()
  await clickBtn('导入')
  await waitText('导入店铺')
  await dialogInput().setInputFiles(path.join(FIX, '打卡.json'))
  await waitText('跳过 2 个同名任务', 20000)
  const t = await bodyText()
  assert(t.includes('已导入 0 个店铺'), '第二次仍新建了店铺')
  await shot('04-打卡重复导入')
  await closeDialog()
})

await step('导入结果出现在管理列表与今日清单', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await clickBtn('管理店铺')
  await page.waitForTimeout(900)
  const t = await bodyText()
  assert(t.includes('E2E测试店铺'), '管理列表没有店铺')
  assert(t.includes('E2E内容'), '管理列表没有分类')
  await shot('05-管理列表')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const t2 = await bodyText()
  assert(t2.includes('E2E发布内容'), '今日清单没有生成任务')
  await shot('06-今日清单')
})

await step('社媒页模板用「账号」口径', async () => {
  await goto('/checkins/social')
  await clickBtn('导入')
  await waitText('导入社媒账号')
  const dialog = page.locator('.el-dialog:visible').first()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    dialog.getByRole('button', { name: '下载模板', exact: true }).click(),
  ])
  const name = download.suggestedFilename()
  const dest = path.join(FIX, 'tpl-social.json')
  await download.saveAs(dest)
  const data = JSON.parse(fs.readFileSync(dest, 'utf8'))
  assert(name.includes('账号'), `文件名不含账号：${name}`)
  assert(Array.isArray(data['账号']), '缺「账号」列表')
  console.log(`       文件名 = ${name}`)
  await closeDialog()
})

console.log('\n【3】表格导入：四种格式')
const cases = [
  { file: '商品-CSV.csv', name: '商品-CSV', label: 'CSV-UTF8' },
  { file: '商品-GBK.csv', name: '商品-GBK', label: 'CSV-GBK' },
  { file: '商品-JSON.json', name: '商品-JSON', label: 'JSON' },
  { file: '商品-XLS.xls', name: '商品-XLS', label: 'XLS' },
]
for (const tc of cases) {
  await step(`用 ${tc.label} 建表`, async () => {
    await goto('/data')
    assert((await bodyText()).includes('从 Excel 导入'), '缺入口按钮')
    await clickBtn('从 Excel 导入')
    await waitText('从文件新建表格')
    await dialogInput().setInputFiles(path.join(FIX, tc.file))
    await page.waitForTimeout(2500)
    const t = await bodyText()
    assert(/\d+ 行/.test(t), `未进入预览：${t.slice(0, 120)}`)
    await shot(`07-预览-${tc.label}`)
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/\/data\/\d+/, { timeout: 25000 })
    await page.waitForTimeout(1300)
    const title = (await page.locator('.title-15').first().innerText()).trim()
    assert(title === tc.name, `表名不对：${title} ≠ ${tc.name}`)
    assert(/\d+ 行/.test(await bodyText()), '详情页没有行数')
    await shot(`08-导入后-${tc.label}`)
  })
}

await step('GBK 的 CSV 中文不乱码', async () => {
  await goto('/data')
  const row = page.locator('tr', { hasText: '商品-GBK' }).first()
  await row.getByRole('button', { name: '打开' }).click()
  await page.waitForTimeout(1300)
  const t = await bodyText()
  assert(t.includes('商品名称'), `表头乱码：${t.slice(0, 160)}`)
  assert(t.includes('徽章-定制圆章'), '内容乱码')
  await shot('09-GBK表头')
})

await step('详情页用「列设置」「共 N 行」', async () => {
  const t = await bodyText()
  assert(t.includes('列设置'), '缺「列设置」')
  assert(/共 \d+ 行/.test(t), '缺「共 N 行」')
  assert(!t.includes('字段'), '仍有「字段」')
})

await step('重名建表给出可读提示', async () => {
  await goto('/data')
  await clickBtn('从 Excel 导入')
  await waitText('从文件新建表格')
  await dialogInput().setInputFiles(path.join(FIX, '商品-CSV.csv'))
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: '确认导入' }).click()
  await waitText('同名', 15000)
  const t = await bodyText()
  assert(t.includes('同名'), '没有重名提示')
  await shot('10-重名提示')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
})

console.log('\n【4】表格批量导入')
await step('批量导入让行数增加', async () => {
  await goto('/data')
  const row = page.locator('tr', { hasText: '商品-CSV' }).first()
  await row.getByRole('button', { name: '打开' }).click()
  await page.waitForTimeout(1300)
  const before = Number((await bodyText()).match(/共 (\d+) 行/)?.[1] || 0)
  await clickBtn('批量导入')
  await waitText('导入到当前表格')
  await dialogInput().setInputFiles(path.join(FIX, '商品-CSV.csv'))
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(2500)
  const after = Number((await bodyText()).match(/共 (\d+) 行/)?.[1] || 0)
  assert(after > before, `行数没增加：${before} → ${after}`)
  console.log(`       行数 ${before} → ${after}`)
  await shot('11-批量导入后')
})

console.log('\n【5】其它页面用词')
await step('回收站筛选项与说明', async () => {
  await goto('/trash')
  const t = await bodyText()
  assert(t.includes('便利贴'), '缺「便利贴」')
  assert(t.includes('表格行'), '缺「表格行」')
  assert(t.includes('店铺、社媒账号不进回收站'), '说明未更新')
  assert(!t.includes('数据表'), '仍有「数据表」')
  await shot('12-回收站')
})

await step('便利贴页用词', async () => {
  await goto('/memos')
  const t = await bodyText()
  assert(t.includes('新建便利贴'), '缺「新建便利贴」')
  assert(!t.includes('便签'), '仍有「便签」')
  await shot('13-便利贴')
})

await step('设置页说明用词', async () => {
  await goto('/settings')
  const t = await bodyText()
  assert(t.includes('多久做一次'), '缺「多久做一次」')
  assert(t.includes('数据存储'), '缺「数据存储」')
  await shot('14-设置')
})

await step('无页面异常、无服务端 5xx', async () => {
  assert(realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
})
await step('控制台无 JS 报错（登录前 401 探测已排除）', async () => {
  const unexpected = consoleErrors.filter(
    (e) => !/401 \(Unauthorized\)/.test(e) && !/409 \(Conflict\)/.test(e),
  )
  assert(unexpected.length === 0, `${unexpected.length} 条：${unexpected.slice(0, 2).join(' | ')}`)
})

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n===== 仿真结果：${results.length - failed.length} 通过 / ${failed.length} 失败 =====`)
failed.forEach((f) => console.log(`  失败：${f.name} → ${f.err}`))
fs.writeFileSync(path.join(FIX, 'result.json'), JSON.stringify({ results, realErrors, consoleErrors }, null, 2))
process.exit(failed.length ? 1 : 0)
