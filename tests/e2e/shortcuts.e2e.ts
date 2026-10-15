import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import type { QuickRule } from '../../src/shared/quickActions';
let app: ElectronApplication, page: Page, overlay: Page, data: string;
async function launch(extraEnv: Record<string, string> = {}) {
  app = await electron.launch({ executablePath: process.env.LOLPING_E2E_EXECUTABLE, args: [...(process.env.LOLPING_E2E_EXECUTABLE ? [] : ['.']), `--user-data-dir=${join(data, 'chromium')}`], env: { ...process.env, LOLPING_TEST_DATA_DIR: data, ...extraEnv }, timeout: 30000 });
  await app.evaluate(({ app }) => { app.emit('activate'); });
  await expect.poll(() => app.windows().some(w => w.url().includes('/settings/'))).toBe(true);
  page = app.windows().find(w => w.url().includes('/settings/'))!;
  await expect(page.getByRole('button', { name: '快捷动作', exact: true })).toBeVisible();
  await expect.poll(() => app.windows().some(w => w.url().includes('/overlay/'))).toBe(true);
  overlay = app.windows().find(w => w.url().includes('/overlay/'))!;
  await page.getByRole('button', { name: '快捷动作', exact: true }).click();
  await expect(page.getByText('我的信号规则', { exact: true })).toBeVisible();
  await expect(page.locator('.navItem.sel')).toHaveText('快捷动作');
}
async function captureVisible() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().includes('/capture/') && w.isVisible())); }
async function backupClipboard() {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const items = await clipboard.read();
    // Windows can return an empty item for an empty clipboard. It has no data to restore.
    const saved = await Promise.all(items.filter(item => item.types.length > 0).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    (globalThis as unknown as { testClipboard: Electron.ClipboardItem[] }).testClipboard = saved;
  });
}
async function restoreClipboard() {
  await app.evaluate(async ({ clipboard }) => {
    const saved = (globalThis as unknown as { testClipboard?: Electron.ClipboardItem[] }).testClipboard;
    if (!saved) return;
    if (saved.length) await clipboard.write(saved); else clipboard.clear();
  });
}
const textRule = (patch: Partial<QuickRule> = {}): QuickRule => ({ id: 'test-action', name: '测试快捷文本', ping: 'assist', count: 3, intervalMs: 2500, cooldownMs: 5000, enabled: true, action: { type: 'clipboard', target: 'lolPing shortcut test' }, ...patch });
async function configure(rule = textRule()) {
  await page.evaluate(async r => { const s = await window.settingsApi.getSettings(); const result = await window.settingsApi.setSettings({ quickActions: { ...s.quickActions, rules: [r] } }); if (!result.ok) throw new Error(result.error); }, rule);
}
async function localPing(id: 'assist' | 'missing' = 'assist', button: 'left' | 'right' = 'left') { await overlay.evaluate(({id, button}) => window.overlay.reportPing(id, 400, 300, button), {id, button}); }
test.beforeEach(async () => { app = undefined!; data = await mkdtemp(join(tmpdir(), 'lolping-shortcuts-')); await launch(); });
test.afterEach(async () => { if (app && app.process().exitCode === null) { try { await restoreClipboard(); } finally { await app.close(); } } if (data) await rm(data, { recursive: true, force: true }); });

test('original assets are loaded and UI-created rules persist after restart', async () => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await expect.poll(async () => (await page.evaluate(() => window.settingsApi.getAbout())).problems.filter(p => p.includes('textures/') || p.includes('sounds/')).length).toBe(0);
  const shotDir = process.env.LOLPING_SCREENSHOT_DIR;
  if (shotDir) {
    await mkdir(shotDir, { recursive: true });
    await page.screenshot({ path: join(shotDir, 'quick-actions.png'), omitBackground: true });
  }
  await page.getByRole('button', { name: '添加规则', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialogBounds = await page.getByRole('dialog').boundingBox();
  const saveBounds = await page.getByRole('button', { name: '保存规则', exact: true }).boundingBox();
  expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height);
  if (shotDir) {
    await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().map(a => a.finished)); });
    await page.screenshot({ path: join(shotDir, 'quick-rule.png'), omitBackground: true });
  }
  await page.getByLabel(/^规则名称/).fill('协助三次复制文本');
  await page.getByLabel('执行动作', { exact: true }).selectOption('clipboard');
  await page.getByLabel(/^要复制的文本/).fill('收到，马上处理。');
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('协助三次复制文本', { exact: true })).toBeVisible();
  await app.close(); await launch();
  await expect(page.getByText('协助三次复制文本', { exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).quickActions.rules).toHaveLength(4);
  expect(errors).toEqual([]);
});

