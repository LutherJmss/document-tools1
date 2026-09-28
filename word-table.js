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

export function buildWordTable(model, docx, pageWidth, font='SimSun') {
  const {Table,TableRow,TableCell,Paragraph,TextRun,WidthType}=docx;
  const cellWidth=Math.floor(pageWidth/model.columns);
  return new Table({
    width:{size:pageWidth,type:WidthType.DXA},columnWidths:Array(model.columns).fill(cellWidth),
    rows:model.rows.map((cells,i)=>new TableRow({cantSplit:true,children:cells.map(text=>new TableCell({
      width:{size:cellWidth,type:WidthType.DXA},
      margins:{top:80,bottom:80,left:80,right:80},
      children:[new Paragraph({spacing:{after:0,line:280},children:[new TextRun({text,font,size:20,bold:i===0})]})],
    }))})),
  });
}
