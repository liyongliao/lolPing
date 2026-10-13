import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import Screenshots from 'react-screenshots';
import 'react-screenshots/lib/style.css';
import type { CaptureFrame, CaptureRect } from '../../shared/capture';
type Action = 'image' | 'text' | 'scroll';
function Editor({ frame, element }: { frame: CaptureFrame; element: HTMLElement }) {
  const [viewport,setViewport]=useState({width:innerWidth,height:innerHeight});
  useEffect(()=>{const resize=()=>setViewport({width:innerWidth,height:innerHeight});window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState('拖动框选区域，选择标注、提取文字或滚动截图');
  const [busy, setBusy] = useState(false);
  const requested = useRef<Action>('image');
  const pending = useRef(false);
  const finished = useRef(false);
  useEffect(() => {
    let target: HTMLElement | null = null;
    const update = () => {
      const toolbar = element.querySelector<HTMLElement>('.screenshots-operations-buttons');
      if (!toolbar) { if (target) { target = null; setHost(null); } return; }
      if (target?.parentElement === toolbar) return;
      target = document.createElement('div'); target.className = 'capture-direct-actions';
      const copy = toolbar.querySelector<HTMLElement>('[title="复制到剪贴板"]');
      let anchor = copy;
      while (anchor?.parentElement && anchor.parentElement !== toolbar) anchor = anchor.parentElement;
      toolbar.insertBefore(target, anchor);
      setHost(target);
    };
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true }); update();
    return () => observer.disconnect();
  }, [element]);
  useEffect(() => {
    if (!host) return;
    // Added tools change the toolbar width. Keep it inside the viewport after every resize.
    const toolbar = host.closest<HTMLElement>('.screenshots-operations')!;
    const place = () => {
      const rect = toolbar.getBoundingClientRect();
      const style = getComputedStyle(toolbar), matrix = new DOMMatrix(style.transform);
      const x = Math.min(Math.max(8, matrix.m41), Math.max(8, innerWidth - rect.width - 8));
      toolbar.style.transform = `translate(${x}px, ${Math.min(matrix.m42, innerHeight - rect.height - 8)}px)`;
    };
    const observer = new ResizeObserver(place); observer.observe(toolbar); place();
    return () => observer.disconnect();
  }, [host]);
  const finish = async (blob: Blob, bounds: CaptureRect) => {
    if (finished.current) return;
    finished.current = true; pending.current = true; setBusy(true); setMessage(requested.current === 'text' ? '正在提取文字…' : '正在处理…');
    try {
      await window.captureApi.advanced({ x: bounds.x * frame.width / innerWidth, y: bounds.y * frame.height / innerHeight, width: bounds.width * frame.width / innerWidth, height: bounds.height * frame.height / innerHeight }, new Uint8Array(await blob.arrayBuffer()), requested.current);
    } catch (error) {
      finished.current = false; pending.current = false; requested.current = 'image'; setBusy(false); setMessage((error as Error).message);
    }
  };
  const execute = (action: Action) => {
    if (pending.current) return;
    const complete = element.querySelector<HTMLElement>('.screenshots-button[title="完成"]');
    if (!complete) return;
    pending.current = true; requested.current = action; complete.click();
  };
  return <>
    <Screenshots url={frame.dataUrl} width={viewport.width} height={viewport.height} onOk={finish} onSave={finish} onCancel={() => void window.captureApi.finish(null)} lang={{ operation_save_title: '复制到剪贴板', operation_ok_title: '完成', operation_text_title: '文字标注' }} />
    {host && createPortal(<>
      <button type="button" className="screenshots-button capture-action" title="提取文字" aria-label="提取文字" disabled={busy} onClick={() => execute('text')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V3h4m10 0h4v4M3 17v4h4m10 0h4v-4M8 8h8m-4 0v9m-3 0h6" /></svg></button>
      <button type="button" className="screenshots-button capture-action" title="滚动截图" aria-label="滚动截图" disabled={busy} onClick={() => execute('scroll')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8V3h14v5M5 16v5h14v-5M12 7v10m-4-4 4 4 4-4" /></svg></button>
    </>, host)}
    <div className="capture-editor-hint" role="status" hidden={!!host && !busy}>{message}</div>
  </>;
}
export function mountAdvanced(element: HTMLElement, frame: CaptureFrame): () => void {
  const root = createRoot(element);
  const decorate = () => element.querySelectorAll<HTMLElement>('.screenshots-button').forEach(button => {
    button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-disabled', String((button instanceof HTMLButtonElement && button.disabled) || button.classList.contains('screenshots-button-disabled')));
  });
  const observer = new MutationObserver(decorate);
  observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  const keydown = (event: KeyboardEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.screenshots-button');
    if (button && button.tagName !== 'BUTTON' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); button.click(); }
  };
  element.addEventListener('keydown', keydown);
  flushSync(()=>root.render(<Editor frame={frame} element={element} />));
  return () => { observer.disconnect(); element.removeEventListener('keydown', keydown); root.unmount(); };
}
