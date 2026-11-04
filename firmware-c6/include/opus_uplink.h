#pragma once
#include <stddef.h>
#include <stdint.h>
#define VOXI_OPUS_UPLINK 1
#if !defined(VOXI_BOARD_MINICAM)&&!defined(VOXI_BOARD_AMOLED)&&!defined(VOXI_BOARD_S3G)
#define VOXI_OPUS_C6 1
#endif
using OpusUplinkSend=bool(*)(const uint8_t*,size_t);
bool opusUplinkReset();
bool opusUplinkAudio(const uint8_t* pcm,size_t bytes,OpusUplinkSend send);
bool opusUplinkFinish(OpusUplinkSend send);
void opusUplinkClose();
extern uint32_t opusUplinkFrames,opusUplinkErrors,opusUplinkMaxUs,opusUplinkWireBytes;

// Called by the Arduino owner before encoding; C6 releases reply-only RAM.
void prepareOpusUplinkMemory();
bool opusUplinkWorkerActive();
bool prepareOpusReplyMemory();
