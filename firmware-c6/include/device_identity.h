#pragma once
#include <stdint.h>
#include <stddef.h>
// Preserve the original little-endian efuse ID spelling without 64-bit printf.
inline void formatDeviceIdentity(const uint8_t mac[6],char* out,size_t size){
 if(size<19){if(size)out[0]=0;return;}
 const char prefix[]="esp32-",hex[]="0123456789abcdef";
 for(int i=0;i<6;i++)out[i]=prefix[i];
 for(int i=0;i<6;i++){uint8_t value=mac[5-i];out[6+i*2]=hex[value>>4];out[7+i*2]=hex[value&15];}
 out[18]=0;
}
