import { describe, expect, it } from 'vitest';
import { screenshotClashesWithToggle, DEFAULT_QUICK_ACTIONS, QuickRuleEngine, normalizeQuickActions, quickSettingsError, actionError, type QuickRule, type QuickActionsSettings } from '../../src/shared/quickActions';
import { boundedCrop } from '../../src/shared/capture';
import { normalizeSettings } from '../../src/shared/settings';
const rule = (patch: Partial<QuickRule> = {}): QuickRule => ({ id: 'test', name: 'Test', ping: 'assist', count: 3, intervalMs: 2500, cooldownMs: 5000, enabled: true, action: { type: 'clipboard', target: 'hello' }, ...patch });
const config = (...rules: QuickRule[]): QuickActionsSettings => ({ ...DEFAULT_QUICK_ACTIONS, rules });
describe('local signal shortcut engine', () => {
  it('executes only at the configured consecutive threshold', () => {
    const e = new QuickRuleEngine(), c = config(rule());
    expect(e.accept('assist', c, 0)).toEqual([]);
    expect(e.accept('assist', c, 100)).toEqual([]);
    expect(e.accept('assist', c, 200)).toEqual(c.rules);
  });
  it('another ping interrupts a sequence', () => {
    const e = new QuickRuleEngine(), c = config(rule());
    e.accept('assist', c, 0); e.accept('assist', c, 100); e.accept('missing', c, 200);
    expect(e.accept('assist', c, 300)).toEqual([]);
    expect(e.accept('assist', c, 400)).toEqual([]);
    expect(e.accept('assist', c, 500)).toEqual(c.rules);
  });
  it('an emote or pause resets counts without erasing cooldown', () => {
    const e = new QuickRuleEngine(), c = config(rule({ count: 2 }));
    e.accept('assist', c, 0); e.breakSequence();
    expect(e.accept('assist', c, 100)).toEqual([]);
    expect(e.accept('assist', c, 200)).toHaveLength(1);
    e.breakSequence();
    expect(e.accept('assist', c, 300)).toEqual([]);
    expect(e.accept('assist', c, 400)).toEqual([]);
  });
  it('a long gap resets the count; time is between neighboring pings', () => {
    const e = new QuickRuleEngine(), c = config(rule());
    e.accept('assist', c, 0); e.accept('assist', c, 2600);
    expect(e.accept('assist', c, 5000)).toEqual([]);
    expect(e.accept('assist', c, 7400)).toHaveLength(1);
  });
  it('pings during cooldown do not accumulate', () => {
    const e = new QuickRuleEngine(), c = config(rule({ count: 2 }));
    e.accept('assist', c, 0); expect(e.accept('assist', c, 100)).toHaveLength(1);
    for (const t of [200, 500, 2000, 4900, 5000]) expect(e.accept('assist', c, t)).toEqual([]);
    expect(e.accept('assist', c, 5100)).toEqual([]);
    expect(e.accept('assist', c, 5200)).toHaveLength(1);
  });
  it('counts rules independently', () => {
    const e = new QuickRuleEngine(), c = config(rule({ id: 'one', count: 1 }), rule({ id: 'two', count: 2 }));
    expect(e.accept('assist', c, 0).map(r => r.id)).toEqual(['one']);
    expect(e.accept('assist', c, 100).map(r => r.id)).toEqual(['two']);
  });
  it('disabled configuration and rules cannot run', () => {
    const e = new QuickRuleEngine();
    expect(e.accept('assist', config(rule({ enabled: false, count: 1 })))).toEqual([]);
    expect(e.accept('assist', { ...config(rule({ count: 1 })), enabled: false })).toEqual([]);
  });
  it('settings changes reset pending counters', () => {
    const e = new QuickRuleEngine(), c = config(rule({ count: 2 }));
    e.accept('assist', c, 0); e.reset(); expect(e.accept('assist', c, 100)).toEqual([]);
  });
});
describe('shortcut settings validation', () => {
  it('upgrades upstream settings without changing original wheel, trigger or volume', () => {
    const s = normalizeSettings({ trigger: 'alt', volume: 23 });
    expect(s.trigger).toBe('alt'); expect(s.volume).toBe(23);
    expect(s.quickActions).toEqual(DEFAULT_QUICK_ACTIONS);
    expect(s.quickActions.rules.every(r => !r.enabled)).toBe(true);
  });
  it('clones defaults so editing a template cannot corrupt other settings', () => {
    const a = normalizeQuickActions(undefined); a.rules[0].name = 'changed';
    expect(normalizeQuickActions(undefined).rules[0].name).not.toBe('changed');
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/plain,a'])('rejects unsafe URL %s', target => expect(actionError({ type: 'url', target })).not.toBeNull());
  it('accepts Windows and Mac application paths including spaces', () => {
    expect(actionError({ type: 'app', target: 'C:\\Program Files\\WeChat\\WeChat.exe' })).toBeNull();
    expect(actionError({ type: 'app', target: '/Applications/Visual Studio Code.app' })).toBeNull();
    expect(actionError({ type: 'app', target: 'open -a Calculator' })).not.toBeNull();
  });
  it('requires target only when an app template is enabled', () => {
    expect(quickSettingsError(DEFAULT_QUICK_ACTIONS)).toBeNull();
    expect(quickSettingsError(config(rule({ action: { type: 'app', target: '' } })))).not.toBeNull();
  });
  it('rejects duplicate IDs, oversized lists, noninteger counts and plain letter shortcuts', () => {
    expect(quickSettingsError(config(rule(), rule()))).not.toBeNull();
    expect(quickSettingsError(config(...Array.from({ length: 51 }, (_, n) => rule({ id: String(n) }))))).not.toBeNull();
    expect(quickSettingsError(config(rule({ count: 1.5 })))).not.toBeNull();
    expect(quickSettingsError({ ...DEFAULT_QUICK_ACTIONS, screenshotShortcut: 'A' })).not.toBeNull();
  });
  it('bounds HiDPI screenshot crops and rejects negative/nonfinite sizes', () => {
    expect(boundedCrop({ x: 1910, y: 1070, width: 300, height: 300 }, 1920, 1080)).toEqual({ x: 1910, y: 1070, width: 10, height: 10 });
    expect(() => boundedCrop({ x: NaN, y: 0, width: 20, height: 20 }, 1920, 1080)).toThrow();
    expect(() => boundedCrop({ x: 0, y: 0, width: -20, height: 20 }, 1920, 1080)).toThrow();
  });
});

it('detects native pause conflicts across modifier aliases and order on both platforms', () => {
  expect(screenshotClashesWithToggle('Shift+CommandOrControl+2', { mods: 12, vk: 50 }, 'mac')).toBe(true);
  expect(screenshotClashesWithToggle('Shift+CmdOrCtrl+2', { mods: 5, vk: 50 }, 'win')).toBe(true);
  expect(screenshotClashesWithToggle('Ctrl+Alt+P', { mods: 3, vk: 80 }, 'mac')).toBe(true);
  expect(screenshotClashesWithToggle('CommandOrControl+Shift+2', { mods: 3, vk: 80 }, 'mac')).toBe(false);
});
