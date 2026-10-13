import { describe, expect, it } from 'vitest';
import { appendScrollFrame, scrollOffset, type BitmapFrame } from '../../src/shared/scrollStitch';
import { scopeAllows } from '../../src/shared/mouseButtons';
import { DEFAULT_QUICK_ACTIONS, normalizeQuickActions, QuickRuleEngine, type QuickRule } from '../../src/shared/quickActions';
import { normalizeSettings } from '../../src/shared/settings';
function content(width: number, height: number): BitmapFrame {
  const pixels = new Uint8Array(width * height * 4);
  let seed = 17;
  for (let i = 0; i < pixels.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  return { width, height, pixels };
}
function part(all: BitmapFrame, y: number, height: number): BitmapFrame { return { width: all.width, height, pixels: all.pixels.slice(y * all.width * 4, (y + height) * all.width * 4) }; }
describe('scroll screenshot stitching', () => {
  it('finds overlap and appends each row exactly once across several screens', () => {
    const all = content(150, 600), a = part(all, 0, 300), b = part(all, 120, 300), c = part(all, 250, 300);
    expect(scrollOffset(a, b)).toBe(120);
    const ab = appendScrollFrame(a, a, b);
    expect(ab.height).toBe(420); expect(ab.pixels).toEqual(part(all, 0, 420).pixels);
    const abc = appendScrollFrame(ab, b, c);
    expect(abc.height).toBe(550); expect(abc.pixels).toEqual(part(all, 0, 550).pixels);
  });
  it('ignores an unchanged screen and refuses unrelated images or changed size', () => {
    const a = content(100, 200);
    expect(appendScrollFrame(a, a, a)).toBe(a);
    const b = { ...a, pixels: new Uint8Array(a.pixels.length).fill(255) };
    expect(() => scrollOffset(a, b)).toThrow('重叠');
    expect(() => scrollOffset(a, content(90, 200))).toThrow('尺寸');
  });
});
describe('mouse scope and settings upgrade', () => {
  it('defaults to fast capture, only 3 recent records, and all room markers shared', () => {
    const old = { ...DEFAULT_QUICK_ACTIONS } as Record<string, unknown>;
    delete old.screenshotMode; delete old.historyLimit;
    const s = normalizeSettings({ quickActions: old });
    expect(s.quickActions.screenshotMode).toBe('fast'); expect(s.quickActions.historyLimit).toBe(3);
    expect(s.roomSyncButton).toBe('both'); expect(scopeAllows(s.roomSyncButton, 'right')).toBe(true);
    expect(normalizeQuickActions(old).rules).toEqual(DEFAULT_QUICK_ACTIONS.rules);
  });
  it('each room synchronization choice leaves the other button local', () => {
    expect(scopeAllows('left', 'left')).toBe(true); expect(scopeAllows('left', 'right')).toBe(false);
    expect(scopeAllows('right', 'left')).toBe(false); expect(scopeAllows('right', 'right')).toBe(true);
    expect(scopeAllows('none', 'left')).toBe(false); expect(scopeAllows('none', 'right')).toBe(false);
  });
  it('counts buttons separately, filters rules by button, and shares the rule cooldown', () => {
    const rule: QuickRule = { id: 'test', name: 'test', ping: 'assist', button: 'both', count: 2, intervalMs: 2500, cooldownMs: 5000, enabled: true, action: { type: 'clipboard', target: 'test' } };
    const config = { ...DEFAULT_QUICK_ACTIONS, rules: [rule] }, engine = new QuickRuleEngine();
    expect(engine.accept('assist', config, 0, 'left')).toHaveLength(0);
    expect(engine.accept('assist', config, 100, 'right')).toHaveLength(0);
    expect(engine.accept('assist', config, 200, 'left')).toHaveLength(1);
    expect(engine.accept('assist', config, 300, 'right')).toHaveLength(0);
    engine.reset(); rule.button = 'right';
    engine.accept('assist', config, 0, 'left'); engine.accept('assist', config, 100, 'left');
    expect(engine.accept('assist', config, 200, 'right')).toHaveLength(0);
    expect(engine.accept('assist', config, 300, 'right')).toHaveLength(1);
  });
});
