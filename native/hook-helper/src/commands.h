#pragma once
#include <cstdint>
#include <string>

#include "decision.h"

namespace lp {

struct Command {
  enum class Kind { Invalid, Config, SetEnabled, Suspend, Shutdown, Scroll, SimEvent, SimTick } kind = Kind::Invalid;
  int x = 0, y = 0, pixels = 0, request = 0; // Scroll
  Config config;      // Config
  bool flag = false;  // SetEnabled / Suspend
  InputEvent event;   // SimEvent
  uint64_t timeMs = 0;  // SimEvent / SimTick
};

// Parses one stdin line. `current` supplies values for config fields missing from the message.
Command parseCommand(const std::string& line, const Config& current);

}  // namespace lp
