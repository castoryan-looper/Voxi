#pragma once
#include <stddef.h>
#include <stdint.h>
constexpr size_t OPUS_REPLY_SAMPLES=480;
struct OpusReplySpan {const uint8_t* data;size_t bytes;};
// Validate the entire envelope before advancing any codec/sequence state.
inline size_t opusReplyPackets(const uint8_t* p,size_t bytes,bool batched,OpusReplySpan (&frames)[3]){
 if(!p||!bytes||bytes>2048)return 0;
 if(!batched){if(bytes<5||bytes>1279)return 0;frames[0]={p,bytes};return 1;}
 const size_t count=p[0];if(!count||count>3)return 0;size_t at=1;
 for(size_t i=0;i<count;i++){
  if(bytes-at<2)return 0;
  size_t len=size_t(p[at])|(size_t(p[at+1])<<8);at+=2;
  if(len<5||len>1279||len>bytes-at)return 0;
  frames[i]={p+at,len};at+=len;
 }
 return at==bytes?count:0;
}
// Validates the v1 sequence header before touching decoder state.
inline bool opusReplyHeader(const uint8_t* p,size_t bytes,uint32_t expected){
 if(bytes<5||bytes>1279)return false;
 uint32_t sequence=uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);
 return sequence==expected;
}
bool opusReplyReset();
bool opusReplyDecode(const uint8_t* wire,size_t bytes,int16_t* pcm);
void opusReplyClose();
extern uint32_t opusReplyFrames,opusReplyErrors,opusReplyMaxUs;
