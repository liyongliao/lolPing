import { scopeAllows, markerButton } from '../shared/mouseButtons';
import { QuickActions } from './quickActions';
import { app, clipboard, dialog, desktopCapturer, Menu, powerMonitor, screen, shell, systemPreferences } from 'electron';
import { randomBytes, randomInt } from 'node:crypto';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { resolveLang, strings, type Strings } from '../shared/i18n';
import { SETTINGS_CH, type About, type AppStatus } from '../shared/ipc';
import { hotkeyLabel } from '../shared/keys';
import { configCommand, type HelperStatus } from '../shared/protocol';
import type { RoomState } from '../shared/room';
import { formatRoomCode, parseRoomCode } from '../shared/roomCode';
import { overlaySettings, type Settings } from '../shared/settings';
import { updateErrorText, type UpdateState } from '../shared/update';
import { registerAppScheme, serveAppScheme } from './appProtocol';
import { resolveTarget, toShared } from './displayNumbers';
import { EmoteLibrary, resolveEmoteArt } from './emoteLibrary';
import { InputBridge } from './inputBridge';
import { LanTransport } from './lanTransport';
import { RELAYS } from './relays';
import { RelayTransport } from './relayTransport';
import { OverlayManager, type SharedEmote, type SharedPing } from './overlayManager';
import { assetPath, buildResourcePath, helperExePath, IS_MAC, PLATFORM, settingsDir } from './paths';
import { deriveRoomKeys } from './roomCrypto';
import { RoomManager, type RoomToast } from './roomManager';
import { registerSettingsIpc } from './settingsIpc';
import { SettingsStore } from './settingsStore';
import { onSettingsWindowGone, openSettingsWindow, settingsWindow } from './settingsWindow';
import { AppTray, trayUpdateFrom, type TrayMode } from './tray';
import { trayUpdateHandlers } from './trayUpdate';
import { MacBackend, RELEASES_API } from './updateMac';
import { WinBackend } from './updateWin';
import { Updater } from './updater';

const SCREEN_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const ACCESSIBILITY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

registerAppScheme();
app.setAppUserModelId('com.lolping.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettingsWindow());
  app.on('activate', () => openSettingsWindow()); // macOS: opened again from Finder or Launchpad while running
  void app.whenReady().then(start);
}

/** The OS account name: the default name under this machine's pings in a room. */
function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'Player';
  }
}

/**
 * The relays to use. Development builds take a comma-separated LOLPING_RELAYS instead, so "no relay reachable" can
 * be tried without touching the firewall; packaged builds always use the pinned list.
 */
function relayUrls(): readonly string[] {
  const custom = app.isPackaged ? undefined : process.env.LOLPING_RELAYS;
  const urls = custom?.split(',').map((u) => u.trim()).filter((u) => u.startsWith('wss://')) ?? [];
  return urls.length > 0 ? urls : RELAYS;
}

/** macOS: the app, Edit and Window menus, so Cmd+Q, Cmd+W and the clipboard shortcuts work in the settings window. */
function setMacMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

