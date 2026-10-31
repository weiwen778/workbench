import Decimal from 'decimal.js'
export type Field = {id:number;key:string;name:string;type:string;required?:boolean;options?:{id:string;name:string}[];config?:Record<string,any>}
export type Row = {id:number;data:Record<string,any>;version:number;computed_errors?:Record<string,string>;created_at?:string;updated_at?:string}
export type Filter = {field:string;op:string;value:any}
export type ViewConfig = {hidden:string[];order:string[];widths:Record<string,number>;frozen:number;search:string;filters:Filter[];sorts:{field:string;order:string}[];group:string;rowHeight:number;formats:Record<string,{style:string;digits:number}>;conditions:{field:string;op:string;value:string;color:string}[];summary:{group:string;value:string;operation:string};pivot:{row:string;column:string;value:string;operation:string};detail:boolean}
export const computedTypes=new Set(['formula','lookup','rollup'])
export const defaultConfig=():ViewConfig=>({hidden:[],order:[],widths:{},frozen:1,search:'',filters:[],sorts:[],group:'',rowHeight:36,formats:{},conditions:[],summary:{group:'',value:'',operation:'count'},pivot:{row:'',column:'',value:'',operation:'count'},detail:false})
export function normalizeConfig(raw:any):ViewConfig {const d=defaultConfig();return {...d,...raw,widths:{...d.widths,...raw?.widths},formats:{...d.formats,...raw?.formats},summary:{...d.summary,...raw?.summary},pivot:{...d.pivot,...raw?.pivot},filters:Array.isArray(raw?.filters)?raw.filters:[],sorts:Array.isArray(raw?.sorts)?raw.sorts:[],conditions:Array.isArray(raw?.conditions)?raw.conditions:[],hidden:Array.isArray(raw?.hidden)?raw.hidden:[],order:Array.isArray(raw?.order)?raw.order:[]}}
export function display(field:Field,value:any,refs:Record<string,{id:number;label:string}[]>={},format?:{style:string;digits:number}):string {
 if(value===null||value===undefined)return ''
 if(field.type==='reference'){const map=new Map((refs[field.key]||[]).map(x=>[x.id,x.label]));return (Array.isArray(value)?value:[value]).map(x=>map.get(x)||`#${x}`).join('、')}
 if(field.type==='select'||field.type==='multiselect'){const map=new Map((field.options||[]).map(x=>[x.id,x.name]));return (Array.isArray(value)?value:[value]).map(x=>map.get(x)||x).join('、')}
 if(field.type==='checkbox')return value?'是':'否'
 if(Array.isArray(value))return value.join('、')
 if(format&&format.style!=='plain'&&value!=='')try{let n=new Decimal(value);if(format.style==='percent')n=n.mul(100);const s=n.toFixed(Math.max(0,Math.min(6,format.digits||0)));return (format.style==='currency'?'¥':'')+s.split('.').map((part,i)=>i?part:part.replace(/\B(?=(\d{3})+(?!\d))/g,',')).join('.')+(format.style==='percent'?'%':'')}catch{}
 if(field.type==='attachment')return `附件 #${value}`
 return String(value)
}
export function parseCell(field:Field,value:any,refs:Record<string,{id:number;label:string}[]>={}) {
 if(computedTypes.has(field.type))throw new Error(`${field.name} 是只读计算列`)
 if(value===null||value===undefined||value==='')return field.type==='multiselect'?[]:null
 if(field.type==='number'){const s=String(value).trim().replace(/,/g,'');const n=new Decimal(s);if(!n.isFinite())throw new Error(`${field.name} 需要合法数字`);return n.toFixed()}
 if(field.type==='checkbox'){if(typeof value==='boolean')return value;const s=String(value).toLowerCase().trim();if(['true','1','是','已勾选'].includes(s))return true;if(['false','0','否','未勾选'].includes(s))return false;throw new Error(`${field.name} 需要是/否`)}
 if(field.type==='select'||field.type==='multiselect'){
  const opts=field.options||[],values=Array.isArray(value)?value:String(value).split(/[,，、]/);const ids=values.map(v=>{const o=opts.find(o=>o.id===v||o.name===v);if(!o)throw new Error(`${field.name} 包含未知选项：${v}`);return o.id});return field.type==='select'?ids[0]:[...new Set(ids)]
 }
 if(field.type==='reference'){
  const values=Array.isArray(value)?value:String(value).split(/[,，、]/);const ids=values.map(v=>{const options=refs[field.key]||[];const matches=options.filter(o=>o.label===String(v));if(matches.length>1)throw new Error('关联名称重复，请在详情里选择记录');const option=options.find(o=>o.id===Number(v))||matches[0];if(!option)throw new Error(`${field.name} 的关联记录不存在`);return option.id});return field.config?.multiple?[...new Set(ids)]:ids[0]
 }
 if(field.type==='attachment'){const n=Number(value);if(!Number.isInteger(n)||n<1)throw new Error('附件需要有效的文件 ID');return n}
 if(field.type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw new Error(`${field.name} 需要 YYYY-MM-DD`)
 return String(value)
}
export function parseTSV(text:string):string[][] {
 const rows:string[][]=[],row:string[]=[];let value='',quoted=false
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++}else if(!value||quoted)quoted=!quoted;else value+=c}else if(c==='\t'&&!quoted){row.push(value);value=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row.splice(0));value=''}else value+=c}
 if(quoted)throw new Error('粘贴数据的引号没有闭合')
 if(value||row.length||!rows.length){row.push(value);rows.push(row)}
 return rows
}
export const toTSV=(rows:any[][])=>rows.map(row=>row.map(v=>{const s=String(v??'');return /[\t\n\r"]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join('\t')).join('\n')
export function matches(row:Row,f:Filter,fields:Field[],refs:Record<string,any[]>) {
 const field=fields.find(x=>x.key===f.field);if(!field)return false
 const raw=row.data[f.field],v=display(field,raw,refs),wanted=String(f.value??'')
 if(f.op==='empty')return raw==null||raw===''||Array.isArray(raw)&&!raw.length
 if(f.op==='not_empty')return !(raw==null||raw===''||Array.isArray(raw)&&!raw.length)
 if(f.op==='contains')return v.toLowerCase().includes(wanted.toLowerCase())
 if(f.op==='eq')return v===wanted||String(raw)===wanted
 if(f.op==='ne')return v!==wanted&&String(raw)!==wanted
 try{const a=new Decimal(raw),b=new Decimal(wanted);return f.op==='gt'?a.gt(b):f.op==='gte'?a.gte(b):f.op==='lt'?a.lt(b):a.lte(b)}catch{return f.op==='gt'?v>wanted:f.op==='gte'?v>=wanted:f.op==='lt'?v<wanted:v<=wanted}
}
export function queryRows(rows:Row[],fields:Field[],config:ViewConfig,refs:Record<string,any[]>) {
 const search=config.search.trim().toLowerCase();let result=rows.filter(r=>(!search||fields.some(f=>display(f,r.data[f.key],refs).toLowerCase().includes(search)))&&config.filters.every(f=>matches(r,f,fields,refs)))
 if(config.sorts.length)result=[...result].sort((a,b)=>{for(const s of config.sorts){const field=fields.find(f=>f.key===s.field);if(!field)continue;let n=0;const av=a.data[s.field],bv=b.data[s.field];if(av==null)n=bv==null?0:1;else if(bv==null)n=-1;else if(['number','rollup','formula'].includes(field.type)){try{n=new Decimal(av).cmp(bv)}catch{n=display(field,av,refs).localeCompare(display(field,bv,refs),'zh-CN',{numeric:true})}}else n=display(field,av,refs).localeCompare(display(field,bv,refs),'zh-CN',{numeric:true});if(n)return s.order==='desc'?-n:n}return a.id-b.id})
 return result
}
export function aggregate(rows:Row[],key:string,operation:string):string {
 if(operation==='count')return String(rows.length)
 const values:Decimal[]=[];for(const r of rows){const v=r.data[key];if(v==null||v==='')continue;try{const d=new Decimal(v);if(d.isFinite())values.push(d)}catch{}}
 if(!values.length)return '—';const sum=values.reduce((a,b)=>a.add(b),new Decimal(0));return (operation==='sum'?sum:operation==='avg'?sum.div(values.length):operation==='min'?Decimal.min(...values):Decimal.max(...values)).toDecimalPlaces(6).toFixed()
}

// CSV quotes do not stop spreadsheet apps interpreting text as formulas.
export function csvCell(value:any):string {const raw=String(value??'');const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim());const safe=/^\s*[=+@-]/.test(raw)&&!numeric?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"'}
