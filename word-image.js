// Lossless image optimization. Classification never authorizes lowering the
// source resolution or quantizing formula, table, QR or Chinese text pixels.
export function classifyImage(region) {
  if (region.imageClass === 'text' || region.type === 'text' || region.type === 'coverage' || region.type === 'scan') return 'text';
  if (region.type === 'table') return 'table';
  if (region.type === 'formula') return 'formula';
  if (region.type === 'qr') return 'qr';
  if (region.type === 'exercise') return region.imageClass || 'formula';
  return 'figure';
}

const crcTable = Uint32Array.from({length:256}, (_, n) => {
  for (let k=0;k<8;k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const b of bytes) value = crcTable[(value ^ b) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set([...type].map(c=>c.charCodeAt(0)),4); bytes.set(data,8);
  view.setUint32(bytes.length-4,crc(bytes.subarray(4,bytes.length-4)));
  return bytes;
}
const equal = (a,b) => a.length === b.length && a.every((v,i)=>v===b[i]);

// Only use grayscale PNG when every RGB triplet is already identical and
// opaque. Every antialiased edge and small glyph retains its original value.
export async function losslessGrayPNG(rgba, width, height) {
  if (!globalThis.CompressionStream || rgba.length !== width*height*4) return null;
  for (let i=0;i<rgba.length;i+=4)
    if (rgba[i]!==rgba[i+1] || rgba[i]!==rgba[i+2] || rgba[i+3]!==255) return null;
  const filtered = new Uint8Array((width+1)*height);
  const sub = new Uint8Array(width), up = new Uint8Array(width);
  for (let y=0;y<height;y++) {
    let subScore=0,upScore=0;
    for (let x=0;x<width;x++) {
      const i=(y*width+x)*4,value=rgba[i];
      sub[x]=(value-(x?rgba[i-4]:0))&255;
      up[x]=(value-(y?rgba[i-width*4]:0))&255;
      subScore+=Math.min(sub[x],256-sub[x]);upScore+=Math.min(up[x],256-up[x]);
    }
    const start=y*(width+1),useUp=upScore<subScore;
    filtered[start]=useUp?2:1;filtered.set(useUp?up:sub,start+1);
  }
  const deflated = new Uint8Array(await new Response(new Blob([filtered]).stream()
    .pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const header=new Uint8Array(13),view=new DataView(header.buffer);
  view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=0;
  return new Uint8Array(await new Blob([new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflated),chunk('IEND',new Uint8Array())]).arrayBuffer());
}

export function createImageOptimizer({cacheLimit=24*1024*1024}={}) {
  const cache=new Map(),encoded=new Map();let cacheBytes=0;
  const stats={imageEncodes:0,imageDuplicates:0,regionCacheHits:0,pageRenders:0,
    uniqueImages:0,imageBytes:0,uniqueImageBytes:0,losslessGrayImages:0,
    nativePNGImages:0,optimizerFallbacks:0,imageClasses:{text:0,formula:0,table:0,qr:0,figure:0}};
  return {stats,
    async encode(canvas,region) {
      const width=canvas.width,height=canvas.height;
      stats.imageClasses[classifyImage(region)]++;
      let pixels,key,entry;
      try {
        pixels=canvas.getContext('2d').getImageData(0,0,width,height).data;
        const digest=globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)) : null;
        key=`${width}x${height}:`+(digest?Array.from(digest,v=>v.toString(16).padStart(2,'0')).join(''):crc(pixels));
        entry=cache.get(key)?.find(e=>equal(e.pixels,pixels));
      } catch { stats.optimizerFallbacks++; }
      if (entry) {stats.imageDuplicates++;stats.imageBytes+=entry.bytes.length;return entry.bytes;}
      let bytes;
      try { if(pixels)bytes=await losslessGrayPNG(pixels,width,height); }
      catch {stats.optimizerFallbacks++;}
      if(bytes)stats.losslessGrayImages++;
      else {
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('区域图片生成失败')),'image/png'));
        bytes=new Uint8Array(await blob.arrayBuffer());stats.nativePNGImages++;
      }
      stats.imageEncodes++;
      const encodedKey=`${bytes.length}:${crc(bytes)}`,previous=encoded.get(encodedKey)||[];
      const identical=previous.find(b=>equal(b,bytes));
      if(identical){bytes=identical;stats.imageDuplicates++;}
      else {previous.push(bytes);encoded.set(encodedKey,previous);stats.uniqueImages++;stats.uniqueImageBytes+=bytes.length;}
      stats.imageBytes+=bytes.length;
      if(key && pixels && cacheBytes+pixels.length<=cacheLimit) {
        const entries=cache.get(key)||[];entries.push({pixels,bytes});cache.set(key,entries);cacheBytes+=pixels.length;
      }
      return bytes;
    },
    dispose(){cache.clear();encoded.clear();cacheBytes=0;}
  };
}
