// PDF text is positioned glyph data, not paragraphs. Keep a page model before
// constructing Word so uncertain graphic regions can be preserved as images.
import { detectTableStructure, buildWordTable } from './word-table.js';
import { inferCaptionFigures } from './word-graphics.js';
export { cropRegions } from './word-graphics.js';
const HAN = /[\u3400-\u9fff]/;
const PUNCT_END = /[。！？!?；;：:]$/;
const median = values => { const a = [...values].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 10; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function normalizePdfFontName(name = '') { return name.replace(/^[A-Z]{6}\+/, '').replace(/[\s-]/g, '').toLowerCase(); }
export function mapPdfFont(name = '', text = '', heading = false) {
  const f = normalizePdfFontName(name);
  if (heading && HAN.test(text)) return 'Microsoft YaHei';
  if (/courier/.test(f)) return 'Courier New';
  if (/cambria.?math|math/.test(f)) return 'Cambria Math';
  if (/times|roman/.test(f)) return 'Times New Roman';
  if (/helvetica|arial/.test(f)) return 'Arial';
  if (/simhei|hei|black/.test(f)) return 'SimHei';
  if (/simsun|stsong|song/.test(f)) return 'SimSun';
  return heading ? 'Microsoft YaHei' : HAN.test(text) ? 'SimSun' : 'Times New Roman';
}

function joinSegments(parts) {
  let text = '', previous = null;
  for (const part of parts) {
    const value = part.text.trim();
    if (!value) continue;
    if (previous) {
      const gap = part.x - (previous.x + previous.width);
      const a = text.at(-1), b = value[0];
      // PDF.js sometimes splits a Chinese line into many glyph runs. Never
      // infer spaces between Han glyphs solely from their x coordinates.
      if (gap > 1.8 && !HAN.test(a) && !HAN.test(b) && /[\w)]/.test(a) && /[\w(]/.test(b)) text += ' ';
      else if (gap > 4 && ((HAN.test(a) && /[A-Za-z]/.test(b)) || (/[A-Za-z]/.test(a) && HAN.test(b)))) text += ' ';
    }
    text += value;
    previous = part;
  }
  return text.replace(/\s+([，。；：！？、,.!?;:）])/g, '$1').trim();
}

export function extractTextItems(content, pageHeight) {
  return content.items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => ({
    text: item.str,
    x: item.transform[4], y: pageHeight - item.transform[5],
    width: Math.max(0, item.width || 0),
    height: Math.max(5, item.height || Math.abs(item.transform[3]) || 10),
    fontName: item.fontName || '',
    fontFamily: content.styles?.[item.fontName]?.fontFamily || '',
    bold: /bold|semibold|demi|black|heavy|simhei/i.test((content.styles?.[item.fontName]?.fontFamily || '') + ' ' + item.fontName),
  })).filter(item => Number.isFinite(item.x) && Number.isFinite(item.y));
}

