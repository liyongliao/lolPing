export interface BitmapFrame { width: number; height: number; pixels: Uint8Array }
/** Match the overlapping content, using RGB samples spread across the selected viewport. */
export function scrollOffset(previous: BitmapFrame, next: BitmapFrame): number {
  const { width, height } = previous;
  if (width !== next.width || height !== next.height || width < 32 || height < 64) throw new Error('滚动区域尺寸发生变化，请重新框选');
  const score = (delta: number): number => {
    const overlap = height - delta;
    let sum = 0, count = 0;
    for (let y = 4; y < overlap - 4; y += Math.max(1, Math.floor(overlap / 45))) {
      for (let x = 8; x < width - 8; x += Math.max(1, Math.floor(width / 36))) {
        const a = ((y + delta) * width + x) * 4, b = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) { sum += Math.abs(previous.pixels[a + c] - next.pixels[b + c]); count++; }
      }
    }
    return sum / Math.max(1, count);
  };
  if (score(0) < 0.6) return 0;
  let best = Infinity, offset = 0;
  const minimumOverlap = Math.max(40, Math.round(height * 0.12));
  for (let delta = 1; delta <= height - minimumOverlap; delta++) {
    const error = score(delta);
    if (error < best) { best = error; offset = delta; }
  }
  if (best > 7) throw new Error('找不到重叠内容，请少滚动一些，并避开固定标题和工具栏');
  return offset;
}
export function appendScrollFrame(composite: BitmapFrame, previous: BitmapFrame, next: BitmapFrame): BitmapFrame {
  const delta = scrollOffset(previous, next);
  if (!delta) return composite;
  const height = composite.height + delta;
  if (height > 30000 || height * next.width > 60_000_000) throw new Error('长图已达到大小上限，请先完成当前截图');
  const pixels = new Uint8Array(next.width * height * 4);
  pixels.set(composite.pixels);
  pixels.set(next.pixels.subarray((next.height - delta) * next.width * 4), composite.pixels.length);
  return { width: next.width, height, pixels };
}
