// 深水区流程：Excel 导出/导入、工作簿（文档项目）往返、Agent 变更审批、PDF 渲染
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
const password = process.env.WB_E2E_PASSWORD
const outDir = process.env.WB_AUDIT_OUT || resolve(process.cwd(), '../.run/audit4')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) jsErrors.push(m.text().slice(0, 200)) })

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`)
}

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.getByPlaceholder('请输入用户名').fill('admin')
await page.getByPlaceholder('请输入密码').fill(password)
await page.getByRole('button', { name: '登录' }).first().click()
await page.waitForURL(/checkins/, { timeout: 20000 })

const csrf = async () => (await context.cookies()).find((c) => c.name === 'wb_csrf')?.value || ''
async function api(method, path, body) {
  const res = await page.request.fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() },
    data: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text.slice(0, 300) }
  return { ok: res.ok(), status: res.status(), body: json }
}
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.tables || [])

const tables = listOf((await api('GET', '/tables')).body)
const demo = tables.find((t) => (t.record_count || 0) > 50) || tables[0]
console.log('target table:', demo?.id, demo?.name, 'records=', demo?.record_count)

// 1. Excel 导出：异步任务 → 下载产物 → 校验 xlsx
try {
  const job = await api('POST', `/tables/${demo.id}/exports`, {})
  const downloadUrl = job.body?.download_url
  const rows = job.body?.rows ?? job.body?.result?.rows ?? 0
  let bytes = 0
  let isZip = false
  let zipEntries = []
  if (downloadUrl) {
    const res = await page.request.get(`${base}${downloadUrl}`)
    const buf = await res.body()
    bytes = buf.length
    isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b
    writeFileSync(resolve(outDir, 'export.xlsx'), buf)
    if (isZip) {
      const text = buf.toString('latin1')
      zipEntries = ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/'].filter((name) => text.includes(name))
    }
  }
  record('表格 Excel 导出', job.ok && job.body?.status === 'success' && isZip && rows > 0,
    `job=${job.status}/${job.body?.status} rows=${rows} bytes=${bytes} xlsx=${isZip} entries=${zipEntries.join('|') || '-'}`)
} catch (error) { record('表格 Excel 导出', false, String(error.message).slice(0, 160)) }

// 2. 工作簿（文档项目）保存往返：创建 → 写入 state → 读回校验 → 删除
try {
  const title = `审计工作簿 ${Date.now() % 100000}`
  const created = await api('POST', '/document-projects', {
    kind: 'sheet', title, state: { sheets: { s1: { name: 'Sheet1', cells: { A1: { v: '审计单元格' } } } } },
  })
  const projectId = created.body?.id
  const version = created.body?.version ?? 1
  const read1 = await api('GET', `/document-projects/${projectId}`)
  const state1 = JSON.stringify(read1.body?.state || {})
  const updated = await api('PUT', `/document-projects/${projectId}`, {
    kind: 'sheet', title, version, state: { sheets: { s1: { name: 'Sheet1', cells: { A1: { v: '审计单元格2' }, B2: { v: 42 } } } } },
  })
  const read2 = await api('GET', `/document-projects/${projectId}`)
  const state2 = JSON.stringify(read2.body?.state || {})
  record('工作簿 保存往返', created.ok && state1.includes('审计单元格') && updated.ok && state2.includes('审计单元格2') && state2.includes('42'),
    `create=${created.status} v=${version} put=${updated.status} v2=${updated.body?.version} persisted=${state2.includes('审计单元格2')}`)
  if (projectId) await api('DELETE', `/document-projects/${projectId}`)
} catch (error) { record('工作簿 保存往返', false, String(error.message).slice(0, 160)) }

// 3. Excel 导入（预览 → 确认 → 校验表与行数 → 删除）
try {
  const bytes = readFileSync(resolve(process.cwd(), 'fixtures/sample.xlsx'))
  const preview = await page.request.post(`${base}/api/v1/imports/preview`, {
    headers: { 'X-CSRF-Token': await csrf() },
    multipart: {
      file: { name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes },
    },
  })
  const previewBody = await preview.json().catch(() => null)
  const jobId = previewBody?.job_id || previewBody?.id
  const previewRows = previewBody?.rows?.length ?? previewBody?.preview?.rows?.length ?? previewBody?.row_count ?? 0
  let tableId = null
  let recordCount = 0
  let confirmStatus = null
  if (jobId) {
    const confirmed = await api('POST', `/imports/${jobId}/confirm`, { name: `审计导入 ${Date.now() % 100000}`, mode: 'new' })
    confirmStatus = confirmed.status
    tableId = confirmed.body?.table_id || confirmed.body?.table?.id || confirmed.body?.id
    if (tableId) {
      const detail = await api('GET', `/tables/${tableId}`)
      recordCount = detail.body?.record_count ?? 0
    }
  }
  record('Excel 导入 预览+确认', preview.ok && Boolean(jobId) && Boolean(tableId),
    `preview=${preview.status} job=${jobId} previewRows=${previewRows} confirm=${confirmStatus} table=${tableId} records=${recordCount}`)
  if (tableId) await api('DELETE', `/tables/${tableId}`)
} catch (error) { record('Excel 导入 预览+确认', false, String(error.message).slice(0, 160)) }

// 4. Agent：建令牌 → /me → 提交变更（引用真实清单）→ 管理员合并 → 校验 → 撤销
try {
  const lists = listOf((await api('GET', '/todo-lists')).body)
  const listId = lists[0]?.id
  const created = await api('POST', '/agent-tokens', { name: `审计令牌 ${Date.now() % 100000}`, scopes: ['todos:write'], write_mode: 'review', expires_in_days: 1 })
  const token = created.body?.token
  const tokenId = created.body?.id
  const todoTitle = `Agent 审计待办 ${Date.now() % 100000}`
  let meStatus = 0
  let mode = ''
  let changeId = null
  let changeStatus = 0
  let mergeStatus = 0
  let todoFound = false
  if (token) {
    const me = await page.request.get(`${base}/api/v1/agent/me`, { headers: { Authorization: `Bearer ${token}` } })
    meStatus = me.status()
    mode = (await me.json().catch(() => ({})))?.write_mode || ''
    const change = await page.request.post(`${base}/api/v1/agent/changes`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ title: '审计：新增一条待办', operations: [{ method: 'POST', path: '/api/v1/todos', body: { title: todoTitle, list_id: listId } }] }),
    })
    changeStatus = change.status()
    changeId = (await change.json().catch(() => ({})))?.id || null
    if (changeId) {
      // 合并需要携带变更当前版本号（乐观锁），先读详情拿 version
      const detail = await api('GET', `/agent-changes/${changeId}`)
      const changeVersion = detail.body?.version ?? 1
      const merged = await api('POST', `/agent-changes/${changeId}/merge`, { version: changeVersion })
      mergeStatus = merged.status
      if (!merged.ok) console.log('  merge body:', JSON.stringify(merged.body).slice(0, 200))
      const after = await api('GET', `/todos?list_id=${listId}`)
      todoFound = JSON.stringify(after.body).includes(todoTitle)
      if (todoFound) {
        const all = [...(after.body.pending || []), ...(after.body.completed || [])]
        const found = all.find((t) => t.title === todoTitle)
        if (found) await api('DELETE', `/todos/${found.id}`)
      }
      if (mergeStatus !== 200) await api('POST', `/agent-changes/${changeId}/reject`, { version: changeVersion })
    }
    record('Agent 变更 提交+合并', changeStatus === 202 && mergeStatus === 200 && todoFound,
      `me=${meStatus} mode=${mode} change=${changeStatus} id=${changeId} merge=${mergeStatus} todo=${todoFound}`)
  } else {
    record('Agent 变更 提交+合并', false, `建令牌失败 ${created.status} ${JSON.stringify(created.body).slice(0, 100)}`)
  }
  if (tokenId) await api('DELETE', `/agent-tokens/${tokenId}`)
} catch (error) { record('Agent 变更 提交+合并', false, String(error.message).slice(0, 160)) }

// 5. PDF：上传最小 PDF → 文档工作台渲染
try {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    '4 0 obj<</Length 62>>stream',
    'BT /F1 18 Tf 40 120 Td (Audit PDF Page) Tj ET',
    'endstream endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n')
  const pdfPath = resolve(outDir, 'audit-sample.pdf')
  writeFileSync(pdfPath, pdf, 'latin1')
  await page.goto(`${base}/docs`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const input = page.locator('input[type=file]').first()
  const hasInput = await input.count()
  let canvases = 0
  if (hasInput) {
    await input.setInputFiles(pdfPath)
    await page.waitForTimeout(4500)
    canvases = await page.locator('canvas').count()
    await page.screenshot({ path: resolve(outDir, 'pdf-render.png') })
  }
  record('PDF 打开并渲染', canvases > 0, `fileInput=${hasInput} canvas=${canvases}`)
} catch (error) { record('PDF 打开并渲染', false, String(error.message).slice(0, 160)) }

// 6. 工作簿 UI 挂载：切到「工作簿」页签，确认 Univer 画布就绪
try {
  await page.goto(`${base}/docs`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.getByRole('tab', { name: /工作簿/ }).click()
  await page.waitForTimeout(3500)
  const canvases = await page.locator('canvas').count()
  await page.screenshot({ path: resolve(outDir, 'workbook-ui.png') })
  record('工作簿 UI 挂载', canvases > 0, `canvas=${canvases}`)
} catch (error) { record('工作簿 UI 挂载', false, String(error.message).slice(0, 160)) }

writeFileSync(resolve(outDir, 'deepflow.json'), JSON.stringify({ results, jsErrors }, null, 2))
console.log('\nJS errors:', jsErrors.length)
for (const e of jsErrors.slice(0, 8)) console.log('  ' + e)
const failed = results.filter((r) => !r.ok).length
console.log(`\nsummary: ${results.length - failed}/${results.length} passed`)
await browser.close()
