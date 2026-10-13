export interface CaptureFrame { dataUrl: string; width: number; height: number }
export interface CaptureRect { x: number; y: number; width: number; height: number }
export interface CaptureApi {
  frame(): Promise<CaptureFrame | null>;
  finish(rect: CaptureRect | null): Promise<void>;
}
export function boundedCrop(rect: unknown, width: number, height: number): CaptureRect {
  if (!rect || typeof rect !== 'object') throw new Error('截图区域无效');
  const r = rect as CaptureRect;
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width < 1 || r.height < 1) throw new Error('截图区域无效');
  const x = Math.max(0, Math.min(width - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(r.y)));
  return { x, y, width: Math.min(width - x, Math.max(1, Math.round(r.width))), height: Math.min(height - y, Math.max(1, Math.round(r.height))) };
}
