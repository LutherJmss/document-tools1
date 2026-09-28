import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.min.mjs';
import { analyzePage, buildEditableDocx, cropRegions, extractTextItems, buildLines, repeatedMargins } from './word-layout.js';
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs';
const $ = id => document.getElementById(id);
const { PDFDocument, degrees } = window.PDFLib;
const states = new Map();
const libraries = new Map();
const LIMIT = 50 * 1024 * 1024;

function loadScript(src) {
  if (!libraries.has(src)) libraries.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve;
    script.onerror = () => { libraries.delete(src); script.remove(); reject(new Error('组件加载失败，请刷新后重试')); };
    document.head.appendChild(script);
  }));
  return libraries.get(src);
}
function status(task, message, error = false) {
  const node = $(task + 'Status'); node.textContent = message; node.classList.toggle('error', error);
}
function clearResult(task) {
  const s = states.get(task);
  if (s.url) URL.revokeObjectURL(s.url);
  s.url = null; s.download.disabled = true; s.name.textContent = '';
}
function fileBase(file) { return file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'document'; }
function selected(id, multiple = false) {
  const files = Array.from($(id).files);
  if (!files.length) throw new Error('请先选择文件');
  if (files.reduce((n, f) => n + f.size, 0) > LIMIT) throw new Error('本次文件总大小超过 50 MB，请分批处理');
  return multiple ? files : files[0];
}
function selectedPages(task, max) {
  const spec = $(task + 'Pages').value.trim();
  return spec ? parsePages(spec, max) : Array.from({ length: max }, (_, i) => i);
}
async function run(task, job) {
  const s = states.get(task); if (s.busy) return;
  clearResult(task); s.busy = true;
  const controls = [...s.card.querySelectorAll('input, select, button:not(.download)')];
  controls.forEach(node => node.disabled = true); status(task, '处理中…');
  try {
    const result = await job();
    if (!result.blob.size) throw new Error('没有生成可下载内容');
    s.url = URL.createObjectURL(result.blob); s.filename = result.name;
    s.name.textContent = result.name + ' · ' + (result.blob.size / 1024).toFixed(1) + ' KB';
    s.download.disabled = false; status(task, result.message || '处理完成，请点击下方按钮下载。');
  } catch (e) {
    const message = /password|encrypted/i.test(e.message) ? '文件已加密，请先解锁 PDF 后重试。' : /Invalid PDF|PDF structure|No PDF header/i.test(e.message) ? 'PDF 文件已损坏或格式无效，请重新选择文件。' : (e.message || '文件无法处理，请检查格式后重试');
    status(task, '未完成：' + message, true);
  } finally { s.busy = false; controls.forEach(node => node.disabled = false); }
}
function output(bytes, name, type = 'application/pdf', message) { return { blob: bytes instanceof Blob ? bytes : new Blob([bytes], { type }), name, message }; }

