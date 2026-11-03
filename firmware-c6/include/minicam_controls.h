#pragma once
#include <stdint.h>
struct MiniCamActions {int volumeDelta=0;bool nextChannel=false,toggleTalk=false;};
class MiniCamControls {
 int keyCandidate=0,keyStable=0,keyCount=0;bool buttonCandidate=false,buttonStable=false,shortPending=false;
 uint32_t buttonChanged=0,pressedAt=0,shortAt=0;
public:
 static int volumeKey(int mv){return mv>=0&&mv<=700?-1:mv>=900&&mv<=3000?1:0;}
 MiniCamActions sample(uint32_t now,int mv,bool down){
  MiniCamActions result;int key=volumeKey(mv);
  if(key!=keyCandidate){keyCandidate=key;keyCount=1;}else if(keyCount<3)keyCount++;
  if(keyCount==3&&key!=keyStable){keyStable=key;result.volumeDelta=key*10;}
  if(down!=buttonCandidate){buttonCandidate=down;buttonChanged=now;}
  if(now-buttonChanged>=30&&down!=buttonStable){
   buttonStable=down;
   if(down)pressedAt=now;
   else if(now-pressedAt<250){if(shortPending&&now-shortAt<450){result.nextChannel=true;shortPending=false;}else{shortPending=true;shortAt=now;}}
   else shortPending=false;
  }
  if(shortPending&&now-shortAt>=450){shortPending=false;result.toggleTalk=true;}
  return result;
 }
};
