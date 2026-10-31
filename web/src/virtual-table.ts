export type VirtualSource={alias:string;table_id:number}
export type VirtualKey={key:string;name:string;type:string;fields:Record<string,string>}
export type VirtualColumn={key:string;name:string;type:string;mapping:Record<string,string>;source?:string|null;field?:string|null;aggregation:string;expression?:string|null;bindings:Record<string,string>}
export type VirtualDefinition={mode:'union'|'join'|'align';sources:VirtualSource[];keys:VirtualKey[];columns:VirtualColumn[];join_type:'left'|'inner'|'full';allow_many:boolean;filters:{field:string;op:string;value:any}[];sorts:{field:string;order:string}[]}
export const virtualKey=()=> 'v_'+crypto.randomUUID().replace(/-/g,'').slice(0,28)
export const emptyDefinition=():VirtualDefinition=>({mode:'union',sources:[],keys:[],columns:[],join_type:'left',allow_many:false,filters:[],sorts:[]})
export const newVirtualColumn=(name='',type='short_text'):VirtualColumn=>({key:virtualKey(),name,type,mapping:{},source:null,field:null,aggregation:'sum',expression:null,bindings:{}})
export const outputType=(type:string)=>['number','formula','rollup'].includes(type)?'number':type==='date'?'date':type==='checkbox'?'checkbox':'short_text'
export const modeLabels:Record<string,string>={union:'上下追加',join:'按字段关联',align:'汇总后对齐'}
export const virtualTypes=[{value:'short_text',label:'文本'},{value:'number',label:'数字'},{value:'date',label:'日期'},{value:'checkbox',label:'勾选'},{value:'formula',label:'计算列'}]
