import {chromium} from './node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
const base='http://127.0.0.1:18192',browser=await chromium.launch({headless:true,executablePath:'/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/login');await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops')
 async function api(path,body){return page.evaluate(async({path,body})=>{const csrf=decodeURIComponent(document.cookie.match(/(?:^|; )wb_csrf=([^;]*)/)?.[1]||'');const r=await fetch('/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()},{path,body})}
 for(let i=1;i<=11;i++)await api('/tables',{name:'运营数据 '+String(i).padStart(2,'0'),fields:[]})
 const last=await api('/tables',{name:'蓝鲸国际站 · 年度客户跟进与销售转化分析',fields:[]})
 for(const name of ['工作记录','客户资料','项目复盘'])await api('/note-folders',{name})
 await api('/work-targets',{kind:'shop',name:'每日经营检查'})
 await page.goto(base+'/checkins')
 let side=page.locator('.wb-sidebar:visible');assert.equal(Math.round((await side.boundingBox()).width),256)
 // Labels go to a module immediately; expansion is an independent button.
 await side.getByRole('button',{name:'表格',exact:true}).click();await page.waitForURL('**/data');assert.equal(await side.getByRole('button',{name:'表格',exact:true}).getAttribute('aria-expanded'),'true')
 await side.getByRole('button',{name:'笔记',exact:true}).click();await page.waitForURL('**/notes');assert.equal(await side.getByRole('button',{name:'表格',exact:true}).getAttribute('aria-expanded'),'true');assert.equal(await side.getByRole('button',{name:'笔记',exact:true}).getAttribute('aria-expanded'),'true')
 await page.reload();await side.getByRole('button',{name:'笔记',exact:true}).waitFor();assert.equal(await side.getByRole('button',{name:'表格',exact:true}).getAttribute('aria-expanded'),'true')
 const current=side.locator('[aria-current="page"]');assert.equal(await current.count(),1,'only the current destination has a selected indicator')
 await side.getByRole('button',{name:'收起表格',exact:true}).click();assert.equal(new URL(page.url()).pathname,'/notes','collapse must not change route');await page.reload();await side.getByRole('button',{name:'展开表格',exact:true}).waitFor()
 await side.getByRole('button',{name:'展开表格',exact:true}).click();await side.getByRole('button',{name:/显示其余/}).click();await side.getByRole('button',{name:last.name,exact:true}).waitFor()
 await side.getByRole('textbox',{name:'查找导航项目'}).fill('蓝鲸');await side.getByRole('button',{name:last.name,exact:true}).click();await page.waitForURL('**/data/'+last.id);assert.equal(await side.getByRole('textbox',{name:'查找导航项目'}).inputValue(),'');assert.equal(await side.getByRole('button',{name:last.name,exact:true}).getAttribute('aria-current'),'page')
 // Search must include items beyond the initial displayed subset, even after reload.
 await page.reload();await side.getByRole('textbox',{name:'查找导航项目'}).fill('蓝鲸');await side.getByRole('button',{name:last.name,exact:true}).waitFor();await side.getByRole('textbox',{name:'查找导航项目'}).press('Escape')
 // Create remains a direct, keyboard-accessible header action.
 await side.getByRole('button',{name:'新建文件夹',exact:true}).click();const prompt=page.getByRole('dialog',{name:'新建文件夹',exact:true});await prompt.waitFor();await prompt.getByRole('button',{name:'取消',exact:true}).click();await prompt.waitFor({state:'hidden'})
 await side.getByRole('button',{name:'笔记',exact:true}).click();await page.waitForURL('**/notes');for(const label of ['打卡','表格']){const collapse=side.getByRole('button',{name:'收起'+label,exact:true});if(await collapse.count())await collapse.click()}await page.mouse.move(800,10);await side.screenshot({path:'.run/sidebar-usability-light.png',animations:'disabled'})
 await page.evaluate(()=>document.documentElement.classList.add('dark'));await side.screenshot({path:'.run/sidebar-usability-dark.png',animations:'disabled'});await page.evaluate(()=>document.documentElement.classList.remove('dark'))
 // Desktop remains available on common 1100px laptop windows.
 await page.setViewportSize({width:1100,height:800});assert(await side.isVisible());await side.getByRole('button',{name:'收起侧栏',exact:true}).click();await page.getByTitle('展开侧栏',{exact:true}).click();await side.waitFor()
 // Phone drawer fills its available width, keeps fixed actions reachable, closes after navigation.
 await page.setViewportSize({width:390,height:760});await page.getByRole('button',{name:'打开导航',exact:true}).click();side=page.locator('.wb-sidebar:visible');await side.waitFor();const box=await side.boundingBox();assert(box.width>=270&&box.width<=366, 'mobile sidebar width: '+box.width);await side.screenshot({path:'.run/sidebar-usability-mobile.png',animations:'disabled'});await side.getByRole('button',{name:'翻译',exact:true}).click();await page.waitForURL('**/translate');await side.waitFor({state:'hidden'})
 assert.deepEqual(errors,[]);console.log('PASS: direct module navigation, independent expand/collapse, multiple persisted groups, single selected destination, all-item search and clear, long labels, show-more, create prompt, 256px desktop, 1100px laptop, collapse/expand, mobile drawer and navigation, light/dark screenshots')
}catch(e){await browser.contexts()[0]?.pages()[0]?.screenshot({path:'.run/sidebar-usability-failure.png',animations:'disabled'});throw e}finally{await browser.close()}