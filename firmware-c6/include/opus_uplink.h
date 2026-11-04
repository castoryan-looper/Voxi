#pragma once
#include <stddef.h>
#include <stdint.h>
#if defined(VOXI_BOARD_MINICAM)||defined(VOXI_BOARD_AMOLED)||defined(VOXI_BOARD_S3G)
#define VOXI_OPUS_UPLINK 1
#endif
using OpusUplinkSend=bool(*)(const uint8_t*,size_t);
bool opusUplinkReset();
bool opusUplinkAudio(const uint8_t* pcm,size_t bytes,OpusUplinkSend send);
bool opusUplinkFinish(OpusUplinkSend send);
void opusUplinkClose();
extern uint32_t opusUplinkFrames,opusUplinkErrors,opusUplinkMaxUs,opusUplinkWireBytes;
