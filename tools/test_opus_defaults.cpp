#include "../firmware-c6/include/opus_uplink.h"
#ifndef VOXI_OPUS_UPLINK
#error Every maintained board must enable Opus microphone uplink by default
#endif
static_assert(VOXI_OPUS_UPLINK == 1, "Opus uplink must default on");
int main() {}
