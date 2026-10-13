param(
  [ValidateSet('Assist', 'Missing', 'Screenshot')][string]$Action,
  [ValidateRange(1, 10)][int]$Count = 1
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LolPingInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
try {
  if ($Action -eq 'Screenshot') {
    [LolPingInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [LolPingInput]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
    [LolPingInput]::keybd_event(0x32, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    [LolPingInput]::keybd_event(0x32, 0, 2, [UIntPtr]::Zero)
  } else {
    for ($i = 0; $i -lt $Count; $i++) {
      [LolPingInput]::SetCursorPos(400, 300) | Out-Null
      Start-Sleep -Milliseconds 100
      [LolPingInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 100
      [LolPingInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 100
      if ($Action -eq 'Assist') { [LolPingInput]::SetCursorPos(400, 450) | Out-Null }
      else { [LolPingInput]::SetCursorPos(250, 300) | Out-Null }
      Start-Sleep -Milliseconds 200
      [LolPingInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
      [LolPingInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 150
    }
  }
} finally {
  [LolPingInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  foreach ($key in @(0x12, 0x11, 0x10, 0x32)) {
    [LolPingInput]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
  }
}
