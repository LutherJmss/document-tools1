// Recognize bounded local crops. The PDF image never leaves this browser.
const SCRIPT='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
let workerPromise=null,queue=Promise.resolve();
async function worker(){
 if(!workerPromise)workerPromise=(async()=>{
  if(!globalThis.Tesseract)await new Promise((ok,bad)=>{
   const s=document.createElement('script');s.src=SCRIPT;s.onload=ok;s.onerror=()=>bad(Error('局部 OCR 组件无法加载'));document.head.append(s);
  });
  return Tesseract.createWorker('chi_sim+eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
   corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',langPath:new URL('./ocr-data/',import.meta.url).href,workerBlobURL:true});
 })().catch(e=>{workerPromise=null;throw e});
 return workerPromise;
}
export async function preloadLocalOCR(){return worker()}
export async function recognizeLocalPNG(bytes,{timeoutMs=1200,math=false}={}){
 let timer;try{
  const task=queue.catch(()=>{}).then(async()=>{const w=await worker();await w.setParameters({tessedit_pageseg_mode:math?'7':'6',
   tessedit_char_whitelist:math?'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz()+-=^_{}. ':''});
   const r=await w.recognize(new Blob([bytes],{type:'image/png'}));return {text:r.data.text,confidence:r.data.confidence};});queue=task;
  return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('局部 OCR 时间预算用尽')),timeoutMs)})]);
 }finally{clearTimeout(timer)}
}