function start(): void {
  const library = new EmoteLibrary(join(settingsDir(), 'emotes'));
  serveAppScheme({
    rendererRoot: process.env.ELECTRON_RENDERER_URL ? null : join(__dirname, '../renderer'), // development pages come from Vite
    emoteDirs: () => [library.dir],
  });
  if (IS_MAC) {
    app.dock?.hide(); // a menu bar app: the Dock icon only shows while settings are open
    setMacMenu();
  }
  const store = new SettingsStore(settingsDir(), undefined, PLATFORM, { name: osUserName(), color: randomInt(8) });
  let settings = store.load();
  if (store.firstRun) settings = store.update({ language: 'zh-CN' });
  // An imported emote whose still is gone is dropped; normalising the shorter list repairs the wheel slots that used it.
  const kept = library.present(settings.customEmotes);
  if (kept.length !== settings.customEmotes.length) settings = store.update({ customEmotes: kept });
  // The language setting, or the system display language when it's 'auto'.
  const text = (): Strings => strings(resolveLang(settings.language, app.getLocale()), PLATFORM);
  let enabled = settings.enabledOnStart;
  let quitting = false; // read by pushStatus: once true, the tray and overlays are gone
  let screenshotting = false;
  let capturing = false; // the settings page is listening for a key, so the helper must stay suspended

  const overlays = new OverlayManager(overlaySettings(settings), (ref, remote) => resolveEmoteArt(ref, settings.customEmotes, remote));
  overlays.start();
  const bridge = new InputBridge({ command: helperExePath() });
  const syncSuspend = (): void => bridge.send({ type: 'suspend', on: capturing || screenshotting });
  const quickActions = new QuickActions({
    settings: () => settings.quickActions,
    scroll: (x, y, pixels) => bridge.scroll(x, y, pixels),
    enabled: () => enabled && !quitting,
    suspend: (on) => { screenshotting = on; overlays.cancelWheel(); syncSuspend(); },
    toast: (title, body) => overlays.toast(title, body),
  });

  // Upstream updater code remains available only when explicitly pointed at a test server.
  const testUrl = process.env.LOLPING_UPDATE_TEST_URL || undefined;
  // This enhanced build must not install upstream binaries that remove its extra features.
  const updater = testUrl ? createUpdater() : null;
  function createUpdater(): Updater {
    const backend = IS_MAC
      ? new MacBackend({
        apiBase: testUrl ?? RELEASES_API,
        currentVersion: app.getVersion(),
        fetch,
        downloadsDir: app.getPath('downloads'),
        focus: () => app.focus({ steal: true }), // the dialog is shown from a menu bar app, which is not the active one
        showDialog: (message) => dialog.showMessageBox({ message, buttons: ['OK'] }).then(() => undefined),
        openPath: (path) => shell.openPath(path),
        dialogText: () => text().updateMacDialog,
        quit: () => app.quit(),
      })
      : new WinBackend({
        testUrl,
        log: (line) => console.log('[update]', line),
        toast: () => overlays.toast(text().restartingToUpdate, ''),
        isQuitting: () => quitting,
      });
    return new Updater({
      backend,
      now: Date.now,
      autoCheck: () => settings.autoUpdateCheck,
      notifiedVersion: () => settings.updateNotifiedVersion,
      setNotifiedVersion: (version) => void store.update({ updateNotifiedVersion: version }),
      errorText: (kind, reason) => {
        console.warn('[update]', kind, reason); // the whole reason goes to the log; the card shows its first line
        return updateErrorText(text(), kind, reason);
      },
    });
  }

  // Room: pings shared with other lolPing users, on the network and through public relays.
  const testPort = process.env.LOLPING_TEST_DATA_DIR ? Number(process.env.LOLPING_TEST_LAN_PORT) : 0;
  const testPeer = Number(process.env.LOLPING_TEST_LAN_PEER_PORT);
  const localTest = Number.isInteger(testPort) && testPort > 1024 && testPort < 65536 && Number.isInteger(testPeer) && testPeer > 1024 && testPeer < 65536;
  const lan = new LanTransport(localTest ? { port: testPort, bindAddress: '127.0.0.1', broadcast: false, seeds: [{ host: '127.0.0.1', port: testPeer }] } : {});
  const relay = new RelayTransport({ urls: relayUrls() });
  const room = new RoomManager({
    transports: [lan, relay],
    now: Date.now,
    randomBytes: (n) => randomBytes(n),
    deriveKeys: deriveRoomKeys,
    appVersion: app.getVersion(),
    profile: () => ({ name: settings.displayName, color: settings.tagColor, limit: settings.incomingPingLimit }),
    resolveTarget: (d) => {
      const target = resolveTarget(overlays.numbered(), d);
      return target ? { displayId: target.id, width: target.bounds.width, height: target.bounds.height } : null;
    },
  });
  const roomState = (): RoomState => {
    const all = screen.getAllDisplays();
    return {
      ...room.state(),
      displays: overlays.numbered().map((d) => {
        const scale = all.find((x) => x.id === d.id)?.scaleFactor ?? 1; // show pixels, as the OS display settings do
        return { number: d.number, width: Math.round(d.bounds.width * scale), height: Math.round(d.bounds.height * scale), primary: d.primary };
      }),
    };
  };
  const clipboardCode = async (): Promise<string | null> => {
    // Strict: nobody typed this, so only an unmistakable code counts, never words that happen to pass the check.
    const parsed = parseRoomCode(await clipboard.readText().catch(() => ''), { strict: true });
    return parsed.ok ? formatRoomCode(parsed.code) : null;
  };
  const copyRoomCode = (): void => {
    const code = room.state().code;
    if (code) void clipboard.writeText(code).catch(() => undefined);
  };

  // macOS Accessibility. Without it the helper can't create its event tap, so it isn't started: a timer waits for
  // the permission instead. `staleAccess`: macOS lists lolPing as allowed, yet the helper still has no access.
  let accessTimer: NodeJS.Timeout | null = null;
  let staleAccess = false;
  const screenReady = (): boolean => !IS_MAC || !!process.env.LOLPING_TEST_DATA_DIR || systemPreferences.getMediaAccessStatus('screen') === 'granted';
  const trusted = (): boolean => !IS_MAC || systemPreferences.isTrustedAccessibilityClient(false);
  const stopWaitingForAccess = (): void => {
    if (accessTimer) clearInterval(accessTimer);
    accessTimer = null;
  };
  const waitForAccess = (): void => {
    if (accessTimer) return;
    accessTimer = setInterval(() => {
      if (!trusted()) return;
      stopWaitingForAccess();
      staleAccess = false;
      bridge.retry();
    }, 1500);
    overlays.cancelWheel();
    pushStatus();
  };
  const startHelper = (): void => {
    staleAccess = false;
    if (trusted()) bridge.retry();
    else waitForAccess();
  };

  const helperStatus = (): HelperStatus => (accessTimer ? 'noAccess' : bridge.status);
  const status = (): AppStatus => ({ enabled, helper: helperStatus(), staleAccess, screenAccess: screenReady() });
  const trayMode = (): TrayMode => {
    const h = helperStatus();
    if (h === 'failed' || h === 'noAccess') return h;
    return enabled ? 'on' : 'off';
  };
  const tray = new AppTray(
    assetPath('textures', 'generic_ping.png'),
    {
      openSettings: () => openSettingsWindow(),
      setEnabled: (on) => setEnabled(on),
      retryHelper: startHelper,
      quit: () => app.quit(),
      room: {
        joinClipboard: () => {
          void clipboardCode().then((code) => {
            if (code) void room.join(code);
            else overlays.toast(text().toastNoCode, text().toastNoCodeBody);
          });
        },
        create: () => void room.create(),
        copyCode: copyRoomCode,
        setMuted: (on) => store.update({ roomMuted: on }),
        leave: () => room.leave(),
        openSettings: () => openSettingsWindow('room'),
      },
      // The tray has no card to show a result on, so the handlers toast it. Nothing to toast on once the overlays are gone.
      update: updater
        ? trayUpdateHandlers({ updater, toast: (title, body) => { if (!quitting) overlays.toast(title, body); }, text })
        : { check: () => undefined, start: () => undefined },
    },
    text(),
    IS_MAC ? { on: buildResourcePath('trayTemplate.png'), off: buildResourcePath('trayOffTemplate.png') } : undefined,
  );
  /** Sends to the settings window if there is one that is still alive (the updater also reports while the app quits). */
  function sendToSettings(channel: string, payload: unknown): void {
    const w = settingsWindow();
    if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
  if (updater) {
    updater.on('state', (s: UpdateState) => {
      if (quitting) return; // the tray and windows are going away
      tray.setUpdate(trayUpdateFrom(s));
      sendToSettings(SETTINGS_CH.updateState, s);
    });
    updater.on('notify', (version: string) => {
      if (!quitting) overlays.toast(text().updateToastTitle, text().updateToastBody(version));
    });
    tray.setUpdate(trayUpdateFrom(updater.state));
  }
  function pushRoom(): void {
    if (quitting) return;
    const s = roomState();
    tray.setRoom({ code: s.code, count: s.members.length, muted: settings.roomMuted });
    settingsWindow()?.webContents.send(SETTINGS_CH.roomChanged, s);
  }
  const syncRoomFlags = (): void => room.setStatusFlags({ paused: !enabled, roomMuted: settings.roomMuted });
  room.on('state', pushRoom);
  overlays.on('displays', pushRoom);
  room.on('remotePing', (p) => overlays.spawnRemote(p));
  overlays.on('shared', (p: SharedPing) => {
    quickActions.localPing(p);
    const shared = toShared(overlays.numbered(), p.displayId, p.x, p.y);
    if (shared && scopeAllows(settings.roomSyncButton, markerButton(p.button))) room.sendPing(p.id, shared);
  });
  room.on('remoteEmote', (p) => overlays.spawnRemoteEmote(p));
  overlays.on('sharedEmote', (p: SharedEmote) => {
    quickActions.breakSequence();
    const shared = toShared(overlays.numbered(), p.displayId, p.x, p.y);
    if (shared && scopeAllows(settings.roomSyncButton, markerButton(p.button))) room.sendEmote(p.ref, shared);
  });
  room.on('saveCode', (code: string | null) => store.update({ lastRoomCode: code }));
  room.on('toast', (n: RoomToast) => {
    const t = text();
    const code = room.state().code ?? '';
    if (n.kind === 'joinedRoom') overlays.toast(t.toastRoomJoined(n.code), t.toastRoomJoinedBody);
    else if (n.kind === 'full') overlays.toast(t.toastRoomFull, t.toastRoomFullBody);
    else if (n.kind === 'joined') overlays.toast(t.toastMemberJoined(n.name), code);
    else if (n.kind === 'left') overlays.toast(t.toastMemberLeft(n.name), code);
    else overlays.toast(t.toastMemberLost(n.name), code);
  });
  powerMonitor.on('resume', () => {
    lan.rebind();
    relay.wake();
  });

  function pushStatus(): void {
    if (quitting) return;
    tray.set(trayMode(), enabled);
    settingsWindow()?.webContents.send(SETTINGS_CH.statusChanged, status());
  }
  const about = (): About => ({
    version: app.getVersion(),
    problems: [
      ...store.problems,
      ...(store.emoteKeyClashed ? [text().problemEmoteKeyClash] : []),
      ...[...overlays.missingAssets].map((a) => text().missingAsset(a)),
    ],
    limitations: text().limitations,
  });

  function setEnabled(on: boolean): void {
    if (on === enabled) return;
    enabled = on;
    quickActions.breakSequence();
    bridge.send(configCommand(store.get(), enabled)); // also refreshes the config re-sent after restarts
    const t = text();
    overlays.toast(on ? t.toastOn : t.toastOff, t.toastToggleHint(hotkeyLabel(store.get().toggleHotkey, PLATFORM)));
    syncRoomFlags();
    pushStatus();
  }

  bridge.on('event', (ev) => {
    if (ev.type === 'toggled') setEnabled(ev.enabled);
    else if (ev.type === 'ready') {
      // A restarted helper starts unsuspended: re-apply an active key capture.
      if (capturing || screenshotting) syncSuspend();
    } else if (ev.type === 'error') console.warn('[helper]', ev.code ?? '', ev.message);
    else overlays.handle(ev);
  });
  bridge.on('status', (s: HelperStatus) => {
    // A helper that is starting or has stopped can no longer send the cancel that dismisses a wheel left on screen.
    if (s !== 'running') overlays.cancelWheel();
    if (s === 'noAccess') {
      // Allowed but still refused is an entry left over from an earlier build. Otherwise wait for the user to allow it.
      if (trusted()) staleAccess = true;
      else waitForAccess();
      openSettingsWindow();
    }
    pushStatus();
    if (s === 'failed') overlays.toast(text().toastHelperStopped, text().toastHelperStoppedBody);
  });
  bridge.on('log', (line: string) => console.log('[helper]', line));

  store.on('change', (s: Settings) => {
    const previous = settings;
    settings = s;
    quickActions.changed(previous.quickActions);
    bridge.send(configCommand(s, enabled));
    overlays.updateSettings(overlaySettings(s));
    settingsWindow()?.webContents.send(SETTINGS_CH.changed, s);
    if (s.language !== previous.language) tray.setText(text());
    if (s.displayName !== previous.displayName || s.tagColor !== previous.tagColor) room.profileChanged();
    if (s.autoUpdateCheck !== previous.autoUpdateCheck) updater?.setAutoCheck(s.autoUpdateCheck);
    if (s.roomMuted !== previous.roomMuted) {
      syncRoomFlags();
      pushRoom();
    }
    if (s.allowInternet !== previous.allowInternet) {
      room.setInternetAllowed(s.allowInternet);
      pushRoom();
    }
    if (app.isPackaged && s.launchAtStartup !== previous.launchAtStartup) {
      // macOS ignores args, and a Mac launch starts in the menu bar anyway.
      app.setLoginItemSettings(IS_MAC ? { openAtLogin: s.launchAtStartup } : { openAtLogin: s.launchAtStartup, args: ['--hidden'] });
    }
  });

  const openScreenAccess = async (): Promise<void> => {
    if (!IS_MAC || process.env.LOLPING_TEST_DATA_DIR) return;
    const win = openSettingsWindow();
    win.show(); win.focus(); app.focus({ steal: true });
    if (systemPreferences.getMediaAccessStatus('screen') === 'not-determined') {
      // Ask at startup/on the permission card, before hiding any windows for a screenshot.
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined);
    }
    if (!screenReady()) await shell.openExternal(SCREEN_PANE);
    pushStatus();
  };
  const refreshPermissions = (): void => { if (!quitting) pushStatus(); };
  app.on('browser-window-focus', refreshPermissions);
  registerSettingsIpc({
    store,
    quickActions,
    library,
    getStatus: status,
    setEnabled,
    preview: (id) => overlays.previewPing(id),
    previewEmote: (ref) => overlays.previewEmote(ref),
    about,
    retryHelper: startHelper,
    setCapturing: (on) => {
      capturing = on;
      syncSuspend();
    },
    openScreenAccess,
    openAccessibility: () => {
      systemPreferences.isTrustedAccessibilityClient(true); // adds lolPing to the list and shows the system prompt
      void shell.openExternal(ACCESSIBILITY_PANE);
      if (!trusted()) waitForAccess();
    },
    text,
    platform: PLATFORM,
    update: updater
      ? { state: () => updater.state, notesUrl: () => updater.notesUrl, check: () => updater.check(true), start: () => updater.startUpdate() }
      : undefined,
    room: {
      state: roomState,
      create: () => room.create(),
      join: (t) => room.join(t),
      leave: () => room.leave(),
      mute: (peer, on) => room.muteMember(peer, on),
      clipboardCode,
      copyCode: copyRoomCode,
      retryInternet: () => relay.retryNow(),
    },
  });
  // The page can't report that it went away mid-capture (window closed, renderer crashed): release the suspend here.
  onSettingsWindowGone(() => {
    if (!capturing) return;
    capturing = false;
    syncSuspend();
  });

  bridge.send(configCommand(settings, enabled));
  if (trusted()) bridge.start();
  else waitForAccess();
  pushStatus();
  syncRoomFlags();
  room.setInternetAllowed(settings.allowInternet);
  pushRoom();
  if (settings.rejoinRoom && settings.lastRoomCode) void room.join(settings.lastRoomCode);
  if (IS_MAC) {
    // A menu bar app: open settings only when there is something to do, otherwise point at the menu bar icon.
    if (store.firstRun || !trusted() || !screenReady()) {
      const win = openSettingsWindow();
      if (!process.env.LOLPING_TEST_DATA_DIR && (!trusted() || !screenReady())) {
        const prompt = async () => {
          if (quitting || win.isDestroyed()) return;
          win.show(); win.focus(); app.focus({ steal: true });
          const { response } = await dialog.showMessageBox(win, {
            type: 'info', title: 'lolPing 需要系统权限', message: '启用截图和鼠标标记',
            detail: '屏幕录制：用于截图、滚动截图和文字识别。\n辅助功能：用于鼠标标记和自动滚动。\n请在系统设置中允许 lolPing；屏幕录制授权后，按系统提示重新打开应用。',
            buttons: ['授权屏幕录制', '打开辅助功能设置', '稍后'], defaultId: screenReady() ? 1 : 0, cancelId: 2,
          });
          if (response === 0) await openScreenAccess();
          else if (response === 1) {
            app.focus({ steal: true }); systemPreferences.isTrustedAccessibilityClient(true);
            await shell.openExternal(ACCESSIBILITY_PANE);
          }
        };
        if (win.isVisible()) void prompt(); else win.once('ready-to-show', () => void prompt());
      }
    }
    else overlays.toast(text().toastMenuBar, text().toastMenuBarBody);
  } else if (!process.argv.includes('--hidden')) {
    openSettingsWindow();
  }

  updater?.start();

  app.on('window-all-closed', () => {
    /* stay running: the overlays are the app */
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    quickActions.dispose();
    updater?.stop(); // aborts a download and drops a check in flight; an install that is quitting the app is left alone
    room.quit(); // says bye, so the others see "left" instead of waiting for a timeout
    stopWaitingForAccess();
    app.off('browser-window-focus', refreshPermissions);
    tray.destroy();
    overlays.destroy();
    void Promise.allSettled([bridge.stop(), store.flush(), lan.whenClosed(), relay.whenClosed()]).then(() => app.exit(0));
  });
}
