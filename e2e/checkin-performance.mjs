import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
const page = await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const data={kind:'shop',period_type:'daily',period_start:'2026-10-28',period_end:'2026-10-29',statistics:{total:148,completed:0,rate:0},targets:[{id:1,name:'Test shop'}],groups:[{group_id:1,group_name:'Test group',sort_order:0,total:148,completed:0,items:Array.from({length:148},(_,i)=>({id:i+1,rule_id:i+1,target_id:1,target_name:'Test shop',group_id:1,group_name:'Test group',period_type:'daily',period_start:'2026-10-28',period_end:'2026-10-29',title:`Task ${i+1}`,description:'Task description',completed:false,completed_at:null,note:null,locked:false,lock_reason:null,version:1}))}]};
let listRequests=0;
await page.route('**/api/v1/**',async route=>{
 const req=route.request(), url=new URL(req.url());let body={};
 if(url.pathname.endsWith('/auth/me'))body={user:{id:1,username:'test',theme:'light'}};
 else if(url.pathname.endsWith('/tables'))body=[];
 else if(url.pathname.endsWith('/checkin-instances')){
  listRequests++;body=structuredClone(data);
  const status=url.searchParams.get('status');
  body.groups[0].items=body.groups[0].items.filter(i=>status==='done'?i.completed:status==='pending'?!i.completed:true);
  body.groups[0].total=body.groups[0].items.length;body.groups[0].completed=body.groups[0].items.filter(i=>i.completed).length;
 } else if(/checkin-instances\/\d+/.test(url.pathname)){
  const id=Number(url.pathname.match(/checkin-instances\/(\d+)/)[1]);body=data.groups[0].items.find(i=>i.id===id);
  if(req.method()==='PATCH')body.note=req.postDataJSON().note;
  else {body.completed=url.pathname.endsWith('/complete');body.completed_at=body.completed?new Date().toISOString():null;}
  body.version++;data.statistics.completed=data.groups[0].items.filter(i=>i.completed).length;data.statistics.rate=Math.round(data.statistics.completed/148*100);
 }
 await route.fulfill({json:body});
});
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:18743') + '/checkins/shops');
await page.locator('.checkin-row').last().waitFor();assert.equal(await page.locator('.checkin-row').count(),148);
const before=listRequests;
await page.locator('.checkin-row').nth(1).evaluate(el=>el.dataset.retained='yes');
let start=Date.now();
await page.locator('.checkin-row').first().locator('.el-checkbox').click();
await page.locator('.checkin-row.done').first().waitFor();
console.log('Complete and update 148-row list:',Date.now()-start,'ms');
assert.equal(listRequests,before,'Completing must not reload list');
assert.equal(await page.locator('.checkin-row').nth(1).getAttribute('data-retained'),'yes','Other rows must retain DOM');
await page.locator('.checkin-row').first().locator('.el-checkbox').click();
await page.waitForFunction(()=>!document.querySelector('.checkin-row.done'));
assert.equal(listRequests,before);
start=Date.now();await page.getByText('本周',{exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.el-loading-mask'));
console.log('Period switch:',Date.now()-start,'ms');
assert.equal(listRequests,before+1);
await page.locator('.checkin-row').first().getByRole('button',{name:'备注',exact:true}).click();
await page.locator('textarea:visible').fill('Regression note');
await page.getByRole('button',{name:'保存',exact:true}).click();
await page.locator('.checkin-row').first().getByText('· 备注：Regression note').waitFor();
assert.equal(listRequests,before+1,'Saving note must not reload list');
await page.locator('.page-toolbar .el-select').nth(1).click();await page.getByText('未完成',{exact:true}).click();
await page.waitForFunction(()=>!document.querySelector('.el-loading-mask'));
await page.locator('.checkin-row').first().locator('.el-checkbox').click();
await page.waitForFunction(()=>document.querySelectorAll('.checkin-row').length===147);
assert.deepEqual(errors,[]);
console.log('Complete/cancel, retained DOM, switching, notes, pending filter: PASS');
await browser.close();
