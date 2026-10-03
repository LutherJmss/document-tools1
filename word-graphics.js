const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const region=(type,top,bottom,left,right,w,h)=>({type,top:clamp(top,0,h),bottom:clamp(bottom,0,h),left:clamp(left,0,w),right:clamp(right,0,w)});

export function detectGraphicRegions(ops,OPS,width,height,lines=[]) {
  if(!ops||!OPS)return {regions:[],graphicsDetected:0,rasterBackground:false,qrDetected:0};
  const images=[],stack=[];let matrix=[1,0,0,1,0,0],rasterBackground=false,objects=0;
  const paints=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintJpegXObject,OPS.paintImageMaskXObject]);
  for(let i=0;i<ops.fnArray.length;i++) {
    const fn=ops.fnArray[i],args=ops.argsArray[i];
    if(fn===OPS.save)stack.push([...matrix]);
    else if(fn===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(fn===OPS.transform&&args?.length===6)matrix=multiply(matrix,args);
    else if(paints.has(fn)) {
      objects++;
      const pts=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>point(matrix,x,y));
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      const left=Math.min(...xs),right=Math.max(...xs),top=height-Math.max(...ys),bottom=height-Math.min(...ys);
      const w=right-left,h=bottom-top;
      if(w>width*.8&&h>height*.8){rasterBackground=true;continue}
      if(w<18||h<18||w*h<600)continue;
      images.push(region('figure',top-3,bottom+3,left-3,right+3,width,height));
    }
  }
  images.sort((a,b)=>a.top-b.top||a.left-b.left);
  const merged=[];
  for(const r of images){const last=merged.at(-1);
    if(last&&r.left<=last.right+12&&r.right>=last.left-12&&r.top<=last.bottom+12) {
      last.top=Math.min(last.top,r.top);last.bottom=Math.max(last.bottom,r.bottom);
      last.left=Math.min(last.left,r.left);last.right=Math.max(last.right,r.right);
    } else merged.push({...r});
  }
  // Full-page scanned images contain no separate QR operator. Marginal labels
  // provide a conservative anchor for a QR crop without mixing it into prose.
  const qr=[];
  if(rasterBackground) for(const item of lines.flatMap(l=>l.items||[])) if(/微视频|扫码/.test(item.text)&&(item.x<width*.14||item.x>width*.82)&&item.width<80) {
    const box=region('qr',item.y-65,item.y-12,Math.max(8,item.x-3),Math.min(width-8,item.x+53),width,height);
    if(!qr.some(r=>Math.abs(r.top-box.top)<40&&Math.abs(r.left-box.left)<60))qr.push(box);
  }
  return {regions:[...merged,...qr],graphicsDetected:images.length,imageObjectsSeen:objects,rasterBackground,qrDetected:qr.length};
}

export function inferCaptionFigures(lines,width,height) {
  const regions=[];
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(!/^图\s*\d+(?:\.\d+)+/.test(line.text))continue;
    let body=i-1;
    while(body>=0&&line.y-lines[body].y<185&&lines[body].text.length<18)body--;
    const start=body>=0?lines[body].y+17:line.y-110;
    const end=line.y-line.fontSize-1;
    if(end-start>40){
      const labels=lines.slice(body+1,i).filter(l=>l.y>=start&&l.text.length<30&&!/微视频|扫码/.test(l.text));
      const left=labels.length?Math.max(35,Math.min(...labels.map(l=>l.x))-16):55;
      const right=labels.length?Math.min(width-35,Math.max(...labels.map(l=>l.right))+16):width-45;
      regions.push({...region('figure',start,end,left,right,width,height),caption:line.text,captionY:line.y});
    }
  }
  return regions;
}

export async function cropRegions(page,regions,optimizer=null) {
  if(!regions.length)return [];
  const base=page.getViewport({scale:1}),scale=Math.min(2,Math.sqrt(6000000/(base.width*base.height)));
  const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  try {
    await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
    if(optimizer)optimizer.stats.pageRenders++;
    const coordinateCache=new Map(),crop=document.createElement('canvas');
    const images=[];
    for(const r of regions) {
      const x=Math.floor(r.left*scale),y=Math.floor(r.top*scale);
      const w=Math.min(canvas.width-x,Math.ceil((r.right-r.left)*scale)),h=Math.min(canvas.height-y,Math.ceil((r.bottom-r.top)*scale));
      if(w<5||h<5){images.push(null);continue}
      const key=[x,y,w,h].join(',');
      if(optimizer&&coordinateCache.has(key)){optimizer.stats.regionCacheHits++;images.push(coordinateCache.get(key));continue}
      crop.width=w;crop.height=h;
      crop.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);
      let bytes;
      if(optimizer)bytes=await optimizer.encode(crop,r);
      else {const blob=await new Promise((resolve,reject)=>crop.toBlob(b=>b?resolve(b):reject(new Error('区域图片生成失败')),'image/png'));bytes=new Uint8Array(await blob.arrayBuffer())}
      coordinateCache.set(key,bytes);images.push(bytes);
    }
    crop.width=crop.height=0;
    return images;
  }finally{canvas.width=canvas.height=0;page.cleanup()}
}