// Validate the entire expression before expanding it: no silent truncation or huge loops.
export function parsePages(spec, max) {
  const ids = new Set(); const parts = spec.replaceAll('，', ',').split(',');
  if (!spec.trim()) throw new Error('请输入页码，例如 1,3,5-8');
  for (const raw of parts) {
    const match = raw.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('页码格式无效，请使用 1,3,5-8 这样的格式');
    let a = Number(match[1]), b = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1 || a > max || b > max) throw new Error('页码超出范围：此文件共 ' + max + ' 页');
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) ids.add(i - 1);
  }
  return [...ids].sort((a, b) => a - b);
}
async function withPdf(file, task, fn) {
  const loader = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/cmaps/', cMapPacked: true, standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/standard_fonts/', wasmUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/wasm/', isEvalSupported: false });
  let rejectPassword;
  const passwordError = new Promise((resolve, reject) => { rejectPassword = reject; });
  loader.onPassword = () => rejectPassword(new Error('文件已加密，请先解锁 PDF 后重试。'));
  try {
    const pdf = await Promise.race([loader.promise, passwordError]);
    if (pdf.numPages > 100) throw new Error('此功能每次最多处理 100 页，请先拆分文件');
    return await fn(pdf);
  } finally { await loader.destroy(); }
}
async function renderPage(page, format = 'png', requestedScale = 2) {
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(requestedScale, Math.sqrt(6000000 / (original.width * original.height)), 4096 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' }).promise;
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片生成失败')), format === 'jpg' ? 'image/jpeg' : 'image/png', .88));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: original.width, height: original.height };
  } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
}
function linesFromContent(content) {
  const lines = []; let line = '', lastY = null, endX = 0;
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform[5], x = item.transform[4];
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, Math.abs(item.transform[3]) * .35)) { if (line.trim()) lines.push(line); line = ''; }
    if (line && x - endX > 2 && !/\s$/.test(line)) line += ' ';
    line += item.str; lastY = y; endX = x + item.width;
    if (item.hasEOL) { if (line.trim()) lines.push(line); line = ''; lastY = null; }
  }
  if (line.trim()) lines.push(line);
  return lines;
}
async function extractText(pdf, task, ids) {
  const pages = []; let empty = 0;
  for (const [index, id] of ids.entries()) {
    status(task, `正在提取第 ${id + 1} 页（${index + 1} / ${ids.length}）…`);
    const page = await pdf.getPage(id + 1); const lines = linesFromContent(await page.getTextContent()); page.cleanup();
    if (!lines.length) empty++;
    pages.push({ number: id + 1, lines });
  }
  if (empty === pages.length) throw new Error('未发现可提取文字，可能是扫描件。请使用 Word「保留页面外观」模式，或先进行 OCR');
  return { pages, warning: empty ? `其中 ${empty} 页未发现文字（可能为空白页或扫描页），请核对原件。` : '' };
}

