/**
 * React 版流程仿真：打卡勾选 / 打卡历史 / Excel 导入向导 / 回收站恢复。
 * 每个分区独立 try/catch，输出分区级 PASS/FAIL，便于定位真实缺陷。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD || 'admin12345'
fs.mkdirSync('../.run/react-flows', { recursive: true })

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

try {
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  // ---------- 1. 打卡勾选 ----------
  try {
    await page.goto(base + '/checkins', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const counter = page.getByText(/完成 \d+ \/ \d+/).first()
    await counter.waitFor({ timeout: 15000 })
    const before = (await counter.innerText()).match(/完成 (\d+) \/ (\d+)/)
    const doneBefore = Number(before?.[1] ?? 0)

    const boxes = page.locator('input[type=checkbox]')
    const total = await boxes.count()
    let clicked = false
    for (let i = 0; i < total; i += 1) {
      const box = boxes.nth(i)
      if (!(await box.isChecked()) && (await box.isEnabled())) {
        await box.click()
        clicked = true
        break
      }
    }
    if (!clicked) throw new Error('没有可勾选的打卡项')
    await page.waitForTimeout(1500)
    const after = (await counter.innerText()).match(/完成 (\d+) \/ (\d+)/)
    const doneAfter = Number(after?.[1] ?? 0)
    if (doneAfter !== doneBefore + 1) throw new Error(`计数未 +1（${doneBefore} → ${doneAfter}）`)

    // 取消勾选，保持数据原状
    const checked = page.locator('input[type=checkbox]:checked')
    if (await checked.count()) {
      await checked.first().click()
      await page.waitForTimeout(1000)
    }
    record('打卡勾选（计数 +1 并回退）', true)
  } catch (error) {
    record('打卡勾选（计数 +1 并回退）', false, error.message.split('\n')[0])
  }

  // ---------- 2. 打卡历史 ----------
  try {
    await page.goto(base + '/checkins', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '历史', exact: true }).click()
    // 历史用 MuiDrawer 呈现，不是 dialog
    const drawer = page.locator('.MuiDrawer-root').last()
    await drawer.waitFor({ timeout: 10000 })
    const text = await drawer.innerText()
    if (!/打卡历史|已完成|完成率/.test(text)) throw new Error('历史抽屉内容异常')
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden', timeout: 8000 })
    record('打卡历史弹层', true)
  } catch (error) {
    record('打卡历史弹层', false, error.message.split('\n')[0])
  }

  // ---------- 3. Excel 导入向导 ----------
  try {
    await page.goto(base + '/data', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: '导入', exact: true }).click()
    const dialog = page.getByRole('dialog').first()
    await dialog.waitFor({ timeout: 10000 })
    const fileInput = page.locator('input[type=file]')
    await fileInput.setInputFiles('../e2e/fixtures/sample.xlsx')
    // 预览应出现行数/表头，至少出现“导入”或“下一步”类按钮
    await page.waitForTimeout(2500)
    const text = await dialog.innerText()
    if (!/行|列|表头|预览|导入/.test(text)) throw new Error('导入向导未显示预览内容')
    await page.screenshot({ path: '../.run/react-flows/import-wizard.png' })
    // 取消，不写库
    const cancel = dialog.getByRole('button', { name: /取消|关闭/ })
    if (await cancel.count()) await cancel.first().click()
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    record('Excel 导入向导（上传→预览→取消）', true)
  } catch (error) {
    record('Excel 导入向导（上传→预览→取消）', false, error.message.split('\n')[0])
  }

  // ---------- 4. 回收站恢复 ----------
  try {
    await page.goto(base + '/memos', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '新建便利贴' }).click()
    await page.getByPlaceholder('不填则显示为无标题便利贴').fill('回收站流程验证')
    await page.getByPlaceholder('随手记内容，Ctrl / Command + Enter 保存').fill('自动化流程验证内容')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForTimeout(1200)

    const card = page.locator('.MuiPaper-root', { has: page.getByRole('button', { name: '回收站流程验证', exact: true }) }).last()
    await card.waitFor({ timeout: 10000 })
    await card.getByRole('button', { name: '更多便利贴操作' }).click()
    await page.getByRole('menuitem', { name: '删除便利贴' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.waitForTimeout(1200)

    await page.goto(base + '/settings/trash', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    // 回收站是 DataGrid：按行定位，行内按钮文本为「恢复」
    const row = page.locator('[role=row]', { hasText: '回收站流程验证' }).first()
    await row.waitFor({ timeout: 10000 })
    await row.getByRole('button', { name: '恢复', exact: true }).click()
    // 恢复会弹确认框
    const confirm = page.getByRole('dialog').last()
    if (await confirm.count()) {
      const ok = confirm.getByRole('button', { name: /恢复|确定/ })
      if (await ok.count()) await ok.first().click()
    }
    await page.waitForTimeout(1800)
    await page.goto(base + '/memos', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    const restored = (await page.locator('body').innerText()).includes('回收站流程验证')
    if (!restored) throw new Error('恢复后便利贴未回到列表')
    record('回收站恢复（新建→删除→恢复）', true)

    // 清理：把测试便利贴再删一次并彻底删除，保持库内原状
    const cleanupCard = page.locator('.MuiPaper-root', { has: page.getByRole('button', { name: '回收站流程验证', exact: true }) }).last()
    await cleanupCard.getByRole('button', { name: '更多便利贴操作' }).click()
    await page.getByRole('menuitem', { name: '删除便利贴' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.waitForTimeout(1200)
    await page.evaluate(async () => {
      const csrf = document.cookie.split('; ').find((part) => part.startsWith('wb_csrf='))?.slice('wb_csrf='.length)
      const res = await fetch('/api/v1/trash', { credentials: 'include' })
      const data = await res.json()
      for (const item of data.items || []) {
        if (item.kind === 'memo' && item.name === '回收站流程验证') {
          const deleted = await fetch(`/api/v1/trash/memo/${item.entity_id}`, {
            method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': csrf || '' },
          })
          if (!deleted.ok) throw new Error(`清理测试便利贴失败（${deleted.status}）`)
        }
      }
    })
  } catch (error) {
    record('回收站恢复（新建→删除→恢复）', false, error.message.split('\n')[0])
  }

  const failed = results.filter((r) => !r.ok)
  if (pageErrors.length) console.log('PAGE_ERRORS:', pageErrors.slice(0, 3))
  console.log(`SUMMARY: ${results.length - failed.length}/${results.length} 分区通过`)
  if (failed.length) process.exitCode = 1
} finally {
  await page.screenshot({ path: '../.run/react-flows/final.png' }).catch(() => {})
  await browser.close()
}
