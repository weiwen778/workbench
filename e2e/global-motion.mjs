import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
const base=process.env.WB_BASE || 'http://127.0.0.1:18747'
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))
assert.ok(['18746','18747'].includes(new URL(base).port),'Use an isolated test service')
const output=process.env.WB_OUTPUT || '../.run/global-motion-e2e';await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined})
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'})
const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000)
page.on('pageerror',e=>errors.push(e.message))
await page.addInitScript(()=>{
 window.motionEvents=[]
 document.addEventListener('animationstart',e=>window.motionEvents.push({name:e.animationName,className:e.target.className}))
})
async function api(path,data,method='POST') {
 const csrf=(await context.cookies()).find(c=>c.name==='wb_csrf')?.value || ''
 const r=await context.request.fetch(base+'/api/v1'+path,{method,headers:{'X-CSRF-Token':csrf},data})
 assert.ok(r.ok(),await r.text());return r.json()
}
async function until(test,message) {for(let i=0;i<80;i++){if(await test())return;await page.waitForTimeout(25)}throw new Error(message)}
async function show(side,name) {const b=side.getByRole('button',{name,exact:true});if(await b.getAttribute('aria-expanded')!=='true')await b.click()}
const check=(title)=>page.locator('.task-block').filter({has:page.getByText(title,{exact:true})}).locator('input[type=checkbox]').first()
try {
 await page.goto(base+'/login');await page.getByPlaceholder('请输入用户名').fill('admin');await page.getByPlaceholder('请输入密码').fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops')
 const label='动效验收-'+Date.now(),list=await api('/todo-lists',{name:label})
 const tasks=[];for(const title of ['保存失败保留','完成一次','减少动态效果','快速离开'])tasks.push(await api('/todos',{list_id:list.id,title}))
 const parent=await api('/todos',{list_id:list.id,title:'含子任务'})
 const child=await api('/todos',{list_id:list.id,parent_id:parent.id,title:'完成子任务'})
 await page.goto(base+`/todos/${list.id}`);await page.getByText('完成一次',{exact:true}).waitFor()
 const side=page.locator('.wb-sidebar')
 assert.equal(await side.locator('button[aria-expanded=true]').count(),0)
 const heights=await page.evaluate(async()=>{
  const side=document.querySelector('.wb-sidebar'),button=[...side.querySelectorAll('button')].find(b=>b.textContent.trim()==='打卡'),panel=button.nextElementSibling
  const closed=panel.getBoundingClientRect().height,values=[];button.click();const start=performance.now()
  while(performance.now()-start<240){await new Promise(requestAnimationFrame);values.push(panel.getBoundingClientRect().height)}
  return {closed,values,final:panel.getBoundingClientRect().height,inert:panel.inert}
 })
 assert.equal(heights.closed,0);assert.ok(heights.final>30);assert.ok(heights.values.some(h=>h>0&&h<heights.final-1),'Accordion must have intermediate heights');assert.equal(heights.inert,false)
 await show(side,'待办');await page.waitForTimeout(220)
 assert.equal(await side.locator('button[aria-expanded=true]').count(),1)
 assert.equal(await side.locator('.wb-nav-collapse:not(.open):not([inert])').count(),0)
 await side.getByRole('button',{name:'新建清单',exact:true}).click();const dialog=page.getByRole('dialog',{name:'新建清单',exact:true});await dialog.waitFor()
 await until(()=>page.evaluate(()=>window.motionEvents.some(e=>e.name==='wb-dialog-in')),'Dialog should animate')
 await dialog.getByRole('textbox').fill('取消创建');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
 assert.equal((await api('/todo-lists',undefined,'GET')).some(x=>x.name==='取消创建'),false)
 const fail='**/api/v1/todos/'+tasks[0].id+'/complete'
 await page.route(fail,r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'TEST_ERROR',message:'测试：完成失败'})}))
 await check('保存失败保留').locator('xpath=ancestor::label').click();await page.getByText('测试：完成失败',{exact:true}).waitFor()
 await until(async()=>!await check('保存失败保留').isDisabled(),'Failed completion must unlock')
 assert.equal(await check('保存失败保留').isChecked(),false);assert.equal(await page.locator('.task-block.is-completing').count(),0)
 await page.unroute(fail)
 let writes=0
 const success='**/api/v1/todos/'+tasks[1].id+'/complete'
 await page.route(success,async r=>{writes++;await page.waitForTimeout(100);await r.continue()})
 await check('完成一次').locator('xpath=ancestor::label').click();await until(()=>page.locator('.task-block.is-completing').count(),'Successful write must show completion feedback')
 await page.evaluate(()=>document.querySelector('.task-block.is-completing input').click())
 await page.locator('.completed-block').getByText('完成一次',{exact:true}).waitFor();assert.equal(writes,1)
 await page.unroute(success)
 // Server confirmation also drives child completion and parent aggregation.
 const childRow=page.locator('.subtask-row').filter({has:page.getByText('完成子任务',{exact:true})})
 await childRow.locator('.el-checkbox').click();await page.locator('.completed-block').getByText('含子任务',{exact:true}).waitFor()
 await page.locator('.completed-block .task-row').filter({has:page.getByText('完成一次',{exact:true})}).locator('.el-checkbox').first().click()
 await check('完成一次').waitFor({state:'attached'});assert.equal(await check('完成一次').isChecked(),false)
 // Removing a row and leaving during its feedback must not schedule an old view reload.
 let afterLeaveReads=0,left=false
 page.on('request',r=>{if(left&&r.method()==='GET'&&new URL(r.url()).pathname==='/api/v1/todos')afterLeaveReads++})
 await check('快速离开').locator('xpath=ancestor::label').click();await until(()=>page.locator('.task-block.is-completing').count(),'Completion feedback before leaving')
 left=true;await side.getByRole('button',{name:'图片处理',exact:true}).click();await page.waitForURL('**/images');await page.waitForTimeout(300)
 assert.equal(afterLeaveReads,0);left=false
 await page.goto(base+`/todos/${list.id}`);await check('减少动态效果').waitFor({state:'attached'})
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await check('减少动态效果').waitFor({state:'attached'})
 const reduced=await page.locator('.wb-route-frame').evaluate(el=>({animation:getComputedStyle(el).animationName,duration:getComputedStyle(document.documentElement).getPropertyValue('--wb-motion-duration').trim()}))
 assert.equal(reduced.animation,'none');assert.equal(reduced.duration,'0s')
 const timings=[];page.on('request',r=>{if(r.method()==='GET'&&new URL(r.url()).pathname==='/api/v1/todos')timings.push(performance.now())})
 const response=page.waitForResponse(r=>r.url().endsWith(`/todos/${tasks[2].id}/complete`)&&r.request().method()==='POST')
 await check('减少动态效果').locator('xpath=ancestor::label').click();await response;const confirmed=performance.now()
 await page.locator('.completed-block').getByText('减少动态效果',{exact:true}).waitFor()
 assert.ok(timings.some(t=>t-confirmed<140),'Reduced motion must skip the completion pause')
 await page.emulateMedia({reducedMotion:'no-preference'})
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click()
 const drawer=page.locator('.el-drawer:visible');await show(drawer,'笔记');await page.waitForTimeout(200);assert.equal(await drawer.locator('button[aria-expanded=true]').count(),1)
 await show(drawer,'待办');await page.waitForTimeout(200);assert.equal(await drawer.locator('button[aria-expanded=true]').count(),1)
 await page.screenshot({path:output+'/motion-mobile.png'})
 await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});await page.reload();await check('完成一次').waitFor({state:'attached'})
 await page.getByRole('button',{name:'打开导航',exact:true}).click();assert.equal(await page.locator('.el-drawer:visible button[aria-expanded=true]').count(),0)
 await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});await side.waitFor()
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();const icons=page.locator('.wb-iconbar')
 await icons.locator('[title=打卡]').click();await page.locator('.el-popover:visible').waitFor()
 await icons.locator('[title=待办]').click();await page.waitForTimeout(240);assert.equal(await page.locator('.el-popover:visible').count(),1)
 await page.locator('.el-popover:visible').getByRole('button',{name:new RegExp(label)}).click();await page.waitForTimeout(200);assert.equal(await page.locator('.el-popover:visible').count(),0)
 await icons.locator('[title=展开侧栏]').click();await side.waitFor();await show(side,'待办')
 await page.screenshot({path:output+'/motion-desktop.png'})
 assert.equal(errors.length,0,errors.join('\n'))
 assert.ok(await page.evaluate(()=>window.motionEvents.some(e=>e.name==='wb-page-in')))
 await fs.writeFile(output+'/result.json',JSON.stringify({passed:true,accordionIntermediateHeights:heights.values.length,reducedMotion:reduced,duplicateWrites:writes,pageErrors:errors,checks:['accordion','dialog','failure preservation','single completion','child aggregation','undo completion','navigation cleanup','reduced motion','mobile','popover exclusivity']},null,2))
 console.log('PASS: accordion, dialogs, failed/successful/duplicate/child todo completion, navigation cancellation, reduced motion, mobile, refresh collapse and icon popovers.')
} catch(error) {await page.screenshot({path:output+'/failure.png',fullPage:true});throw error}
finally {await browser.close()}