const jobs = {
  async merge() {
    const files = selected('mergeFiles', true); if (files.length < 2) throw new Error('请选择至少 2 个 PDF');
    const out = await PDFDocument.create();
    for (const f of files) { const src = await PDFDocument.load(await f.arrayBuffer()); (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); }
    return output(await out.save(), 'merged.pdf');
  },
  async split() {
    const file = selected('splitFile'), src = await PDFDocument.load(await file.arrayBuffer()), ids = parsePages($('splitPages').value, src.getPageCount());
    const out = await PDFDocument.create(); (await out.copyPages(src, ids)).forEach(p => out.addPage(p));
    return output(await out.save(), fileBase(file) + '-提取.pdf');
  },
  async rotate(angle) {
    const file = selected('rotateFile'), doc = await PDFDocument.load(await file.arrayBuffer());
    doc.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + angle) % 360)));
    return output(await doc.save(), fileBase(file) + '-旋转' + angle + '.pdf');
  },
  async image() {
    const files = selected('imageFiles', true), doc = await PDFDocument.create();
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const img = bytes[0] === 137 && bytes[1] === 80 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const ratio = Math.min(595.28 / img.width, 841.89 / img.height);
      const page = doc.addPage([img.width * ratio, img.height * ratio]);
      page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    }
    return output(await doc.save(), 'images.pdf');
  },
  async pdfImage() {
    const file = selected('pdfImageFile');
    return withPdf(file, 'pdfImage', async pdf => {
      const ids = selectedPages('pdfImage', pdf.numPages), format = $('pdfImageFormat').value;
      const scale = Number($('pdfImageScale').value);
      const zip = new window.JSZip(); let total = 0;
      for (const [index, id] of ids.entries()) {
        status('pdfImage', `正在生成第 ${id + 1} 页（${index + 1} / ${ids.length}）…`);
        const image = await renderPage(await pdf.getPage(id + 1), format, scale); total += image.bytes.length; checkOutput(total);
        zip.file(`page-${String(id + 1).padStart(3, '0')}.${format}`, image.bytes);
      }
      return output(await zip.generateAsync({ type: 'blob' }), fileBase(file) + '-' + format.toUpperCase() + '-图片.zip', 'application/zip');
    });
  },
  async text() {
    const file = selected('textFile');
    return withPdf(file, 'text', async pdf => {
      const { pages, warning } = await extractText(pdf, 'text', selectedPages('text', pdf.numPages));
      return output('\uFEFF' + pages.map(p => `—— 第 ${p.number} 页 ——\n${p.lines.length ? p.lines.join('\n') : '[此页无可提取文字]'}`).join('\n\n'), fileBase(file) + '.txt', 'text/plain;charset=utf-8', '提取完成，请下载。' + warning);
    });
  },
  async word() {
    const file = selected('wordFile'), mode = $('wordMode').value;
    await loadScript('https://cdn.jsdelivr.net/npm/docx@9.6.1/dist/index.iife.js');
    return withPdf(file, 'word', async pdf => {
      const ids = selectedPages('word', pdf.numPages);
      const { Document, Paragraph, TextRun, ImageRun, Packer } = window.docx;
      let sections, warning = '';
      if (mode === 'image') {
        sections = []; let total = 0;
        for (const [index, id] of ids.entries()) {
          status('word', `正在保留第 ${id + 1} 页（${index + 1} / ${ids.length}）…`);
          const image = await renderPage(await pdf.getPage(id + 1)); total += image.bytes.length; checkOutput(total);
          // Fit Word page limits; floating image coordinates are relative to the page.
          const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
          const w = image.width * scale, h = image.height * scale;
          sections.push({ properties: { page: { size: { width: Math.round(w * 20), height: Math.round(h * 20) }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } }, children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [new ImageRun({ data: image.bytes, type: 'png', transformation: { width: w * 96 / 72, height: h * 96 / 72 }, floating: { horizontalPosition: { relative: 'page', offset: 0 }, verticalPosition: { relative: 'page', offset: 0 }, wrap: { type: 'none' }, allowOverlap: true, behindDocument: false }, altText: { title: `第 ${id + 1} 页`, description: 'PDF 页面图片，文字不可单独编辑', name: `page-${id + 1}` } })] })] });
        }
        const doc = new Document({ creator: '文档小站', title: fileBase(file), sections });
        status('word', '正在生成 Word…');
        return output(await Packer.toBlob(doc), fileBase(file) + '-原版布局.docx', undefined, '转换完成，请下载。');
      }
      status('word', '正在读取 PDF…');
      const raw = [];
      for (const [index, id] of ids.entries()) {
        status('word', `正在分析第 ${index + 1} / ${ids.length} 页…`);
        const page = await pdf.getPage(id + 1), viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        raw.push({ number: id + 1, width: viewport.width, height: viewport.height, content,
          lines: buildLines(extractTextItems(content, viewport.height)) });
        page.cleanup();
      }
      const repeated = repeatedMargins(raw), models = raw.map(p => analyzePage(p.number, p.width, p.height, p.content, mode, repeated));
      if (models.every(p => p.lines.length === 0)) throw new Error('未发现可提取文字，可能是扫描件。请使用「原版布局」模式，或先进行 OCR');
      status('word', '正在重建段落和分析标题…');
      let total = 0;
      for (const [index, model] of models.entries()) {
        if (!model.regions.length) continue;
        status('word', `正在处理第 ${index + 1} / ${models.length} 页图片、表格及公式…`);
        const page = await pdf.getPage(ids[index] + 1), images = await cropRegions(page, model.regions);
        for (const [i, r] of model.regions.entries()) {
          const block = model.blocks.find(b => b.kind === 'region' && b.region === r);
          block.image = images[i]; total += images[i]?.length || 0; checkOutput(total);
        }
      }
      const { doc, stats } = buildEditableDocx(models, window.docx, mode);
      const shortRatio = stats.paragraphs ? stats.shortParagraphs / stats.paragraphs : 0;
      const qa = { pdfPages: pdf.numPages, selectedPages: ids.length, ...stats, shortRatio: +shortRatio.toFixed(3) };
      console.info('PDF → DOCX 质量统计', JSON.stringify(qa));
      if (shortRatio > .25 || stats.paragraphs > ids.length * 40) console.warn('PDF → DOCX 段落可能过碎，请核查原件', qa);
      status('word', '正在生成 Word…');
      const name = fileBase(file) + (mode === 'smart' ? '-智能排版' : '-易于编辑') + '.docx';
      return output(await Packer.toBlob(doc), name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '转换完成，请下载。正文可编辑；表格、公式等复杂区域会以图片保留，请核对原件。' + warning);
    });
  },
  async ppt() {
    const file = selected('pptFile'); await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js');
    return withPdf(file, 'ppt', async pdf => {
      const ids = selectedPages('ppt', pdf.numPages);
      const ppt = new window.PptxGenJS(); ppt.author = '文档小站'; ppt.subject = 'PDF 页面图片'; ppt.title = fileBase(file);
      const first = await pdf.getPage(ids[0] + 1), viewport = first.getViewport({ scale: 1 }); first.cleanup();
      const factor = 10 / Math.max(viewport.width, viewport.height), w = viewport.width * factor, h = viewport.height * factor;
      ppt.defineLayout({ name: 'PDF_PAGE', width: w, height: h }); ppt.layout = 'PDF_PAGE';
      let total = 0;
      for (const [index, id] of ids.entries()) {
        status('ppt', `正在生成第 ${id + 1} 页（${index + 1} / ${ids.length}）…`);
        const image = await renderPage(await pdf.getPage(id + 1)); total += image.bytes.length; checkOutput(total);
        const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(new Blob([image.bytes], { type: 'image/png' })); });
        const scale = Math.min(w / image.width, h / image.height), iw = image.width * scale, ih = image.height * scale;
        const slide = ppt.addSlide(); slide.background = { color: 'FFFFFF' };
        slide.addImage({ data, x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih, altText: `PDF 第 ${id + 1} 页` });
      }
      return output(await ppt.write({ outputType: 'blob', compression: true }), fileBase(file) + '.pptx');
    });
  },
};
function checkOutput(bytes) { if (bytes > 100 * 1024 * 1024) throw new Error('生成图片超过 100 MB，请先拆分 PDF，减少手机内存占用'); }

