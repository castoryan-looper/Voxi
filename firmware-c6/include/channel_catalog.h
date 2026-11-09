#pragma once
#include <stdint.h>

constexpr int channelLimit = 16;

struct ChannelLabel {
  static constexpr int width = 120, height = 16, bytes = width / 8 * height;
  char name[129]{}, mode[9]{};
  uint8_t bitmap[bytes]{};
  bool hasBitmap = false;
  bool disabled() const { return mode[0] == 'd'; }
  int number(int index) const { return index + (mode[0] ? 0 : 1); }
  bool asciiName() const {
    if (!name[0]) return false;
    for (const unsigned char* c = reinterpret_cast<const unsigned char*>(name); *c; ++c)
      if (*c < 32 || *c > 126) return false;
    return true;
  }
};

inline int nextEnabledChannel(int current, int direction, uint16_t enabled) {
  if (!direction) return current;
  int step = direction > 0 ? 1 : channelLimit - 1;
  for (int offset = 1; offset <= channelLimit; ++offset) {
    int next = (current + step * offset) % channelLimit;
    if (enabled & (1u << next)) return next;
  }
  return current;
}
