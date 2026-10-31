import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
const base=process.env.WB_BASE || 'http://127.0.0.1:18747'
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
assert.ok([18746,18747].includes(Number(new URL(base).port)), 'Use an isolated test service on port 18746 or 18747')
await fs.mkdir('../.run/release-ui-audit',{recursive:true})
const label='发布验收-'+Date.now()
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined})
const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[],pdfRequests=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&/Failed to resolve|Unhandled/.test(m.text()))errors.push(m.text())})
page.on('request',r=>{if(/\/assets\/pdf-|pdf\.worker/.test(r.url()))pdfRequests.push(r.url())})
async function api(path,data,method='POST'){const csrf=(await context.cookies()).find(c=>c.name==='wb_csrf')?.value||'';const r=await context.request.fetch(base+'/api/v1'+path,{method,headers:{'X-CSRF-Token':csrf},data});assert.ok(r.ok(),await r.text());return r.json()}
function pdf(){let text='%PDF-1.4\n',offsets=[0];const stream='BT /F1 18 Tf 20 150 Td (Performance QA) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];objects.forEach((v,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${v}\nendobj\n`});const xref=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(text)}
try{
  await page.goto(base+'/login');await page.getByPlaceholder('请输入用户名').fill('admin');await page.getByPlaceholder('请输入密码').fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops')
  if(process.env.WB_ALLOW_SEEDED_TEST!=='1')assert.equal((await api('/tables',undefined,'GET')).length,0,'Use a fresh isolated test database')
  const list=await api('/todo-lists',{name:label}),folder=await api('/note-folders',{name:'发布记录-'+label})
  const note=await api('/notes',{title:'版本笔记',content:'原始内容',folder_id:folder.id,tags:['验收']})
  await api('/memos',{title:'测试便利贴-'+label,content:'保留分类与颜色',category:label,color:'blue'})
  await api('/todos',{list_id:list.id,title:'发布检查'})
  const table=await api('/tables',{name:'发布验收表-'+label,fields:[{name:'金额',type:'number'},{name:'凭证',type:'attachment'}]})
  await page.goto(base+`/todos/${list.id}`);await page.getByText('发布检查',{exact:true}).waitFor()
  await page.getByRole('button',{name:'设置截止',exact:true}).click();await page.locator('.el-popover:visible .el-date-editor input').first().click();await page.locator('.el-date-picker:visible').waitFor();assert.ok((await page.locator('.el-date-picker:visible').textContent()).includes('年'));await page.keyboard.press('Escape');await page.locator('.wb-topbar').click()
  await page.goto(base+`/notes/${folder.id}`);const body=page.getByPlaceholder('直接写内容，支持简单排版：# 大标题、- 列表、**加粗**',{exact:true});await body.waitFor();assert.equal(await body.inputValue(),'原始内容');await body.fill('优化后仍能自动保存的内容')
  await page.locator('.wb-sidebar').getByRole('button',{name:'翻译',exact:true}).click();await page.waitForURL('**/translate');assert.equal((await api('/notes/'+note.id,undefined,'GET')).content,'优化后仍能自动保存的内容')
  await page.getByRole('button',{name:'服务设置',exact:true}).click();await page.getByText('翻译服务设置',{exact:true}).waitFor();await page.keyboard.press('Escape')
  await page.goto(base+'/memos?category='+encodeURIComponent(label));await page.getByText('测试便利贴-'+label,{exact:true}).waitFor();assert.equal(await page.locator('.page-toolbar .el-select').count(),0)
  await page.goto(base+`/data/${table.id}`);await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'文件导入 / 导出',exact:true}).click();await page.getByRole('button',{name:'可视化',exact:true}).waitFor();assert.deepEqual(pdfRequests,[],'PDF engine must not load while opening an ordinary table')
  const csrf=(await context.cookies()).find(c=>c.name==='wb_csrf')?.value||''
  const upload=await context.request.post(base+'/api/v1/files',{headers:{'X-CSRF-Token':csrf},multipart:{file:{name:'release-preview.pdf',mimeType:'application/pdf',buffer:pdf()}}});assert.ok(upload.ok(),await upload.text());const file=await upload.json()
  await api(`/tables/${table.id}/records`,{data:{[table.fields[0].key]:'123.45',[table.fields[1].key]:file.id}})
  await page.reload();await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'文件导入 / 导出',exact:true}).click();await page.getByText('查看附件',{exact:true}).click();await page.getByText('第 1 / 1 页',{exact:true}).waitFor();await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="PDF 页面"]');return c&&c.style.width&&c.width>0&&c.height>0})
  assert.ok(pdfRequests.some(url=>/\/assets\/pdf-/.test(url)));assert.ok(pdfRequests.some(url=>/pdf\.worker/.test(url)))
  await page.getByRole('dialog',{name:'release-preview.pdf',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
  await page.goto(base+'/settings');await page.locator('.settings-nav').getByRole('button',{name:'回收站',exact:true}).click();await page.waitForURL('**/settings/trash');await page.getByText('回收站是空的',{exact:true}).waitFor()
  await page.goto(base+'/images');await page.getByText('把图片拖到这里，开始处理',{exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.deepEqual(errors,[])
  await fs.writeFile('../.run/release-ui-audit/audit.json',JSON.stringify({passed:true,checks:['Element Plus on-demand/Chinese locale/loading','todos date picker','note summaries and autosave','memo category routing','tables and attachments','PDF runtime and worker lazy loaded only on preview','settings/trash','image module','mobile'],browserErrors:errors},null,2))
  console.log('PASS: release UI, auto-imported components and locale, autosave, classified memos, table attachments, lazy PDF engine+worker, settings/trash, images and mobile; no Vue errors.')
}catch(error){await page.screenshot({path:'../.run/release-ui-audit/failure.png'});throw error}
finally{await browser.close()}
