#pragma once
#include <stdint.h>
#include <stddef.h>
// 120 samples = 5ms at 24kHz; attenuation only, with exact zero endpoints.
static int16_t playbackEnvelope(int16_t sample,size_t index,size_t fadeRemaining,size_t available){
  int gain=120;
  if(index<fadeRemaining)gain=(int)(120-fadeRemaining+index);
  size_t tail=available-index-1;
  if(tail<120&&gain>(int)tail)gain=(int)tail;
  return (int16_t)((int32_t)sample*gain/120);
}
