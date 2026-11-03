#pragma once
#include <stdint.h>
inline int16_t decodeMulaw(uint8_t value){
 uint8_t code=~value;int magnitude=(((code&15)<<3)+132)<<((code>>4)&7);
 return (code&128)?(132-magnitude):(magnitude-132);
}
