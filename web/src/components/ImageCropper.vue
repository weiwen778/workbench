<template><div ref="host" class="cropper-host" aria-label="图片裁剪区域" /></template>
<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue'
import Cropper from 'cropperjs'
import type {CropperSelection} from 'cropperjs'
type Crop={x:number;y:number;w:number;h:number}
const props=defineProps<{src:string;modelValue:Crop;aspectRatio:number}>()
const emit=defineEmits<{(e:'update:modelValue',value:Crop):void;(e:'commit'):void}>()
const host=ref<HTMLElement>();let cropper:Cropper|undefined,selection:CropperSelection|null=null,observer:ResizeObserver|undefined,syncing=false,sequence=0
function sync(){
 if(!host.value||!selection)return
 const {width,height}=host.value.getBoundingClientRect();if(!width||!height)return
 const c=props.modelValue
 if(Math.abs(selection.x-c.x*width)<.5&&Math.abs(selection.y-c.y*height)<.5&&Math.abs(selection.width-c.w*width)<.5&&Math.abs(selection.height-c.h*height)<.5)return
 syncing=true;selection.$change(c.x*width,c.y*height,c.w*width,c.h*height,props.aspectRatio||NaN);syncing=false
}
async function setup(){
 const current=++sequence;cropper?.destroy();selection=null
 if(!host.value||!props.src)return
 const image=new Image();image.src=props.src
 cropper=new Cropper(image,{container:host.value,template:`<cropper-canvas background style="width:100%;height:100%"><cropper-image></cropper-image><cropper-shade></cropper-shade><cropper-handle action="select" plain></cropper-handle><cropper-selection movable resizable outlined><cropper-grid role="grid" covered></cropper-grid><cropper-crosshair centered></cropper-crosshair><cropper-handle action="select" plain style="position:absolute;inset:0;width:100%;height:100%"></cropper-handle><cropper-handle action="move" style="left:calc(50% - 12px);top:calc(50% - 12px);width:24px;height:24px" theme-color="rgba(255,255,255,.35)"></cropper-handle>${['n','e','s','w','ne','nw','se','sw'].map(d=>`<cropper-handle action="${d}-resize"></cropper-handle>`).join('')}</cropper-selection></cropper-canvas>`})
 try{await cropper.getCropperImage()?.$ready();if(current!==sequence)return;cropper.getCropperImage()?.$center('contain');selection=cropper.getCropperSelection();if(!selection)return;selection.aspectRatio=props.aspectRatio||NaN;sync()
 selection.addEventListener('change',event=>{
  if(syncing||!host.value)return
  const {x,y,width,height}=(event as CustomEvent).detail,rect=host.value.getBoundingClientRect()
  if(width<1||height<1)return
  if(x<-.5||y<-.5||x+width>rect.width+.5||y+height>rect.height+.5){event.preventDefault();return}
  emit('update:modelValue',{x:Math.max(0,x/rect.width),y:Math.max(0,y/rect.height),w:Math.min(1,width/rect.width),h:Math.min(1,height/rect.height)})
 })
 cropper.getCropperCanvas()?.addEventListener('actionend',()=>emit('commit'))
 }catch{ /* Source may be replaced while it loads. */ }
}
watch(()=>props.src,setup)
watch(()=>[props.modelValue,props.aspectRatio],()=>{if(selection)selection.aspectRatio=props.aspectRatio||NaN;sync()},{deep:true})
onMounted(()=>{void setup();observer=new ResizeObserver(()=>{cropper?.getCropperImage()?.$center('contain');sync()});if(host.value)observer.observe(host.value)})
onBeforeUnmount(()=>{sequence++;observer?.disconnect();cropper?.destroy()})
</script>
<style scoped>.cropper-host {position:absolute;inset:0;touch-action:none;}</style>