test('only three local committed pings execute; previews and remote pings never do', async () => {
  await backupClipboard(); await configure();
  await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('untouched'); });
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.settingsApi.previewPing('assist'));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/overlay/'))!;
    for (let i = 0; i < 3; i++) w.webContents.send('ping:spawn', { id: 'assist', x: 400, y: 300, tag: { name: 'remote', color: 1 } });
  });
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('untouched');
  expect((await page.evaluate(() => window.settingsApi.getQuickState())).history).toHaveLength(0);
  await localPing(); await localPing();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('untouched');
  await localPing();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('lolPing shortcut test');
  await localPing(); await localPing(); await localPing();
  expect((await page.evaluate(() => window.settingsApi.getQuickState())).history).toHaveLength(1);
});

test('original wheel release reports the selected ping and runs its configured action', async () => {
  await backupClipboard(); await configure(textRule({ count: 1 }));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/overlay/'))!;
    w.webContents.send('wheel:open', { x: 400, y: 300, wheel: 'ping' });
    w.webContents.send('wheel:move', { x: 400, y: 450, wheel: 'ping' });
    w.webContents.send('wheel:release', { x: 400, y: 450, wheel: 'ping' });
  });
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('lolPing shortcut test');
});

test('crop uses real native window and clipboard; escape restores the original overlay', async () => {
  await backupClipboard();
  await app.evaluate(({ desktopCapturer, nativeImage }) => {
    process.env.LOLPING_TEST_CAPTURE_BACKEND = 'electron';
    const pixels = Buffer.alloc(400 * 200 * 4, 255);
    desktopCapturer.getSources = async () => [{ id: 'screen:0:0', display_id: '', name: 'test', appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBitmap(pixels, { width: 400, height: 200 }) }];
  });
  const readImage = () => app.evaluate(async ({ clipboard, nativeImage }) => {
    const item = (await clipboard.read()).find(i => i.types.includes('image/png'));
    if (!item) throw new Error('missing PNG');
    const image = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));
    return { size: image.getSize(), data: image.toDataURL() };
  });
  await page.getByRole('button', { name: '区域截图', exact: true }).click();
  await expect.poll(captureVisible).toBe(true);
  const capture = app.windows().find(w => w.url().includes('/capture/'))!;
  await expect(capture.getByText('拖动框选，松开即复制到剪贴板')).toBeVisible();
  const size = await capture.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await capture.mouse.move(size.w * .25, size.h * .25); await capture.mouse.down();
  await capture.mouse.move(size.w * .75, size.h * .75); await capture.mouse.up().catch(e => { if (!String(e).includes('closed')) throw e; });
  await expect.poll(captureVisible).toBe(false);
  expect((await readImage()).size).toEqual({ width: 200, height: 100 });
  const before = (await readImage()).data;
  await page.getByRole('button', { name: '区域截图', exact: true }).click();
  await expect.poll(captureVisible).toBe(true);
  const cancel = app.windows().find(w => w.url().includes('/capture/'))!;
  await expect(cancel.getByText('拖动框选，松开即复制到剪贴板')).toBeVisible();
  await cancel.keyboard.press('Escape').catch(e => { if (!String(e).includes('closed')) throw e; });
  await expect.poll(captureVisible).toBe(false);
  expect((await readImage()).data).toBe(before);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('/overlay/')).every(w => w.isVisible()))).toBe(true);
});

