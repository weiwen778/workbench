import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { base, password } from './react-env.mjs'

const require = createRequire(new URL('../web-react/package.json', import.meta.url))
const { PDFDocument } = require('pdf-lib')
const { unzipSync } = require('fflate')
const XLSX = require('xlsx')

async function downloadBytes(download) {
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function pdfOpenFailure(page) {
  const stamp = Date.now()
  async function savePdf(title, pages) {
    const pdf = await PDFDocument.create()
    for (let index = 0; index < pages; index++) pdf.addPage()
    await page.goto(base + '/docs')
    await page.locator('input[type=file][accept^=".pdf"]').setInputFiles({
      name: title + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
    })
    await page.getByText(pages + ' 页', { exact: true }).waitFor()
    const pending = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/document-projects') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '保存项目', exact: true }).click()
    const response = await pending
    assert.ok(response.ok(), await response.text())
    await page.getByText('项目已创建', { exact: true }).waitFor()
    return response.json()
  }

  const unavailable = await savePdf('重新打开 ' + stamp, 2)
  const existing = await savePdf('当前编辑 ' + stamp, 1)
  const attachmentUrl = base + unavailable.attachments[0].url
  await page.route(attachmentUrl, (route) => route.fulfill({
    status: 503, json: { code: 'FILE_OFFLINE', message: '附件暂时不可用' },
  }))
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const projects = page.getByRole('dialog', { name: 'PDF项目' })
  await projects.getByText(unavailable.title, { exact: true }).click()
  const failure = await Promise.race([
    projects.getByText(/项目恢复失败/).waitFor().then(() => 'error'),
    page.getByText('已打开「' + unavailable.title + '」', { exact: true }).waitFor().then(() => 'success'),
  ])
  assert.equal(failure, 'error', 'An attachment failure must not switch the active PDF project.')
  await projects.getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'PDF 标题' }).inputValue(), existing.title)
  await page.getByText('1 页', { exact: true }).waitFor()

  await page.unroute(attachmentUrl)
  await page.getByRole('button', { name: '项目', exact: true }).click()
  await projects.getByText(unavailable.title, { exact: true }).click()
  await page.getByText('2 页', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'PDF 标题' }).inputValue(), unavailable.title)
}

async function gridSlices(page) {
  await page.goto(base + '/images')
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 5
    canvas.height = 3
    const context = canvas.getContext('2d')
    context.fillStyle = '#ff0000'
    context.fillRect(0, 0, 5, 3)
    context.fillStyle = '#0000ff'
    context.fillRect(4, 0, 1, 3)
    context.fillRect(0, 2, 5, 1)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'odd.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64'),
  })
  await page.getByRole('tab', { name: '切图' }).click()
  await page.getByRole('spinbutton', { name: '行数', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: '列数', exact: true }).fill('2')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '切图并下载 ZIP' }).click()
  const download = await pending
  const entries = unzipSync(await downloadBytes(download))
  const dimensions = Object.fromEntries(Object.entries(entries).map(([name, bytes]) => {
    const png = Buffer.from(bytes)
    return [name, [png.readUInt32BE(16), png.readUInt32BE(20)]]
  }))
  assert.deepEqual(dimensions, {
    'odd-r1c1.png': [2, 1], 'odd-r1c2.png': [3, 1],
    'odd-r2c1.png': [2, 2], 'odd-r2c2.png': [3, 2],
  }, 'Grid exports must include every row and column of the source image.')

  await page.getByRole('spinbutton', { name: '行数', exact: true }).fill('4')
  await page.getByRole('button', { name: '切图并下载 ZIP' }).click()
  await page.getByText(/行列数不能超过图片宽高/).waitFor()
}

async function pdfReplaceSameName(page) {
  await page.goto(base + '/docs')
  const name = '同名替换 ' + Date.now() + '.pdf'
  async function importPdf(width) {
    const pdf = await PDFDocument.create()
    pdf.addPage([width, 200])
    await page.locator('input[type=file][accept^=".pdf"]').setInputFiles({
      name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
    })
    await page.getByText('1 页', { exact: true }).waitFor()
  }
  await importPdf(100)
  const created = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/document-projects') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const original = await (await created).json()
  await page.getByText('项目已创建', { exact: true }).waitFor()

  await page.getByRole('button', { name: '删除本页', exact: true }).click()
  await page.getByRole('dialog', { name: '删除页面' }).getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '选择 PDF', exact: true }).waitFor()
  await importPdf(300)
  const updated = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/document-projects/' + original.id) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const project = await (await updated).json()
  const attachment = await page.request.get(base + project.attachments[0].url)
  assert.ok(attachment.ok(), await attachment.text())
  const pdf = await PDFDocument.load(await attachment.body())
  assert.equal(pdf.getPages()[0].getWidth(), 300, 'A newly imported PDF must replace the attachment even when the filename matches.')
}

