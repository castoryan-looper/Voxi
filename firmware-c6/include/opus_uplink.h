#pragma once
#include <stddef.h>
#include <stdint.h>
using OpusUplinkSend=bool(*)(const uint8_t*,size_t);
bool opusUplinkReset();
bool opusUplinkAudio(const uint8_t* pcm,size_t bytes,OpusUplinkSend send);
bool opusUplinkFinish(OpusUplinkSend send);
void opusUplinkClose();
extern uint32_t opusUplinkFrames,opusUplinkErrors,opusUplinkMaxUs,opusUplinkWireBytes;
