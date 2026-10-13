#include <unistd.h>
#include <ApplicationServices/ApplicationServices.h>
#include <chrono>
#include <thread>
#include <cstdlib>
#include <iostream>

#include <csignal>
#include <cstring>
#include <string>

#include "app.h"

namespace {

bool writeStdout(const std::string& s) {
  const std::string buf = s + "\n";
  size_t done = 0;
  while (done < buf.size()) {
    const ssize_t n = ::write(STDOUT_FILENO, buf.data() + done, buf.size() - done);
    if (n <= 0) return false;
    done += static_cast<size_t>(n);
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 3 && (std::strcmp(argv[1], "--capture-ready") == 0 || std::strcmp(argv[1], "--capture-ready-server") == 0)) {
    const int pid = std::atoi(argv[2]);
    if (pid <= 0) return 2;
    const auto waitHidden = [pid]() -> bool {
    int clear = 0;
    for (int tick = 0; tick < 100; ++tick) {
      bool visible = false;
      const CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
      if (!windows) return false;
      for (CFIndex i = 0; i < CFArrayGetCount(windows); ++i) {
        const auto info = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(windows, i));
        const auto owner = static_cast<CFNumberRef>(CFDictionaryGetValue(info, kCGWindowOwnerPID));
        int ownerPid = 0;
        if (owner && CFNumberGetValue(owner, kCFNumberIntType, &ownerPid) && ownerPid == pid) {
          const auto alpha = static_cast<CFNumberRef>(CFDictionaryGetValue(info, kCGWindowAlpha));
          double opacity = 1;
          if (alpha) CFNumberGetValue(alpha, kCFNumberDoubleType, &opacity);
          if (opacity > 0.001) { visible = true; break; }
        }
      }
      CFRelease(windows);
      clear = visible ? 0 : clear + 1;
      if (clear >= 2) return true;
      std::this_thread::sleep_for(std::chrono::milliseconds(8));
    }
    return false;
    };
    if (std::strcmp(argv[1], "--capture-ready") == 0) return waitHidden() ? 0 : 2;
    std::signal(SIGPIPE, SIG_IGN);
    // Establish the WindowServer connection once, before the first screenshot request.
    const auto warm = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    if (!warm) return 2;
    CFRelease(warm);
    std::cout << "ready\n" << std::flush;
    std::string request;
    while (std::getline(std::cin, request)) {
      if (request.empty() || request.find_first_not_of("0123456789") != std::string::npos) continue;
      std::cout << request << (waitHidden() ? " ready\n" : " busy\n") << std::flush;
    }
    return 0;
  }
  std::signal(SIGPIPE, SIG_IGN);  // a closed pipe makes write() fail instead of killing the process
  lp::Output out(writeStdout);
  const bool simulate = argc > 1 && std::strcmp(argv[1], "--simulate") == 0;
  const int code = simulate ? lp::runSimulate(out) : lp::runHooks(out);
  out.stop();
  return code;
}
