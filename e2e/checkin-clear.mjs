import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try {
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
let deleted=false,requests=0;
await page.route('**/api/v1/**',async route=>{
 const url=new URL(route.request().url());let body={};let status=200;
 if(url.pathname.endsWith('/auth/me'))body={user:{id:1,username:'test',theme:'light'}};
 else if(['/tables','/work-targets','/checkin-groups'].some(path=>url.pathname.endsWith(path)))body=[];
 else if(url.pathname.endsWith('/checkin-instances'))body={period_start:'2026-10-28',period_end:'2026-10-29',statistics:{total:deleted?0:1,completed:0,rate:deleted?null:0},targets:deleted?[]:[{id:1,name:'Test shop'}],groups:deleted?[]:[{group_id:1,group_name:'Group',total:1,completed:0,items:[{id:1,target_name:'Test shop',title:'Test task',completed:false,version:1}]}]};
 else if(url.pathname.endsWith('/checkin-data/summary'))body={shops:1,social_accounts:1,groups:1,rules:2,instances:4};
 else if(url.pathname.endsWith('/checkin-data/clear')){
  requests++;const input=route.request().postDataJSON();assert.equal(input.confirmation,'删除全部打卡内容');
  if(input.password==='correct-password'){deleted=true;body={ok:true,deleted:{targets:2,rules:2,instances:4,groups:1}}}
  else {status=403;body={code:'PASSWORD_MISMATCH',message:'当前登录密码不正确，未删除任何打卡内容'}}
 }
 await route.fulfill({status,json:body});
});
await page.goto((process.env.BASE_URL||'http://127.0.0.1:18743')+'/checkins/shops');
await page.locator('.checkin-row').waitFor();
assert.equal(await page.locator('.page-toolbar').getByRole('button',{name:'删除全部打卡内容',exact:true}).count(),0);
await page.locator('.page-toolbar').getByRole('button',{name:'管理店铺',exact:true}).click();
const drawer=page.getByRole('dialog',{name:'店铺与分类',exact:true});
await drawer.waitFor();
const open=drawer.getByRole('button',{name:'删除全部打卡内容',exact:true});
assert.equal(await open.isVisible(),false);
await drawer.locator('summary').filter({hasText:'高级操作'}).click();
await open.click();
const dialog=page.getByRole('dialog',{name:'删除全部打卡内容',exact:true});await dialog.waitFor();
await dialog.getByText(/当前共有 1 个店铺/).waitFor();
const submit=dialog.getByRole('button',{name:'验证密码并删除全部',exact:true});
assert.equal(await submit.isDisabled(),true);
const password=dialog.getByPlaceholder('输入当前登录账号的密码');
await password.fill('wrong');await password.press('Enter');assert.equal(requests,0,'Enter without confirmation must not submit');
await dialog.getByText('我确认永久删除全部店铺和社媒的打卡内容',{exact:true}).click();
await submit.click();await dialog.getByRole('alert').filter({hasText:'当前登录密码不正确'}).waitFor();
assert.equal(await password.inputValue(),'');assert.equal(deleted,false);assert.equal(await page.locator('.checkin-row').count(),1);
await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});
await open.click();await dialog.waitFor();assert.equal(await password.inputValue(),'');assert.equal(await submit.isDisabled(),true);
await password.fill('correct-password');await dialog.getByText('我确认永久删除全部店铺和社媒的打卡内容',{exact:true}).click();await submit.click();
await dialog.waitFor({state:'hidden'});await page.getByText('全部打卡内容已删除',{exact:true}).waitFor();
assert.equal(deleted,true);assert.equal(requests,2);assert.equal(await page.locator('.checkin-row').count(),0);
assert.deepEqual(errors,[]);console.log('PASS: summary, confirmation required, wrong password preserves rows, password cleanup, cancel, successful reset clears UI (mock data only)');
} finally {await browser.close()}
