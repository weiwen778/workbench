import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage();const calls=[];const errors=[];
page.on('pageerror',e=>errors.push(e.message));let configured=true;
await page.route('**/api/v1/**',async route=>{
 const url=new URL(route.request().url());let body={};
 if(url.pathname.endsWith('/auth/me'))body={user:{id:1,username:'test',theme:'light'}};
 else if(url.pathname.endsWith('/tables'))body=[];
 else if(url.pathname.endsWith('/translation-connections'))body={credential_key_ready:true,items:[{provider:'baidu',name:'百度翻译',configured,enabled:configured,limits:{unit:'byte',value:6000},masked:{}}]};
 else if(url.pathname.endsWith('/translation-history'))body={items:[],total:0};
 else if(url.pathname.endsWith('/translations')){
   const payload=route.request().postDataJSON();calls.push(payload);
   if(payload.source_text==='slow')await new Promise(r=>setTimeout(r,1600));
   body={...payload,target_text:'Translated: '+payload.source_text,provider_name:'百度翻译',duration_ms:10};
 }
 try{await route.fulfill({json:body})}catch{}
});
const base=process.env.BASE_URL||'http://127.0.0.1:18743';
await page.goto(base+'/translate');
const source=page.locator('.translate-workbench textarea');const toggle=page.locator('.page-toolbar .el-switch');
await toggle.waitFor();assert.equal(await toggle.locator('input').getAttribute('aria-checked'),'true');
await source.fill('hello');await page.waitForTimeout(300);await source.fill('hello world');await page.waitForTimeout(300);assert.equal(calls.length,0);
await page.getByText('Translated: hello world',{exact:true}).waitFor();assert.equal(calls.length,1);
await source.fill('manual');await page.getByRole('button',{name:'翻译',exact:true}).click();await page.getByText('Translated: manual',{exact:true}).waitFor();await page.waitForTimeout(950);assert.equal(calls.length,2,'manual click must cancel pending auto request');
await source.dispatchEvent('compositionstart');await source.fill('正在输入');await page.waitForTimeout(950);assert.equal(calls.length,2);
await source.dispatchEvent('compositionend');await page.getByText('Translated: 正在输入',{exact:true}).waitFor();assert.equal(calls.length,3);
await source.fill('slow');await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('正在翻译'));
await source.fill('new text');await page.getByText('Translated: new text',{exact:true}).waitFor();await page.waitForTimeout(900);assert.equal(await page.locator('.result-text').innerText(),'Translated: new text');
await source.fill('clear before request');const count=calls.length;await page.getByRole('button',{name:'清空原文',exact:true}).click();await page.waitForTimeout(950);assert.equal(calls.length,count);assert.equal(await page.locator('.result-text').count(),0);
await source.fill('a'.repeat(6001));await page.waitForTimeout(950);assert.equal(calls.length,count);await page.getByText('内容超出上限，已暂停自动翻译',{exact:true}).waitFor();
await toggle.click();await source.fill('disabled text');await page.waitForTimeout(950);assert.equal(calls.length,count);
await page.reload();await toggle.waitFor();assert.equal(await toggle.locator('input').getAttribute('aria-checked'),'false');
await toggle.click();await source.fill('language change');await page.getByText('Translated: language change',{exact:true}).waitFor();
const langCount=calls.length;await page.locator('.page-toolbar .el-select').nth(2).click();await page.getByRole('option',{name:'中文',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('正在翻译')||document.querySelector('.result-text')!==null);await page.getByText('Translated: language change',{exact:true}).waitFor();assert.equal(calls.length,langCount+1);assert.equal(calls.at(-1).target_lang,'zh');
configured=false;await page.reload();await source.fill('no config');const noConfigCount=calls.length;await page.waitForTimeout(950);assert.equal(calls.length,noConfigCount);await page.getByText('请先配置并启用翻译服务',{exact:true}).waitFor();
assert.deepEqual(errors,[]);console.log('PASS: debounce, manual deduplication, IME, stale responses, clear, limit, switch persistence, language change, unconfigured service');
await browser.close();
