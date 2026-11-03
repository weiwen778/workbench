// Run against an isolated test database: creates notes and table fixtures.
import assert from 'node:assert/strict'
import {chromium} from './node_modules/playwright/index.mjs'
const base=process.env.WB_BASE||'http://127.0.0.1:18182'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'})
try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/login');await page.getByPlaceholder('请输入用户名').fill('admin');await page.getByPlaceholder('请输入密码').fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops');await page.waitForLoadState('networkidle')
 const api=(path,body,method='POST')=>page.evaluate(async({path,body,method})=>{const csrf=decodeURIComponent(document.cookie.match(/(?:^|; )wb_csrf=([^;]*)/)?.[1]||'');const result=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});if(!result.ok)throw Error(await result.text());return result.json()},{path,body,method})
 const sidebar=page.locator('.wb-sidebar');const before=(await sidebar.boundingBox()).width;const separator=page.getByRole('separator',{name:'调整侧边栏宽度'});await separator.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.ok((await sidebar.boundingBox()).width>before)
 let box=await separator.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+100);await page.mouse.down();await page.mouse.move(box.x+60,box.y+100,{steps:6});await page.mouse.up();const saved=(await sidebar.boundingBox()).width
 await page.reload();await page.waitForLoadState('networkidle');assert.ok(Math.abs((await sidebar.boundingBox()).width-saved)<2)
 await page.goto(base+'/translate');await page.waitForLoadState('networkidle');const favorite=page.locator('#translate-favorites');const initial=(await favorite.boundingBox()).width;const split=page.getByRole('separator',{name:'调整收藏和历史的宽度'});await split.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.ok((await favorite.boundingBox()).width>initial)
 console.log('PASS Element Plus Splitter: sidebar pointer/keyboard and persistence, translation splitter')
 const first=await api('/notes',{title:'笔记甲',content:'原内容甲'}),second=await api('/notes',{title:'笔记乙',content:'原内容乙'});
 await page.goto(base+'/notes/uncategorized');await page.locator('.note-item').filter({hasText:'笔记甲'}).click();await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent==='原内容甲'&&document.querySelector('.note-item.active')?.textContent.includes('笔记甲'));const editor=page.getByRole('textbox',{name:'笔记正文',exact:true});await editor.fill('# 新内容\n精确保存 Markdown');
 await page.waitForFunction(async(id)=>(await(await fetch('/api/v1/notes/'+id)).json()).content.includes('精确保存'),first.id)
 await editor.focus();await page.keyboard.press('Control+f');await page.locator('.cm-search').waitFor();await page.keyboard.press('Escape');
 await page.locator('.note-item').filter({hasText:'笔记乙'}).click();await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent==='原内容乙');await editor.focus();await page.keyboard.press('Control+z');assert.equal(await editor.innerText(),'原内容乙')
 await page.reload();await page.locator('.note-item').filter({hasText:'笔记甲'}).click();await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('精确保存')).catch(async e=>{console.log(await page.evaluate(async()=>({editor:document.querySelector('.cm-content')?.textContent,first:await(await fetch('/api/v1/notes/1')).json()})));throw e});assert.ok((await editor.innerText()).includes('精确保存'))
 console.log('PASS CodeMirror: Markdown, automatic save, native find, per-note undo isolation and reload')
 const table=await api('/tables',{name:'透视精度测试',fields:[{name:'店铺',type:'short_text'},{name:'月份',type:'short_text'},{name:'金额',type:'number'}]});const k=Object.fromEntries(table.fields.map(f=>[f.name,f.key]));
 for(const [shop,month,amount] of [['甲','一月','0.1'],['甲','一月','0.2'],['乙','二月','2']])await api(`/tables/${table.id}/records`,{data:{[k['店铺']]:shop,[k['月份']]:month,[k['金额']]:amount}})
 await page.goto(base+'/data/'+table.id);await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'汇总与透视',exact:true}).click();const dialog=page.getByRole('dialog',{name:'汇总与透视',exact:true});
 async function choose(index,name){const control=dialog.locator('.analysis-controls .el-select').nth(index);await control.locator('.el-select__wrapper').click();const id=await control.getByRole('combobox').getAttribute('aria-controls');await page.locator(`[id="${id}"]`).getByRole('option',{name,exact:true}).click();await page.waitForTimeout(200)}
 await choose(0,'店铺');await choose(1,'月份');await choose(2,'求和');await choose(3,'金额');
 await dialog.locator('.analysis-table canvas').first().waitFor();await page.waitForTimeout(300);assert.ok((await dialog.locator('.analysis-summary').textContent()).includes('2.3'))
 await page.screenshot({path:new URL('../.run/components-pivot.png',import.meta.url).pathname});
 const cell=await dialog.locator('.analysis-table').boundingBox();await page.mouse.click(cell.x+100,cell.y+80);await page.waitForTimeout(150);assert.ok((await dialog.locator('.el-pagination').textContent()).includes('2'))
 await dialog.locator('.el-dialog__headerbtn').click()
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/translate');await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 assert.deepEqual(errors,[]);console.log('PASS VTable PivotTable: complete source, Decimal totals, linked detail, mobile and no uncaught browser errors')
}finally{await browser.close()}