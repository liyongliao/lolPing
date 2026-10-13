import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, ipcMain, nativeImage, screen, type Display, type NativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedCrop, type CaptureFrame, type CaptureMode, type CaptureRect } from '../shared/capture';
import { appendScrollFrame, type BitmapFrame } from '../shared/scrollStitch';
import { IS_MAC, loadPage, preloadPath } from './paths';
import { OcrService } from './ocrService';
const compositorTick = () => new Promise(resolve => setTimeout(resolve, 40));
const bitmap = (image: NativeImage): BitmapFrame => ({ ...image.getSize(), pixels: image.toBitmap() });

export class ScreenshotTool {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private image: NativeImage | null = null;
  private payload: CaptureFrame | null = null;
  private busy = false;
  private disposed = false;
  private session = 0;
  private restore: BrowserWindow[] = [];
  private focused: BrowserWindow | null = null;
  private display: Display | null = null;
  private ocr = new OcrService();
  private scroll: { rect: CaptureRect; previous: BitmapFrame; composite: BitmapFrame; frames: number; running: boolean } | null = null;
  readonly folder = join(app.getPath('pictures'), 'lolPing');
  constructor(private readonly deps: { saveFiles(): boolean; mode(): CaptureMode; onBusy(on: boolean): void; report(name: string, detail: string, ok: boolean): void }) {
    this.ipc('frame', () => this.payload);
    this.ipc('finish', async (rect: unknown) => {
      try {
        if (rect !== null) {
          if (!this.image || !this.busy || this.payload?.stage !== 'capture') throw new Error('截图已失效，请重试');
          const { width, height } = this.image.getSize();
          await this.copy(this.image.crop(boundedCrop(rect, width, height)));
        }
      } catch (e) { this.deps.report('截图失败', (e as Error).message, false); }
      finally { this.cleanup(); }
    });
    this.ipc('advanced', (rect, png, action) => this.advanced(rect, png, action));
    this.ipc('scrollNext', () => this.scrollNext());
    this.ipc('scrollDone', async () => { if (!this.scroll || this.scroll.running) return; try { await this.copy(this.scrollImage()); } finally { this.cleanup(); } });
    // Preload only the tiny selection page. No screen access, editor or OCR work happens here.
    void this.prepare().catch(() => undefined);
  }
  private ipc(name: string, handler: (...args: any[]) => unknown): void {
    ipcMain.handle(`capture:${name}`, (event, ...args) => {
      if (event.sender !== this.window?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的截图请求');
      return handler(...args);
    });
  }
  private prepare(): Promise<void> {
    if (this.window && !this.window.isDestroyed() && this.ready) return this.ready;
    const win = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, show: false, backgroundColor: '#101820', webPreferences: { preload: preloadPath('capture'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.window = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('render-process-gone', () => { this.cleanup(); win.destroy(); });
    win.on('closed', () => { if (this.window === win) { this.window = null; this.ready = null; this.cleanup(); } });
    this.ready = loadPage(win, 'capture').catch(e => { this.ready = null; if (!win.isDestroyed()) win.destroy(); throw e; });
    return this.ready;
  }
  async capture(region: boolean, mode = this.deps.mode()): Promise<void> {
    if (this.scroll) { await this.scrollNext(); return; }
    if (this.busy) throw new Error('已有截图正在进行，请完成或按 Esc 取消');
    if (this.disposed) return;
    const started = performance.now();
    this.busy = true; this.session++; this.deps.onBusy(true);
    this.focused = BrowserWindow.getFocusedWindow();
    this.restore = BrowserWindow.getAllWindows().filter(w => w !== this.window && w.isVisible());
    for (const w of this.restore) w.hide();
    try {
      this.display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      // Only wait for the compositor to hide our own UI, instead of an unconditional 220ms delay.
      await compositorTick();
      this.image = await this.readScreen(this.display);
      if (this.disposed) return;
      if (!region) { await this.copy(this.image); this.cleanup(); return; }
      await this.prepare();
      if (this.disposed || !this.window) return;
      this.window.setBounds(this.display.bounds);
      this.setFrame({ dataUrl: mode === 'fast' ? `data:image/jpeg;base64,${this.image.toJPEG(88).toString('base64')}` : this.image.toDataURL(), ...this.image.getSize(), session: this.session, mode, stage: 'capture' });
      this.window.show(); this.window.focus();
      console.log('[capture]', mode, 'ready in', Math.round(performance.now() - started), 'ms');
    } catch (e) { this.cleanup(); throw e; }
  }
  private async readScreen(display: Display): Promise<NativeImage> {
    if (!(process.env.LOLPING_TEST_DATA_DIR && process.env.LOLPING_TEST_CAPTURE_BACKEND === 'electron')) {
      try {
        const { Monitor } = await import('node-screenshots');
        const center = { x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 };
        const monitor = IS_MAC ? Monitor.all().find(m => m.id() === display.id) : Monitor.fromPoint(...(() => { const p = screen.dipToScreenPoint(center); return [p.x, p.y] as const; })());
        if (!monitor) throw new Error('显示器未找到');
        const captured = await monitor.captureImage();
        // Electron needs a copied output buffer from napi-rs, as documented by node-screenshots.
        const image = nativeImage.createFromBuffer(await captured.toPng(true));
        if (image.isEmpty()) throw new Error('原生截屏为空');
        return image;
      } catch (error) { console.warn('[capture] native backend unavailable; using Electron:', (error as Error).message); }
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
    const source = sources.find(s => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
    if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取屏幕。请允许屏幕录制权限并重启应用后重试。');
    return source.thumbnail;
  }
  private setFrame(frame: CaptureFrame | null): void { this.payload = frame; if (this.window && !this.window.isDestroyed()) this.window.webContents.send('capture:changed', frame); }
  private async advanced(rect: unknown, png: unknown, action: unknown): Promise<void> {
    if (!this.busy || this.payload?.mode !== 'advanced' || this.payload.stage !== 'capture' || !this.image) throw new Error('高级截图已失效');
    if (!['image', 'text', 'scroll'].includes(String(action))) throw new Error('截图动作无效');
    const size = this.image.getSize(), crop = boundedCrop(rect, size.width, size.height);
    if (!(png instanceof Uint8Array) || !png.length || png.length > 64_000_000) throw new Error('截图数据无效');
    const edited = nativeImage.createFromBuffer(Buffer.from(png));
    if (edited.isEmpty()) throw new Error('截图数据无效');
    const id = this.session;
    try {
      if (action === 'scroll') {
        const first = bitmap(this.image.crop(crop));
        this.scroll = { rect: crop, previous: first, composite: first, frames: 1, running: false };
        this.showPanel('scroll', '向下滚动内容，再捕获下一屏；需保留部分重叠内容');
        return;
      }
      if (action === 'text') {
        this.showPanel('working', '正在离线识别中英文文字…首次初始化可能需要数秒');
        const text = await this.ocr.recognize(edited.toPNG());
        if (!this.busy || this.session !== id || this.disposed) return;
        if (!text) throw new Error('未识别到文字，请重新框选清晰的文字区域');
        await clipboard.writeText(text);
        this.deps.report('文字已复制到剪贴板', `离线识别完成，共 ${text.length} 个字符`, true);
      } else await this.copy(edited);
    } catch (e) { if (this.session === id && this.busy) this.deps.report('高级截图失败', (e as Error).message, false); }
    finally { if (this.session === id && !this.scroll) this.cleanup(); }
  }
  private scrollImage(): NativeImage {
    const c = this.scroll!.composite;
    return nativeImage.createFromBitmap(Buffer.from(c.pixels), { width: c.width, height: c.height });
  }
  private showPanel(stage: 'scroll' | 'working', message: string): void {
    if (!this.window || !this.display) return;
    const b = this.display.workArea;
    this.window.setBounds({ x: b.x + b.width - 430, y: b.y + b.height - 190, width: 420, height: 175 });
    this.setFrame({ dataUrl: stage === 'scroll' ? this.scrollImage().resize({ width: 70 }).toDataURL() : '', width: this.scroll?.composite.width ?? 0, height: this.scroll?.composite.height ?? 0, session: this.session, mode: 'advanced', stage, message, frames: this.scroll?.frames });
    this.window.showInactive();
  }
  private async scrollNext(): Promise<void> {
    const scroll = this.scroll;
    if (!scroll || scroll.running || !this.display) return;
    const id = this.session;
    scroll.running = true;
    this.window?.hide();
    try {
      await compositorTick();
      const current = await this.readScreen(this.display);
      if (this.session !== id || !this.busy) return;
      const original = this.image!.getSize(), size = current.getSize();
      if (original.width !== size.width || original.height !== size.height) throw new Error('显示器尺寸变化，请重新截图');
      const next = bitmap(current.crop(scroll.rect));
      const merged = appendScrollFrame(scroll.composite, scroll.previous, next);
      const changed = merged !== scroll.composite;
      scroll.composite = merged;
      if (changed) { scroll.previous = next; scroll.frames++; }
      this.showPanel('scroll', changed ? '已追加，继续向下滚动并捕获，或完成复制' : '内容未变化，请向下滚动一些后再捕获');
    } catch (e) { if (this.session === id && this.busy) this.showPanel('scroll', (e as Error).message); }
    finally { scroll.running = false; }
  }
  private async copy(image: NativeImage): Promise<void> {
    if (image.isEmpty()) throw new Error('截图为空，请重试');
    const png = image.toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    if (this.deps.saveFiles()) {
      try { await mkdir(this.folder, { recursive: true }); await writeFile(join(this.folder, `lolPing-${new Date().toISOString().replace(/[:.]/g, '-')}.png`), png); }
      catch (e) { this.deps.report('截图已复制，保存文件失败', (e as Error).message, false); return; }
    }
    setTimeout(() => { if (!this.disposed) this.deps.report('截图已复制到剪贴板', this.deps.saveFiles() ? '同时保存到 图片 / lolPing' : '直接粘贴到聊天、笔记或文档', true); }, 80);
  }
  private cleanup(): void {
    this.session++; this.image = null; this.scroll = null; this.busy = false; this.display = null;
    if (this.window && !this.window.isDestroyed()) { this.window.hide(); this.setFrame(null); }
    if (!this.disposed) {
      for (const w of this.restore) if (!w.isDestroyed()) w.showInactive();
      if (this.focused && !this.focused.isDestroyed()) { this.focused.show(); this.focused.focus(); }
      this.deps.onBusy(false);
    }
    this.restore = []; this.focused = null;
  }
  dispose(): void {
    this.disposed = true; this.cleanup(); this.ocr.dispose();
    const win = this.window; this.window = null; if (win && !win.isDestroyed()) win.destroy();
    for (const name of ['frame', 'finish', 'advanced', 'scrollNext', 'scrollDone']) ipcMain.removeHandler(`capture:${name}`);
  }
}
