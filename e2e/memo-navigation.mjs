import { showNavGroup } from './navigation.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('../.run/memo-navigation-e2e',{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined})
const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
// Use a fresh isolated test database: this test creates, moves, deletes and restores memos.
const base=process.env.WB_BASE || 'http://127.0.0.1:18746'
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
const special='客服 / 供应商 & 合作?#%'
const side=page.locator('.wb-sidebar'),cards=page.locator('.memo-card')
async function api(path,data,method='POST'){const csrf=(await context.cookies()).find(c=>c.name==='wb_csrf')?.value;const response=await context.request.fetch(base+'/api/v1'+path,{method,headers:{'X-CSRF-Token':csrf||''},data});assert.ok(response.ok(),await response.text());return response.json()}
async function category(name,root=side){if (!await root.getAttribute('class').then(c=>c?.includes('el-popover'))) await showNavGroup(root,'便利贴');await root.getByRole('button',{name:'便利贴分类：'+name,exact:true}).click();await page.waitForURL(url=>url.pathname==='/memos'&&url.searchParams.get('category')===name)}
try{
  await page.goto(base+'/login');await page.getByPlaceholder('请输入用户名').fill('admin');await page.getByPlaceholder('请输入密码').fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops')
  await api('/memos',{title:'巡店要点',content:'检查库存和投放',category:'运营要点',color:'blue'})
  const movable=await api('/memos',{title:'供应商联系人',content:'明天确认报价',category:special,color:'green'})
  await api('/memos',{title:'临时号码',content:'未分类内容',color:'yellow'})
  await api('/memos',{title:'恢复分类用',content:'还原后分类要出现',category:'需恢复分类',color:'purple'})
  await page.reload();await showNavGroup(side,'便利贴');await side.getByRole('button',{name:'便利贴分类：运营要点',exact:true}).waitFor()
  await category('运营要点');await cards.getByText('巡店要点',{exact:true}).waitFor();assert.equal(await cards.count(),1)
  assert.equal(await page.locator('.page-toolbar .el-select').count(),0)
  await page.reload();await showNavGroup(side,'便利贴');await cards.getByText('巡店要点',{exact:true}).waitFor();assert.ok((await side.getByRole('button',{name:'便利贴分类：运营要点',exact:true}).getAttribute('class')).includes('active'))
  await page.getByRole('button',{name:'新建便利贴',exact:true}).click();let dialog=page.getByRole('dialog',{name:'新建便利贴',exact:true})
  await dialog.getByPlaceholder('不填则显示为无标题便利贴').fill('当前分类新建')
  await dialog.getByPlaceholder('随手记内容，Ctrl / Command + Enter 保存').fill('默认归入运营要点')
  const created=page.waitForResponse(r=>r.url().endsWith('/api/v1/memos')&&r.request().method()==='POST')
  await dialog.getByRole('button',{name:'保存',exact:true}).click();assert.equal((await(await created).json()).category,'运营要点')
  await cards.getByText('当前分类新建',{exact:true}).waitFor();assert.equal(await cards.count(),2)
  await page.getByPlaceholder('搜索标题或正文').fill('库存');await page.waitForFunction(()=>document.querySelectorAll('.memo-card').length===1)
  await category(special);await cards.getByText('供应商联系人',{exact:true}).waitFor();assert.equal(await page.title(),special+' · 个人工作台')
  await cards.getByTitle('编辑',{exact:true}).click();dialog=page.getByRole('dialog',{name:'编辑便利贴',exact:true})
  await dialog.locator('.el-select').hover();await dialog.locator('.el-select__clear').click()
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('还没有便利贴',{exact:true}).waitFor()
  const moved=(await api('/memos?category=__uncategorized__',undefined,'GET')).find(m=>m.id===movable.id)
  assert.equal(moved.category,'');assert.equal(moved.color,'green');assert.equal(moved.content,'明天确认报价')
  await side.locator('[aria-label="便利贴分类"]').getByRole('button',{name:'未分类',exact:true}).click();await page.waitForURL('**/memos?uncategorized=1')
  await cards.getByText('供应商联系人',{exact:true}).waitFor();await cards.getByText('临时号码',{exact:true}).waitFor();assert.equal(await cards.count(),2)
  await category('需恢复分类');await cards.getByText('恢复分类用',{exact:true}).waitFor()
  await cards.getByTitle('删除',{exact:true}).click();await page.getByRole('dialog',{name:'删除便利贴',exact:true}).getByRole('button',{name:'删除',exact:true}).click()
  await side.getByRole('button',{name:'便利贴分类：需恢复分类',exact:true}).waitFor({state:'hidden'})
  await page.goto(base+'/settings/trash');await showNavGroup(side,'便利贴');const row=page.getByRole('row').filter({hasText:'恢复分类用'});await row.getByRole('button',{name:'恢复',exact:true}).click()
  await side.getByRole('button',{name:'便利贴分类：需恢复分类',exact:true}).waitFor();await category('需恢复分类');await cards.getByText('恢复分类用',{exact:true}).waitFor()
  await side.getByRole('button',{name:'全部便利贴',exact:true}).click();await page.waitForURL('**/memos');await page.waitForFunction(()=>document.querySelectorAll('.memo-card').length===5)
  await page.screenshot({path:'../.run/memo-navigation-e2e/nav-desktop.png',style:'.el-message{visibility:hidden}'})
  await page.getByTitle('收起侧栏',{exact:true}).click();await page.getByTitle('便利贴',{exact:true}).click()
  await category('运营要点',page.locator('.el-popover:visible'));await page.locator('.el-popover:visible').waitFor({state:'hidden'});await cards.getByText('巡店要点',{exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click();const drawer=page.locator('.el-drawer:visible');await showNavGroup(drawer,'便利贴')
  await drawer.locator('[aria-label="便利贴分类"]').getByRole('button',{name:'未分类',exact:true}).click();await page.waitForURL('**/memos?uncategorized=1');await drawer.waitFor({state:'hidden'})
  await cards.getByText('供应商联系人',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
  await page.screenshot({path:'../.run/memo-navigation-e2e/nav-mobile.png',style:'.el-message{visibility:hidden}'})
  assert.deepEqual(errors,[])
  console.log('PASS: category child items, all/uncategorized, special-character URLs, reload/active title, category-prefilled creation, scoped search, category move/delete/restore, collapsed and mobile navigation.')
}catch(error){await page.screenshot({path:'../.run/memo-navigation-e2e/nav-failure.png'});throw error}
finally{await browser.close()}