export function buildLines(items) {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x), lines = [];
  for (const item of ordered) {
    let line = lines.findLast(line => Math.abs(line.baseline - item.y) <= Math.max(2.8, Math.min(line.fontSize, item.height) * .27));
    if (!line) { line = { baseline: item.y, fontSize: item.height, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(line => {
    line.items.sort((a, b) => a.x - b.x);
    const x = Math.min(...line.items.map(i => i.x)), right = Math.max(...line.items.map(i => i.x + i.width));
    const fontSize = median(line.items.map(i => i.height));
    return { x, y: line.baseline, width: right - x, right, fontSize,
      fontName: line.items[0].fontFamily || line.items[0].fontName, bold: line.items.some(i => i.bold),
      text: joinSegments(line.items), items: line.items };
  }).filter(line => line.text).sort((a, b) => a.y - b.y || a.x - b.x);
}

export function detectTOCRegion(lines) {
  const title = lines.some(l => /^目\s*录$|^目录$/.test(l.text.trim()));
  const entries = lines.filter(l => /^(?:\*?第\s*\d+\s*章|\*?\d+\.\d+|附录\s*[A-Z])/.test(l.text) &&
    (/[.·…⋯]{2,}|\d{1,3}\s*$/.test(l.text) || /\d{1,3}\s+\S/.test(l.text)));
  return { isTOC: (title && entries.length >= 2) || entries.length >= 8,
    entries: entries.length };
}

export function detectColumns(items, width, height) {
  const candidates = items.filter(i => i.y > 55 && i.y < height - 45 && i.text.length > 4 && i.width < width * .52);
  const left = candidates.filter(i => i.x + i.width < width * .49), right = candidates.filter(i => i.x > width * .51);
  const span = a => a.length ? Math.max(...a.map(i => i.y)) - Math.min(...a.map(i => i.y)) : 0;
  const crossing = candidates.filter(i => i.x < width * .49 && i.x + i.width > width * .51).length;
  const confidence = Math.min(1, Math.min(left.length, right.length) / 16) *
    Math.min(1, Math.min(span(left), span(right)) / (height * .45)) *
    (crossing > 5 ? .35 : 1);
  return { count: left.length >= 8 && right.length >= 8 && confidence > .55 ? 2 : 1,
    confidence: +confidence.toFixed(2) };
}

export function detectHeading(line, bodySize, context = {}) {
  const t = line.text.replace(/\s+/g, ' ').trim();
  if (context.toc || t.length > 46 || /[=×÷∑Σ∫√]/.test(t) ||
      /^[（(]?\d+(?:\.\d+){2,}[）)]?$/.test(t) || isCaption(line) ||
      /^\(?\d+[）).、]/.test(t) || /[?？；;]$/.test(t)) return 0;
  const xOK = line.x < (context.width || 600) * .55;
  const gap = context.previous ? line.y - context.previous.y : 40;
  if (/^第\s*\d+\s*章\s*\S{0,18}$/.test(t) && xOK && (gap > 10 || line.fontSize > bodySize * 1.1)) return 1;
  if (/^\d+\.\d+\.\d+\s*[^\d.\s]\S{0,32}$/.test(t) && xOK) return 3;
  if (/^\d+\.\d+\s*[^\d.\s]\S{0,32}$/.test(t) && xOK) return 2;
  if (/^[一二三四五六七八九十]+、\s*\S{1,28}$/.test(t) && line.x < (context.width || 600) * .35 && !/[。,:，]/.test(t)) return 4;
  if (/^(内容提要|前言|本章小结|练习题|思考题)$/.test(t)) return 2;
  if (context.previous && /^第\s*\d+\s*章/.test(context.previous.text) &&
      line.fontSize > bodySize * 1.3 && t.length < 18 && xOK) return 2;
  if (line.bold && line.fontSize > bodySize * 1.25 && t.length < 24 && xOK && gap > bodySize * 1.5) return 2;
  return 0;
}

function isList(line) { return /^(?:[（(]?\d+[）).、]|[（(][一二三四五六七八九十]+[）)]|[①②③④⑤⑥⑦⑧⑨])/.test(line.text); }
function isCaption(line) { return /^(?:图|表|Figure|Table)\s*\d+(?:\.\d+)+/i.test(line.text); }
function isTableCaption(line) { return /^(?:表|Table)\s*\d+(?:\.\d+)+|^续表/i.test(line.text); }
function mathLine(line) {
  return line.x > 95 && line.text.length < 125 &&
    (/[=∑Σ∫√≈≤≥×÷^]/.test(line.text) || /\(\s*\d+(?:\.\d+){2,}\s*\)/.test(line.text) ||
      /^\(?\d+(?:\.\d+)+\)?$/.test(line.text)) &&
    !/^[一二三四五六七八九十]+、/.test(line.text);
}
function region(type, first, last, pageWidth, x1 = 35, x2 = pageWidth - 35) {
  return { type, top: clamp(first, 0, 20000), bottom: clamp(last, 0, 20000),
    left: clamp(x1, 0, pageWidth), right: clamp(x2, 0, pageWidth) };
}

export function detectHeaderFooter(lines, width, height, repeated = new Set()) {
  return lines.filter(line => {
    const t = line.text.replace(/\s/g, '');
    if (line.y < 52 || line.y > height - 35) {
      if (/^[IVX\d]+$/.test(t) || repeated.has(t.replace(/\d/g, '')) || (line.text.length < 40 && line.fontSize < 12)) return false;
    }
    // Marginal QR labels and side notes are not part of the main reading order.
    if ((line.x < 50 || line.x > width - 75) && line.width < 75 && /微视频|扫码/.test(t)) return false;
    return true;
  });
}

function detectRegions(lines, width, height, mode, graphics = []) {
  if (mode !== 'smart') return [];
  const regions = [...graphics];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTableCaption(line)) {
      let end = i, foundRows = 0;
      for (let j = i + 1; j < lines.length && lines[j].y - line.y < 310; j++) {
        const next = lines[j], gaps = next.items.slice(1).map((item, k) => item.x - (next.items[k].x + next.items[k].width));
        const columns = gaps.some(g => g > 38) || (next.items.length >= 3 && next.width > 280);
        if (foundRows >= 2 && next.text.length > 48 && next.x < 120 && !columns) break;
        if (next.y - lines[end].y > 28 && foundRows >= 2) break;
        if (columns || foundRows) { end = j; if (columns) foundRows++; }
      }
      if (foundRows >= 2 && lines[end].y - line.y > 45) {
        regions.push(region('table', line.y - line.fontSize - 5, lines[end].y + 12, width, 57, width - 48));
        i = end; continue;
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!mathLine(line) || regions.some(r => line.y >= r.top && line.y <= r.bottom)) continue;
    let start = i, end = i;
    while (start > 0 && line.y - lines[start - 1].y < 27 && !detectHeading(lines[start - 1], 10) &&
      (mathLine(lines[start - 1]) || lines[start - 1].text.length < 12)) start--;
    while (end + 1 < lines.length && lines[end + 1].y - lines[end].y < 27 &&
      !detectHeading(lines[end + 1], 10) &&
      (mathLine(lines[end + 1]) || lines[end + 1].text.length < 12)) end++;
    const group = lines.slice(start, end + 1);
    if (group.some(l => detectHeading(l, 10) || l.text.length > 135)) continue;
    // PDF text coordinates are baselines. The following prose often begins
    // less than one line height below an equation; a generous bottom margin
    // catches the top of that prose and makes a visibly clipped duplicate.
    const previous = lines[start - 1], following = lines[end + 1];
    const top = Math.max(lines[start].y - Math.max(...group.map(l => l.fontSize)) - 2,
      previous ? previous.y + 3 : 0);
    const bottom = Math.min(lines[end].y + 3,
      following ? following.y - following.fontSize - 2 : height);
    if (bottom - top > 12) regions.push(region('formula', top, bottom, width, 65, width - 15));
    i = end;
  }
  return regions.sort((a, b) => a.top - b.top).filter((r, i, all) => i === 0 ||
    r.top >= all[i - 1].bottom || r.right < all[i - 1].left || r.left > all[i - 1].right);
}

function joinParagraphLine(previous, next) {
  const left = previous.text.at(-1), right = next.text[0];
  if (HAN.test(left) && HAN.test(right)) return previous.text + next.text;
  if (/[A-Za-z0-9)]/.test(left) && /[A-Za-z0-9(]/.test(right) && !/[-/]$/.test(previous.text)) return previous.text + ' ' + next.text;
  return previous.text + next.text;
}

export function mergeParagraphLines(lines, bodySize, width, toc = false) {
  const blocks = [], baseLeft = Math.min(100, median(lines.filter(l => l.text.length > 20).map(l => l.x)));
  for (const [i,line] of lines.entries()) {
    const heading = detectHeading(line, bodySize, {toc,width,previous:lines[i-1],next:lines[i+1]});
    const type = isCaption(line) ? 'caption' : heading ? 'heading' : isList(line) ? 'list' : toc ? 'toc' : 'paragraph';
    const last = blocks.at(-1), prior = last?.lines.at(-1);
    const gap = prior ? line.y - prior.y : Infinity;
    const indented = line.x > baseLeft + 16;
    const continuation = last?.type === 'list' && type === 'paragraph' && gap > 0 && gap < 24 &&
      Math.abs(line.x-prior.x)<35;
    const fresh = !last || (!continuation && (type !== 'paragraph' || last.type !== 'paragraph')) ||
      gap > Math.max(25, bodySize * 2.3) || gap < 2 ||
      (!continuation && indented && (!prior || Math.abs(line.x - prior.x) > 14)) ||
      (prior && PUNCT_END.test(prior.text) && indented) ||
      (prior && Math.abs(line.fontSize - prior.fontSize) > 2.5) ||
      (prior && prior.right < width * .67 && PUNCT_END.test(prior.text));
    if (fresh) blocks.push({ type, level: heading, text: line.text, lines: [line],
      x: line.x, y: line.y, fontSize: line.fontSize, bold: line.bold,
      indent: indented, align: line.x > width * .29 && line.right < width * .75 ? 'center' : 'left' });
    else { last.text = joinParagraphLine({ text: last.text }, line); last.lines.push(line); }
  }
  return blocks;
}

export function analyzePage(number, width, height, content, mode, repeated = new Set(), graphicInfo = {}, previousTOC = false) {
  const items = extractTextItems(content, height);
  const qr = graphicInfo.regions?.filter(r => r.type === 'qr') || [];
  const cleanItems = items.filter(i => !qr.some(r => i.x < r.right + 4 && i.y >= r.top && i.y <= r.bottom));
  const columnInfo = detectColumns(cleanItems, width, height);
  const continuation=previousTOC && detectTOCRegion(buildLines(cleanItems)).entries>=3;
  if(continuation && columnInfo.count===1) {
    const left=cleanItems.filter(i=>i.x<width*.47).length;
    const right=cleanItems.filter(i=>i.x>width*.53).length;
    if(left>=3&&right>=3) {columnInfo.count=2;columnInfo.confidence=Math.max(columnInfo.confidence,.6)}
  }
  const makeLines = source => detectHeaderFooter(buildLines(source), width, height, repeated);
  const lines = columnInfo.count === 2 ?
    [...makeLines(cleanItems.filter(i => i.x + i.width / 2 < width / 2)),
      ...makeLines(cleanItems.filter(i => i.x + i.width / 2 >= width / 2))] : makeLines(cleanItems);
  const toc = detectTOCRegion(lines);
  if(continuation)toc.isTOC=true;
  const bodySize = median(lines.filter(l => l.text.length > 20 && l.x < width * .55).map(l => l.fontSize));
  const graphics = [...(graphicInfo.regions || []), ...inferCaptionFigures(lines, width, height)];
  const regions = detectRegions(lines, width, height, mode, graphics);
  for (const r of regions) if (r.type === 'table') r.table = detectTableStructure(r, lines);
  const visible = lines.filter(l => !regions.some(r => l.y >= r.top && l.y <= r.bottom &&
    (r.type !== 'qr' || l.x < r.right + 5)));
  const blocks = mergeParagraphLines(visible, bodySize, width, toc.isTOC)
    .map(block => ({ ...block, kind: 'text' }));
  for (const r of regions) {
    if (r.type === 'table' && r.table?.confidence === 'high') {
      if (r.table.caption) blocks.push({kind:'text',type:'caption',text:r.table.caption,y:r.top,x:r.left,fontSize:9});
      blocks.push({kind:'table',region:r,table:r.table,y:r.top+2,x:r.left});
    } else blocks.push({ kind: 'region', region: r, y: r.top, x:r.left });
  }
  blocks.sort((a, b) => columnInfo.count === 2 ?
    (Number(a.x >= width/2)-Number(b.x >= width/2)) || a.y-b.y : a.y-b.y);
  return { number, width, height, bodySize, blocks, regions, lines, toc, columnInfo,
    graphicsDetected:graphicInfo.graphicsDetected||0, rasterBackground:!!graphicInfo.rasterBackground,
    qrDetected:graphicInfo.qrDetected||0 };
}

export function repeatedMargins(pages) {
  const counts = new Map();
  for (const p of pages) for (const l of p.lines) if (l.y < 55 || l.y > p.height - 35) {
    const key = l.text.replace(/\s|\d/g, '');
    if (key.length > 2) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= 3).map(([key]) => key));
}

