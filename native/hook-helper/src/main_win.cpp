#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dwmapi.h>

#include <cwchar>
#include <string>
#include <iostream>

#include "app.h"

namespace {

bool writeStdout(const std::string& s) {
  static const HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
  const std::string buf = s + "\n";
  DWORD written = 0;
  return WriteFile(h, buf.data(), static_cast<DWORD>(buf.size()), &written, nullptr) != 0 && written == buf.size();
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);  // hook coordinates in physical pixels
  if (argc == 3 && (std::wcscmp(argv[1], L"--capture-ready") == 0 || std::wcscmp(argv[1], L"--capture-ready-server") == 0)) {
    // Wait for queued window changes to be presented, rather than sleeping for an animation duration.
    const auto presented = [] { return SUCCEEDED(DwmFlush()) && SUCCEEDED(DwmFlush()); };
    if (std::wcscmp(argv[1], L"--capture-ready") == 0) return presented() ? 0 : 2;
    std::cout << "ready\n" << std::flush;
    std::string request;
    while (std::getline(std::cin, request)) {
      if (request.empty() || request.find_first_not_of("0123456789") != std::string::npos) continue;
      std::cout << request << (presented() ? " ready\n" : " busy\n") << std::flush;
    }
    return 0;
  }
  lp::Output out(writeStdout);
  const bool simulate = argc > 1 && std::wcscmp(argv[1], L"--simulate") == 0;
  const int code = simulate ? lp::runSimulate(out) : lp::runHooks(out);
  out.stop();
  return code;
}