test('invalid app rules and shortcut conflicts leave previous settings unchanged', async () => {
  const original = await page.evaluate(() => window.settingsApi.getSettings());
  const rejected = await page.evaluate(async () => {
    const s = await window.settingsApi.getSettings();
    s.quickActions.rules[0].enabled = true;
    return window.settingsApi.setSettings({ quickActions: s.quickActions });
  });
  expect(rejected.ok).toBe(false);
  await app.evaluate(({ globalShortcut }) => { if (!globalShortcut.register('Control+Alt+9', () => {})) throw new Error('test key unavailable'); });
  try {
    const conflict = await page.evaluate(async () => {
      const s = await window.settingsApi.getSettings();
      return window.settingsApi.setSettings({ quickActions: { ...s.quickActions, screenshotShortcut: 'Control+Alt+9' } });
    });
    expect(conflict.ok).toBe(false);
    expect((await page.evaluate(() => window.settingsApi.getQuickState())).screenshotShortcutActive).toBe(true);
  } finally { await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('Control+Alt+9')); }
  expect((await page.evaluate(() => window.settingsApi.getSettings())).quickActions).toEqual(original.quickActions);
});


test.describe('Windows native integration', () => {
  test.skip(process.platform !== 'win32', 'Requires the actual Windows desktop and native input helper');
  const input = async (action: string, count = 1, button = 'Left') => {
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/e2e/fixtures/native-input.ps1'), '-Action', action, '-Count', String(count), '-Button', button], { timeout: 20000 });
  };
  test('Windows overlay recovers after native demotion, desktop switching, screenshots and foreground changes', async () => {
    test.setTimeout(120000);
    await expect.poll(async () => (await page.evaluate(() => window.settingsApi.getStatus())).helper).toBe('running');
    const target = await electron.launch({ args: [resolve('tests/e2e/fixtures/scroll-target.cjs'), `--user-data-dir=${join(data, 'layer-target')}`], timeout: 30000 });
    await expect((await target.firstWindow()).locator('canvas')).toBeVisible();
    const overlayHandle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/overlay/'))!.getNativeWindowHandle().readBigUInt64LE().toString());
    const targetHandle = await target.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 80, y: 80, width: 800, height: 500 }); w.show(); w.focus();
      return w.getNativeWindowHandle().readBigUInt64LE().toString();
    });
    const layer = async (action = 'Inspect'): Promise<{ topmost: boolean; above: boolean; visible: boolean; foreground: string }> => {
      const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/e2e/fixtures/window-layer.ps1'), '-Action', action, '-Overlay', overlayHandle, '-Target', targetHandle], { timeout: 20000 });
      return JSON.parse(result.stdout.trim());
    };
    try {
      await overlay.evaluate(() => {
        (window as unknown as { wheelOpen: boolean }).wheelOpen = false;
        window.overlay.on('wheel:open', () => { (window as unknown as { wheelOpen: boolean }).wheelOpen = true; });
        window.overlay.on('wheel:release', () => { (window as unknown as { wheelOpen: boolean }).wheelOpen = false; });
      });
      // Simulate the native loss of topmost that Electron's cached flag cannot reliably detect.
      for (let cycle = 0; cycle < 3; cycle++) {
        expect((await layer('Demote')).topmost).toBe(false);
        await layer('Cover');
        await target.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
        const foreground = (await layer()).foreground;
        expect(foreground).toBe(targetHandle);
        console.log('Holding native wheel:', await layer('Hold'));
        await expect.poll(() => overlay.evaluate(() => (window as unknown as { wheelOpen: boolean }).wheelOpen)).toBe(true);
        await expect.poll(async () => { const state = await layer(); return state.topmost && state.above && state.visible && state.foreground === foreground; }).toBe(true);
        // Another topmost app moves above an already held, stationary wheel.
        await layer('Cover');
        await expect.poll(async () => { const state = await layer(); return state.above && state.foreground === foreground; }).toBe(true);
        await layer('Release');
        await expect.poll(() => overlay.evaluate(() => (window as unknown as { wheelOpen: boolean }).wheelOpen)).toBe(false);
      }
      await layer('Desktop');
      await target.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.show(); w.focus(); });
      console.log('Holding wheel after desktop:', await layer('Hold'));
      await expect.poll(async () => { const state = await layer(); return state.above && state.visible && state.foreground === targetHandle; }).toBe(true);
      await layer('Release');
      await mockScreens([await page.evaluate(() => { const c = document.createElement('canvas'); c.width=400; c.height=200; return c.toDataURL(); })]);
      await page.evaluate(() => window.settingsApi.captureScreenshot(true, 'fast'));
      expect((await layer()).visible).toBe(false);
      // A marker arriving during capture must not restore the overlay prematurely.
      await page.evaluate(() => window.settingsApi.previewPing('assist'));
      expect((await layer()).visible).toBe(false);
      const capture = app.windows().find(w => w.url().includes('/capture/'))!;
      await capture.keyboard.press('Escape');
      await expect.poll(captureVisible).toBe(false);
      await expect.poll(async () => { const state = await layer(); return state.topmost && state.visible && state.above; }).toBe(true);
    } finally { await layer('Release'); await target.close(); }
  });
  test('native Alt-drag assist copies text and two question pings open a real EXE', async () => {
    await backupClipboard();
    await overlay.evaluate(() => {
      const events: unknown[] = [];
      (window as unknown as { nativeEvents: unknown[] }).nativeEvents = events;
      for (const channel of ['wheel:open', 'wheel:move', 'wheel:release', 'wheel:cancel', 'ping:spawn'] as const) window.overlay.on(channel, data => { events.push({ channel, data }); });
    });
    const target = join(data, '快捷应用 with spaces.exe');
    const compiler = join(process.env.SystemRoot!, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    await exec(compiler, ['/nologo', '/target:winexe', `/out:${target}`, resolve('tests/e2e/fixtures/launcher.cs')]);
    const rules = [textRule({ intervalMs: 10000 }), textRule({ id: 'question-app', name: '问号两次打开测试应用', ping: 'missing', count: 2, intervalMs: 10000, action: { type: 'app', target } })];
    await page.evaluate(async rules => {
      const s = await window.settingsApi.getSettings();
      const result = await window.settingsApi.setSettings({ gameCheck: false, quickActions: { ...s.quickActions, rules } });
      if (!result.ok) throw new Error(result.error);
    }, rules);
    await expect.poll(async () => (await page.evaluate(() => window.settingsApi.getStatus())).helper).toBe('running');
    await app.evaluate(async ({ clipboard }) => { await clipboard.writeText('native input pending'); });
    await input('Assist', 3);
    console.log('Native assist events:', JSON.stringify(await overlay.evaluate(() => (window as unknown as { nativeEvents: unknown[] }).nativeEvents)));
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('lolPing shortcut test');
    await input('Missing', 2);
    console.log('Native question events:', JSON.stringify(await overlay.evaluate(() => (window as unknown as { nativeEvents: unknown[] }).nativeEvents)));
    await expect.poll(async () => readFile(target + '.launched', 'utf8').catch(() => '')).toBe('opened by lolPing');
    await expect.poll(async () => (await page.evaluate(() => window.settingsApi.getQuickState())).history.filter(h => h.ok).length).toBe(2);
  });

  test('global screenshot shortcut captures the real desktop and copies the crop', async () => {
    await backupClipboard();
    expect((await page.evaluate(() => window.settingsApi.getQuickState())).screenshotShortcutActive).toBe(true);
    await input('Screenshot');
    await expect.poll(captureVisible).toBe(true);
    const capture = app.windows().find(w => w.url().includes('/capture/'))!;
    await expect(capture.getByText('拖动框选，松开即复制到剪贴板')).toBeVisible();
    await capture.mouse.move(100, 100); await capture.mouse.down();
    await capture.mouse.move(400, 300); await capture.mouse.up().catch(e => { if (!String(e).includes('closed')) throw e; });
    await expect.poll(captureVisible).toBe(false);
    const size = await app.evaluate(async ({ clipboard, nativeImage }) => {
      const item = (await clipboard.read()).find(i => i.types.includes('image/png'));
      if (!item) throw new Error('missing PNG from desktop capture');
      return nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer())).getSize();
    });
    expect(size.width).toBeGreaterThanOrEqual(300);
    expect(size.height).toBeGreaterThanOrEqual(200);
    await expect.poll(async () => (await page.evaluate(() => window.settingsApi.getQuickState())).history.some(h => h.ok && h.name === '截图已复制到剪贴板')).toBe(true);
  });
  test('native right-button wheel runs only right-button shortcuts', async () => {
    await backupClipboard(); await configure(textRule({count:2,button:'right'}));
    await page.evaluate(async()=>{const r=await window.settingsApi.setSettings({gameCheck:false});if(!r.ok)throw new Error(r.error);});
    await expect.poll(async()=>(await page.evaluate(()=>window.settingsApi.getStatus())).helper).toBe('running');
    await overlay.evaluate(()=>{(window as unknown as {rightReleases:number}).rightReleases=0;window.overlay.on('wheel:release',p=>{if(p.button==='right')(window as unknown as {rightReleases:number}).rightReleases++;});});
    await input('Assist',2,'Right');
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('lolPing shortcut test');
    expect(await overlay.evaluate(()=>(window as unknown as {rightReleases:number}).rightReleases)).toBe(2);
  });
});