function estimateMargins(models) {
  const selected=models.filter(p=>!p.toc.isTOC&&p.lines.length>5);
  const body=selected.flatMap(p=>p.lines.filter(l=>l.text.length>20&&l.x>25&&l.x<p.width*.55));
  const left=median(body.map(l=>l.x)),right=median(selected.flatMap(p=>p.lines.filter(l=>l.text.length>20&&l.x>25).map(l=>p.width-l.right)).filter(x=>x>10));
  const top=median(selected.map(p=>Math.min(...p.lines.filter(l=>l.y>45).map(l=>l.y),70)));
  const bottom=median(selected.map(p=>p.height-Math.max(...p.lines.filter(l=>l.y<p.height-25).map(l=>l.y),p.height-45)));
  return {left:clamp(Math.round(left*.7*20),576,1728),right:clamp(Math.round(right*.7*20),576,1728),
    top:clamp(Math.round(top*.5*20),576,1728),bottom:clamp(Math.round(bottom*.7*20),576,1728)};
}

export function buildEditableDocx(models, docx, mode) {
  const {Document,Paragraph,TextRun,ImageRun,HeadingLevel}=docx;
  const stats={paragraphs:0,shortParagraphs:0,singleCharacterParagraphs:0,headings:0,realHeadings:0,
    tocEntries:0,images:0,tables:0,editableTables:0,tableFallbacks:0,formulaFallbacks:0,
    figures:0,figureRegions:0,qrPreserved:0,captions:0,graphicsDetected:0,rasterBackgroundPages:0,
    columnsDetected:0,columnConfidence:0,sections:0,fontMappings:{}};
  const margins=estimateMargins(models),sections=[];
  for(const [index,page] of models.entries()) {
    stats.graphicsDetected+=page.graphicsDetected;stats.rasterBackgroundPages+=Number(page.rasterBackground);
    stats.columnsDetected+=Number(page.columnInfo.count>1);
    stats.columnConfidence=Math.max(stats.columnConfidence,page.columnInfo.confidence);
    stats.figureRegions+=page.regions.filter(r=>r.type==='figure').length;
    stats.tables+=page.regions.filter(r=>r.type==='table').length;
    let section=sections.at(-1);
    if(!section||Math.abs(section.w-page.width)>3||Math.abs(section.h-page.height)>3) {
      section={w:page.width,h:page.height,children:[]};sections.push(section);
    }
    let first=true;
    for(const block of page.blocks) {
      const pageBreakBefore=mode==='smart'&&index>0&&first&&block.kind==='text'&&block.type==='heading'&&block.level===1;
      first=false;
      if(block.kind==='table') {
        section.children.push(buildWordTable(block.table,docx,Math.round(page.width*20)-margins.left-margins.right));stats.editableTables++;
        continue;
      }
      if(block.kind==='region') {
        const r=block.region;
        if(!r.image)continue;
        const maxWidth=Math.min(page.width-76,500),factor=Math.min(1,maxWidth/(r.right-r.left),560/(r.bottom-r.top));
        const width=(r.right-r.left)*factor*96/72,height=(r.bottom-r.top)*factor*96/72;
        section.children.push(new Paragraph({pageBreakBefore,keepNext:!!r.caption,spacing:{before:70,after:80},
          alignment:'center',children:[new ImageRun({data:r.image,type:'png',transformation:{width,height},
            altText:{title:r.type,description:'PDF 区域外观保留',name:'pdf-region'}})]}));
        stats.images++;if(r.type==='table')stats.tableFallbacks++;
        if(r.type==='formula')stats.formulaFallbacks++;
        if(r.type==='figure')stats.figures++;
        if(r.type==='qr')stats.qrPreserved++;
        continue;
      }
      const value=block.text.trim();if(!value)continue;
      const heading=block.type==='heading',caption=block.type==='caption',toc=block.type==='toc';
      const sourceSize=clamp(block.fontSize||10,8,18),size=heading?
        clamp(Math.max(sourceSize,block.level===1?17:block.level===2?14:11),11,18):clamp(sourceSize,9.3,11.5);
      const level=heading?[null,HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,HeadingLevel.HEADING_4][block.level]:undefined;
      const font=mapPdfFont(block.lines?.[0]?.fontName||'',value,heading);
      stats.fontMappings[font]=(stats.fontMappings[font]||0)+1;
      section.children.push(new Paragraph({
        ...(pageBreakBefore?{pageBreakBefore}:{}),...(level?{heading:level}:{}),
        ...(caption?{style:'Caption'}:{}),...((heading||caption)?{keepNext:caption?false:true}:{}),
        ...(block.align==='center'||caption?{alignment:'center'}:{}),
        ...(block.indent&&!heading&&block.type==='paragraph'?{indent:{firstLine:Math.round(size*40)}}:{}),
        spacing:{before:heading?125:caption?65:0,after:heading?60:caption?55:55,line:Math.round(size*27)},
        children:[new TextRun({text:value,font,size:Math.round(size*2),...(heading?{bold:true}:{}),color:'000000'})],
      }));
      stats.paragraphs++;if(value.length<=5)stats.shortParagraphs++;
      if(value.length===1)stats.singleCharacterParagraphs++;
      if(heading){stats.headings++;stats.realHeadings++}
      if(caption)stats.captions++;
      if(toc)stats.tocEntries++;
    }
  }
  stats.sections=sections.length;stats.estimatedMargins=margins;
  const shortRatio=stats.paragraphs?stats.shortParagraphs/stats.paragraphs:0;
  stats.layoutQualityScore=clamp(Math.round(100-shortRatio*75-stats.singleCharacterParagraphs*1.2-
    Math.max(0,stats.headings/models.length-3)*5-(stats.tableFallbacks/Math.max(stats.tables,1))*8-
    Math.max(0,stats.sections-3)*4),0,100);
  const doc=new Document({creator:'文档小站',title:'PDF 转 Word',
    styles:{default:{document:{run:{font:'SimSun',size:21}}},paragraphStyles:[
      {id:'Caption',name:'Caption',basedOn:'Normal',run:{font:'SimSun',size:18},paragraph:{alignment:'center'}},
      {id:'TableText',name:'Table Text',basedOn:'Normal',run:{font:'SimSun',size:20}},
    ]},
    sections:sections.map(s=>({properties:{page:{size:{width:Math.round(s.w*20),height:Math.round(s.h*20)},margin:margins}},children:s.children}))});
  return {doc,stats};
}
