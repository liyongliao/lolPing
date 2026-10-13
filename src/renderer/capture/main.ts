import type { CaptureApi, CaptureFrame } from '../../shared/capture';
import './style.css';
declare global { interface Window { captureApi: CaptureApi } }
const api = window.captureApi;
const root = document.getElementById('capture')!;
const image = document.getElementById('screen') as HTMLImageElement;
const selection = document.getElementById('selection')!;
const shade = document.getElementById('shade')!;
const hint = document.getElementById('hint')!;
const toolbar = document.getElementById('toolbar')!;
const advanced = document.getElementById('advanced')!;
const panel = document.getElementById('panel')!;
let frame: CaptureFrame | null = null;
let start: { x: number; y: number } | null = null;
let busy = false;
let unmount: (() => void) | null = null;
let generation = 0;
async function apply(data: CaptureFrame | null) {
  const token = ++generation;
  unmount?.(); unmount = null;
  frame = data; start = null; busy = false;
  selection.hidden = true; shade.hidden = false;
  root.hidden = !data; root.dataset.active = String(!!data);
  panel.hidden = true; advanced.hidden = true;
  image.hidden = false; shade.hidden = false; toolbar.hidden = false;
  if (!data) { image.src = ''; return; }
  if (data.stage !== 'capture') {
    image.hidden = true; shade.hidden = true; toolbar.hidden = true; panel.hidden = false;
    const scroll = data.stage === 'scroll';
    document.getElementById('panel-title')!.textContent = scroll ? `滚动截图 · ${data.frames} 屏 · ${data.width} × ${data.height}` : '离线文字识别';
    document.getElementById('panel-message')!.textContent = data.message ?? '';
    const preview = document.getElementById('long-preview') as HTMLImageElement;
    preview.hidden = !scroll; preview.src = data.dataUrl;
    document.getElementById('scroll-next')!.hidden = !scroll;
    document.getElementById('scroll-done')!.hidden = !scroll;
    document.getElementById('scroll-next')!.textContent = data.paused ? '继续滚动' : '暂停';
    return;
  }
  const decoded = new Image(); decoded.src = data.dataUrl;
  await decoded.decode();
  if (token !== generation) return;
  if (data.mode === 'advanced') {
    image.hidden = true; shade.hidden = true; toolbar.hidden = true; advanced.hidden = false;
    hint.textContent = '正在加载高级截图工具…';
    const module = await import('./advanced');
    if (token === generation) unmount = module.mountAdvanced(advanced, data);
  } else {
    image.src = data.dataUrl;
    await image.decode();
    hint.textContent = '拖动框选，松开即复制到剪贴板';
  }
  if (data.mode === 'advanced') await document.fonts.load('18px screenshots-icon');
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (token === generation) await api.ready(data.session);
}
api.onFrame(data => void apply(data));
void api.frame().then(data => { if (!frame && data) void apply(data); });
const cancel = () => { if (!busy || frame?.stage === 'working') void api.finish(null); };
document.getElementById('cancel')!.addEventListener('click', cancel);
document.getElementById('panel-cancel')!.addEventListener('click', () => void api.finish(null));
document.getElementById('scroll-next')!.addEventListener('click', () => void api.scrollNext());
document.getElementById('scroll-done')!.addEventListener('click', () => void api.scrollDone());
toolbar.addEventListener('pointerdown', e => e.stopPropagation());
panel.addEventListener('pointerdown', e => e.stopPropagation());
window.addEventListener('keydown', e => { if (e.key === 'Escape') { if (frame?.stage === 'scroll') void api.scrollDone(); else cancel(); } });
root.addEventListener('contextmenu', e => { if (frame?.mode === 'fast' || frame?.stage !== 'capture') { e.preventDefault(); cancel(); } });
function rectangle(e: PointerEvent) {
  const x = Math.max(0, Math.min(innerWidth, e.clientX)), y = Math.max(0, Math.min(innerHeight, e.clientY));
  return { x: Math.min(start!.x, x), y: Math.min(start!.y, y), width: Math.abs(start!.x - x), height: Math.abs(start!.y - y) };
}
root.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !frame || frame.mode !== 'fast' || busy) return;
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
