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
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public MouseInput mouse; }
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] input, int size);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  public static void Mouse(uint flags, int x=0, int y=0) {
    var input = new Input { type=0, mouse=new MouseInput { x=x, y=y, flags=flags } };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Move(int x, int y) {
    Mouse(0x8001, (int)Math.Round(x * 65535.0 / (GetSystemMetrics(0)-1)), (int)Math.Round(y * 65535.0 / (GetSystemMetrics(1)-1)));
  }
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
    [WindowLayer]::Move(400, 300)
    Start-Sleep -Milliseconds 100
    [WindowLayer]::keybd_event(0xA4, 0x38, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    if (([WindowLayer]::GetAsyncKeyState(0xA4) -band 0x8000) -eq 0) { throw 'Windows did not hold the injected Alt key' }
    [WindowLayer]::Mouse(2, 0, 0)
    Start-Sleep -Milliseconds 100
    for ($step=1; $step -le 5; $step++) {
      [WindowLayer]::Move(400, (300+30*$step))
      Start-Sleep -Milliseconds 40
    }
  }
  'Release' {
    [WindowLayer]::Mouse(4, 0, 0)
    [WindowLayer]::keybd_event(0xA4, 0x38, 2, [UIntPtr]::Zero)
  }
}
@{
  topmost = (([WindowLayer]::GetWindowLong($overlayHandle, -20) -band 8) -ne 0)
  above = [WindowLayer]::Above($overlayHandle, $targetHandle)
  visible = [WindowLayer]::IsWindowVisible($overlayHandle)
  altDown = (([WindowLayer]::GetAsyncKeyState(0xA4) -band 0x8000) -ne 0)
  foreground = [WindowLayer]::GetForegroundWindow().ToInt64().ToString()
} | ConvertTo-Json -Compress
