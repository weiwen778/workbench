import { showNavGroup } from './navigation.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('../.run/checkin-labels-e2e',{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined})
const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
// Use an isolated test database with default navigation labels.
const base=process.env.WB_BASE || 'http://127.0.0.1:18746'
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))
async function login(p){await p.goto(base+'/login');await p.getByPlaceholder('请输入用户名').fill('admin');await p.getByPlaceholder('请输入密码').fill('admin12345');await p.getByRole('button',{name:'登录',exact:true}).click();await p.waitForURL('**/checkins/shops')}
async function rename(oldName,newName,root=page.locator('.wb-sidebar')){
  if (await root.locator('.wb-sidebar').count() || await root.getAttribute('class').then(c=>c?.includes('wb-sidebar')||c?.includes('el-drawer'))) await showNavGroup(root,'打卡')
  await root.getByRole('button',{name:'重命名'+oldName,exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'重命名打卡子项',exact:true})
  await dialog.getByRole('textbox').fill(newName)
  const done=page.waitForResponse(r=>r.url().endsWith('/api/v1/preferences')&&r.request().method()==='PUT')
  await dialog.getByRole('button',{name:'保存',exact:true}).click();return await done
}
try{
  await login(page)
  const side=page.locator('.wb-sidebar')
  await showNavGroup(side,'打卡')
  await side.getByRole('button',{name:'重命名店铺打卡',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'重命名打卡子项',exact:true})
  await dialog.getByRole('textbox').fill('   ');await dialog.getByRole('button',{name:'保存',exact:true}).click()
  await dialog.getByText('请输入 1–40 个字',{exact:true}).waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click()
  assert.equal((await rename('店铺打卡','  店铺运营巡检  ')).status(),200)
  await side.getByRole('button',{name:'店铺运营巡检',exact:true}).waitFor();assert.equal(await page.title(),'店铺运营巡检 · 个人工作台')
  assert.equal(new URL(page.url()).pathname,'/checkins/shops')
  assert.equal((await rename('社媒打卡','内容发布检查')).status(),200)
  assert.equal(await page.locator('.wb-topbar .title-15').textContent(),'店铺运营巡检')
  await side.getByRole('button',{name:'内容发布检查',exact:true}).click();await page.waitForURL('**/checkins/social')
  assert.equal(await page.title(),'内容发布检查 · 个人工作台')
  await page.reload();await showNavGroup(side,'打卡');await side.getByRole('button',{name:'内容发布检查',exact:true}).waitFor();assert.equal(await page.title(),'内容发布检查 · 个人工作台')
  await page.screenshot({path:'../.run/checkin-labels-e2e/nav-desktop.png',style:'.el-message {visibility:hidden}'})
  await page.getByTitle('收起侧栏',{exact:true}).click();await page.getByTitle('打卡',{exact:true}).click()
  assert.equal((await rename('内容发布检查','社媒内容排期',page.locator('.el-popover:visible'))).status(),200)
  await page.getByTitle('打卡',{exact:true}).click();await page.locator('.el-popover:visible').getByRole('button',{name:'店铺运营巡检',exact:true}).click();await page.waitForURL('**/checkins/shops')
  await page.getByTitle('展开侧栏',{exact:true}).click()
  await page.route('**/api/v1/preferences',route=>route.request().method()==='PUT'?route.fulfill({status:503,json:{code:'TEST_ERROR',message:'测试：保存失败'}}):route.continue())
  assert.equal((await rename('店铺运营巡检','不应保存的名字')).status(),503)
  await page.getByText('测试：保存失败',{exact:true}).waitFor();await side.getByRole('button',{name:'店铺运营巡检',exact:true}).waitFor()
  assert.equal(await page.locator('.wb-topbar .title-15').textContent(),'店铺运营巡检')
  await page.unroute('**/api/v1/preferences')
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click()
  assert.equal((await rename('店铺运营巡检','日常运营检查',page.locator('.el-drawer:visible'))).status(),200)
  await page.locator('.el-drawer:visible').waitFor({state:'hidden'});assert.equal(await page.title(),'日常运营检查 · 个人工作台')
  await page.getByRole('button',{name:'打开导航',exact:true}).click()
  await page.screenshot({path:'../.run/checkin-labels-e2e/nav-mobile.png',style:'.el-message {visibility:hidden}'})
  const newContext=await browser.newContext({viewport:{width:1440,height:1050}}),another=await newContext.newPage()
  await login(another);await showNavGroup(another.locator('.wb-sidebar'),'打卡');await another.locator('.wb-sidebar').getByRole('button',{name:'日常运营检查',exact:true}).waitFor();await another.locator('.wb-sidebar').getByRole('button',{name:'社媒内容排期',exact:true}).waitFor()
  assert.equal(await another.title(),'日常运营检查 · 个人工作台')
  await newContext.close();assert.deepEqual(errors,[])
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1050})
  assert.equal((await rename('日常运营检查','图片处理')).status(),200)
  await side.locator('.wb-nav > button').filter({hasText:'图片处理'}).click();await page.waitForURL('**/images')
  await showNavGroup(side,'打卡')
  await side.locator('.checkin-nav-row').getByRole('button',{name:'图片处理',exact:true}).click();await page.waitForURL('**/checkins/shops')
  assert.equal(await page.title(),'图片处理 · 个人工作台')
  console.log('PASS: validation/cancel, both check-in items, trimming, live titles, route/data separation, reload, collapsed/mobile renames, save failure and new browser session persistence.')
}catch(error){await page.screenshot({path:'../.run/checkin-labels-e2e/nav-failure.png'});throw error}
finally{await browser.close()}