async function mockScreens(urls: string[]) {
  await app.evaluate(({ desktopCapturer, nativeImage }, images) => {
    process.env.LOLPING_TEST_CAPTURE_BACKEND = 'electron';
    let index = 0;
    desktopCapturer.getSources = async () => [{ id: 'screen:0:0', display_id: '', name: 'test', appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromDataURL(images[Math.min(index++, images.length - 1)]) }];
  }, urls);
}
async function clipboardImage() {
  return app.evaluate(async ({ clipboard, nativeImage }) => {
    const item = (await clipboard.read()).find(i => i.types.includes('image/png'));
    if (!item) throw new Error('PNG not on clipboard');
    const image = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));
    return { size: image.getSize(), data: image.toDataURL() };
  });
}
test('fast capture reuses its preloaded window and history is collapsed and bounded', async () => {
  await backupClipboard();
  await configure(textRule({ count: 1, cooldownMs: 1000 }));
  const captureBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/capture/'))!.id);
  await app.evaluate(({ desktopCapturer, nativeImage }) => {
    process.env.LOLPING_TEST_CAPTURE_BACKEND = 'electron';
    desktopCapturer.getSources = async () => [{ id: 'screen:0:0', display_id: '', name: 'test', appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromBitmap(Buffer.alloc(400 * 200 * 4, 255), { width: 400, height: 200 }) }];
  });
  const start = Date.now(); await page.evaluate(() => window.settingsApi.captureScreenshot(true, 'fast'));
  console.log('Warm fast capture ready:',Date.now()-start,'ms');
  expect(Date.now() - start).toBeLessThan(process.env.CI ? 1500 : 900);
  expect(Date.now() - start).toBeLessThan(2000);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/capture/'))!.id)).toBe(captureBefore);
  const capture = app.windows().find(w => w.url().includes('/capture/'))!;
  await expect(capture.getByText('拖动框选，松开即复制到剪贴板')).toBeVisible();
  expect(await capture.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('/advanced-')))).toBe(false);
  await capture.keyboard.press('Escape'); await expect.poll(captureVisible).toBe(false);
  for (let i = 0; i < 4; i++) { await localPing(); if (i < 3) await new Promise(r => setTimeout(r, 1100)); }
  expect((await page.evaluate(() => window.settingsApi.getQuickState())).history).toHaveLength(3);
  expect(await page.locator('.qa-records').evaluate(e => (e as HTMLDetailsElement).open)).toBe(false);
});
test('advanced screenshot editor annotates the copied image', async () => {
  await backupClipboard();
  const dataUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 700; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); return c.toDataURL(); });
  await mockScreens([dataUrl]);
  await page.getByRole('button', { name: '高级截图', exact: true }).click();
  await expect.poll(captureVisible).toBe(true);
  const capture = app.windows().find(w => w.url().includes('/capture/'))!;
  await expect(capture.locator('.screenshots')).toBeVisible();
  await expect(capture.getByRole('combobox')).toHaveCount(0);
  await capture.mouse.move(100, 140); await capture.mouse.down(); await capture.mouse.move(750, 500); await capture.mouse.up();
  await expect(capture.getByRole('button', { name: '滚动截图', exact: true })).toHaveCount(0);
  await expect(capture.getByRole('button', { name: '提取文字', exact: true })).toBeVisible();
  const icons = await capture.evaluate(async () => { await document.fonts.ready; return document.fonts.check('18px screenshots-icon'); });
  expect(icons).toBe(true);
  const buttonStyle = await capture.getByTitle('矩形', { exact: true }).evaluate(e => ({color:getComputedStyle(e).color,label:getComputedStyle(e,'::after').content}));
  expect(buttonStyle.color).toBe('rgb(36, 41, 47)');
  expect(buttonStyle.label).toBe('"矩形"');
  if (process.env.LOLPING_SCREENSHOT_DIR) await capture.screenshot({path:join(process.env.LOLPING_SCREENSHOT_DIR,'advanced-toolbar.png')});
  await capture.getByTitle('矩形', { exact: true }).click();
  await capture.mouse.move(170, 200); await capture.mouse.down(); await capture.mouse.move(450, 360); await capture.mouse.up();
  await capture.getByTitle('完成', { exact: true }).click();
  await expect.poll(captureVisible).toBe(false);
  const image = await clipboardImage();
  const painted = await page.evaluate(async url => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d')!; ctx.drawImage(img,0,0); const d = ctx.getImageData(0,0,c.width,c.height).data; let red = 0; for(let i=0;i<d.length;i+=4) if(d[i]>180 && d[i+1]<100 && d[i+2]<100) red++; return red; }, image.data);
  expect(painted).toBeGreaterThan(100);
});
test('advanced screenshot extracts English text offline into the system clipboard', async () => {
  await backupClipboard();
  const dataUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 400; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle = '#000'; ctx.font = '80px Arial'; ctx.fillText('HELLO OCR 2026', 80, 180); return c.toDataURL(); });
  await mockScreens([dataUrl]);
  await page.evaluate(() => window.settingsApi.captureScreenshot(true, 'advanced'));
  const capture = app.windows().find(w => w.url().includes('/capture/'))!;
  await expect(capture.locator('.screenshots')).toBeVisible();
  await expect(capture.getByRole('combobox')).toHaveCount(0);
  const viewport=await capture.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await capture.mouse.move(5,5);await capture.mouse.down();await capture.mouse.move(viewport.width-5,viewport.height-5);await capture.mouse.up();
  await capture.getByRole('button',{name:'提取文字',exact:true}).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/HELLO\s+OCR\s+2026/);
  await expect.poll(captureVisible).toBe(false);
});
test('native screenshot immediately after minimize contains the target rather than the settings animation', async () => {
  await backupClipboard();
  app.process().stdout?.on('data',chunk=>{const lines=String(chunk).split('\n').filter(line=>line.startsWith('[capture]'));if(lines.length)console.log(lines.join('\n'));});
  const display=await app.evaluate(({screen})=>screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds);
  const target=await electron.launch({args:[resolve('tests/e2e/fixtures/scroll-target.cjs'),`--user-data-dir=${join(data,'minimize-target')}`],timeout:30000});
  try {
    const targetPage=await target.firstWindow();await expect(targetPage.locator('canvas')).toBeVisible();
    await target.evaluate(({BrowserWindow},d)=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({x:d.x+80,y:d.y+80,width:800,height:500});w.show();w.focus();},display);
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/settings/'))!;w.show();w.focus();w.minimize();});
    const start=Date.now();await page.evaluate(()=>window.settingsApi.captureScreenshot(true,'fast'));
    console.log('Native capture after minimize ready:',Date.now()-start,'ms');
    const capture=app.windows().find(w=>w.url().includes('/capture/'))!;
    await capture.evaluate(async()=>{const f=(await window.captureApi.frame())!;await window.captureApi.finish({x:120*f.width/innerWidth,y:200*f.height/innerHeight,width:200*f.width/innerWidth,height:200*f.height/innerHeight});});
    console.log('Capture geometry after minimize',await capture.evaluate(()=>({viewport:[innerWidth,innerHeight]})));
    const image=await clipboardImage();
    const correlation=await targetPage.evaluate(async url=>{
      const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=200;c.height=200;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0,200,200);const got=ctx.getImageData(0,0,200,200).data;
      const expected=document.querySelector('canvas')!.getContext('2d')!.getImageData(40,120,200,200).data;
      // Compare texture rather than display-profile-dependent colour values (e.g. an Apple P3 panel).
      let n=0,a=0,b=0,aa=0,bb=0,ab=0;
      for(let i=0;i<got.length;i+=200){const x=0.2126*got[i]+0.7152*got[i+1]+0.0722*got[i+2],y=0.2126*expected[i]+0.7152*expected[i+1]+0.0722*expected[i+2];n++;a+=x;b+=y;aa+=x*x;bb+=y*y;ab+=x*y;}
      return (n*ab-a*b)/Math.sqrt((n*aa-a*a)*(n*bb-b*b));
    },image.data);
    console.log('Minimize capture matches target texture:',correlation);
    expect(correlation).toBeGreaterThan(0.95);
  } finally {await target.close();}
});
async function freePort(): Promise<number> { const s = createSocket('udp4'); await new Promise<void>(r => s.bind(0,'127.0.0.1',r)); const port = (s.address() as {port:number}).port; await new Promise<void>(r=>s.close(r)); return port; }
test('joined room receives only the selected mouse button while shortcuts can use the private button', async () => {
  await app.close();
  const portA = await freePort(), portB = await freePort();
  await launch({LOLPING_TEST_LAN_PORT:String(portA), LOLPING_TEST_LAN_PEER_PORT:String(portB)});
  await backupClipboard();
  const peerData = join(data,'peer'); await mkdir(peerData);
  await writeFile(join(peerData,'settings.json'),JSON.stringify({language:'zh-CN', enabledOnStart:true, allowInternet:false, quickActions:{ ...DEFAULT_PEER_QUICK, screenshotShortcut:'' }}));
  const peer = await electron.launch({executablePath:process.env.LOLPING_E2E_EXECUTABLE,args:[...(process.env.LOLPING_E2E_EXECUTABLE?[]:['.']),`--user-data-dir=${join(peerData,'chromium')}`],env:{...process.env,LOLPING_TEST_DATA_DIR:peerData,LOLPING_TEST_LAN_PORT:String(portB),LOLPING_TEST_LAN_PEER_PORT:String(portA)},timeout:30000});
  try {
    await peer.evaluate(({app})=>app.emit('activate'));
    await expect.poll(()=>peer.windows().some(w=>w.url().includes('/settings/'))).toBe(true);
    const peerPage = peer.windows().find(w=>w.url().includes('/settings/'))!;
    await expect(peerPage.getByRole('button',{name:'房间',exact:true})).toBeVisible();
    await expect.poll(()=>peer.windows().some(w=>w.url().includes('/overlay/'))).toBe(true);
    const peerOverlay = peer.windows().find(w=>w.url().includes('/overlay/'))!;
    await peerOverlay.evaluate(()=>{ (window as unknown as {remotePings:unknown[]}).remotePings=[]; window.overlay.on('ping:spawn',p=>{ if(p.tag) (window as unknown as {remotePings:unknown[]}).remotePings.push(p); }); });
    await page.evaluate(async rule=>{ const s=await window.settingsApi.getSettings(); const r=await window.settingsApi.setSettings({allowInternet:false,roomSyncButton:'right',quickActions:{...s.quickActions,rules:[rule]}}); if(!r.ok)throw new Error(r.error); await window.settingsApi.createRoom(); },textRule({count:1,button:'left'}));
    const code = (await page.evaluate(()=>window.settingsApi.getRoom())).code!;
    expect((await peerPage.evaluate(code=>window.settingsApi.joinRoom(code),code)).ok).toBe(true);
    await expect.poll(async()=> (await page.evaluate(()=>window.settingsApi.getRoom())).members.length).toBe(2);
    await localPing('assist','left');
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('lolPing shortcut test');
    await new Promise(r=>setTimeout(r,350));
    expect(await peerOverlay.evaluate(()=>(window as unknown as {remotePings:unknown[]}).remotePings.length)).toBe(0);
    await localPing('assist','right');
    await expect.poll(()=>peerOverlay.evaluate(()=>(window as unknown as {remotePings:unknown[]}).remotePings.length)).toBe(1);
    expect((await page.evaluate(()=>window.settingsApi.getQuickState())).history).toHaveLength(1);
  } finally { await peer.close(); }
});
const DEFAULT_PEER_QUICK = { enabled:false, screenshotShortcut:'',saveScreenshots:false,screenshotMode:'fast',historyLimit:3,rules:[] };
