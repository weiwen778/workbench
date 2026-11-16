// Run only against an isolated server with its own DB/storage/backup directory.
import {chromium} from './node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:18182';
const browser=await chromium.launch({headless:true,executablePath:'/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/login');await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/checkins/shops');
 async function api(path,body,method='POST',token){return page.evaluate(async({path,body,method,token})=>{const csrf=decodeURIComponent(document.cookie.match(/(?:^|; )wb_csrf=([^;]*)/)?.[1]||'');const response=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const data=await response.json();if(response.status>=400)throw Error(JSON.stringify(data));return data},{path,body,method,token});}
 let targetNote;
 for(let i=0;i<62;i++){
  const n=await api('/notes',{title:i===0?'定位目标笔记':'分页笔记'+i,content:'统一搜索恢复演练 '+i});if(!i)targetNote=n;
  await api('/memos',{title:'分页便利贴'+i,content:'自然高度正文 '+i,category:'验证分页'});
 }
 await page.goto(base+'/memos?category='+encodeURIComponent('验证分页'));await page.locator('.memo-card').first().waitFor();assert.equal(await page.locator('.memo-card').count(),50);
 await page.locator('.el-pagination .btn-next').click();await page.waitForFunction(()=>document.querySelectorAll('.memo-card').length===12);
 await page.goto(base+'/notes');await page.locator('.note-item').first().waitFor();assert.equal(await page.locator('.note-item').count(),50);await page.locator('.note-list-pane .el-pagination .btn-next').click();await page.waitForFunction(()=>document.querySelectorAll('.note-item').length<50);
 await page.getByRole('button',{name:'统一搜索',exact:true}).click();await page.waitForURL('**/search');
 await page.getByPlaceholder('搜索待办、笔记、便利贴、书签和表格').fill('定位目标笔记');
 await page.locator('.search-result').filter({hasText:'定位目标笔记'}).click();await page.waitForURL(u=>u.pathname==='/notes'&&u.searchParams.get('note')===String(targetNote.id));
 await page.waitForFunction(()=>document.querySelector('.title-input input')?.value==='定位目标笔记');
 console.log('PASS notes/memos bounded paging and global search opens the actual older note');
 const t=await api('/tables',{name:'后台导出页面测试',fields:[{name:'名称',type:'short_text'}]});
 await api(`/tables/${t.id}/records`,{data:{[t.fields[0].key]:'导出内容'}});
 await page.goto(base+'/data/'+t.id);await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'导出',exact:true}).click();
 await page.getByRole('dialog',{name:'导出表格',exact:true}).getByRole('button',{name:'导出',exact:true}).click();await page.waitForURL('**/tasks');
 await page.getByRole('link',{name:'下载结果',exact:true}).first().waitFor();
 await page.goto(base+'/settings/system');await page.getByRole('button',{name:'立即备份',exact:true}).click();await page.getByRole('button',{name:'打开任务中心',exact:true}).click();await page.waitForURL('**/tasks');
 await page.getByText('备份校验通过',{exact:true}).first().waitFor();await page.screenshot({path:'.run/improve-tasks.png',fullPage:true});
 const lst=await api('/todo-lists',{name:'回收站恢复验证'});const todo=await api('/todos',{list_id:lst.id,title:'误删后能恢复'});await api('/todos/'+todo.id,undefined,'DELETE');
 await page.goto(base+'/settings/trash');const row=page.locator('.el-table__row').filter({hasText:'误删后能恢复'});await row.getByRole('button',{name:'恢复',exact:true}).click();await row.waitFor({state:'detached'});
 assert.equal((await api('/todos?list_id='+lst.id,undefined,'GET')).pending[0].title,'误删后能恢复');
 console.log('PASS actual export queue, background completion/download, encrypted backup verification and todo trash restore UI');
 const token=(await api('/agent-tokens',{name:'中文审核测试',scopes:['all:stage']})).token;
 const draft=await api('/agent/memos',{title:'人能看懂的标题',content:'暂存的正文'},'POST',token);
 await page.goto(base+'/settings/agents');await page.getByRole('button',{name:'查看与审核',exact:true}).first().click();const drawer=page.getByRole('dialog',{name:'审核 Agent 暂存'});
 await drawer.getByRole('columnheader',{name:'修改项目',exact:true}).waitFor();await drawer.getByText('标题',{exact:true}).waitFor();
 await drawer.getByPlaceholder('审核备注（可选）').fill('页面上核对过内容');await drawer.getByRole('button',{name:'合并到正式数据',exact:true}).click();await page.getByRole('button',{name:'确认合并',exact:true}).click();await drawer.getByText('已合并',{exact:true}).waitFor();
 assert.equal((await api('/agent-changes/'+draft.id,undefined,'GET')).review_note,'页面上核对过内容');
 await drawer.getByRole('button',{name:'关闭',exact:true}).last().click();await page.setViewportSize({width:390,height:844});await page.goto(base+'/tasks');await page.waitForLoadState('networkidle');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log('PASS Chinese field review, persisted approval note, mobile task center and no uncaught browser errors');
}finally{await browser.close();}