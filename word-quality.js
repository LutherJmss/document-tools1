import {TextQualityEngine} from './text-quality.js';
import {FormulaRecognizer} from './formula-recognizer.js';
import {recognizeLocalPNG} from './local-ocr.js';
const quality=new TextQualityEngine(),formula=new FormulaRecognizer();
function bounds(block,page,type='text'){
 const lines=block.lines||[];
 return {type,imageClass:'text',left:Math.max(0,Math.min(...lines.map(l=>l.x))-4),right:Math.min(page.width,Math.max(...lines.map(l=>l.right))+4),
  top:Math.max(0,Math.min(...lines.flatMap(l=>(l.items||[]).map(i=>i.y-i.height)))-3),
  bottom:Math.min(page.height,Math.max(...lines.flatMap(l=>(l.items||[]).map(i=>i.y)))+4)};
}
function riskyMath(block){
 if(block.type==='heading'||block.type==='toc')return false;
 const t=block.text;
 if(/^式中[,，]/.test(t)&&/(?:权|下标)/.test(t)&&/\d/.test(t))return true;
 if(/\d{1,2}\(\d\)的幂/.test(t))return true;
 if(!/[\u3400-\u9fff]/.test(t)&&/[=＝]/.test(t)&&(t.match(/[×x*]\s*\d/g)||[]).length>=2)return true;
 return /十六进制数转换/.test(t)&&/\)[ ]*16/.test(t)&&
  (block.lines||[]).some(l=>(l.items||[]).some(i=>i.text.trim()==='16'&&i.height<l.fontSize*.8));
}
export function prepareQuality(models,raw,{ocr=true}={}){
 const report={version:'V1.4.3-RC1',confidenceMeaning:'heuristic risk score, not calibrated probability',
  policy:{fullPdfOCR:false,traditionalAutoRewrite:false,ocrBudgetMs:1200,maxOCRRegions:4},
  pages:raw.map(p=>quality.page(p.number,p.lines)),regions:[],formulas:[],
  summary:{ocrAttempted:0,ocrRepaired:0,textImageFallbacks:0,formulaRestored:0,formulaImageFallbacks:0,
   formulaOCRAttempted:0,formulaOCRVerified:0,scannedPagesPreserved:0,partialRasterPages:0,rasterGapImages:0}};
 for(const page of models){
  if(!page.lines.length){const r={type:'scan',left:0,right:page.width,top:0,bottom:page.height};page.regions=[r];page.blocks=[{kind:'region',region:r,x:0,y:0}];report.summary.scannedPagesPreserved++;continue;}
  if(page.rasterBackground&&page.lines.length<4&&!page.toc.isTOC){page.coverageRegion={type:'coverage',left:0,right:page.width,top:0,bottom:page.height};page.regions.push(page.coverageRegion);}
  page.blocks=page.blocks.flatMap(block=>{
   if(block.kind!=='text'||block.category==='exercise'||block.lines?.length<2||!riskyMath(block))return [block];
   const groups=[];for(const line of block.lines){const unsafe=riskyMath({...block,text:line.text,lines:[line]});let g=groups.at(-1);
    if(!g||g.unsafe!==unsafe){g={unsafe,lines:[]};groups.push(g)}g.lines.push(line);}
   if(!groups.some(g=>g.unsafe))return [block];
   return groups.map(g=>({...block,lines:g.lines,text:g.lines.map(l=>l.text).join(''),y:g.lines[0].y,x:g.lines[0].x,indent:false}));
  });
  if(!page.toc.isTOC)for(const group of formula.glyphGroups(page.lines)){
   if(page.regions.some(r=>group.lines.some(l=>l.y>=r.top&&l.y<=r.bottom)))continue;
   const owned=page.blocks.filter(b=>b.kind==='text'&&b.lines?.some(l=>group.lines.includes(l)));
   if(!owned.length||owned.some(b=>b.type==='heading'||b.category==='exercise'||b.lines.some(l=>!group.lines.includes(l))))continue;
   const first=owned[0];first.kind='formula';first.formula=group.recognized;page.blocks=page.blocks.filter(b=>b===first||!owned.includes(b));
   report.summary.formulaRestored++;const audit={page:page.number,latex:group.recognized.latex,source:group.recognized.source,status:'restored'};report.formulas.push(audit);
   if(ocr){first.formulaOCRRegion=bounds({lines:group.lines},page,'formula');first.formulaAudit=audit;page.regions.push(first.formulaOCRRegion);}
  }
  for(const block of page.blocks){
   if(block.kind==='region'&&block.region.type==='formula'){
    const r=block.region,lines=page.lines.filter(l=>l.y>=r.top&&l.y<=r.bottom),recognized=formula.recognizeLines(lines);
    if(recognized){block.kind='formula';block.formula=recognized;block.region=null;
     if(!ocr)page.regions=page.regions.filter(x=>x!==r);report.summary.formulaRestored++;
     const audit={page:page.number,latex:recognized.latex,source:recognized.source,status:'restored'};report.formulas.push(audit);
     if(ocr){block.formulaOCRRegion=r;block.formulaAudit=audit;}}
    else report.summary.formulaImageFallbacks++;continue;
   }
   if(block.kind!=='text'||!block.text)continue;
   const assessment=quality.assess(block.text,{heading:block.type==='heading'});
   if(assessment.needsRepair||riskyMath(block)){
    const mathRisk=!assessment.needsRepair,r=bounds(block,page,mathRisk?'formula':'text');if(!Number.isFinite(r.top)||r.bottom<=r.top)continue;
    block.qualityRegion=r;page.regions.push(r);
    const audit={page:page.number,source:block.text,status:'pending',reason:mathRisk?'uncertain_math_positions':assessment.reason,
     assessment,ocrEnabled:ocr&&!mathRisk,heading:block.type==='heading'};
    report.regions.push(audit);block.qualityAudit=audit;
   }else if(!page.toc.isTOC&&block.lines?.length===1){
    const recognized=formula.recognizeLines(block.lines);
    if(recognized&&!/[\u3400-\u9fff]/.test(block.text)){block.inlineFormula=recognized;report.summary.formulaRestored++;
     report.formulas.push({page:page.number,latex:recognized.latex,source:recognized.source,status:'restored'});}
   }
  }
  const p=report.pages.find(x=>x.page===page.number);
  if(report.regions.some(x=>x.page===page.number)){p.status='warning';p.reason='text_layer_abnormal';p.confidence=Math.min(p.confidence,.62);}
 }
 return report;
}
export async function preserveRasterGaps(models,report,optimizer){
 for(const page of models){const source=page.coverageRegion;if(!source?.image)continue;let bitmap;
  try{bitmap=await createImageBitmap(new Blob([source.image],{type:'image/png'}));}
  catch{source.type='scan';page.blocks=[{kind:'region',region:source,x:0,y:0}];report.summary.partialRasterPages++;report.summary.rasterGapImages++;continue;}
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
  try{const scale=canvas.width/page.width,pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const masks=[...page.lines.map(l=>({left:l.x-8,right:l.right+8,top:l.y-l.fontSize-8,bottom:l.y+8})),...page.regions.filter(r=>r!==source)];
   const ink=[];for(let y=Math.floor(52*scale);y<canvas.height-35*scale;y+=2){let count=0,left=canvas.width,right=0;
    for(let x=0;x<canvas.width;x+=2){const i=(y*canvas.width+x)*4;if(pixels[i]+pixels[i+1]+pixels[i+2]>540)continue;
     if(masks.some(r=>x/scale>=r.left&&x/scale<=r.right&&y/scale>=r.top&&y/scale<=r.bottom))continue;
     count++;left=Math.min(left,x);right=Math.max(right,x);}if(count>=5)ink.push({y,left,right});}
   const bands=[];for(const row of ink){let b=bands.at(-1);if(!b||row.y-b.bottom>8){b={top:row.y,bottom:row.y,left:row.left,right:row.right};bands.push(b)}
    b.bottom=row.y;b.left=Math.min(b.left,row.left);b.right=Math.max(b.right,row.right);}
   const meaningful=bands.filter(b=>b.bottom-b.top>=4);if(!meaningful.length)continue;
   report.summary.partialRasterPages++;const pageReport=report.pages.find(p=>p.page===page.number);pageReport.status='warning';pageReport.rasterCoverage='uncovered_ink_preserved';
   for(const band of meaningful){const r={type:'scan',left:Math.max(0,(band.left-6)/scale),right:Math.min(page.width,(band.right+8)/scale),
    top:Math.max(0,(band.top-6)/scale),bottom:Math.min(page.height,(band.bottom+8)/scale)};
    if(page.lines.some(l=>l.y>=r.top&&l.y-l.fontSize<=r.bottom)){
     source.type='scan';page.blocks=[{kind:'region',region:source,x:0,y:0}];report.summary.rasterGapImages++;pageReport.rasterCoverage='partial_line_full_page_image';break;}
    const crop=document.createElement('canvas');crop.width=Math.ceil((r.right-r.left)*scale);crop.height=Math.ceil((r.bottom-r.top)*scale);
    crop.getContext('2d').drawImage(canvas,r.left*scale,r.top*scale,crop.width,crop.height,0,0,crop.width,crop.height);
    r.image=await optimizer.encode(crop,r);crop.width=crop.height=0;page.blocks.push({kind:'region',region:r,x:r.left,y:r.top});report.summary.rasterGapImages++;
   }page.blocks.sort((a,b)=>a.y-b.y||a.x-b.x);
  }finally{canvas.width=canvas.height=0;}
 }
}
export async function repairQuality(models,report,{recognize=recognizeLocalPNG}={}){
 const start=performance.now();
 for(const page of models)for(const block of page.blocks){const r=block.qualityRegion,audit=block.qualityAudit;if(!r)continue;
  const left=report.policy.ocrBudgetMs-(performance.now()-start);
  if(audit.ocrEnabled&&r.image&&left>100&&report.summary.ocrAttempted<report.policy.maxOCRRegions){
   report.summary.ocrAttempted++;
   try{const candidate=await recognize(r.image,{timeoutMs:Math.floor(left)});audit.ocrConfidence=candidate.confidence;audit.ocrText=candidate.text;
    const selected=quality.select(block.text,candidate,audit.assessment,{heading:audit.heading});
    if(selected){block.text=selected.text;block.qualityRegion=null;audit.status='ocr_repaired';audit.output=selected.text;report.summary.ocrRepaired++;continue;}
    audit.status='image_fallback';audit.selectionReason='ocr_not_strictly_better';}
   catch(e){audit.status='image_fallback';audit.selectionReason=e.message;}
  }else{audit.status='image_fallback';audit.selectionReason=audit.ocrEnabled?'budget_or_region_limit':'unsafe_math_or_ocr_disabled';}
  if(r.image){if(audit.heading){const anchor=block.text.match(/^第\s*\d+\s*章/);block.qualityHeadingLabel=anchor?anchor[0].replace(/\s/g,'')+(/绪论\s*$/.test(block.text)?' 绪论':''):'标题 原图';audit.navigationAnchor=block.qualityHeadingLabel;}
   report.summary.textImageFallbacks++;if(r.type==='formula')report.summary.formulaImageFallbacks++;}
 }
 for(const page of models)for(const block of page.blocks){const r=block.formulaOCRRegion;if(!r?.image)continue;
  const remaining=report.policy.ocrBudgetMs-(performance.now()-start);if(remaining<100){block.formulaAudit.ocrSelection='native_geometry_or_explicit_text_budget_exhausted';continue;}
  report.summary.formulaOCRAttempted++;
  try{const candidate=await recognize(r.image,{math:true,timeoutMs:Math.floor(remaining)}),verified=formula.fromOCR(candidate,block.formula);
   block.formulaAudit.ocrConfidence=candidate.confidence;block.formulaAudit.ocrText=candidate.text;
   if(verified){block.formula=verified;block.formulaAudit.source=verified.source;report.summary.formulaOCRVerified++;}
   else if(candidate.confidence>=97&&candidate.text.trim()){block.kind='region';block.region=r;block.formulaAudit.status='image_fallback_conflicting_ocr';report.summary.formulaRestored--;report.summary.formulaImageFallbacks++;}
   else block.formulaAudit.ocrSelection='higher_confidence_native_evidence';
  }catch(e){block.formulaAudit.ocrSelection='native_evidence_preferred';block.formulaAudit.ocrFailure=e.message;}
 }
 report.summary.ocrMs=Math.round(performance.now()-start);return report;
}
