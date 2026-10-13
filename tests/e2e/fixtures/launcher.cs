using System;
using System.IO;
using System.Reflection;

// A harmless real Windows executable: proves ShellExecute opened the configured application.
class Launcher {
  static void Main() {
    File.WriteAllText(Assembly.GetExecutingAssembly().Location + ".launched", "opened by lolPing");
  }
}
