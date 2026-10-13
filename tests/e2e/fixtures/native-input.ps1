param(
  [ValidateSet('Assist', 'Missing', 'Screenshot')][string]$Action,
  [ValidateRange(1, 10)][int]$Count = 1
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LolPingInput {
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
      [LolPingInput]::Move(400, 300)
      Start-Sleep -Milliseconds 100
      [LolPingInput]::keybd_event(0xA4, 0x38, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 100
      if (([LolPingInput]::GetAsyncKeyState(0xA4) -band 0x8000) -eq 0) { throw 'Windows did not hold the injected Alt key' }
      [LolPingInput]::Mouse(2)
      Start-Sleep -Milliseconds 100
      # Real movement events exercise the low-level input hook, rather than just teleporting the cursor.
      for ($step = 1; $step -le 5; $step++) {
        if ($Action -eq 'Assist') { [LolPingInput]::Move(400, (300 + 30 * $step)) }
        else { [LolPingInput]::Move((400 - 30 * $step), 300) }
        Start-Sleep -Milliseconds 40
      }
      Start-Sleep -Milliseconds 200
      [LolPingInput]::Mouse(4)
      [LolPingInput]::keybd_event(0xA4, 0x38, 2, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 150
    }
  }
} finally {
  [LolPingInput]::Mouse(4)
  foreach ($key in @(0xA4, 0x12, 0x11, 0x10, 0x32)) {
    [LolPingInput]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
  }
}
