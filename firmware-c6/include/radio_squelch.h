#pragma once
#include <stdint.h>
#include <stddef.h>
// Locally generated band-limited squelch; random-access samples survive partial I2S writes.
struct RadioSquelch {
  static constexpr size_t samples=5280; // 220ms, 24kHz mono
  static int noise(uint32_t n,uint32_t seed){
    uint32_t x=n+seed;x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;
    return int(x&2047)-1024;
  }
  static int16_t sample(size_t i,uint32_t seed){
    if(i>=samples)return 0;
    // Short FIR removes DC and rolls off the harshest high frequencies.
    int band=(noise(i,seed)+noise(i+1,seed)-noise(i+4,seed)-noise(i+5,seed))/4;
    int envelope=1024;
    if(i<48)envelope=int(i)*1024/48;
    size_t left=samples-i-1;
    if(left<360&&envelope>int(left)*1024/360)envelope=int(left)*1024/360;
    int flutter=650+int((uint32_t)noise(i/120,seed^0xa91u)&511);
    return int16_t(int32_t(band)*envelope/1024*flutter/1161);
  }
};
