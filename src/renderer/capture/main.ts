import type { CaptureApi, CaptureFrame } from '../../shared/capture';
import './style.css';
declare global { interface Window { captureApi: CaptureApi } }
const api = window.captureApi;
const root = document.getElementById('capture')!;
const image = document.getElementById('screen') as HTMLImageElement;
const selection = document.getElementById('selection')!;
const shade = document.getElementById('shade')!;
const hint = document.getElementById('hint')!;
let frame: CaptureFrame | null = null;
let start: { x: number; y: number } | null = null;
let busy = false;
void api.frame().then(data => {
  frame = data;
  if (data) { image.src = data.dataUrl; hint.textContent = '拖动框选，松开即复制到剪贴板'; }
  else hint.textContent = '截图失效，请取消后重试';
}).catch(() => { hint.textContent = '屏幕加载失败，请取消后重试'; });
const cancel = () => { if (!busy) void api.finish(null); };
document.getElementById('cancel')!.addEventListener('click', cancel);
document.getElementById('toolbar')!.addEventListener('pointerdown', e => e.stopPropagation());
window.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });
root.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); });
function rectangle(e: PointerEvent) {
  const x = Math.max(0, Math.min(innerWidth, e.clientX)), y = Math.max(0, Math.min(innerHeight, e.clientY));
  return { x: Math.min(start!.x, x), y: Math.min(start!.y, y), width: Math.abs(start!.x - x), height: Math.abs(start!.y - y) };
}
root.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !frame || busy) return;
  start = { x: e.clientX, y: e.clientY }; root.setPointerCapture(e.pointerId);
});
root.addEventListener('pointermove', e => {
  if (!start || !frame) return;
  const r = rectangle(e);
  selection.hidden = false; shade.hidden = true;
  Object.assign(selection.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.getElementById('size')!.textContent = `${Math.round(r.width * frame.width / innerWidth)} × ${Math.round(r.height * frame.height / innerHeight)}`;
});
root.addEventListener('pointerup', e => {
  if (!start || !frame || busy) return;
  const r = rectangle(e); start = null;
  if (r.width < 4 || r.height < 4) { selection.hidden = true; shade.hidden = false; return; }
  busy = true; hint.textContent = '正在复制…';
  void api.finish({ x: r.x * frame.width / innerWidth, y: r.y * frame.height / innerHeight, width: r.width * frame.width / innerWidth, height: r.height * frame.height / innerHeight });
});
