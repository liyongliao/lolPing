import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { helperExePath } from './paths';

/** A prewarmed compositor connection, independent of Accessibility and the input hooks. */
export class CaptureBarrier {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private sequence = 0;
  private disposed = false;
  private pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private readonly command = helperExePath(), private readonly args = ['--capture-ready-server', String(process.pid)]) {
    void this.start().catch(() => undefined);
  }
  private start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('截图服务已关闭'));
    if (this.child && this.ready) return this.ready;
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => { reject(new Error('截图服务启动超时，请重启软件')); child.kill(); }, 2000);
      const gone = () => {
        clearTimeout(timeout);
        if (!settled) { settled = true; reject(new Error('截图服务未就绪，请重启软件')); }
        if (this.child !== child) return;
        this.child = null; this.ready = null;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('截图服务已退出，请重试')); }
        this.pending.clear();
      };
      child.once('error', gone); child.once('exit', gone);
      child.stdin?.on('error', gone);
      createInterface({ input: child.stdout! }).on('line', line => {
        if (line === 'ready' && !settled) { settled = true; clearTimeout(timeout); resolve(); return; }
        const match = /^(\d+) (ready|busy)$/.exec(line);
        if (!match) return;
        const id = Number(match[1]), request = this.pending.get(id);
        if (!request) return;
        clearTimeout(request.timer); this.pending.delete(id);
        if (match[2] === 'ready') request.resolve();
        else request.reject(new Error('窗口尚未隐藏，请关闭弹出菜单后重试截图'));
      });
    });
    return this.ready;
  }
  async wait(): Promise<void> {
    await this.start();
    if (this.disposed || !this.child?.stdin?.writable) throw new Error('截图服务未就绪，请重试');
    const id = ++this.sequence;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('等待窗口隐藏超时，请重试')); }, 1200);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(`${id}\n`);
    });
  }
  dispose(): void {
    this.disposed = true;
    const child = this.child;
    this.child = null; this.ready = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('截图服务已关闭')); }
    this.pending.clear();
    if (child) {
      child.stdin?.end();
      const kill = setTimeout(() => child.kill(), 250); kill.unref();
      child.once('exit', () => clearTimeout(kill));
    }
  }
}
