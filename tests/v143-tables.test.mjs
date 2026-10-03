import assert from 'node:assert/strict';import {detectSimpleTables} from '../word-table.js';
const line=(text,y,items)=>({text,y,x:65,right:440,fontSize:12,items:items||[{text,x:65,y,height:12,width:300}]});
const rows=[['A','B','AND','OR'],['0','0','0','0'],['0','1','0','1'],['1','0','0','1'],['1','1','1','1']];
const lines=[line('Table 1.1.1 Logic truth table',82),...rows.map((cells,n)=>line(cells.join(' '),127+n*30,cells.map((text,i)=>({text,x:77+i*95,y:127+n*30,height:12,width:24}))))];
assert.deepEqual(detectSimpleTables(lines,595,842)[0].table.rows,rows);
assert.equal(detectSimpleTables(lines.slice(1),595,842).length,0);
const inconsistent=structuredClone(lines);inconsistent[2].items[2].x+=18;assert.equal(detectSimpleTables(inconsistent,595,842).length,0);
const tiny=structuredClone(lines);tiny[2].items[1].height=6;assert.equal(detectSimpleTables(tiny,595,842).length,0);
console.log(JSON.stringify({passed:4},null,2));
