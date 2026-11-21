#pragma once
#include <stdint.h>
namespace pocket {
// Taiji vendor wiring: A and B independently pulse low for each direction.
// Count qualified rising edges without waiting for both inputs to be idle.
class DirectionalPulseEncoder {
  uint8_t previous=3;uint32_t lowAt[2]={},lastStep=0;bool low[2]={},accepted=false;int queued=0;
public:
  unsigned mode=1;
  void begin(uint8_t state){previous=state&3;low[0]=low[1]=false;accepted=false;queued=0;}
  void edge(uint8_t state,uint32_t now){
    state&=3;
    for(unsigned i=0;i<2;i++){
      unsigned mask=1U<<i;
      if((previous&mask)&&!(state&mask)){lowAt[i]=now;low[i]=true;}
      if(!(previous&mask)&&(state&mask)){
        if(low[i]&&uint32_t(now-lowAt[i])>=80&&(!accepted||uint32_t(now-lastStep)>=8000)){
          queued+=i==1?1:-1;if(queued>32)queued=32;if(queued< -32)queued=-32;lastStep=now;accepted=true;
        }low[i]=false;
      }
    }previous=state;
  }
  int take(uint32_t){int result=queued;queued=0;return result;}
};
}
