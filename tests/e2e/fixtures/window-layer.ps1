param(
  [ValidateSet('Inspect','Demote','Cover','Desktop','Hold','Release')][string]$Action,
  [long]$Overlay,
  [long]$Target
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WindowLayer {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static bool Above(IntPtr overlay, IntPtr target) {
    for (var w = GetWindow(target, 3); w != IntPtr.Zero; w = GetWindow(w, 3)) if (w == overlay) return true;
    return false;
  }
}
'@
$overlayHandle = [IntPtr]$Overlay
$targetHandle = [IntPtr]$Target
switch ($Action) {
  'Demote' { if (![WindowLayer]::SetWindowPos($overlayHandle, [IntPtr](-2), 0, 0, 0, 0, 0x13)) { throw 'Demote failed' } }
  'Cover' { if (![WindowLayer]::SetWindowPos($targetHandle, [IntPtr](-1), 0, 0, 0, 0, 0x13)) { throw 'Cover failed' } }
  'Desktop' { (New-Object -ComObject Shell.Application).ToggleDesktop(); Start-Sleep -Milliseconds 400 }
  'Hold' {
    [WindowLayer]::SetCursorPos(400, 300) | Out-Null
    [WindowLayer]::keybd_event(0xA4, 0x38, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    [WindowLayer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    for ($step=1; $step -le 5; $step++) {
      [WindowLayer]::SetCursorPos(400, (300+10*$step)) | Out-Null
      Start-Sleep -Milliseconds 40
    }
  }
  'Release' {
    [WindowLayer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [WindowLayer]::keybd_event(0xA4, 0x38, 2, [UIntPtr]::Zero)
  }
}
@{
  topmost = (([WindowLayer]::GetWindowLong($overlayHandle, -20) -band 8) -ne 0)
  above = [WindowLayer]::Above($overlayHandle, $targetHandle)
  visible = [WindowLayer]::IsWindowVisible($overlayHandle)
  foreground = [WindowLayer]::GetForegroundWindow().ToInt64().ToString()
} | ConvertTo-Json -Compress
