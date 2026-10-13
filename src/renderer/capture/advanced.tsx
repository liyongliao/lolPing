import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import Screenshots from 'react-screenshots';
import 'react-screenshots/lib/style.css';
import type { CaptureFrame, CaptureRect } from '../../shared/capture';
function Editor({ frame }: { frame: CaptureFrame }) {
  const [action, setAction] = useState<'image' | 'text' | 'scroll'>('image');
  const [message, setMessage] = useState('拖动框选区域，可画图、打码、添加文字；完成后直接复制。');
  const [busy, setBusy] = useState(false);
  const finish = async (blob: Blob, bounds: CaptureRect) => {
    if (busy) return;
    setBusy(true); setMessage('正在处理…');
    try {
      await window.captureApi.advanced({ x: bounds.x * frame.width / innerWidth, y: bounds.y * frame.height / innerHeight, width: bounds.width * frame.width / innerWidth, height: bounds.height * frame.height / innerHeight }, new Uint8Array(await blob.arrayBuffer()), action);
    } catch (error) { setBusy(false); setMessage((error as Error).message); }
  };
  return <>
    <Screenshots url={frame.dataUrl} width={innerWidth} height={innerHeight} onOk={finish} onSave={finish} onCancel={() => void window.captureApi.finish(null)} lang={{ operation_save_title: '复制到剪贴板', operation_ok_title: '完成', operation_text_title: '文字标注' }} />
    <div className="advanced-mode"><b>高级截图</b><label>完成后 <select aria-label="高级截图完成动作" value={action} disabled={busy} onChange={e => setAction(e.target.value as typeof action)}><option value="image">复制标注后的图片</option><option value="text">提取文字并复制（离线文字识别）</option><option value="scroll">开始滚动截图</option></select></label><span>{message}</span><button onClick={() => void window.captureApi.finish(null)}>取消</button></div>
  </>;
}
export function mountAdvanced(element: HTMLElement, frame: CaptureFrame): () => void {
  const root = createRoot(element);
  const decorate = () => element.querySelectorAll<HTMLElement>('.screenshots-button').forEach(button => {
    button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-disabled', String(button.classList.contains('screenshots-button-disabled')));
  });
  const observer = new MutationObserver(decorate);
  observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  const keydown = (event: KeyboardEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('.screenshots-button');
    if (button && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); button.click(); }
  };
  element.addEventListener('keydown', keydown);
  root.render(<Editor frame={frame} />);
  return () => { observer.disconnect(); element.removeEventListener('keydown', keydown); root.unmount(); };
}
