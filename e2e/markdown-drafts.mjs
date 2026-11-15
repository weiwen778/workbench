import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { base, password } from './react-env.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/checkins')
  await page.goto(base + '/docs?module=doc')
  const body = page.locator('.cm-content')
  await body.fill('# 草稿回归文档')
  const saved = page.waitForResponse(response => response.url().endsWith('/api/v1/document-projects') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存项目' }).click()
  assert.equal((await saved).status(), 201)
  const project = await (await saved).json()
  await page.getByText('项目已创建', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '项目', exact: true }).click()
  await page.getByRole('dialog').getByText(project.title, { exact: true }).first().click()
  await page.getByRole('heading', { name: '草稿回归文档' }).waitFor()

  // The editor writes drafts after a 700ms debounce.
  await page.waitForTimeout(850)
  await page.reload()
  await body.waitFor()
  await page.getByText('发现浏览器本地草稿', { exact: false }).waitFor({ timeout: 1500 }).then(
    () => assert.fail('Opening a saved project created a false draft'),
    error => { if (error.name !== 'TimeoutError') throw error },
  )
} finally {
  await browser.close()
}
