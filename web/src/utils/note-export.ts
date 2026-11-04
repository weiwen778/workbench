import DOMPurify from 'dompurify'

const css=`body{margin:0;background:white;color:#202630;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:16px;line-height:1.75}article{padding:40px;overflow-wrap:anywhere}h1{font-size:28px}h2{font-size:23px}h3{font-size:20px}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #bac2cd;padding:8px}pre{white-space:pre-wrap;background:#f1f3f5;padding:16px}blockquote{border-left:4px solid #a5bfe0;margin:16px 0;padding:8px 16px;background:#f4f6f8}img{max-width:100%;height:auto}a{color:#175ca8}*{box-sizing:border-box}`
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function inlineImages(node:HTMLElement){
  await Promise.all(Array.from(node.querySelectorAll('img')).map(async img=>{
    const url=new URL(img.getAttribute('src')||'',location.href)
    if(!['http:','https:','data:'].includes(url.protocol))throw new Error('图片地址不受支持')
    const response=await fetch(url,{credentials:url.origin===location.origin?'same-origin':'omit'})
    if(!response.ok)throw new Error('图片读取失败，请确认图片仍可访问')
    const blob=await response.blob()
    img.src=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(blob)})
    await img.decode()
  }))
}
export async function exportNote(title:string,html:string,format:string){
  const name=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'笔记'
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-12000px;top:0;width:800px;height:1200px;border:0';document.body.append(frame)
  try{
    const doc=frame.contentDocument!;doc.open();doc.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title></title><style>'+css+'</style></head><body><article></article></body></html>');doc.close();doc.title=title
    const article=doc.querySelector('article')!;const heading=doc.createElement('h1');heading.textContent=title;article.append(heading)
    const body=doc.createElement('div');body.innerHTML=DOMPurify.sanitize(html);article.append(body)
    await inlineImages(article);await doc.fonts.ready
    if(format==='html'){download(new Blob(['<!doctype html>'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'}),name+'.html');return}
    if(format==='docx'){
      const {Document,Packer,Paragraph,TextRun,ImageRun,Table,TableRow,TableCell,ExternalHyperlink}=await import('docx')
      function runs(node:Node,style:any={}):any[]{
        if(node.nodeType===3)return [new TextRun({text:node.textContent||'',...style})]
        if(node.nodeType!==1)return []
        const el=node as HTMLElement,tag=el.tagName
        if(tag==='INPUT')return [new TextRun({text:(el as HTMLInputElement).checked?'☑ ':'☐ '})]
        if(tag==='BR')return [new TextRun({break:1})]
        if(tag==='IMG'){const img=el as HTMLImageElement;return [new ImageRun({type:'png',data:pngImage(img),transformation:{width:Math.min(600,img.naturalWidth),height:Math.min(600,img.naturalWidth)*img.naturalHeight/img.naturalWidth}})]}
        const next={...style,...(['B','STRONG'].includes(tag)?{bold:true}:{}),...(['I','EM'].includes(tag)?{italics:true}:{}),...(tag==='CODE'?{font:'Consolas'}:{})}
        const children=Array.from(node.childNodes).flatMap(n=>runs(n,next))
        if(tag==='A'&&/^https?:/.test((el as HTMLAnchorElement).href))return [new ExternalHyperlink({link:(el as HTMLAnchorElement).href,children})]
        return children
      }
      function blocks(parent:HTMLElement):any[]{return Array.from(parent.children).flatMap((el):any[]=>{
        if(el.tagName==='TABLE')return [new Table({rows:Array.from(el.querySelectorAll('tr')).map(row=>new TableRow({children:Array.from(row.children).map(cell=>new TableCell({children:[new Paragraph({children:runs(cell)})]}))}))})]
        if(['DIV','UL','OL','BLOCKQUOTE'].includes(el.tagName))return blocks(el as HTMLElement)
        if(el.tagName==='HR')return [new Paragraph('────────────────────────')]
        return [new Paragraph({children:runs(el),...(/^H[1-6]$/.test(el.tagName)?{heading:('Heading'+el.tagName[1]) as any}:{}),...(el.tagName==='LI'?{bullet:{level:0}}:{}),spacing:{after:160}})]
      })}
      download(await Packer.toBlob(new Document({sections:[{children:blocks(article)}]})),name+'.docx');return
    }
    const {toCanvas}=await import('html-to-image')
    const height=article.scrollHeight,tileHeight=format==='pdf'?1040:6000
    const origin=article.getBoundingClientRect().top,spans:Array<{top:number;bottom:number}>=[]
    const walker=doc.createTreeWalker(article,NodeFilter.SHOW_TEXT)
    while(walker.nextNode()){const range=doc.createRange();range.selectNodeContents(walker.currentNode);for(const rect of Array.from(range.getClientRects()))spans.push({top:rect.top-origin,bottom:rect.bottom-origin})}
    for(const node of Array.from(article.querySelectorAll('img,tr'))){const rect=node.getBoundingClientRect();if(rect.height<tileHeight)spans.push({top:rect.top-origin,bottom:rect.bottom-origin})}
    function safeHeight(top:number){let end=Math.min(height,top+tileHeight);for(let i=0;i<10;i++){const crossing=spans.filter(r=>r.top<end&&r.bottom>end&&r.top>top);if(!crossing.length)break;end=Math.min(...crossing.map(r=>r.top))}return Math.max(1,Math.floor(end-top))}
    const viewport=doc.createElement('div');viewport.style.cssText=`width:800px;overflow:hidden;background:white;position:relative`;article.replaceWith(viewport);viewport.append(article)
    const pdf=format==='pdf'?new (await import('jspdf')).jsPDF({unit:'px',format:[800,1120],hotfixes:['px_scaling']}):null
    for(let top=0,index=0;top<height;index++){
      const h=safeHeight(top);viewport.style.height=h+'px';article.style.transform=`translateY(-${top}px)`
      const canvas=await toCanvas(viewport,{width:800,height:h,pixelRatio:1.5,backgroundColor:'#ffffff',fontEmbedCSS:''})
      top+=h
      if(pdf){if(index)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',0.94),'JPEG',0,40,800,h)}
      else{const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片生成失败'))));download(blob,name+(height>tileHeight?`-${index+1}`:'')+'.png')}
    }
    if(pdf)pdf.save(name+'.pdf')
  }finally{frame.remove()}
}
function pngImage(img:HTMLImageElement){const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d')!.drawImage(img,0,0);return canvas.toDataURL('image/png')}