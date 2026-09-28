// PDF text is positioned glyph data, not paragraphs. Keep a page model before
// constructing Word so uncertain graphic regions can be preserved as images.
const HAN = /[\u3400-\u9fff]/;
const PUNCT_END = /[。！？!?；;：:]$/;
const HEADINGS = [
  [/^第\s*\d+\s*章/, 1],
  [/^\d+\.\d+\.\d+\s*\S/, 3],
  [/^\d+\.\d+\s*\S/, 2],
  [/^[一二三四五六七八九十]+、\s*\S/, 4],
  [/^(内容提要|前言|目录|本章小结|练习题|思考题)$/, 2],
];
const median = values => { const a = [...values].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 10; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
    bold: /bold|hei|black/i.test((content.styles?.[item.fontName]?.fontFamily || '') + ' ' + item.fontName),
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
      fontName: line.items[0].fontName, bold: line.items.some(i => i.bold),
      text: joinSegments(line.items), items: line.items };
  }).filter(line => line.text).sort((a, b) => a.y - b.y || a.x - b.x);
}

export function detectHeading(line, bodySize) {
  const t = line.text.replace(/\s+/g, ' ').trim();
  for (const [pattern, level] of HEADINGS) if (pattern.test(t) && t.length < 55) return level;
  if (line.fontSize > bodySize * 1.55 && t.length < 36 && !/[。；,，]/.test(t)) return 2;
  return 0;
}

function isList(line) { return /^(?:[（(]?\d+[）).、]|[（(][一二三四五六七八九十]+[）)]|[①②③④⑤⑥⑦⑧⑨])/.test(line.text); }
function isCaption(line) { return /^(?:图|表)\s*\d+(?:\.\d+)+/.test(line.text); }
function isTableCaption(line) { return /^(?:表\s*\d+(?:\.\d+)+|续表)/.test(line.text); }
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

function detectRegions(lines, width, height, mode) {
  if (mode !== 'smart') return [];
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTableCaption(line)) {
      let end = i, foundRows = 0;
      for (let j = i + 1; j < lines.length && lines[j].y - line.y < 310; j++) {
        const next = lines[j], gaps = next.items.slice(1).map((item, k) => item.x - (next.items[k].x + next.items[k].width));
        const columns = gaps.some(g => g > 38) || (next.items.length >= 3 && next.width > 280);
        if (foundRows >= 2 && next.text.length > 48 && next.x < 120 && !columns) break;
        if (next.y - lines[end].y > 39 && foundRows >= 2) break;
        if (columns || foundRows) { end = j; if (columns) foundRows++; }
      }
      if (foundRows >= 2 && lines[end].y - line.y > 45) {
        regions.push(region('table', line.y - line.fontSize - 5, lines[end].y + 12, width, 57, width - 48));
        i = end; continue;
      }
    }
    if (/^图\s*\d+(?:\.\d+)+/.test(line.text)) {
      let body = i - 1;
      while (body >= 0 && line.y - lines[body].y < 185 && lines[body].text.length < 30) body--;
      const start = body >= 0 ? lines[body].y + 17 : line.y - 110;
      if (line.y - start > 40) {
        regions.push(region('figure', start, line.y + 22, width, 55, width - 45));
        continue;
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
  return regions.sort((a, b) => a.top - b.top).filter((r, i, all) => i === 0 || r.top >= all[i - 1].bottom);
}

function joinParagraphLine(previous, next) {
  const left = previous.text.at(-1), right = next.text[0];
  if (HAN.test(left) && HAN.test(right)) return previous.text + next.text;
  if (/[A-Za-z0-9)]/.test(left) && /[A-Za-z0-9(]/.test(right) && !/[-/]$/.test(previous.text)) return previous.text + ' ' + next.text;
  return previous.text + next.text;
}

export function mergeParagraphLines(lines, bodySize, width) {
  const blocks = [], baseLeft = Math.min(100, median(lines.filter(l => l.text.length > 20).map(l => l.x)));
  for (const line of lines) {
    const heading = detectHeading(line, bodySize);
    const type = heading ? 'heading' : isCaption(line) ? 'caption' : isList(line) ? 'list' : 'paragraph';
    const last = blocks.at(-1), prior = last?.lines.at(-1);
    const gap = prior ? line.y - prior.y : Infinity;
    const indented = line.x > baseLeft + 16;
    const fresh = !last || type !== 'paragraph' || last.type !== 'paragraph' ||
      gap > Math.max(25, bodySize * 2.3) || gap < 2 ||
      (indented && (!prior || Math.abs(line.x - prior.x) > 14)) ||
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

export function analyzePage(number, width, height, content, mode, repeated = new Set()) {
  const items = extractTextItems(content, height);
  const lines = detectHeaderFooter(buildLines(items), width, height, repeated);
  const bodySize = median(lines.filter(l => l.text.length > 20 && l.x < width * .55).map(l => l.fontSize));
  const regions = detectRegions(lines, width, height, mode);
  const visible = lines.filter(l => !regions.some(r => l.y >= r.top && l.y <= r.bottom));
  const blocks = mergeParagraphLines(visible, bodySize, width)
    .map(block => ({ ...block, kind: 'text' }));
  for (const r of regions) blocks.push({ kind: 'region', region: r, y: r.top });
  blocks.sort((a, b) => a.y - b.y);
  return { number, width, height, bodySize, blocks, regions, lines };
}

export function repeatedMargins(pages) {
  const counts = new Map();
  for (const p of pages) for (const l of p.lines) if (l.y < 55 || l.y > p.height - 35) {
    const key = l.text.replace(/\s|\d/g, '');
    if (key.length > 2) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= 3).map(([key]) => key));
}

export async function cropRegions(page, regions) {
  if (!regions.length) return [];
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, Math.sqrt(6000000 / (base.width * base.height)));
  const viewport = page.getViewport({ scale }), canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' }).promise;
    const images = [];
    for (const r of regions) {
      const x = Math.floor(r.left * scale), y = Math.floor(r.top * scale);
      const w = Math.min(canvas.width - x, Math.ceil((r.right - r.left) * scale));
      const h = Math.min(canvas.height - y, Math.ceil((r.bottom - r.top) * scale));
      if (w < 5 || h < 5) { images.push(null); continue; }
      const crop = document.createElement('canvas'); crop.width = w; crop.height = h;
      crop.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise((resolve, reject) => crop.toBlob(b => b ? resolve(b) : reject(new Error('区域图片生成失败')), 'image/png'));
      images.push(new Uint8Array(await blob.arrayBuffer())); crop.width = crop.height = 0;
    }
    return images;
  } finally { canvas.width = canvas.height = 0; page.cleanup(); }
}

