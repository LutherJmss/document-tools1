import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {FormulaRecognizer} from '../formula-recognizer.js';
const require=createRequire(import.meta.url),docx=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/docx');
const recognizer=new FormulaRecognizer();
const editable=['2^n','2^3','3^2','x^2','x^n','a^3','A_2','B_1','x_0','Q_3','(1011)_2','(1101)_2','(17)_8','(101)_10','(1A)_16','A+B=C','A-B=C','X+Y=Z','P+Q=R','\\frac{1}{2}','\\frac{a}{b}','\\sqrt{2}','\\sqrt{x}','2ⁿ'];
const keepImage=['A2','21','1/2','√x','\\frac{a+b}{c}','\\sqrt{x+1}','(102)_2','(1G)_16','∑i=1','x^n+y^n','A+B','a*b=c'];
for(const input of editable){const parsed=recognizer.parse(input);assert(parsed,`expected OMML: ${input}`);assert(recognizer.toRun(parsed,docx));}
for(const input of keepImage)assert.equal(recognizer.parse(input),null,`unsafe ${input}`);
const paragraphs=editable.map(input=>new docx.Paragraph({children:[new docx.Math({children:[recognizer.toRun(recognizer.parse(input),docx)]})]}));
const buffer=await docx.Packer.toBuffer(new docx.Document({sections:[{children:paragraphs}]}));
const JSZip=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/jszip'),z=await JSZip.loadAsync(buffer),xml=await z.file('word/document.xml').async('string');
assert.equal([...xml.matchAll(/<m:oMath>/g)].length,editable.length);
console.log(JSON.stringify({cases:36,passed:36,restored:24,fallback:12,editableRate:24/36,ommlExpressions:24},null,2));
