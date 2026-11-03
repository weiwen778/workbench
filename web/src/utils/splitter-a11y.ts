import type {Directive} from 'vue'
type SplitterInfo={label:string;value:number;min:number;max:number;disabled?:boolean;vertical?:boolean}
// Element Plus owns all pointer/touch interaction. Add keyboard semantics to its handle.
function update(el:HTMLElement,info:SplitterInfo){
 const handle=el.querySelector<HTMLElement>('.el-splitter-bar__dragger')
 if(!handle)return
 handle.tabIndex=info.disabled?-1:0
 handle.setAttribute('aria-hidden',String(!!info.disabled))
 handle.setAttribute('role','separator')
 handle.setAttribute('aria-label',info.label)
 handle.setAttribute('aria-orientation',info.vertical?'horizontal':'vertical')
 for(const key of ['value','min','max'] as const)handle.setAttribute(key==='value'?'aria-valuenow':`aria-value${key}`,String(Math.round(info[key])))
}
const states=new WeakMap<HTMLElement,{info:SplitterInfo;observer:MutationObserver}>()
export const vSplitterA11y:Directive<HTMLElement,SplitterInfo>={
 mounted(el,binding){
  const state={info:binding.value,observer:new MutationObserver(()=>update(el,state.info))}
  states.set(el,state);state.observer.observe(el,{childList:true,subtree:true});update(el,state.info)
 },
 updated(el,binding){const state=states.get(el);if(state)state.info=binding.value;update(el,binding.value)},
 beforeUnmount(el){states.get(el)?.observer.disconnect();states.delete(el)},
}