export function buildEditableDocx(models, docx, mode) {
  const { Document, Paragraph, TextRun, ImageRun, HeadingLevel } = docx;
  const children = [], stats = { paragraphs: 0, shortParagraphs: 0, singleCharacterParagraphs: 0,
    headings: 0, images: 0, tables: 0, formulaFallbacks: 0 };
  for (const [index, page] of models.entries()) {
    let first = true;
    for (const block of page.blocks) {
      const pageBreakBefore = mode === 'smart' && index > 0 && first &&
        block.kind === 'text' && block.type === 'heading' && block.level === 1;
      first = false;
      if (block.kind === 'region') {
        if (!block.image) continue;
        const r = block.region, maxWidth = Math.min(page.width - 76, 500);
        const factor = Math.min(1, maxWidth / (r.right - r.left), 560 / (r.bottom - r.top));
        const width = (r.right - r.left) * factor * 96 / 72, height = (r.bottom - r.top) * factor * 96 / 72;
        children.push(new Paragraph({ pageBreakBefore, spacing: { before: 70, after: 90 },
          alignment: 'center', children: [new ImageRun({ data: block.image, type: 'png',
            transformation: { width, height }, altText: { title: block.region.type, description: 'PDF 区域外观保留', name: 'pdf-region' } })] }));
        stats.images++; if (r.type === 'table') stats.tables++; if (r.type === 'formula') stats.formulaFallbacks++;
        continue;
      }
      const text = block.text.trim();
      if (!text) continue;
      const heading = block.type === 'heading', caption = block.type === 'caption';
      const sourceSize = clamp(block.fontSize, 8, 18), size = heading ?
        clamp(Math.max(sourceSize, block.level === 1 ? 17 : block.level === 2 ? 14 : 11), 11, 18) :
        clamp(sourceSize, 9.3, 11.5);
      const level = heading ? [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][block.level] : undefined;
      const paragraph = new Paragraph({
        ...(pageBreakBefore ? { pageBreakBefore } : {}),
        ...(level ? { heading: level } : {}),
        ...((heading || caption) ? { keepNext: true } : {}),
        ...(block.align === 'center' || caption ? { alignment: 'center' } : {}),
        ...(block.indent && !heading && block.type === 'paragraph' ? { indent: { firstLine: Math.round(size * 40) } } : {}),
        spacing: { before: heading ? 125 : caption ? 65 : 0,
          after: heading ? 60 : caption ? 55 : 55, line: Math.round(size * 27) },
        children: [new TextRun({ text, font: 'Microsoft YaHei', size: Math.round(size * 2),
          ...(heading ? { bold: true } : {}), color: '000000' })],
      });
      children.push(paragraph);
      stats.paragraphs++; if (text.length <= 5) stats.shortParagraphs++;
      if (text.length === 1) stats.singleCharacterParagraphs++;
      if (heading) stats.headings++;
    }
  }
  const firstPage = models[0];
  const size = { width: Math.round(firstPage.width * 20), height: Math.round(firstPage.height * 20) };
  const doc = new Document({ creator: '文档小站', title: 'PDF 转 Word',
    sections: [{ properties: { page: { size, margin: { top: 600, bottom: 600, left: 630, right: 630 } } }, children }] });
  return { doc, stats };
}
