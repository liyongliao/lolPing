export interface BitmapFrame { width: number; height: number; pixels: Uint8Array }
/** Find fixed header/footer bands before matching the moving page content. */
function fixedBands(previous: BitmapFrame, next: BitmapFrame): {top:number;bottom:number} {
  const {width,height}=previous;
  const sameRow=(y:number):boolean=>{
    let error=0,count=0;
    for(let x=4;x<width-4;x+=Math.max(1,Math.floor(width/40))) {
      const i=(y*width+x)*4;
      for(let c=0;c<3;c++){error+=Math.abs(previous.pixels[i+c]-next.pixels[i+c]);count++;}
    }
    return error/Math.max(1,count)<0.6;
  };
  const limit=Math.floor(height*0.25);
  let top=0,bottom=0;
  while(top<limit && sameRow(top))top++;
  while(bottom<limit && sameRow(height-bottom-1))bottom++;
  return {top,bottom};
}
function matchScroll(previous: BitmapFrame,next: BitmapFrame):{offset:number;bottom:number} {
  const {width,height}=previous;
  if(width!==next.width || height!==next.height || width<32 || height<64)throw new Error('滚动区域尺寸发生变化，请重新框选');
  const bands=fixedBands(previous,next);
  const score=(delta:number):number=>{
    const start=bands.top+4,end=height-delta-bands.bottom-4;
    if(end-start<24)return Infinity;
    let error=0,count=0;
    for(let y=start;y<end;y+=Math.max(1,Math.floor((end-start)/45))) {
      for(let x=8;x<width-8;x+=Math.max(1,Math.floor(width/36))) {
        const a=((y+delta)*width+x)*4,b=(y*width+x)*4;
        for(let c=0;c<3;c++){error+=Math.abs(previous.pixels[a+c]-next.pixels[b+c]);count++;}
      }
    }
    return error/Math.max(1,count);
  };
  if(score(0)<0.6)return {offset:0,bottom:bands.bottom};
  let best=Infinity,offset=0;
  const overlap=Math.max(40,Math.round(height*0.12));
  for(let delta=1;delta<=height-bands.top-bands.bottom-overlap;delta++) {
    const error=score(delta);
    if(error<best){best=error;offset=delta;}
  }
  if(best>7)throw new Error('找不到重叠内容，请回到上一处并缓慢向下滚动');
  return {offset,bottom:bands.bottom};
}
export function scrollOffset(previous: BitmapFrame,next: BitmapFrame):number {return matchScroll(previous,next).offset;}
export function appendScrollFrame(composite: BitmapFrame,previous: BitmapFrame,next: BitmapFrame):BitmapFrame {
  const {offset:delta,bottom}=matchScroll(previous,next);
  if(!delta)return composite;
  const height=composite.height+delta;
  if(height>30000 || height*next.width>60_000_000)throw new Error('长图已达到大小上限，请完成当前截图');
  const pixels=new Uint8Array(next.width*height*4);
  const retained=(composite.height-bottom)*next.width*4;
  pixels.set(composite.pixels.subarray(0,retained));
  pixels.set(next.pixels.subarray((next.height-bottom-delta)*next.width*4),retained);
  return {width:next.width,height,pixels};
}
/** Sparse RGB comparison for stationary live frames; ignores the alpha channel. */
export function frameDifference(a: BitmapFrame, b: BitmapFrame): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let total=0, count=0;
  for(let y=0;y<a.height;y+=Math.max(1,Math.floor(a.height/48))) {
    for(let x=0;x<a.width;x+=Math.max(1,Math.floor(a.width/32))) {
      const i=(y*a.width+x)*4;
      for(let c=0;c<3;c++) {total+=Math.abs(a.pixels[i+c]-b.pixels[i+c]);count++;}
    }
  }
  return total/Math.max(1,count);
}
