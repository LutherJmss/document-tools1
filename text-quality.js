// Risk assessment is heuristic; it is never an automatic script conversion.
export const SUBJECT_TERMS=['二进制','逻辑门','真值表','寄存器','编码','触发器','数据结构','操作系统','网络','算法','数字电子技术'];
const TRAD=/[數電術體邏輯閘觸發暫時進製換網絡編碼機關學習門與運據結構]/g;
const BAD=/[\uFFFD\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE\uFFFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const HAN=/[\u3400-\u9FFF]/g;
export class TextQualityEngine {
 assess(input,{heading=false}={}) {
  const text=String(input||''),bad=[...text.matchAll(BAD)].length+[...text].filter(c=>/[\uD800-\uDFFF]/u.test(c)).length;
  const rare=[...text].filter(c=>c.codePointAt(0)>0x20000&&/\p{Script=Han}/u.test(c)).length;
  const han=(text.match(HAN)||[]).length,traditional=(text.match(TRAD)||[]).length;
  const termHits=SUBJECT_TERMS.filter(t=>text.includes(t));
  const mixedScript=/[A-Za-z][\u0400-\u04FF]|[\u0400-\u04FF][A-Za-z]/.test(text);
  const chapter=heading&&/^第\s*\d+\s*章.{3,}绪论\s*$/.test(text);
  const needsRepair=bad>0||mixedScript||chapter;
  const status=needsRepair||traditional>0||rare>0?'warning':'ok';
  return {status,reason:needsRepair?'text_layer_abnormal':traditional?'traditional_script_warning':rare?'rare_character_warning':'none',rareCharacters:rare,
   needsRepair,abnormalCharacters:bad,traditionalRatio:han?+(traditional/han).toFixed(3):0,
   termHits,confidence:needsRepair?.62:traditional?.78:.98};
 }
 page(page,lines){const s=this.assess(lines.map(l=>l.text).join('\n'));
  return {page,status:lines.length?s.status:'warning',reason:lines.length?s.reason:'no_text_layer',confidence:lines.length?s.confidence:.1,
   abnormalCharacters:s.abnormalCharacters,traditionalRatio:s.traditionalRatio,termHits:s.termHits};}
 select(original,candidate,assessment,{heading=false}={}){
  const text=String(candidate?.text||'').replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'').trim();
  if(!assessment.needsRepair||candidate.confidence<85||!text||this.assess(text).needsRepair)return null;
  const digits=s=>s.match(/\d+/g)||[];
  if(JSON.stringify(digits(text))!==JSON.stringify(digits(original)))return null;
  if([...original].filter(x=>'不无非'.includes(x)).join('')!==[...text].filter(x=>'不无非'.includes(x)).join(''))return null;
  if(assessment.termHits.some(t=>!text.includes(t)))return null;
  if(!heading && /[數電術體邏輯閘觸發進製換網絡]/.test(original)&&!/[數電術體邏輯閘觸發進製換網絡]/.test(text))return null;
  const a=new Set(original.match(HAN)||[]),b=new Set(text.match(HAN)||[]);
  if(!heading&&a.size&&[...a].filter(c=>b.has(c)).length/a.size<.8)return null;
  if(this.assess(text).abnormalCharacters>=assessment.abnormalCharacters && !heading)return null;
  return {text,confidence:candidate.confidence};
 }
}
