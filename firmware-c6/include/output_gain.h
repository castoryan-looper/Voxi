#pragma once
#include <stdint.h>
// +18dB for quiet speech with a continuous knee approaching 15500; reserve 6dB for codec gain.
// Volume is applied last, so zero stays silent and the slider stays linear.
static int16_t speakerSample(int16_t sample,int volume){
  if(volume<=0)return 0;if(volume>100)volume=100;
  int32_t value=(int32_t)sample*8;
  int32_t magnitude=value<0?-value:value;
  if(magnitude>12000){int32_t excess=magnitude-12000;magnitude=12000+excess*3500/(excess+3500);}
  int32_t limited=value<0?-magnitude:magnitude;
  return (int16_t)(limited*volume/100);
}
