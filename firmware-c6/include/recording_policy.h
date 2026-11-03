#pragma once
#include <stdint.h>
constexpr uint32_t RECORDING_MAX_MS=20000;
constexpr uint32_t RECORDING_BYTES_PER_SECOND=48000; // 24kHz mono s16
constexpr uint32_t RECORDING_MAX_BYTES=RECORDING_MAX_MS*RECORDING_BYTES_PER_SECOND/1000;
constexpr uint32_t UPLOAD_STALL_MS=20000;
constexpr uint32_t UPLOAD_MAX_MS=90000;
