#pragma once
#include <stdint.h>
struct MiniCamActions {int volumeDelta=0,channelDelta=0;bool talkChanged=false;};
class MiniCamControls {
 int keyCandidate=0,keyStable=0,keyCount=0;bool keyLong=false,buttonCandidate=false,buttonStable=false;
 uint32_t keyAt=0,buttonChanged=0;
public:
 bool pressed()const{return buttonStable;}
 static int volumeKey(int mv){return mv>=0&&mv<=700?-1:mv>=900&&mv<=3000?1:0;}
 MiniCamActions sample(uint32_t now,int mv,bool down){
  MiniCamActions result;int key=volumeKey(mv);
  if(key!=keyCandidate){keyCandidate=key;keyCount=1;}else if(keyCount<3)keyCount++;
  if(keyCount==3&&key!=keyStable){
   if(keyStable&&!keyLong)result.volumeDelta=keyStable*10;
   keyStable=key;keyAt=now;keyLong=false;
  }
  if(keyStable&&!keyLong&&now-keyAt>=700){result.channelDelta=keyStable;keyLong=true;}
  if(down!=buttonCandidate){buttonCandidate=down;buttonChanged=now;}
  if(now-buttonChanged>=30&&down!=buttonStable){
   buttonStable=down;
   result.talkChanged=true;
  }
  return result;
 }
};
