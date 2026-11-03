// Run only against an isolated test database; this script creates fixtures.
import {chromium} from './node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'/home/weiwen/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'});
try {
 const page=await browser.newPage({viewport:{width:1366,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18182/visualizations');await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('admin12345');await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.waitForFunction(()=>location.pathname==='/visualizations'&&!document.querySelector('input[autocomplete=current-password]'));await page.waitForLoadState('networkidle');
 async function api(path,body,method='POST'){return page.evaluate(async({path,body,method})=>{const csrf=decodeURIComponent(document.cookie.match(/(?:^|; )wb_csrf=([^;]*)/)?.[1]||'');const r=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();},{path,body,method})}
 const table=await api('/tables',{name:'销售日报',fields:[{name:'日期',type:'date'},...['销售额','成本','利润'].map(name=>({name,type:'number'}))]});
 const keys=Object.fromEntries(table.fields.map(f=>[f.name,f.key]));
 for(let i=1;i<=3;i++)await api(`/tables/${table.id}/records`,{data:{[keys['日期']]:`2026-11-0${i}`,[keys['销售额']]:String(i*100),[keys['成本']]:String(i*60),[keys['利润']]:String(i*40)}});
 const board=await api('/dashboards',{name:'多指标看板'});
 await page.goto(`http://127.0.0.1:18182/visualizations/${board.id}`);await page.getByRole('button',{name:'添加图表',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'添加图表',exact:true});
 await editor.getByText('折线图',{exact:true}).click();
 await editor.locator('.el-form-item').filter({hasText:'来源表格'}).locator('.el-select__wrapper').click();await page.getByRole('option',{name:'销售日报',exact:true}).click();
 const values=editor.locator('.el-form-item').filter({hasText:'纵轴：要对比哪些数字？'});
 await values.locator('.el-select__wrapper').click();await page.getByRole('option',{name:'成本',exact:true}).click();await page.getByRole('option',{name:'利润',exact:true}).click();await page.keyboard.press('Escape');
 await editor.getByPlaceholder('例如：本月销售额、各店铺销售对比').fill('销售、成本与利润趋势');
 await editor.getByRole('button',{name:'预览数据',exact:true}).click();

 await editor.locator('.echarts-chart canvas').waitFor();
 const description=locator=>locator.locator('.echarts-host').getAttribute('aria-label');
 const previewText=await description(editor.locator('.echarts-chart'));
 for(const name of ['销售额','成本','利润'])assert.ok(previewText.includes(name),previewText);
 await editor.getByRole('button',{name:'保存图表',exact:true}).click();await editor.waitFor({state:'hidden'});
 let chart=page.locator('.widget-card .echarts-chart');await chart.locator('canvas').waitFor();
 assert.ok((await description(chart)).includes('100'));
 await page.locator('.widget-card').getByText('查看具体数值',{exact:true}).click();assert.equal(await page.locator('.widget-card .chart-values th').count(),4);
 assert.equal(await page.locator('.widget-card .chart-values tbody tr').count(),3);
 assert.ok((await page.locator('.widget-card .chart-values').textContent()).includes('销售额'));
 const box=await chart.boundingBox();
 await page.mouse.move(1,1);const beforeLegend=await chart.screenshot();
 await page.mouse.click(box.x+box.width/2,box.y+12);await page.mouse.move(1,1);await page.waitForTimeout(150);
 const afterLegend=await chart.screenshot();assert.ok(!beforeLegend.equals(afterLegend),'native legend changes rendering');
 await page.screenshot({path:new URL('../.run/echarts-line.png',import.meta.url).pathname});
 await page.reload();await chart.locator('canvas').waitFor();assert.ok((await description(chart)).includes('利润'));
 const light=await chart.screenshot();await page.getByRole('button',{name:'切换主题',exact:true}).click();await page.waitForTimeout(400);assert.ok(!light.equals(await chart.screenshot()));
 const wide=(await chart.boundingBox()).width;await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert.ok((await chart.boundingBox()).width<wide);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:new URL('../.run/echarts-mobile-dark.png',import.meta.url).pathname});
 await page.setViewportSize({width:1366,height:1000});await page.getByRole('button',{name:'切换主题',exact:true}).click();
 await page.getByRole('button',{name:'销售、成本与利润趋势的操作',exact:true}).click();await page.getByRole('menuitem',{name:'编辑图表',exact:true}).click();
 const edit=page.getByRole('dialog',{name:'编辑图表',exact:true});await edit.getByText('柱状图',{exact:true}).click();await edit.getByRole('button',{name:'预览数据',exact:true}).click();await edit.locator('.echarts-chart canvas').waitFor();
 assert.match(await description(edit.locator('.echarts-chart')),/bar|柱状/);
 await edit.getByRole('button',{name:'保存图表',exact:true}).click();await edit.waitFor({state:'hidden'});await chart.locator('canvas').waitFor();
 const current=await page.evaluate(async(id)=>await(await fetch('/api/v1/dashboards')).json().then(list=>list.find(b=>b.id===id)),board.id);
 const w=current.widgets[0];
 await api(`/dashboards/${board.id}`,{name:current.name,version:current.version,widgets:[w,{...w,id:'pie',title:'销售占比',kind:'pie',value_fields:[],value_field:keys['销售额']},{...w,id:'metric',title:'销售合计',kind:'metric',value_fields:[],value_field:keys['销售额']}]},'PUT');
 await page.reload();const pie=page.locator('.widget-card[aria-label="销售占比"] .echarts-chart');await pie.locator('canvas').waitFor();
 assert.match(await description(pie),/pie|饼/);assert.ok((await page.locator('.metric-value').textContent()).includes('600'));
 await page.screenshot({path:new URL('../.run/echarts-dashboard.png',import.meta.url).pathname});
 await page.goto('http://127.0.0.1:18182/notes');
 assert.deepEqual(errors,[]);console.log('PASS ECharts canvas and accessible series data: native legend interaction, line/bar/pie/metric, saved configuration reload, numerical table, light/dark, mobile resize and route navigation; isolated database');
} finally {await browser.close();}
