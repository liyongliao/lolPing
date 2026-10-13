import { hotkeyToAccelerator, type Hotkey } from './keys';
import type { Platform } from './platform';
import { isPingId, type PingId } from './pings';

export type QuickAction =
  | { type: 'app'; target: string }
  | { type: 'url'; target: string }
  | { type: 'clipboard'; target: string }
  | { type: 'screenshot'; region: boolean };
export interface QuickRule {
  id: string;
  name: string;
  ping: PingId;
  count: number;
  intervalMs: number;
  cooldownMs: number;
  enabled: boolean;
  action: QuickAction;
}
export interface QuickActionsSettings {
  enabled: boolean;
  screenshotShortcut: string;
  saveScreenshots: boolean;
  rules: QuickRule[];
}
export interface QuickActivity { id: string; time: number; name: string; detail: string; ok: boolean }
export interface QuickState { history: QuickActivity[]; screenshotShortcutActive: boolean; capturing: boolean }
export const DEFAULT_QUICK_ACTIONS: QuickActionsSettings = {
  enabled: true,
  screenshotShortcut: 'CommandOrControl+Shift+2',
  saveScreenshots: false,
  rules: [
    { id: 'assist-app', name: '协助三次，打开应用', ping: 'assist', count: 3, intervalMs: 2500, cooldownMs: 5000, enabled: false, action: { type: 'app', target: '' } },
    { id: 'missing-app', name: '问号两次，打开应用', ping: 'missing', count: 2, intervalMs: 2500, cooldownMs: 5000, enabled: false, action: { type: 'app', target: '' } },
    { id: 'vision-capture', name: '需要视野两次，截图', ping: 'needvision', count: 2, intervalMs: 2500, cooldownMs: 3000, enabled: false, action: { type: 'screenshot', region: true } },
  ],
};
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, low: number, high: number): v is number => Number.isInteger(v) && (v as number) >= low && (v as number) <= high;
export function validScreenshotShortcut(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 80 && (v === '' || /^(?=.*(?:CommandOrControl|CmdOrCtrl|Command|Control|Ctrl|Alt|Super)\+)(?:CommandOrControl|CmdOrCtrl|Command|Control|Ctrl|Alt|Super|Shift)(?:\+(?:CommandOrControl|CmdOrCtrl|Command|Control|Ctrl|Alt|Super|Shift))*\+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/i.test(v));
}
export function actionError(a: unknown, enabled = true): string | null {
  if (!obj(a)) return '动作格式无效';
  if (a.type === 'screenshot') return typeof a.region === 'boolean' ? null : '请选择截图方式';
  if (!['app', 'url', 'clipboard'].includes(String(a.type)) || typeof a.target !== 'string' || a.target.length > 10000) return '动作内容无效或过长';
  if (!enabled && !a.target) return null;
  if (a.type === 'app') return a.target.length <= 2048 && (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(a.target)) ? null : '请选择本机应用的完整路径';
  if (a.type === 'clipboard') return a.target.length > 0 ? null : '请输入要复制的文本';
  try { return ['http:', 'https:'].includes(new URL(a.target).protocol) ? null : '网址仅支持 http / https'; }
  catch { return '请输入完整的网址，例如 https://www.bing.com'; }
}
export function quickSettingsError(raw: unknown): string | null {
  if (!obj(raw) || typeof raw.enabled !== 'boolean' || typeof raw.saveScreenshots !== 'boolean' || !Array.isArray(raw.rules)) return '快捷动作配置无效';
  if (!validScreenshotShortcut(raw.screenshotShortcut)) return '快捷键需包含 Ctrl、Alt 或 Command；例如 CommandOrControl+Shift+2';
  if (raw.rules.length > 50) return '最多保存 50 条规则';
  const ids = new Set<string>();
  for (const rule of raw.rules) {
    if (!obj(rule) || typeof rule.id !== 'string' || !rule.id || rule.id.length > 100 || ids.has(rule.id)) return '规则标识无效或重复';
    ids.add(rule.id);
    if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 60 || !isPingId(rule.ping) || typeof rule.enabled !== 'boolean') return '请输入有效的规则名称和信号';
    if (!integer(rule.count, 1, 10) || !integer(rule.intervalMs, 500, 10000) || !integer(rule.cooldownMs, 1000, 60000)) return '次数需为 1–10；间隔为 0.5–10 秒；冷却为 1–60 秒';
    const error = actionError(rule.action, rule.enabled);
    if (error) return `${rule.name}：${error}`;
  }
  return null;
}
/** Existing upstream settings have no quickActions field. Default rules never run until explicitly enabled. */
export function normalizeQuickActions(raw: unknown): QuickActionsSettings {
  if (quickSettingsError(raw)) return structuredClone(DEFAULT_QUICK_ACTIONS);
  const value = raw as QuickActionsSettings;
  return {
    enabled: value.enabled, screenshotShortcut: value.screenshotShortcut, saveScreenshots: value.saveScreenshots,
    rules: value.rules.map(r => ({ id: r.id, name: r.name.trim(), ping: r.ping, count: r.count, intervalMs: r.intervalMs, cooldownMs: r.cooldownMs, enabled: r.enabled, action: r.action.type === 'screenshot' ? { type: 'screenshot', region: r.action.region } : { type: r.action.type, target: r.action.target } })),
  };
}
/** Only the caller's local, committed pings enter this engine. Preview and room events have no route here. */
export class QuickRuleEngine {
  private states = new Map<string, { count: number; last: number; fired: number }>();
  reset(): void { this.states.clear(); }
  breakSequence(): void { for (const s of this.states.values()) s.count = 0; }
  accept(ping: PingId, config: QuickActionsSettings, now = Date.now()): QuickRule[] {
    if (!config.enabled) { this.reset(); return []; }
    const matches: QuickRule[] = [];
    for (const rule of config.rules) {
      if (!rule.enabled) { this.states.delete(rule.id); continue; }
      const s = this.states.get(rule.id) ?? { count: 0, last: -Infinity, fired: -Infinity };
      if (rule.ping !== ping || now - s.fired < rule.cooldownMs) { this.states.set(rule.id, { ...s, count: 0 }); continue; }
      const count = now - s.last <= rule.intervalMs ? s.count + 1 : 1;
      if (count >= rule.count) { matches.push(rule); this.states.set(rule.id, { count: 0, last: now, fired: now }); }
      else this.states.set(rule.id, { ...s, count, last: now });
    }
    return matches;
  }
}

/** Resolve accelerator aliases so the native pause key cannot also start a screenshot. */
export function screenshotClashesWithToggle(shortcut: string, toggle: Hotkey, platform: Platform): boolean {
  const canonical = (value: string) => value.toLowerCase().split('+').map(part => {
    if (part === 'commandorcontrol' || part === 'cmdorctrl') return platform === 'mac' ? 'super' : 'control';
    if (part === 'command') return 'super';
    if (part === 'ctrl') return 'control';
    return part;
  }).sort().join('+');
  const pause = hotkeyToAccelerator(toggle);
  return !!shortcut && !!pause && canonical(shortcut) === canonical(pause);
}
