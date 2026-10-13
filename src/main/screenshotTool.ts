import { app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, ipcMain, screen, type NativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boundedCrop } from '../shared/capture';
import { IS_MAC, loadPage, preloadPath } from './paths';

export class ScreenshotTool {
  private window: BrowserWindow | null = null;
  private image: NativeImage | null = null;
  private busy = false;
  private disposed = false;
  private restore: BrowserWindow[] = [];
  private focused: BrowserWindow | null = null;
  readonly folder = join(app.getPath('pictures'), 'lolPing');
  constructor(private readonly deps: { saveFiles(): boolean; onBusy(on: boolean): void; report(name: string, detail: string, ok: boolean): void }) {
    ipcMain.handle('capture:frame', event => {
      this.assertSender(event);
      return this.image ? { dataUrl: this.image.toDataURL(), ...this.image.getSize() } : null;
    });
    ipcMain.handle('capture:finish', async (event, rect: unknown) => {
      this.assertSender(event);
      try {
        if (rect !== null) {
          if (!this.image) throw new Error('截图已失效，请重试');
          const { width, height } = this.image.getSize();
          await this.copy(this.image.crop(boundedCrop(rect, width, height)));
        }
      } catch (e) { this.deps.report('截图失败', (e as Error).message, false); }
      finally { this.cleanup(); }
    });
  }
  private assertSender(event: Electron.IpcMainInvokeEvent): void {
    if (event.sender !== this.window?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的截图请求');
  }
  async capture(region: boolean): Promise<void> {
    if (this.busy) throw new Error('已有截图正在进行，请完成或按 Esc 取消');
    if (this.disposed) return;
    this.busy = true;
    this.deps.onBusy(true);
    this.focused = BrowserWindow.getFocusedWindow();
    this.restore = BrowserWindow.getAllWindows().filter(w => w.isVisible());
    for (const w of this.restore) w.hide();
    try {
      await new Promise(resolve => setTimeout(resolve, 220));
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
      if (this.disposed) return;
      const source = sources.find(s => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
      if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取屏幕。请在系统设置中允许 lolPing 屏幕录制权限，然后重启应用。');
      this.image = source.thumbnail;
      if (!region) { await this.copy(this.image); this.cleanup(); return; }
      const win = new BrowserWindow({ ...display.bounds, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, show: false, backgroundColor: '#101820', webPreferences: { preload: preloadPath('capture'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      this.window = win;
      win.setAlwaysOnTop(true, 'screen-saver');
      if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
      win.webContents.on('render-process-gone', () => this.cleanup());
      win.on('closed', () => { if (this.window === win) { this.window = null; this.cleanup(); } });
      await loadPage(win, 'capture');
      if (!win.isDestroyed()) { win.setBounds(display.bounds); win.show(); win.focus(); }
    } catch (e) { this.cleanup(); throw e; }
  }
  private async copy(image: NativeImage): Promise<void> {
    if (image.isEmpty()) throw new Error('截图为空，请重试');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })]);
    if (this.deps.saveFiles()) {
      try {
        await mkdir(this.folder, { recursive: true });
        await writeFile(join(this.folder, `lolPing-${new Date().toISOString().replace(/[:.]/g, '-')}.png`), image.toPNG());
      } catch (e) { this.deps.report('截图已复制，保存文件失败', (e as Error).message, false); return; }
    }
    // Report after windows return; otherwise the original overlay toast is hidden.
    setTimeout(() => { if (!this.disposed) this.deps.report('截图已复制到剪贴板', this.deps.saveFiles() ? '同时保存到 图片 / lolPing' : '直接粘贴到聊天、笔记或文档', true); }, 80);
  }
  private cleanup(): void {
    const win = this.window;
    this.window = null; this.image = null; this.busy = false;
    if (win && !win.isDestroyed()) win.destroy();
    if (!this.disposed) {
      for (const w of this.restore) if (!w.isDestroyed()) w.showInactive();
      if (this.focused && !this.focused.isDestroyed()) { this.focused.show(); this.focused.focus(); }
      this.deps.onBusy(false);
    }
    this.restore = []; this.focused = null;
  }
  dispose(): void { this.disposed = true; this.cleanup(); ipcMain.removeHandler('capture:frame'); ipcMain.removeHandler('capture:finish'); }
}
