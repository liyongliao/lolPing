import { Button } from '@fluentui/react-components';
import { ShieldKeyhole24Regular } from '@fluentui/react-icons';
import { api } from '../api';
import { useText } from '../text';

/**
 * macOS only: shown while lolPing has no Accessibility access. `stale`: macOS lists lolPing as allowed but the
 * helper is still refused, which is what an entry left over from an earlier (differently signed) build looks like.
 */
export function PermissionCard({ stale }: { stale: boolean }) {
  const t = useText();
  return (
    <div className="card permission">
      <span className="icon"><ShieldKeyhole24Regular /></span>
      <div className="lbl">
        <b>{stale ? t.permStaleTitle : t.permTitle}</b>
        <ol className="desc">
          {(stale ? t.permStaleSteps : t.permSteps).map((step) => <li key={step}>{step}</li>)}
        </ol>
        <div className="actions">
          <Button appearance="primary" onClick={() => void api.openAccessibility()}>{t.permOpen}</Button>
          {stale ? <Button onClick={() => void api.retryHelper()}>{t.permRetry}</Button> : null}
        </div>
      </div>
    </div>
  );
}

export function ScreenPermissionCard() {
  return <div className="card permission"><span className="icon"><ShieldKeyhole24Regular /></span><div className="lbl">
    <b>请允许屏幕录制权限</b><p className="desc">在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中开启 lolPing，然后按系统提示重新打开应用。截图只在你主动使用时采集。</p>
    <div className="actions"><Button appearance="primary" onClick={() => void api.openScreenAccess()}>授权屏幕录制</Button></div>
  </div></div>;
}
