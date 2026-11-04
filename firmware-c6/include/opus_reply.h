#pragma once
#include <stddef.h>
#include <stdint.h>
constexpr size_t OPUS_REPLY_SAMPLES=480;
// Validates the v1 sequence header before touching decoder state.
inline bool opusReplyHeader(const uint8_t* p,size_t bytes,uint32_t expected){
 if(bytes<5||bytes>1279)return false;
 uint32_t sequence=uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);
 return sequence==expected;
}
#ifdef VOXI_BOARD_MINICAM
bool opusReplyReset();
bool opusReplyDecode(const uint8_t* wire,size_t bytes,int16_t* pcm);
void opusReplyClose();
extern uint32_t opusReplyFrames,opusReplyErrors,opusReplyMaxUs;
#endif
