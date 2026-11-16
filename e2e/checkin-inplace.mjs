import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
const base=process.env.WB_BASE || 'http://127.0.0.1:18747'
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)&&['18746','18747'].includes(new URL(base).port))
const output=process.env.WB_OUTPUT || '../.run/checkin-inplace-e2e';await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined})
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
async function api(path,data,method='POST') {const csrf=(await context.cookies()).find(c=>c.name==='wb_csrf')?.value||'';const r=await context.request.fetch(base+'/api/v1'+path,{method,headers:{'X-CSRF-Token':csrf},data});assert.ok(r.ok(),await r.text());return r.json()}
const row=id=>page.locator(`.checkin-row[data-instance-id="${id}"]`)
async function waitFor(test,message) {for(let i=0;i<80;i++){if(await test())return;await page.waitForTimeout(25)}throw new Error(message)}
async function expectCounts(kind='shop',period='daily',status='all') {const data=await api(`/checkin-instances?kind=${kind}&period=${period}&status=${status}`,undefined,'GET');assert.equal(Number(await page.locator('.page-toolbar b').textContent()),data.statistics.completed);return data}
async function filterStatus(name) {await page.locator('.page-toolbar .el-select').nth(1).click();const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/checkin-instances'&&r.request().method()==='GET');await page.getByRole('option',{name,exact:true}).click();await response;await page.waitForTimeout(50)}
try {
 await page.goto(base+'/login');await page.getByPlaceholder('请输入用户名').fill('admin');await page.getByPlaceholder('请输入密码').fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops')
 const name='无闪动-'+Date.now(),group=await api('/checkin-groups',{name}),shop=await api('/work-targets',{kind:'shop',name}),social=await api('/work-targets',{kind:'social',name:name+'社媒'})
 for(let i=0;i<30;i++)await api(`/work-targets/${shop.id}/rules`,{group_id:group.id,title:'日常检查'+i,period:'daily'})
 await api(`/work-targets/${shop.id}/rules`,{group_id:group.id,title:'每周检查',period:'weekly'})
 await api(`/work-targets/${shop.id}/rules`,{group_id:group.id,title:'每月检查',period:'monthly'})
 await api(`/work-targets/${social.id}/rules`,{group_id:group.id,title:'社媒发布',period:'daily'})
 await page.reload();await page.getByText('日常检查18',{exact:true}).first().waitFor();await page.locator('.page-toolbar .el-select').first().click();await page.getByRole('option',{name,exact:true}).click();await page.waitForTimeout(100)
 const data=await expectCounts(),items=data.groups.find(g=>g.group_id===group.id).items,main=items[18],other=items[19],failed=items[17]
 const scroll=page.locator('.page-body > .scroll-area');await scroll.evaluate(el=>el.scrollTop=500)
 await row(other.id).getByRole('button',{name:'备注',exact:true}).click()
 const note=page.locator('.el-popover:visible textarea');await note.fill('尚未保存的备注草稿')
 await page.evaluate(id=>{
  window.listNode=document.querySelector('.page-body > .scroll-area');window.rowNode=document.querySelector(`[data-instance-id="${id}"]`);window.scrollBefore=window.listNode.scrollTop;window.listRemoved=false;window.loadingShown=false
  window.checkinObserver=new MutationObserver(()=>{if(!window.listNode.isConnected)window.listRemoved=true;if(document.querySelector('.page-body .empty-hint')?.textContent.includes('加载中'))window.loadingShown=true})
  window.checkinObserver.observe(document.querySelector('.page-body'),{childList:true,subtree:true})
 },other.id)
 let delayedGets=0
 await page.route('**/api/v1/checkin-instances?*',async r=>{delayedGets++;const response=await r.fetch();await page.waitForTimeout(300);await r.fulfill({response})})
 await row(main.id).locator('.el-checkbox').click();await waitFor(()=>row(main.id).getAttribute('class').then(c=>c.includes('done')),'Completed row did not update')
 const stable=await page.evaluate(id=>({sameList:window.listNode===document.querySelector('.page-body > .scroll-area'),sameOtherRow:window.rowNode===document.querySelector(`[data-instance-id="${id}"]`),listRemoved:window.listRemoved,loadingShown:window.loadingShown,scrollBefore:window.scrollBefore,scrollAfter:window.listNode.scrollTop}),other.id)
 assert.equal(stable.sameList,true);assert.equal(stable.sameOtherRow,true);assert.equal(stable.listRemoved,false);assert.equal(stable.loadingShown,false);assert.ok(Math.abs(stable.scrollAfter-stable.scrollBefore)<2,JSON.stringify(stable));await row(other.id).getByRole('button',{name:'备注',exact:true}).click();assert.equal(await note.inputValue(),'尚未保存的备注草稿')
 await page.locator('.el-popover:visible').getByRole('button',{name:'保存',exact:true}).click();await row(other.id).getByText('· 备注：尚未保存的备注草稿',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.listRemoved),false)
 await page.unroute('**/api/v1/checkin-instances?*');await expectCounts()
 await row(main.id).locator('.el-checkbox').click();await waitFor(async()=>!(await row(main.id).getAttribute('class')).includes('done'),'Cancel completion did not update');await expectCounts()
 // A failed write must restore only its checkbox and leave neighbouring content intact.
 const failure=`**/api/v1/checkin-instances/${failed.id}/complete`
 await page.route(failure,r=>r.fulfill({status:500,json:{code:'TEST_ERROR',message:'测试：打卡保存失败'}}))
 await row(failed.id).locator('.el-checkbox').click();await page.getByText('测试：打卡保存失败',{exact:true}).waitFor();await waitFor(async()=>!await row(failed.id).locator('input').isDisabled(),'Failed checkbox stayed disabled')
 assert.equal(await row(failed.id).locator('input').isChecked(),false);assert.equal(await page.evaluate(()=>window.listRemoved),false);await page.unroute(failure)
 // Two different rows can save concurrently; neither may unlock the other.
 let writes=0
 const slow=`**/api/v1/checkin-instances/${main.id}/complete`
 await page.route(slow,async r=>{writes++;await page.waitForTimeout(500);await r.continue()})
 await row(main.id).locator('.el-checkbox').click();await row(other.id).locator('.el-checkbox').click();assert.equal(await row(main.id).locator('input').isDisabled(),true)
 await row(main.id).locator('input').evaluate(el=>el.click());await waitFor(()=>row(main.id).getAttribute('class').then(c=>c.includes('done')),'Slow completion did not finish');assert.equal(writes,1);await page.unroute(slow);await expectCounts()
 await filterStatus('未完成');const pendingItem=items[0];await row(pendingItem.id).locator('.el-checkbox').click();await row(pendingItem.id).waitFor({state:'detached'});await expectCounts('shop','daily','pending')
 await filterStatus('已完成');await row(main.id).locator('.el-checkbox').click();await row(main.id).waitFor({state:'detached'});await expectCounts('shop','daily','done')
 await filterStatus('全部')
 // A slower old period response must not overwrite the latest selection.
 await page.route('**/api/v1/checkin-instances?*',async r=>{if(new URL(r.request().url()).searchParams.get('period')==='weekly'){const response=await r.fetch();await page.waitForTimeout(500);await r.fulfill({response})}else await r.continue()})
 await page.getByText('本周',{exact:true}).click();await page.getByText('本月',{exact:true}).click();await page.getByText('每月检查',{exact:true}).waitFor();await page.waitForTimeout(600);assert.equal(await page.getByText('每周检查',{exact:true}).count(),0);await page.unroute('**/api/v1/checkin-instances?*')
 const side=page.locator('.wb-sidebar');await side.getByRole('button',{name:'打卡',exact:true}).click();await side.getByRole('button',{name:'社媒打卡',exact:true}).click();await page.waitForURL('**/checkins/social');await page.getByText('社媒发布',{exact:true}).first().waitFor()
 const socialData=await expectCounts('social'),sid=socialData.groups.find(g=>g.group_id===group.id).items[0].id
 await page.setViewportSize({width:390,height:844});await row(sid).locator('.el-checkbox').click();await waitFor(()=>row(sid).getAttribute('class').then(c=>c.includes('done')),'Mobile social completion did not update');await expectCounts('social')
 await page.screenshot({path:output+'/checkin-mobile.png'});assert.deepEqual(errors,[])
 await fs.writeFile(output+'/result.json',JSON.stringify({passed:true,stable,delayedGets,writes,pageErrors:errors,checks:['DOM identity','scroll preservation','open note draft','note save','cancel','write failure','concurrent rows','duplicate guard','pending/done filters','latest period response','mobile social checkin']},null,2))
 console.log('PASS: check-in completion/cancel/note save preserve list DOM, scroll and draft; failure, concurrency, filters, response ordering and mobile social checks passed.')
} catch(error) {await page.screenshot({path:output+'/failure.png',fullPage:true});throw error}
finally {await browser.close()}
