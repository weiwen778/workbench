// LEGACY: review-mode UI labels/selectors predate direct mode. Use agent-direct.mjs for current acceptance.
import {chromium} from '../e2e/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18182/settings/agents');
 await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('admin12345');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForURL(u=>u.pathname==='/settings/agents');
 await page.getByRole('heading',{name:'Agent 暂存区',exact:true}).waitFor();
 async function api(path,method='GET',body,token){return await page.evaluate(async({path,method,body,token})=>{
  const csrf=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('wb_csrf='))?.slice(8)||'');
  const response=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 },{path,method,body,token});}
 const token=(await api('/agent-tokens','POST',{name:'测试暂存流程',scopes:['all:stage']})).data.token;
 const submitted=await api('/agent/todo-lists','POST',{name:'审核后才创建的清单'},token);
 assert.equal(submitted.status,202);assert.equal((await api('/todo-lists')).data.length,0);
 await page.getByRole('button',{name:'刷新暂存',exact:true}).click();
 await page.getByRole('button',{name:'查看与审核',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'审核 Agent 暂存'});
 await drawer.getByText('审核后才创建的清单',{exact:false}).first().waitFor();
 await drawer.getByRole('button',{name:'合并到正式数据',exact:true}).click();
 await page.getByRole('button',{name:'确认合并',exact:true}).click();
 await drawer.getByText('已合并',{exact:true}).waitFor();
 assert.equal((await api('/todo-lists')).data[0].name,'审核后才创建的清单');
 await page.screenshot({path:'.run/agent-stage-approved.png',fullPage:true});
 await drawer.getByRole('button',{name:'关闭',exact:true}).last().click();
 const note=(await api('/notes','POST',{title:'用户原文',content:'保留这些内容'})).data;
 const draft=await api('/agent/notes/'+note.id,'PUT',{title:'不应写入的标题',version:note.version},token);assert.equal(draft.status,202);
 await page.getByRole('button',{name:'刷新暂存',exact:true}).click();
 await page.getByRole('button',{name:'查看与审核',exact:true}).click();
 await drawer.getByRole('button',{name:'拒绝',exact:true}).click();
 await page.getByRole('button',{name:'确认拒绝',exact:true}).click();
 await drawer.getByText('已拒绝',{exact:true}).waitFor();
 assert.equal((await api('/notes/'+note.id)).data.title,'用户原文');
 assert.equal((await api('/agent-changes/'+draft.data.id+'/merge','POST',{version:1},token)).status,403);
 await drawer.getByRole('button',{name:'关闭',exact:true}).last().click();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'创建令牌',exact:true}).click();
 const create=page.getByRole('dialog',{name:'创建 Agent 令牌'});
 assert.equal(await create.getByRole('checkbox',{checked:true}).count(),2);
 assert.deepEqual(errors,[]);
 console.log('PASS: settings preview, actual UI approval, rejection keeps original, bearer+cookie cannot approve, default full grants, mobile dialog, no browser errors');
} finally {await browser.close();}