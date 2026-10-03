import assert from 'node:assert/strict';
import {buildQuestionBlocks} from '../word-exercise.js';
const bounds={top:50,bottom:750,left:30,right:565};
const line=(text,y=100)=>({text,y,x:65,width:450,right:515,fontSize:10,items:[{text,x:65,y,width:450,height:10}]});
const tests=[];function check(name,fn){fn();tests.push(name)}
function question(section,text,extra=[]){return buildQuestionBlocks([line(section,70),line(text),...extra],bounds,1)}
check('simple judgement with literal paired answer brackets becomes text',()=>{const r=question('二、判断题','1.数字电路具有抗干扰能力。()');assert.equal(r.stats.exerciseFallbacks,0);assert.equal(r.questions[0].recovery,'simple-judgement');assert(r.blocks.some(b=>b.text?.endsWith('(  )')))});
check('literal underscores become editable without guessing missing blanks',()=>{const r=question('一、填空题','1.逻辑电路分为____和____。');assert.equal(r.stats.exerciseFallbacks,0);assert(r.blocks.some(b=>b.text?.includes('____')))});
check('missing judgement brackets still fall back',()=>assert.equal(question('二、判断题','1.数字电路具有抗干扰能力。').stats.exerciseFallbacks,1));
check('missing fill rules still fall back',()=>assert.equal(question('一、填空题','1.逻辑电路分为和。').stats.exerciseFallbacks,1));
check('superscripts and powers still fall back',()=>{for(const t of ['1.n位数最高位的权值为21。()','1.计算2^3=8。()'])assert.equal(question('二、判断题',t).stats.exerciseFallbacks,1)});
check('displaced small glyph still falls back',()=>{const l=line('1.这个命题()');l.items.push({text:'2',y:96,height:5});assert.equal(question('二、判断题',l.text).stats.exerciseFallbacks,0);assert.equal(buildQuestionBlocks([line('二、判断题',70),l],bounds,1).stats.exerciseFallbacks,1)});
check('multi-line expressions still fall back',()=>assert.equal(question('二、判断题','1.这个命题', [line('()以外还有表达式',120)]).stats.exerciseFallbacks,1));
check('ordinary choice retains all four option labels',()=>{const r=question('三、选择题','1.请选择正确答案()', [line('A.甲 B.乙 C.丙 D.丁',120)]);assert.equal(r.stats.exerciseFallbacks,0);assert.deepEqual(r.blocks.filter(b=>b.type==='option').map(b=>b.text[0]),['A','B','C','D'])});
console.log(JSON.stringify({passed:tests.length,tests},null,2));
