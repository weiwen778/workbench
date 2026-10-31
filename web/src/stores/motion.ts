import {ref} from 'vue'
const key='workbench:reduce-motion'
export const reduceMotion=ref(false)
export function initMotion(){try{reduceMotion.value=localStorage.getItem(key)==='1'}catch{}document.documentElement.toggleAttribute('data-reduce-motion',reduceMotion.value)}
export function setReduceMotion(value:boolean){reduceMotion.value=value;document.documentElement.toggleAttribute('data-reduce-motion',value);try{localStorage.setItem(key,value?'1':'0');return true}catch{return false}}
