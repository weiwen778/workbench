// Live Flash upload; subsequent paste/confirmation are mocked. No business rows are added.
import {chromium} from './node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const env=Object.fromEntries((await fs.readFile(new URL('../server/.env',import.meta.url),'utf8')).split('\n').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const browser=await chromium.launch({headless:true,executablePath:'/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'});
try{
const page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:18080/login');await page.getByLabel('用户名',{exact:true}).fill(env.WB_ADMIN_USERNAME);await page.getByLabel('密码',{exact:true}).fill(env.WB_ADMIN_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('login'));

const table=await page.evaluate(async()=>await(await fetch('/api/v1/tables/7')).json());const before=table.record_count;
assert.equal(await page.getByRole('button',{name:'统一搜索',exact:true}).textContent(),'');assert.equal(await page.getByRole('button',{name:'任务中心',exact:true}).textContent(),'');
await page.goto('http://127.0.0.1:18080/data/7');await page.getByRole('button',{name:'更多操作',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'更多操作',exact:true}).locator('svg').count(),1);
await page.getByRole('button',{name:'AI 图片填表',exact:true}).click();const dialog=page.getByRole('dialog',{name:'AI 图片填表',exact:true});await dialog.locator('.ai-model').getByText('GLM-4V-Flash',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'开始识别'}).count(),0);assert.equal(await dialog.getByRole('combobox',{name:'识别模型'}).count(),0);await page.screenshot({path:new URL('../.run/ai-redesign-empty.png',import.meta.url).pathname});
const response=page.waitForResponse(r=>r.url().endsWith('/tables/7/ai/extract'));await dialog.locator('input[type=file]').setInputFiles(new URL('./fixtures/ai-table-sample.png',import.meta.url).pathname);const data=await(await response).json();assert.equal(data.results.length,1);assert.equal(data.results[0].model,'glm-4v-flash');assert(!data.results[0].error,JSON.stringify(data.results));await dialog.locator('.ai-fields').waitFor();assert.equal(await dialog.locator('.ai-fields input').first().inputValue(),'张三');await page.screenshot({path:new URL('../.run/ai-redesign-result.png',import.meta.url).pathname});
await page.keyboard.press('Control+k');assert.equal(new URL(page.url()).pathname,'/data/7');
let confirmed;
await page.route('**/ai/drafts/*/confirm',async route=>{confirmed=route.request().postDataJSON();await route.fulfill({json:{record_ids:[99999],already_applied:false}})});
await page.keyboard.press('Control+Enter');await dialog.waitFor({state:'hidden'});assert.equal(confirmed.records.length,1);
let requests=0;
await page.route('**/tables/7/ai/extract',async route=>{requests++;assert(route.request().postData().includes('glm-4v-flash'));await route.fulfill({json:data})});
const image=(await fs.readFile(new URL('./fixtures/ai-table-sample.png',import.meta.url))).toString('base64');
async function paste(){await page.evaluate(image=>{const raw=Uint8Array.from(atob(image),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([raw],'pasted.png',{type:'image/png'}));document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))},image)}
await page.getByRole('button',{name:'AI 图片填表',exact:true}).click();await dialog.waitFor();await paste();await dialog.locator('.ai-fields').waitFor();assert.equal(requests,1,'paste anywhere must auto recognize exactly once');
await page.keyboard.press('Escape');const box=page.getByRole('dialog',{name:'关闭识别结果',exact:true});await box.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});await paste();assert.equal(requests,1,'listener must be removed after close');
await page.keyboard.press('Control+k');await page.waitForURL('**/search');
await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:18080/data/7');await page.getByRole('button',{name:'AI 图片填表',exact:true}).click();await paste();await dialog.locator('.ai-fields').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const footer=await dialog.getByRole('button',{name:'确认新增 1 条记录'}).boundingBox();assert(footer.y+footer.height<844,'confirm button stays visible on mobile');await page.screenshot({path:new URL('../.run/ai-redesign-mobile.png',import.meta.url).pathname});
const after=await page.evaluate(async()=>await(await fetch('/api/v1/tables/7')).json());assert.equal(after.record_count,before);assert.deepEqual(errors,[]);console.log('PASS icon-only header, SVG chevron, Flash default, upload auto recognize, global image paste auto recognize, Ctrl+Enter, Esc, hotkey isolation and cleanup, mobile, no rows written');
}finally{await browser.close()}
