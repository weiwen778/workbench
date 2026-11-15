import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { base, password } from './react-env.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.goto(base + '/login')
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/checkins')

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(base + '/translate', { waitUntil: 'networkidle' })
    const clearSource = page.getByRole('button', { name: '清空原文', exact: true })
    const clearResult = page.getByRole('button', { name: '清空译文', exact: true })
    const input = page.getByPlaceholder(/输入或粘贴需要翻译的内容/)
    await input.fill('待翻译文本')
    const result = await clearResult.boundingBox()
    const source = await clearSource.boundingBox()
    const favorites = await page.getByText('收藏', { exact: true }).last().boundingBox()
    assert.ok(result && source && favorites, `missing translation controls at ${width}px`)
    assert.ok(Math.max(result.y + result.height, source.y + source.height) <= favorites.y,
      `translation controls overlap the favorites panel at ${width}px`)
    await clearSource.click()
    assert.equal(await input.inputValue(), '')
    await page.getByPlaceholder('搜索原文或译文').scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换主题' }).click()
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(15, 21, 23)')
  const contrast = await page.getByRole('button', { name: '粘贴', exact: true }).evaluate((button) => {
    function luminance(color) {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => value / 255)
      return rgb.reduce((sum, value, index) => {
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        return sum + linear * [0.2126, 0.7152, 0.0722][index]
      }, 0)
    }
    let surface = button
    while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)' && surface.parentElement) {
      surface = surface.parentElement
    }
    const values = [luminance(getComputedStyle(button).color), luminance(getComputedStyle(surface).backgroundColor)]
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
  })
  assert.ok(contrast >= 4.5, `dark theme text button contrast is ${contrast.toFixed(2)}:1`)
} finally {
  await browser.close()
}
