// Only regular rows with stable column alignment become editable Word tables.
const median = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)] ?? 0; };

function groupRows(items) {
  const rows=[];
  for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)) {
    let row=rows.findLast(r=>Math.abs(r.y-item.y)<5.5);
    if(!row){row={y:item.y,items:[]};rows.push(row)}
    row.items.push(item);
  }
  return rows.map(row=>{
    const segments=[];
    for(const item of row.items.sort((a,b)=>a.x-b.x)) {
      const last=segments.at(-1),gap=last?item.x-last.right:Infinity;
      if(last&&gap<18){last.text+=(gap>3&&!/[\u3400-\u9fff]/.test(last.text.at(-1))?' ':'')+item.text.trim();last.right=Math.max(last.right,item.x+item.width)}
      else segments.push({x:item.x,right:item.x+item.width,text:item.text.trim()});
    }
    return {y:row.y,segments:segments.filter(s=>s.text)};
  }).filter(row=>row.segments.length);
}

function suspiciousNumbers(rows,col) {
  for(let i=1;i<rows.length;i++) {
    const current=rows[i][col]||'',previous=rows[i-1][col]||'';
    const last=previous.match(/(\d{2,})\s*[~～—-]\s*(\d{2,})/),first=current.match(/^(\d+)\s*个以上/);
    if(last&&first&&Number(first[1])<=Number(last[2])) return true;
  }
  return false;
}

export function detectTableStructure(region, lines) {
  const caption=lines.find(l=>l.y>=region.top&&l.y<region.top+28&&/^(?:表|Table)\s*\d|^续表/i.test(l.text));
  const items=lines.flatMap(l=>l.items).filter(i=>i.y>Math.max(region.top+12,(caption?.y??region.top)+10)&&
    i.y<region.bottom-3&&i.x>=region.left-4&&i.x+i.width<=region.right+17);
  const rows=groupRows(items),counts=new Map();
  for(const row of rows) if(row.segments.length>=2&&row.segments.length<=6) counts.set(row.segments.length,(counts.get(row.segments.length)||0)+1);
  const [columns,matched]=[...counts].sort((a,b)=>b[1]-a[1])[0]||[0,0];
  if(rows.length<3||columns<2||matched/rows.length<.75) return {confidence:'low',reason:'irregular rows',caption:caption?.text};
  const consistent=rows.filter(r=>r.segments.length===columns);
  const anchors=Array.from({length:columns},(_,j)=>median(consistent.slice(1).map(r=>r.segments[j].x)));
  if(anchors.slice(1).some((x,j)=>x-anchors[j]<34)) return {confidence:'low',reason:'ambiguous columns',caption:caption?.text};
  const grid=[];
  for(const row of rows) {
    if(row.segments.length!==columns) return {confidence:'medium',reason:'row mismatch',caption:caption?.text};
    if(row!==rows[0]&&row.segments.some((s,j)=>Math.abs(s.x-anchors[j])>30))
      return {confidence:'medium',reason:'unstable alignment',caption:caption?.text};
    grid.push(row.segments.map(s=>s.text));
  }
  if(Array.from({length:columns},(_,j)=>j).some(j=>suspiciousNumbers(grid.slice(1),j)))
    return {confidence:'medium',reason:'numeric text layer may omit exponent',caption:caption?.text};
  return {confidence:'high',caption:caption?.text,rows:grid,columns,top:rows[0].y,bottom:rows.at(-1).y};
}

// Supplemental small-grid recognizer; leaves the existing low-confidence
// fallback alone and never guesses an unlabeled or merged grid.
export function detectSimpleTables(lines,width,height) {
  const found=[];
  for(let i=0;i<lines.length;i++) {
    if(!/^(?:表|Table)\s*\d/.test(lines[i].text))continue;
    const rows=[];let unsafe=false;
    for(let j=i+1;j<Math.min(lines.length,i+9);j++) {
      const l=lines[j];if(l.y-lines[i].y>210)break;
      const cells=[...(l.items||[])].sort((a,b)=>a.x-b.x);
      if(cells.length<2)break;
      if(cells.length>4||cells.some(c=>c.height<l.fontSize*.8||!c.text.trim()||c.text.length>18)){unsafe=true;break;}
      if(rows.length && (cells.length!==rows[0].length||cells.some((c,k)=>Math.abs(c.x-rows[0][k].x)>10))){unsafe=true;break;}
      if(cells.slice(1).some((c,k)=>c.x-(cells[k].x+cells[k].width)<15))break;
      rows.push(cells);
    }
    if(unsafe||rows.length<2||(rows.length===8&&(lines[i+9]?.items?.length||0)>1))continue;
    const anchors=rows[0].map(c=>c.x),right=Math.max(...rows.flat().map(c=>c.x+c.width));
    if(anchors.slice(1).some((x,j)=>x-anchors[j]<34)||right>width-16)continue;
    found.push({top:lines[i].y-lines[i].fontSize-5,bottom:rows.at(-1)[0].y+12,left:Math.max(0,Math.min(lines[i].x,anchors[0])-8),right:Math.min(width,Math.max(lines[i].right,right)+8),
      table:{confidence:'high',caption:lines[i].text,rows:rows.map(r=>r.map(c=>c.text.trim())),columns:rows[0].length}});
  }
  return found;
}

export function buildWordTable(model, docx, pageWidth, font='SimSun') {
  const {Table,TableRow,TableCell,Paragraph,TextRun,WidthType}=docx;
  const cellWidth=Math.floor(pageWidth/model.columns);
  return new Table({
    layout:'fixed',
    width:{size:pageWidth,type:WidthType.DXA},columnWidths:Array(model.columns).fill(cellWidth),
    rows:model.rows.map((cells,i)=>new TableRow({cantSplit:true,children:cells.map(text=>new TableCell({
      width:{size:cellWidth,type:WidthType.DXA},
      margins:{top:80,bottom:80,left:80,right:80},
      children:[new Paragraph({spacing:{after:0,line:280},children:[new TextRun({text,font,size:20,bold:i===0})]})],
    }))})),
  });
}
