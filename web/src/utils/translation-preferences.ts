export const key='wb_translation_preferences'
export function readTranslationPreferences(){try{return {provider:'baidu',autoSize:true,shortSize:28,mediumSize:21,longSize:16,...JSON.parse(localStorage.getItem(key)||'{}')}}catch{return {provider:'baidu',autoSize:true,shortSize:28,mediumSize:21,longSize:16}}}
export function translationFont(text:string,p:ReturnType<typeof readTranslationPreferences>){return `${p.autoSize?(text.length<=100?p.shortSize:text.length<=500?p.mediumSize:p.longSize):p.longSize}px`}
