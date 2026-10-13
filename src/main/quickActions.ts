import { clipboard, dialog, globalShortcut, shell, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { stat, access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { QuickRuleEngine, type QuickActionsSettings, type QuickRule, type QuickState, type QuickActivity } from '../shared/quickActions';
import type { SharedPing } from './overlayManager';
import { IS_MAC } from './paths';
import { settingsWindow } from './settingsWindow';
import { ScreenshotTool } from './screenshotTool';

export async function openApplication(target: string): Promise<void> {
  if (!isAbsolute(target)) throw new Error('请选择应用的完整路径');
  const info = await stat(target);
  if (IS_MAC) {
    if (!target.toLowerCase().endsWith('.app') || !info.isDirectory()) throw new Error('请选择 .app 应用程序');
    await access(target, constants.R_OK);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('/usr/bin/open', ['-a', target], { shell: false, stdio: 'ignore', cwd: homedir() });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`应用启动失败（${code}）`)));
    });
  } else {
    if (!target.toLowerCase().endsWith('.exe') || !info.isFile()) throw new Error('请选择 .exe 应用程序');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  }
}
export class QuickActions {
  private engine = new QuickRuleEngine();
  private history: QuickActivity[] = [];
  private activeShortcut = '';
  private capturing = false;
  private disposed = false;
  private screenshot: ScreenshotTool;
  constructor(private readonly deps: { settings(): QuickActionsSettings; enabled(): boolean; suspend(on: boolean): void; toast(title: string, body: string): void }) {
    this.screenshot = new ScreenshotTool({ saveFiles: () => deps.settings().saveScreenshots, onBusy: on => { this.capturing = on; this.engine.breakSequence(); deps.suspend(on); this.broadcast(); }, report: (name, detail, ok) => this.report(name, detail, ok) });
    this.register(deps.settings().screenshotShortcut);
    this.ipc('quick:get', () => this.state());
    this.ipc('quick:pickApp', async () => {
      const win = settingsWindow(); if (!win) return null;
      const result = await dialog.showOpenDialog(win, { title: '选择要打开的应用', properties: ['openFile'], filters: [{ name: '应用程序', extensions: [IS_MAC ? 'app' : 'exe'] }] });
      return result.canceled ? null : result.filePaths[0];
    });
    this.ipc('quick:capture', region => { if (typeof region !== 'boolean') throw new Error('截图参数无效'); return this.capture(region); });
    this.ipc('quick:folder', async () => { await mkdir(this.screenshot.folder, { recursive: true }); const error = await shell.openPath(this.screenshot.folder); if (error) throw new Error(error); });
    this.ipc('quick:clear', () => { this.history = []; this.broadcast(); });
  }
  state(): QuickState { return { history: this.history, screenshotShortcutActive: !!this.activeShortcut, capturing: this.capturing }; }
  /** Called only by OverlayManager's local committed-ping event, never preview/remote events. */
  localPing(ping: SharedPing): void {
    if (!this.deps.enabled() || this.capturing || this.disposed) return;
    for (const rule of this.engine.accept(ping.id, this.deps.settings())) void this.execute(rule);
  }
  breakSequence(): void { this.engine.breakSequence(); }
  changed(previous: QuickActionsSettings): void {
    const next = this.deps.settings();
    if (JSON.stringify(next) !== JSON.stringify(previous)) this.engine.reset();
    this.broadcast();
  }
  /** Called before the settings write; a conflict leaves both the old settings and registration intact. */
  applyShortcut(next: string): string | null {
    if (next === this.activeShortcut) return null;
    const old = this.activeShortcut;
    // Keep the current key reserved until the new key is known to work.
    if (next && !this.register(next)) return '截图快捷键已被占用，或系统不支持这个组合。请换一个快捷键。';
    if (old) globalShortcut.unregister(old);
    this.activeShortcut = next;
    return null;
  }
  private register(shortcut: string): boolean {
    if (!shortcut) return true;
    try {
      const ok = globalShortcut.register(shortcut, () => void this.capture(true).catch(() => undefined));
      if (ok) this.activeShortcut = shortcut;
      return ok;
    } catch { return false; }
  }
  private async capture(region: boolean): Promise<void> {
    try { await this.screenshot.capture(region); }
    catch (e) { this.report('截图失败', (e as Error).message, false); throw e; }
  }
  private async execute(rule: QuickRule): Promise<void> {
    try {
      const a = rule.action;
      if (a.type === 'app') await openApplication(a.target);
      else if (a.type === 'url') await shell.openExternal(a.target);
      else if (a.type === 'clipboard') await clipboard.writeText(a.target);
      else { await this.capture(a.region); return; }
      this.report(rule.name, a.type === 'clipboard' ? '文本已复制到剪贴板' : '已执行快捷动作', true);
    } catch (e) { if (rule.action.type !== 'screenshot') this.report(rule.name, (e as Error).message, false); }
  }
  private report(name: string, detail: string, ok: boolean): void {
    if (this.disposed) return;
    this.history = [{ id: crypto.randomUUID(), time: Date.now(), name, detail, ok }, ...this.history].slice(0, 30);
    this.broadcast(); this.deps.toast(name, detail);
  }
  private broadcast(): void { if (!this.disposed) settingsWindow()?.webContents.send('quick:changed', this.state()); }
  private ipc(channel: string, handler: (...args: any[]) => unknown): void {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== settingsWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的快捷动作请求');
      return handler(...args);
    });
  }
  dispose(): void {
    this.disposed = true; this.screenshot.dispose();
    if (this.activeShortcut) globalShortcut.unregister(this.activeShortcut);
    for (const name of ['get', 'pickApp', 'capture', 'folder', 'clear']) ipcMain.removeHandler(`quick:${name}`);
  }
}
