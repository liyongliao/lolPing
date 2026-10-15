import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Switch, Textarea } from '@fluentui/react-components';
import { Add24Regular, Camera24Regular, Delete20Regular, Edit20Regular, FolderOpen24Regular, Keyboard24Regular, Play20Regular, Settings24Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { ButtonScope } from '../../../shared/mouseButtons';
import { ALL_PINGS, textureUrl } from '../../../shared/pings';
import { quickSettingsError, type QuickActionsSettings, type QuickAction, type QuickRule, type QuickState } from '../../../shared/quickActions';
import type { Settings } from '../../../shared/settings';
import { api } from '../api';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { SettingRow, SwitchRow } from './rows';
import './quickActions.css';

const names: Record<QuickAction['type'], string> = { app: '打开应用', url: '打开网址', screenshot: '截图到剪贴板', clipboard: '复制文本' };
function actionDetail(rule: QuickRule): string {
  const a = rule.action;
  if (a.type === 'screenshot') return a.region ? '框选区域 → 剪贴板' : '鼠标所在屏幕 → 剪贴板';
  if (a.type === 'app') return a.target ? a.target.split(/[/\\]/).pop()! : '尚未选择应用';
  return a.target || '尚未设置';
}
const buttonNames = { left: '左键', right: '右键', both: '左右键' };
const emptyRule = (): QuickRule => ({ id: crypto.randomUUID(), name: '新的快捷规则', ping: 'assist', count: 3, intervalMs: 2500, cooldownMs: 5000, enabled: true, button: 'both', action: { type: 'app', target: '' } });

export function QuickActionsSection({ settings, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const config = settings.quickActions;
  const [state, setState] = useState<QuickState>({ history: [], screenshotShortcutActive: false, capturing: false });
  const [draft, setDraft] = useState<QuickRule | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shortcut, setShortcut] = useState(config.screenshotShortcut);
  const [removed, setRemoved] = useState<QuickRule | null>(null);
  useEffect(() => {
    void api.getQuickState().then(setState).catch(e => setError(String(e)));
    return api.onQuickState(setState);
  }, []);
  useEffect(() => setShortcut(config.screenshotShortcut), [config.screenshotShortcut]);
  async function save(next: QuickActionsSettings): Promise<boolean> {
    setBusy(true); setError('');
    try {
      const error = quickSettingsError(next);
      if (error) throw new Error(error);
      const result = await update({ quickActions: next });
      if (!result.ok) throw new Error(result.error);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function run(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }
  function changeAction(type: QuickAction['type']) {
    if (!draft) return;
    const action: QuickAction = type === 'screenshot' ? { type, region: true } : { type, target: type === 'url' ? 'https://' : '' };
    setDraft({ ...draft, action });
  }
  return <div className="qa-section">
    <SwitchRow icon={<Settings24Regular />} title="启用信号快捷动作" description="原来的信号和音效照常显示，达到你设置的次数时，额外执行一个动作。" checked={config.enabled} onChange={on => void save({ ...config, enabled: on })} />
    <div className="qa-note">仅响应你自己用轮盘或触发键点击发出的信号。预览、表情和房间成员的信号不会执行动作。默认模板均为关闭状态。</div>
    <div className="qa-heading"><b>我的信号规则</b><Button icon={<Add24Regular />} disabled={busy || config.rules.length >= 50} onClick={() => { setError(''); setDraft(emptyRule()); }}>添加规则</Button></div>
    {config.rules.map(rule => <div className="card qa-rule" key={rule.id}>
      <img className="qa-ping-icon" src={textureUrl(ALL_PINGS.find(p => p.id === rule.ping)!.icon)} alt="" />
      <div className="lbl"><b>{rule.name}</b><span className="desc">{buttonNames[rule.button ?? 'both']} · {t.pingNames[rule.ping]} × {rule.count} → {names[rule.action.type]}</span><span className="desc qa-target" title={actionDetail(rule)}>{actionDetail(rule)}</span></div>
      <Switch aria-label={`启用${rule.name}`} disabled={busy} checked={rule.enabled} onChange={(_, d) => {
        if (d.checked && rule.action.type === 'app' && !rule.action.target) { setError(''); setDraft({ ...rule, enabled: true }); }
        else void save({ ...config, rules: config.rules.map(r => r.id === rule.id ? { ...r, enabled: d.checked } : r) });
      }} />
      <Button icon={<Edit20Regular />} appearance="subtle" aria-label={`编辑${rule.name}`} onClick={() => { setError(''); setDraft(structuredClone(rule)); }} />
      <Button icon={<Delete20Regular />} appearance="subtle" disabled={busy} aria-label={`删除${rule.name}`} onClick={async () => { if (await save({ ...config, rules: config.rules.filter(r => r.id !== rule.id) })) setRemoved(rule); }} />
    </div>)}
    {!config.rules.length && <div className="card qa-empty">还没有规则。添加一个，让熟悉的信号帮你做点事。</div>}
    {removed && <div className="qa-note qa-undo">已删除「{removed.name}」<Button appearance="subtle" size="small" onClick={async () => { if (await save({ ...config, rules: [...config.rules, removed] })) setRemoved(null); }}>撤销</Button></div>}
    <div className="qa-heading"><b>截图工具</b><span className="desc">松开鼠标即复制，Esc / 右键取消</span></div>
    <SettingRow icon={<Camera24Regular />} title="截图模式" description="快速模式默认开启：框选即复制，不加载标注和 OCR。高级模式按需加载工具。">
      <Select aria-label="截图模式" value={config.screenshotMode} onChange={(_, d) => void save({ ...config, screenshotMode: d.value as 'fast' | 'advanced' })}><option value="fast">快速截图（默认）</option><option value="advanced">高级截图：标注 / OCR</option></Select>
    </SettingRow>
    <SettingRow icon={<Camera24Regular />} title="截图并复制到剪贴板" description="截图时自动隐藏 lolPing 的轮盘、信号和设置窗口。">
      <Button disabled={state.capturing} onClick={() => void run(() => api.captureScreenshot(true))}>区域截图</Button>
      <Button disabled={state.capturing} onClick={() => void run(() => api.captureScreenshot(false))}>全屏截图</Button>
      <Button disabled={state.capturing} onClick={() => void run(() => api.captureScreenshot(true, 'advanced'))}>高级截图</Button>
    </SettingRow>
    <SettingRow icon={<Keyboard24Regular />} title="区域截图快捷键" description="包含 Ctrl / Alt / Command，例如 CommandOrControl+Shift+2；留空禁用。">
      <Input className="qa-shortcut" aria-label="区域截图快捷键" value={shortcut} onChange={(_, d) => setShortcut(d.value)} />
      <Button disabled={busy || shortcut === config.screenshotShortcut} onClick={() => void save({ ...config, screenshotShortcut: shortcut })}>保存</Button>
    </SettingRow>
    {config.screenshotShortcut && !state.screenshotShortcutActive && <div className="qa-warning">截图快捷键未注册成功，请更换一个未被占用的组合。</div>}
    <SwitchRow icon={<FolderOpen24Regular />} title="截图同时保存为 PNG" description="除复制到剪贴板外，也保存到系统图片文件夹内的 lolPing 目录。" checked={config.saveScreenshots} onChange={on => void save({ ...config, saveScreenshots: on })} />
    <div className="qa-note qa-undo"><span>Mac 首次截图需要允许「屏幕与系统音频录制」，之后重启 lolPing。</span><Button size="small" onClick={() => void run(() => api.openScreenshotFolder())}>打开截图文件夹</Button></div>
    <details className="qa-records"><summary>最近执行记录（最多 {config.historyLimit} 条）</summary>
    <div className="qa-heading"><b>最近执行记录</b>{state.history.length > 0 && <Button size="small" onClick={() => void run(() => api.clearQuickHistory())}>清空</Button>}</div>
    {!state.history.length ? <div className="qa-note">还没有执行记录。启用规则后，在桌面连续发送对应信号即可。</div> : <div className="qa-history">{state.history.map(item => <div className="card" key={item.id}><span className={item.ok ? 'qa-ok' : 'qa-bad'}>{item.ok ? '✓' : '!'}</span><div className="lbl">{item.name}<span className="desc">{item.detail}</span></div><time className="desc">{new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false })}</time></div>)}</div>}
    <div className="qa-note qa-undo"><span>只保留最近几次，默认收起。</span><Select aria-label="最近记录数量" value={String(config.historyLimit)} onChange={(_, d) => void save({ ...config, historyLimit: Number(d.value) })}><option value="3">最近 3 次</option><option value="5">最近 5 次</option><option value="10">最近 10 次</option></Select></div></details>
    {error && !draft && <div className="qa-warning" role="alert">{error}</div>}
    <Dialog open={!!draft} onOpenChange={(_, d) => { if (!d.open && !busy) { setDraft(null); setError(''); } }}>
      <DialogSurface className="qa-dialog"><DialogBody><DialogTitle>编辑快捷规则</DialogTitle><DialogContent>{draft && <div className="qa-form">
        <Field label="规则名称" required><Input value={draft.name} maxLength={60} onChange={(_, d) => setDraft({ ...draft, name: d.value })} /></Field>
        <Field label="使用这个信号"><div className="qa-ping-grid">{ALL_PINGS.map(p => <button key={p.id} type="button" title={t.pingNames[p.id]} aria-label={t.pingNames[p.id]} aria-pressed={draft.ping === p.id} onClick={() => setDraft({ ...draft, ping: p.id })}><img src={textureUrl(p.icon)} alt="" /><span>{t.pingNames[p.id]}</span></button>)}</div></Field>
        <div className="qa-grid"><Field label="连续发送次数"><Input type="number" min={1} max={10} value={String(draft.count)} onChange={(_, d) => setDraft({ ...draft, count: Number(d.value) })} /></Field><Field label="相邻信号间隔（秒）"><Input type="number" min={0.5} max={10} step={0.5} value={String(draft.intervalMs / 1000)} onChange={(_, d) => setDraft({ ...draft, intervalMs: Number(d.value) * 1000 })} /></Field></div>
        <Field label="生效鼠标键" hint="左键和右键分别累计连发次数；另一种鼠标键不会触发这条规则。"><Select value={draft.button ?? 'both'} onChange={(_, d) => setDraft({ ...draft, button: d.value as ButtonScope })}><option value="both">左右键都生效</option><option value="left">仅左键生效</option><option value="right">仅右键生效</option></Select></Field>
        <Field label="执行动作"><Select value={draft.action.type} onChange={(_, d) => changeAction(d.value as QuickAction['type'])}>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</Select></Field>
        {draft.action.type === 'app' && <Field label="应用路径" hint={api.platform === 'mac' ? '选择本机的 .app 应用，例如微信、浏览器、音乐软件。' : '选择本机的 .exe 应用程序。'}><div className="qa-path"><Input aria-label="应用路径" value={draft.action.target} placeholder="选择你希望打开的软件" onChange={(_, d) => setDraft({ ...draft, action: { type: 'app', target: d.value } })} /><Button onClick={() => void run(async () => { const target = await api.pickQuickApp(); if (target) setDraft({ ...draft, action: { type: 'app', target } }); })}>选择应用…</Button></div></Field>}
        {draft.action.type === 'url' && <Field label="网址" required><Input type="url" value={draft.action.target} placeholder="https://www.bing.com" onChange={(_, d) => setDraft({ ...draft, action: { type: 'url', target: d.value } })} /></Field>}
        {draft.action.type === 'clipboard' && <Field label="要复制的文本" required><Textarea rows={3} value={draft.action.target} onChange={(_, d) => setDraft({ ...draft, action: { type: 'clipboard', target: d.value } })} /></Field>}
        {draft.action.type === 'screenshot' && <Field label="截图方式"><Select value={draft.action.region ? 'region' : 'full'} onChange={(_, d) => setDraft({ ...draft, action: { type: 'screenshot', region: d.value === 'region' } })}><option value="region">框选区域，自动复制</option><option value="full">鼠标所在屏幕，自动复制</option></Select></Field>}
        <Field label="动作冷却（秒）" hint="触发后进入冷却，期间不重复执行或累计次数。发送其他信号会中断连续计数。"><Input type="number" min={1} max={60} value={String(draft.cooldownMs / 1000)} onChange={(_, d) => setDraft({ ...draft, cooldownMs: Number(d.value) * 1000 })} /></Field>
        <Switch label="启用这条规则" checked={draft.enabled} onChange={(_, d) => setDraft({ ...draft, enabled: d.checked })} />
        {error && <div className="qa-warning" role="alert">{error}</div>}
      </div>}</DialogContent><DialogActions>
        <Button icon={<Play20Regular />} onClick={() => { if (draft) void api.previewPing(draft.ping); }}>仅预览信号</Button>
        <Button disabled={busy} onClick={() => { setDraft(null); setError(''); }}>取消</Button>
        <Button appearance="primary" disabled={busy} onClick={async () => { if (!draft) return; const exists = config.rules.some(r => r.id === draft.id); if (await save({ ...config, rules: exists ? config.rules.map(r => r.id === draft.id ? draft : r) : [...config.rules, draft] })) setDraft(null); }}>{busy ? '正在保存…' : '保存规则'}</Button>
      </DialogActions></DialogBody></DialogSurface>
    </Dialog>
  </div>;
}
