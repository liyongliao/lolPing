import { describe, expect, it } from 'vitest';
import { scopeAllows } from '../../src/shared/mouseButtons';
import { DEFAULT_QUICK_ACTIONS, normalizeQuickActions, QuickRuleEngine, type QuickRule } from '../../src/shared/quickActions';
import { normalizeSettings } from '../../src/shared/settings';
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
