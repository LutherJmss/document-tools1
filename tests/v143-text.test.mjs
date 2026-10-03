import assert from 'node:assert/strict';import {TextQualityEngine} from '../text-quality.js';
const q=new TextQualityEngine(),healthy=['数字电子技术和二进制','逻辑门与真值表','寄存器编码触发器','数据结构算法','操作系统网络','科学技术','chapter 17','2ⁿ 和 A₂','简体汉字','数学公式','Truth table','二进制数(1011)₂'];
const warnings=['数字\uFFFD电子技术','二进制\uE123逻辑门','A\u0000B','第1章學長受不 绪论','字母AБ异常','數字電子技術','邏輯閘與網絡','觸發器','第2章噪声乱码绪论'];
for(const text of healthy)assert(!q.assess(text).needsRepair,text);
for(const text of warnings)assert.equal(q.assess(text,{heading:text.startsWith("第")}).status,'warning',text);
assert.equal(q.select('数字\uFFFD电子技术',{text:'数字电子技术',confidence:95},q.assess('数字\uFFFD电子技术'))?.text,'数字电子技术');
assert.equal(q.select('二进制\uFFFD逻辑门',{text:'二进制非逻辑门',confidence:89},q.assess('二进制\uFFFD逻辑门')),null);
console.log(JSON.stringify({cases:healthy.length+warnings.length,passed:healthy.length+warnings.length,selectionChecks:2},null,2));
