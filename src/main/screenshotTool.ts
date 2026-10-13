import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, globalShortcut, ipcMain, nativeImage, screen, systemPreferences, type Display, type NativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedCrop, type CaptureFrame, type CaptureMode, type CaptureRect } from '../shared/capture';
import { appendScrollFrame, frameDifference, type BitmapFrame } from '../shared/scrollStitch';
import { IS_MAC, loadPage, preloadPath } from './paths';
import { OcrService } from './ocrService';
import { CaptureBarrier } from './captureBarrier';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
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
  private opacity = new Map<BrowserWindow,number>();
  private focused: BrowserWindow | null = null;
  private display: Display | null = null;
  private ocr = new OcrService();
  private barrier = new CaptureBarrier();
  private renderReady: { session: number; resolve(): void } | null = null;
  private stopKey = false;
  private panelOutside = false;
  private border: BrowserWindow | null = null;
  private target: { window: import('node-screenshots').Window; bounds: CaptureRect; crop: CaptureRect } | null = null;
  private scroll: { rect: CaptureRect; previous: BitmapFrame; composite: BitmapFrame; frames: number; running: boolean; automatic: boolean; paused: boolean; finishing: boolean; unchanged: number } | null = null;
  readonly folder = join(app.getPath('pictures'), 'lolPing');
  constructor(private readonly deps: { scroll(x: number, y: number, pixels: number): Promise<void>; saveFiles(): boolean; mode(): CaptureMode; onBusy(on: boolean): void; report(name: string, detail: string, ok: boolean): void }) {
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
    this.ipc('ready', session => { const pending = this.renderReady; if (pending && session === pending.session) pending.resolve(); });
    this.ipc('scrollNext', () => this.toggleScroll());
    this.ipc('scrollDone', () => this.scrollDone());
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
    const win = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, show: false, backgroundColor: '#101820', webPreferences: { preload: preloadPath('capture'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
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
    if (this.scroll) { await this.scrollDone(); return; }
    if (this.busy) throw new Error('已有截图正在进行，请完成或按 Esc 取消');
    if (this.disposed) return;
    if (IS_MAC && !process.env.LOLPING_TEST_DATA_DIR && systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('请先在设置中授权屏幕录制，并按系统提示重新打开应用');
    const started = performance.now();
    this.busy = true; this.session++; this.deps.onBusy(true);
    this.focused = BrowserWindow.getFocusedWindow();
    if(this.focused?.isMinimized())this.focused=null;
    const owned=BrowserWindow.getAllWindows().filter(w=>w!==this.window);
    this.restore=owned.filter(w=>w.isVisible() && !w.isMinimized());
    for(const w of owned) {
      if(!w.isVisible() || w.isMinimized())continue;
      if(IS_MAC){this.opacity.set(w,w.getOpacity());w.setOpacity(0);}
      w.hide();
    }
    const hideRequestedAt=performance.now();
    try {
      this.display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      // Ask the native compositor to confirm the hide, including an in-progress minimise.
      await this.barrier.wait();
      const hiddenAt=performance.now();
      this.image = await this.readScreen(this.display);
      const capturedAt=performance.now();
      if (this.disposed) return;
      if (!region) { await this.copy(this.image); this.cleanup(); return; }
      await this.prepare();
      if (this.disposed || !this.window) return;
      this.window.setBounds(this.display.bounds);
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.renderReady = null; reject(new Error('截图画面加载超时，请重试')); }, 8000);
        this.renderReady = { session: this.session, resolve: () => { clearTimeout(timer); this.renderReady = null; resolve(); } };
      });
      this.setFrame({ dataUrl: mode === 'fast' ? `data:image/jpeg;base64,${this.image.toJPEG(88).toString('base64')}` : this.image.toDataURL(), ...this.image.getSize(), session: this.session, mode, stage: 'capture' });
      await ready;
      if (this.disposed || !this.busy) return;
      this.window.show(); this.window.focus();
      console.log('[capture]',mode,JSON.stringify({hide:Math.round(hiddenAt-started),hideRequest:Math.round(hideRequestedAt-started),barrier:Math.round(hiddenAt-hideRequestedAt),capture:Math.round(capturedAt-hiddenAt),render:Math.round(performance.now()-capturedAt),total:Math.round(performance.now()-started)}));
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
        const pixels = await captured.toRaw(true);
        // xcap returns RGBA; Electron's bitmap input is BGRA on both supported platforms.
        for (let i = 0; i < pixels.length; i += 4) { const r = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = r; }
        const image = nativeImage.createFromBitmap(pixels, { width: captured.width, height: captured.height });
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
        if (crop.width < 64 || crop.height < 120) throw new Error('请框选更大的可滚动内容区域，并避开固定标题和工具栏');
        const first = bitmap(this.image.crop(crop));
        this.scroll = { rect: crop, previous: first, composite: first, frames: 1, running: false, automatic: false, paused: false, finishing: false, unchanged: 0 };
        await this.findScrollTarget(crop, first);
        if (this.session !== id || !this.busy) return;
        this.window?.hide(); this.window?.setFocusable(false);
        this.stopKey = globalShortcut.register('Escape', () => void this.scrollDone());
        this.showPanel('scroll', '在选区内直接向下滚动，停稳后自动拼接 · Esc 完成复制');
        if (!this.target && !this.panelOutside && !(process.env.LOLPING_TEST_DATA_DIR && process.env.LOLPING_TEST_CAPTURE_BACKEND === 'electron')) throw new Error('当前窗口无法直接采集，请缩小选区给工具栏留出空间');
        this.showBorder(crop);
        void this.autoScroll();
        return;
      }
      if (action === 'text') {
        this.showPanel('working', '正在离线识别中英文文字…首次初始化可能需要数秒');
        const text = await this.ocr.recognize(this.image.crop(crop).toPNG());
        if (!this.busy || this.session !== id || this.disposed) return;
        if (!text) throw new Error('未识别到文字，请重新框选清晰的文字区域');
        await clipboard.writeText(text);
        this.deps.report('文字已复制到剪贴板', `离线识别完成，共 ${text.length} 个字符`, true);
      } else await this.copy(edited);
    } catch (e) { if (this.session === id && this.busy) { if(action==='scroll')this.scroll=null; this.deps.report('高级截图失败', (e as Error).message, false); } }
    finally { if (this.session === id && !this.scroll) this.cleanup(); }
  }
  private scrollImage(): NativeImage {
    const c = this.scroll!.composite;
    return nativeImage.createFromBitmap(Buffer.from(c.pixels), { width: c.width, height: c.height });
  }
  private showPanel(stage: 'scroll' | 'working', message: string): void {
    if (!this.window || !this.display) return;
    const b = this.display.workArea;
    const width=stage==='scroll'?600:420,height=stage==='scroll'?80:175;
    let panel = { x: b.x + b.width - width - 10, y: b.y + b.height - height - 10, width, height };
    this.panelOutside = false;
    if (stage === 'scroll' && this.scroll && this.image) {
      const d = this.display.bounds, r = this.scroll.rect, size = this.image.getSize();
      const area = { x: d.x + r.x * d.width / size.width, y: d.y + r.y * d.height / size.height, width: r.width * d.width / size.width, height: r.height * d.height / size.height };
      const positions = [{x:area.x + area.width + 10,y:area.y}, {x:area.x,y:area.y + area.height + 10}, {x:area.x - width - 10,y:area.y}, {x:area.x,y:area.y - height - 10}];
      const fit = positions.find(p => p.x >= b.x && p.y >= b.y && p.x + width <= b.x + b.width && p.y + height <= b.y + b.height);
      if (fit) { panel = {...panel, x:Math.round(fit.x), y:Math.round(fit.y)}; this.panelOutside = true; }
    }
    this.window.setBounds(panel);
    this.setFrame({ dataUrl: stage === 'scroll' ? this.scrollImage().resize({ width: 70 }).toDataURL() : '', width: this.scroll?.composite.width ?? 0, height: this.scroll?.composite.height ?? 0, session: this.session, mode: 'advanced', stage, message, frames: this.scroll?.frames, automatic: this.scroll?.automatic, paused: this.scroll?.paused, source: this.target ? 'window' : 'screen', stopping: this.scroll?.finishing });
    this.window.showInactive();
  }
  private toggleScroll(): void {
    const scroll = this.scroll;
    if (!scroll || scroll.finishing) return;
    if (scroll.paused) { scroll.paused = false; scroll.automatic = false; } else scroll.automatic = !scroll.automatic;
    this.showPanel('scroll', scroll.automatic ? '正在自动向下滚动 · 随时改为手动或完成复制' : '在选区内直接向下滚动，停稳后自动拼接 · Esc 完成复制');
    if (!scroll.paused && !scroll.running) void this.autoScroll();
  }
  private async scrollDone(): Promise<void> {
    const scroll = this.scroll;
    if (!scroll || scroll.finishing) return;
    // Mark stopped before any await: in-flight captures must never append or issue another wheel event.
    scroll.finishing = true;
    try { await this.copy(this.scrollImage()); }
    catch (e) { this.deps.report('长图复制失败', (e as Error).message, false); }
    finally { this.cleanup(); }
  }
  private async nativeBitmap(captured: import('node-screenshots').Image): Promise<NativeImage> {
    const pixels = await captured.toRaw(true);
    for (let i = 0; i < pixels.length; i += 4) { const r = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = r; }
    return nativeImage.createFromBitmap(pixels, { width: captured.width, height: captured.height });
  }
  private regionPoints(rect: CaptureRect): CaptureRect {
    const d = this.display!.bounds, size = this.image!.getSize();
    const p = {x:d.x + rect.x*d.width/size.width, y:d.y + rect.y*d.height/size.height};
    const end = {x:d.x + (rect.x+rect.width)*d.width/size.width, y:d.y + (rect.y+rect.height)*d.height/size.height};
    const a = IS_MAC ? p : screen.dipToScreenPoint(p), b = IS_MAC ? end : screen.dipToScreenPoint(end);
    return {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y};
  }
  private async findScrollTarget(rect: CaptureRect, first: BitmapFrame): Promise<void> {
    this.target = null;
    if (process.env.LOLPING_TEST_DATA_DIR && process.env.LOLPING_TEST_CAPTURE_BACKEND === 'electron') return;
    const id=this.session, area=this.regionPoints(rect);
    const { Window } = await import('node-screenshots');
    const windows = Window.all().filter(w => {
      try { return w.pid() !== process.pid && !w.isMinimized() && area.x>=w.x()-1 && area.y>=w.y()-1 && area.x+area.width<=w.x()+w.width()+1 && area.y+area.height<=w.y()+w.height()+1; }
      catch { return false; }
    }).slice(0, 6);
    for (const window of windows) {
      try {
        const bounds = {x:window.x(),y:window.y(),width:window.width(),height:window.height()};
        const captured = await this.nativeBitmap(await window.captureImage()), size = captured.getSize();
        const crop = boundedCrop({x:(area.x-bounds.x)*size.width/bounds.width,y:(area.y-bounds.y)*size.height/bounds.height,width:area.width*size.width/bounds.width,height:area.height*size.height/bounds.height},size.width,size.height);
        const candidate = bitmap(captured.crop(crop).resize({width:first.width,height:first.height}));
        let opaque=0,total=0;
        for(let i=3;i<candidate.pixels.length;i+=4*Math.max(1,Math.floor(candidate.width*candidate.height/1000))){if(candidate.pixels[i]>=200)opaque++;total++;}
        // Choose the first visible window covering the selection. Its contents may have changed
        // since the frozen preview, so a colour match must not reject a real live window.
        let colour=0,samples=0;
        for(let i=0;i<candidate.pixels.length;i+=4*Math.max(1,Math.floor(candidate.width*candidate.height/1000))){colour+=candidate.pixels[i]+candidate.pixels[i+1]+candidate.pixels[i+2];samples+=3;}
        const blank=colour/Math.max(1,samples)<1 && frameDifference(first,candidate)>10;
        if (opaque/Math.max(1,total)>0.85 && !blank && this.session===id && this.busy) { this.target = {window,bounds,crop}; for(let i=3;i<candidate.pixels.length;i+=4)candidate.pixels[i]=255; if(this.scroll){this.scroll.previous=candidate;this.scroll.composite=candidate;} return; }
      } catch { /* a monitor capture remains usable when the controls fit outside the selection */ }
    }
  }
  private async readScrollFrame(rect: CaptureRect): Promise<BitmapFrame> {
    const target = this.target;
    if (!target) return bitmap((await this.readScreen(this.display!)).crop(rect));
    if (target.window.isMinimized() || target.window.x()!==target.bounds.x || target.window.y()!==target.bounds.y || target.window.width()!==target.bounds.width || target.window.height()!==target.bounds.height) throw new Error('目标窗口已移动或最小化，请完成当前长图并重新框选');
    const image = await this.nativeBitmap(await target.window.captureImage());
    const result=bitmap(image.crop(target.crop).resize({width:rect.width,height:rect.height}));
    for(let i=3;i<result.pixels.length;i+=4)result.pixels[i]=255;
    return result;
  }
  private showBorder(rect: CaptureRect): void {
    if (!this.display || !this.image) return;
    const d=this.display.bounds,size=this.image.getSize();
    const left=Math.floor(d.x+rect.x*d.width/size.width)-4, top=Math.floor(d.y+rect.y*d.height/size.height)-4;
    const right=Math.ceil(d.x+(rect.x+rect.width)*d.width/size.width)+4,bottom=Math.ceil(d.y+(rect.y+rect.height)*d.height/size.height)+4;
    const win=new BrowserWindow({x:left,y:top,width:right-left,height:bottom-top,frame:false,transparent:true,backgroundColor:'#00000000',show:false,focusable:false,skipTaskbar:true,resizable:false,movable:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    this.border=win; win.setAlwaysOnTop(true,'screen-saver'); win.setIgnoreMouseEvents(true);
    if(IS_MAC) win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    void win.loadURL('data:text/html,'+encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;box-sizing:border-box}body{border:2px solid #07c160}</style>`)).then(()=>{if(this.border===win && !win.isDestroyed())win.showInactive();}).catch(()=>undefined);
  }
  private async autoScroll(): Promise<void> {
    const scroll = this.scroll, display = this.display, id = this.session;
    if (!scroll || !display || scroll.running || scroll.finishing) return;
    scroll.running = true;
    const active = () => this.session === id && this.scroll === scroll && !scroll.finishing && !scroll.paused && !this.disposed;
    const began = Date.now();
    let candidate: BitmapFrame | null = null, stableSince = 0, wheelAt = 0;
    try {
      while (active()) {
        if (scroll.automatic && wheelAt===0) {
          const area=this.regionPoints(scroll.rect);
          if (!(process.env.LOLPING_TEST_DATA_DIR && process.env.LOLPING_TEST_CAPTURE_BACKEND === 'electron')) await this.deps.scroll(Math.round(area.x+area.width/2), Math.round(area.y+area.height/2), Math.min(180,Math.max(24,Math.round(scroll.rect.height*display.bounds.height/this.image!.getSize().height*0.3))));
          wheelAt=Date.now(); candidate=null;
        }
        await delay(scroll.automatic ? 200 : 100);
        if (!active()) break;
        const next = await this.readScrollFrame(scroll.rect);
        if (!active()) break;
        if (!candidate || frameDifference(candidate,next)>0.6) { candidate=next; stableSince=Date.now(); continue; }
        if (Date.now()-stableSince<100) continue;
        if (scroll.automatic && Date.now()-wheelAt<400) continue;
        const merged=appendScrollFrame(scroll.composite,scroll.previous,next);
        const changed=merged!==scroll.composite;
        if(changed) {
          scroll.composite=merged;scroll.previous=next;scroll.frames++;scroll.unchanged=0;
          this.showPanel('scroll',scroll.automatic ? '正在自动滚动和拼接 · Esc 完成复制' : '已拼接 · 在选区内继续向下滚动，或完成复制');
        } else if(scroll.automatic) {
          scroll.unchanged++;
          if(scroll.unchanged>=3){await this.scrollDone();return;}
        }
        if(scroll.automatic){wheelAt=0;candidate=null;await delay(100);}
        if(Date.now()-began>120000 || scroll.frames>=150) {await this.scrollDone();return;}
      }
    } catch(e) {
      if(this.session===id && !scroll.finishing){scroll.paused=true;scroll.automatic=false;this.showPanel('scroll',`${(e as Error).message}；已保留当前长图`);}
    } finally {
      scroll.running=false;
      if(active())void this.autoScroll();
    }
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
    this.renderReady?.resolve(); this.renderReady = null;
    if (this.stopKey) { globalShortcut.unregister('Escape'); this.stopKey = false; }
    this.target=null;
    const border=this.border; this.border=null; if(border && !border.isDestroyed())border.destroy();
    if(this.window && !this.window.isDestroyed())this.window.setFocusable(true);
    this.session++; this.image = null; this.scroll = null; this.busy = false; this.display = null;
    if (this.window && !this.window.isDestroyed()) { this.window.hide(); this.setFrame(null); }
    for(const [w,opacity] of this.opacity)if(!w.isDestroyed())w.setOpacity(opacity);
    this.opacity.clear();
    if (!this.disposed) {
      for (const w of this.restore) if (!w.isDestroyed()) w.showInactive();
      if (this.focused && !this.focused.isDestroyed()) { this.focused.show(); this.focused.focus(); }
      this.deps.onBusy(false);
    }
    this.restore = []; this.focused = null;
  }
  dispose(): void {
    this.disposed = true; this.cleanup(); this.ocr.dispose(); this.barrier.dispose();
    const win = this.window; this.window = null; if (win && !win.isDestroyed()) win.destroy();
    for (const name of ['frame', 'ready', 'finish', 'advanced', 'scrollNext', 'scrollDone']) ipcMain.removeHandler(`capture:${name}`);
  }
}
