// Explicit grammar and positioned glyphs only. Unknown mathematics stays an image.
const SUP='⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁺⁻',SUB='₀₁₂₃₄₅₆₇₈₉ₙ₊₋';
const sups='0123456789n+-',subs='0123456789n+-';
const norm=s=>[...s].map(c=>SUP.includes(c)?'^'+sups[SUP.indexOf(c)]:SUB.includes(c)?'_'+subs[SUB.indexOf(c)]:c).join('');
const token=s=>s.length===1?s:s;
export class FormulaRecognizer {
 parse(source){
  const value=norm(String(source).trim()).replace(/\s+/g,'');
  if((value.match(/\{/g)||[]).length!==(value.match(/\}/g)||[]).length)return null;
  let match=value.match(/^\\frac\{([A-Za-z0-9]+)\}\{([A-Za-z0-9]+)\}$/);
  if(match)return {latex:value,ast:{type:'fraction',numerator:match[1],denominator:match[2]},source:'explicit_latex'};
  match=value.match(/^\\sqrt\{([A-Za-z0-9]+)\}$/);
  if(match)return {latex:value,ast:{type:'radical',base:match[1]},source:'explicit_latex'};
  match=value.match(/^\(([0-9A-Fa-f]+)\)_\{?(2|8|10|16)\}?$/);
  if(match){const base=Number(match[2]);if([...match[1]].some(c=>parseInt(c,16)>=base))return null;
   return {latex:`(${match[1]})_{${base}}`,ast:{type:'sub',base:`(${match[1]})`,script:String(base)},source:'explicit_text'};}
  match=value.match(/^([A-Za-z0-9])([_^])\{?([A-Za-z0-9+\-]{1,3})\}?$/);
  if(match)return {latex:`${match[1]}${match[2]}{${match[3]}}`,ast:{type:match[2]==='^'?'sup':'sub',base:match[1],script:match[3]},source:'explicit_text'};
  if(/^[A-Za-z](?:[+\-×][A-Za-z])+=?[A-Za-z]$/.test(value)&&value.includes('='))
   return {latex:value,ast:{type:'plain',base:value},source:'explicit_text'};
  return null;
 }
 recognizeLines(lines){if(lines.length===1){const explicit=this.parse(lines[0].text);if(explicit)return explicit;}
  if(lines.length>3||!lines.length)return null;
  const items=lines.flatMap(l=>l.items||[]).filter(i=>i.text.trim());
  if(items.length!==2)return null;
  const [base,script]=items.sort((a,b)=>a.x-b.x);
  if(base.text.length!==1||script.text.length>2||script.height>base.height*.8||
    script.x<base.x+base.width-3||script.x>base.x+base.width+9)return null;
  const kind=script.y<base.y-base.height*.15?'^':script.y>base.y+base.height*.15?'_':null;
  return kind?this.parse(base.text+kind+script.text):null;
 }
 glyphGroups(lines){const result=[];
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<Math.min(lines.length,i+4);j++){
   const pair=[lines[i],lines[j]],recognized=this.recognizeLines(pair);
   if(recognized&&recognized.source==='explicit_text'&&Math.abs(pair[0].y-pair[1].y)<16)result.push({lines:pair,recognized});
  }
  return result;
 }
 fromOCR(candidate,original){const parsed=this.parse(candidate?.text||'');
  return candidate.confidence>=97&&parsed?.latex===original.latex?{...parsed,source:'ocr_verified_against_native'}:null;}
 toRun(recognized,docx){const {Math:MathRun,MathRun:Run,MathSuperScript,MathSubScript,MathFraction,MathRadical}=docx;
  const a=recognized.ast,run=t=>[new Run(String(t))];
  if(a.type==='sup')return new MathSuperScript({children:run(a.base),superScript:run(a.script)});
  if(a.type==='sub')return new MathSubScript({children:run(a.base),subScript:run(a.script)});
  if(a.type==='fraction')return new MathFraction({numerator:run(a.numerator),denominator:run(a.denominator)});
  if(a.type==='radical')return new MathRadical({children:run(a.base)});
  return new Run(a.base);
 }
}
