#pragma once
#include <stdint.h>
#include <stddef.h>
// 120 samples = 5ms at 24kHz; attenuation only, with exact zero endpoints.
static constexpr size_t playbackFadeSamples=120;
static int16_t playbackEnvelope(int16_t sample,size_t index,size_t fadeRemaining,size_t available,bool fadeTail){
  size_t gain=playbackFadeSamples;
  if(index<fadeRemaining)gain=playbackFadeSamples-fadeRemaining+index;
  if(fadeTail){
    size_t tail=available-index-1;
    if(tail<gain)gain=tail;
  }
  return (int16_t)((int32_t)sample*(int32_t)gain/(int32_t)playbackFadeSamples);
}
