// Exercise rows can span the page even when their options look like columns.
// Confidence is assessed per question; uncertain glyphs stay in a local crop.
const title = text => /^(?:思考题|自测题|练习题)$/.test(text.replace(/\s/g,''));
const section = text => /^[一二三四五六七八九十]+、(?:填空|判断|选择|计算|简答|技能)/.test(text);
const bodyHeading = text => /^\*?\d+\.\d+(?:\.\d+)?\s*[^\d.\s]|^本章小结$|^第\s*\d+\s*章/.test(text);
const question = text => /^\d{1,3}[.、]|^[［\[]题\s*\d+\.\d+[］\]]/.test(text);
// Recover only literal answer slots from an intact, single-line text layer.
// Missing vector blanks/brackets and mathematical notation remain image crops.
export function simpleQuestionText(lines) {
  if(lines.length!==1)return false;
  const line=lines[0],text=line.text.replace(/^\d+[.、]/,'');
  if(/[=+−*/×÷^∑Σ√<>≤≥Π\uFFFD]|权值|次方|指数|幂|[a-z]|[\u0400-\u04ff]/.test(text))return false;
  return !(line.items||[]).some(i=>!/^\d+[.、]$/.test(i.text)&&
    (Math.abs(i.y-line.y)>1.5||i.height<line.fontSize*.7||i.height>line.fontSize*1.3));
}
export function detectExerciseRegion(lines, width, height, previous = false) {
  const regions = []; let active = previous ? {top:50, left:30,right:width-30,bottom:height-35} : null;
  for (const line of [...lines].sort((a,b)=>a.y-b.y)) {
    if (title(line.text) || section(line.text)) {
      if (!active) active={top:line.y-line.fontSize-4,left:30,right:width-30,bottom:height-35};
    } else if (active && bodyHeading(line.text) && (line.fontSize>=12||line.bold||/^本章小结$/.test(line.text))) {
      active.bottom=line.y-line.fontSize-5; regions.push(active);active=null;
    }
  }
  if(active)regions.push(active);
  return {regions:regions.filter(r=>lines.some(l=>l.y>=r.top&&l.y<=r.bottom)),continues:!!active};
}
export function buildQuestionBlocks(lines, bounds, pageNumber) {
  const blocks=[],questions=[];let current=null,sectionType='',nextNumber=null;
  const push=()=>{if(current){questions.push(current);current=null}};
  for(const line of lines) {
    if(title(line.text)||section(line.text)){push();nextNumber=null;sectionType=line.text;blocks.push({kind:'text',type:'heading',level:2,text:line.text,lines:[line],x:line.x,y:line.y,fontSize:line.fontSize,category:'exercise'});continue}
    const number=/^(\d+)[.、]/.exec(line.text);
    if(question(line.text)&&(!number||nextNumber===null||Number(number[1])===nextNumber)){push();if(number)nextNumber=Number(number[1])+1;current={id:`p${pageNumber}-q${questions.length+1}`,lines:[],sectionType};}
    if(current)current.lines.push(line);
    else blocks.push({kind:'text',type:'paragraph',text:line.text,lines:[line],x:line.x,y:line.y,fontSize:line.fontSize,category:'exercise'});
  }
  push();let options=0,orphanOptions=0,orphanParentheses=0,singleCharacterFragments=0;
  for(const q of questions){
    const first=q.lines[0],text=q.lines.map(l=>l.text).join(' '),optionLines=[];let stem=[];
    for(const line of q.lines){
      const matches=[...line.text.matchAll(/(?:^|\s)([A-D])[.．、]\s*/g)];
      if(matches.length){
        for(let i=0;i<matches.length;i++)optionLines.push({label:matches[i][1],text:line.text.slice(matches[i].index+(line.text[matches[i].index]===' '?1:0),matches[i+1]?.index??line.text.length).trim(),line});
      }else stem.push(line);
    }
    optionLines.sort((a,b)=>a.label.localeCompare(b.label));options+=optionLines.length;
    const labels=optionLines.map(o=>o.label).join('');
    const fragments=q.lines.filter(l=>l.text.trim().length===1).length;
    const open=(text.match(/[（(]/g)||[]).length,close=(text.match(/[）)]/g)||[]).length;
    const fillBlank=/填空/.test(q.sectionType);
    const judgement=/判断/.test(q.sectionType);
    const safeJudgement=judgement&&simpleQuestionText(q.lines)&&open===1&&close===1&&/[（(]\s*[）)]\s*$/.test(text);
    const safeFill=fillBlank&&simpleQuestionText(q.lines)&&/_{2,}|＿{2,}/.test(text)&&open===close;
    const missingChoicePlaceholder=optionLines.length>0&&!/[（(][^（）()]*[）)]|[?？]/.test(stem.map(l=>l.text).join(' '));
    const numericNotation=/^[［\[]题/.test(first.text)&&q.lines.some(l=>/[0-9]+[)）][0-9]|BCD|вСР|CX|CXD/.test(l.text));
    const damaged=fragments>0||open!==close||/[Π]/.test(text)||(fillBlank&&!safeFill)||(judgement&&!safeJudgement)||numericNotation||missingChoicePlaceholder||(labels&&labels!=='ABCD');
    q.options=optionLines.length;q.confidence=damaged?'low':'high';
    if(!damaged&&(safeJudgement||safeFill))q.recovery=safeJudgement?'simple-judgement':'literal-fill-blank';
    q.reason=damaged?(fragments?'isolated-glyph':open!==close?'unbalanced-parentheses':/[Π]/.test(text)?'uncertain-glyph':fillBlank?'blank-lines-not-in-text':judgement?'answer-parentheses-and-exponents':numericNotation?'numeric-notation':missingChoicePlaceholder?'missing-choice-placeholder':labels&&labels!=='ABCD'?'incomplete-options':''):'';
    if(damaged){
      const last=q.lines.at(-1),next=lines.find(l=>l.y>last.y+1);
      // Answer brackets and blank rules may be absent from the text layer.
      // Use the full question width for those rows, not the text-only edge.
      const r={type:'exercise',questionId:q.id,reason:q.reason,imageClass:simpleQuestionText(q.lines)?'text':'formula',top:Math.max(bounds.top,first.y-first.fontSize-3),bottom:Math.min(bounds.bottom,next?next.y-next.fontSize-2:last.y+12,optionLines.length?last.y+10:Infinity),left:Math.max(bounds.left,Math.min(...q.lines.map(l=>l.x))-4),right:optionLines.length||judgement||fillBlank?bounds.right+15:Math.min(bounds.right+15,Math.max(...q.lines.map(l=>l.right))+4)};
      blocks.push({kind:'region',region:r,x:r.left,y:r.top,category:'exercise'});q.region=r;
    }else{
      if(stem.length)blocks.push({kind:'text',type:'question',text:stem.map(l=>l.text).join('').replace(/([（(])\s*([）)])/g,'$1  $2'),lines:stem,x:first.x,y:first.y,fontSize:first.fontSize,category:'exercise',questionId:q.id,keepNext:optionLines.length>0});
      for(const [i,o] of optionLines.entries())blocks.push({kind:'text',type:'option',text:o.text,lines:[o.line],x:o.line.x,y:first.y+.01*(i+1),fontSize:o.line.fontSize,category:'exercise',questionId:q.id,keepNext:i<optionLines.length-1});
    }
  }
  const loose=blocks.filter(b=>b.kind==='text'&&!b.questionId&&b.type!=='heading');
  orphanOptions=loose.filter(b=>/^[A-D][.．、]/.test(b.text)).length;
  orphanParentheses=loose.filter(b=>/^[()（）]+$/.test(b.text)).length;
  singleCharacterFragments=loose.filter(b=>b.text.trim().length===1).length;
  return {blocks,questions,stats:{questionsDetected:questions.length,optionsDetected:options,orphanOptions,orphanParentheses,singleCharacterFragments,exerciseFallbacks:questions.filter(q=>q.confidence==='low').length}};
}