async function singleColumnCsv(page) {
  await page.goto(base + '/convert')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'one-col.csv', mimeType: 'text/csv', buffer: Buffer.from('sku\r\n001\r\n002\r\n'),
  })
  await page.getByRole('button', { name: /转换全部/ }).click()
  const status = await Promise.race([
    page.getByRole('button', { name: '下载', exact: true }).first().isEnabled().then(async (ready) => {
      if (!ready) await page.locator('button[aria-label="下载"]:enabled').waitFor()
      return 'success'
    }),
    page.getByText(/CSV 解析失败/).waitFor().then(() => 'error'),
  ])
  assert.equal(status, 'success', 'A single column without separators is valid CSV.')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载', exact: true }).first().click()
  const workbook = XLSX.read(await downloadBytes(await pending))
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [['sku'], ['001'], ['002']])
}

async function wifiRecognitionMasksPassword(page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/codes')
  const secret = 'fixture-secret-demo'
  await page.getByRole('button', { name: /Wi-Fi/i }).click()
  await page.getByLabel(/网络名称/).fill('qa-fixture')
  await page.getByLabel('密码', { exact: true }).fill(secret)
  await page.locator('pre').filter({ hasText: 'WIFI:' }).waitFor()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
  const qr = await downloadBytes(await pending)
  await page.getByRole('tab', { name: '识别', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'wifi.png', mimeType: 'image/png', buffer: qr })
  await page.getByText(/默认遮盖/).waitFor()
  const preview = await page.locator('pre').innerText()
  assert.match(preview, /P:\*\*\*;/)
  assert.ok(!preview.includes(secret), 'The Wi-Fi password must be hidden in the recognition preview.')
}

async function downloadUsesNewQrPayload(page) {
  await page.goto(base + '/codes')
  await page.locator('pre').filter({ hasText: 'https://example.com' }).waitFor()
  await page.getByLabel('网页地址', { exact: true }).fill('https://example.org/updated')
  const disabled = await page.getByRole('button', { name: '下载 PNG', exact: true }).isDisabled()
  const updated = await page.locator('pre').filter({ hasText: 'https://example.org/updated' }).count()
  assert.ok(disabled || updated, 'Download must wait for the current QR payload.')
}

async function lockedColorKeepsPixelPosition(page) {
  await page.goto(base + '/color')
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 60
    const context = canvas.getContext('2d')
    context.fillStyle = 'red'
    context.fillRect(0, 0, 50, 60)
    context.fillStyle = 'blue'
    context.fillRect(50, 0, 50, 60)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type=file]').setInputFiles({
    name: 'red-blue.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64'),
  })
  const target = page.getByLabel('取色图片预览')
  const magnifier = page.getByLabel('像素放大预览')
  await target.click({ position: { x: 20, y: 25 } })
  const position = await page.getByText(/^像素 \d+, \d+$/).innerText()
  const sample = await magnifier.evaluate((canvas) => canvas.toDataURL())
  await target.hover({ position: { x: 80, y: 25 } })
  assert.equal((await page.getByTestId('sample-hex').innerText()).toLowerCase(), '#ff0000')
  assert.equal(await page.getByText(/^像素 \d+, \d+$/).innerText(), position)
  assert.equal(await magnifier.evaluate((canvas) => canvas.toDataURL()), sample)
}

const tests = {
  pdf: pdfOpenFailure,
  'pdf-replace': pdfReplaceSameName,
  images: gridSlices,
  csv: singleColumnCsv,
  wifi: wifiRecognitionMasksPassword,
  'qr-update': downloadUsesNewQrPayload,
  color: lockedColorKeepsPixelPosition,
}
const requested = process.argv.slice(2)
const browser = await chromium.launch()
try {
  for (const name of requested.length ? requested : Object.keys(tests)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(12000)
    try {
      await page.goto(base + '/login')
      await page.getByPlaceholder('请输入用户名').fill('admin')
      await page.getByPlaceholder('请输入密码').fill(password)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/checkins')
      await tests[name](page)
      console.log(name + ' regression passed')
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