for (const card of document.querySelectorAll('[data-task]')) {
  const task = card.dataset.task;
  const download = document.createElement('button'); download.className = 'btn download'; download.textContent = '下载文件'; download.disabled = true; download.type = 'button'; download.setAttribute('aria-label', card.querySelector('h2').textContent + '：下载文件');
  const name = document.createElement('div'); name.className = 'result-name';
  card.append(download, name); states.set(task, { card, download, name, busy: false, url: null });
  $(task + 'Status').setAttribute('role', 'status'); $(task + 'Status').setAttribute('aria-live', 'polite');
  download.addEventListener('click', () => {
    const s = states.get(task); if (!s.url) return;
    const anchor = document.createElement('a'); anchor.href = s.url; anchor.download = s.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    status(task, '已发起下载，可再次点击下载按钮。');
  });
  for (const input of card.querySelectorAll('input, select')) {
    if (!input.getAttribute('aria-label') && !input.labels?.length) input.setAttribute('aria-label', input.placeholder || card.querySelector('h2').textContent + '：选择文件');
    input.addEventListener(input.type === 'text' ? 'input' : 'change', () => { clearResult(task); status(task, ''); });
  }
}
$('wordMode').addEventListener('change', () => {
  $('wordHint').textContent = ({
    smart: '识别自然段和标题，保留主要图、表与复杂公式的外观；正文可编辑。复杂页面请对照原 PDF 核查。',
    edit: '优先自然段、标题与重排编辑；图片、表格和复杂公式可能无法完整保留。',
    image: '每页作为图片放入 Word，最大程度保持页面外观；文字、表格和公式无法单独编辑。',
  })[$('wordMode').value];
});
for (const button of document.querySelectorAll('[data-run]')) button.addEventListener('click', () => run(button.dataset.run, () => jobs[button.dataset.run](Number(button.dataset.angle))));
window.addEventListener('pagehide', () => { for (const s of states.values()) if (s.url) URL.revokeObjectURL(s.url); });
window.addEventListener('pageshow', event => { if (event.persisted) for (const task of states.keys()) { clearResult(task); status(task, '请重新转换后下载。'); } });
