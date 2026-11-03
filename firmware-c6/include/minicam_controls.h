#pragma once
#include <stdint.h>
struct MiniCamActions {int volumeDelta=0,channelDelta=0;bool toggleTalk=false;};
class MiniCamControls {
 int keyCandidate=0,keyStable=0,keyCount=0;bool keyLong=false,buttonCandidate=false,buttonStable=false;
 uint32_t keyAt=0,buttonChanged=0,pressedAt=0;
public:
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
   if(down)pressedAt=now;
   else if(now-pressedAt<1200)result.toggleTalk=true;
  }
  return result;
 }
};
// Recording is a protocol state, never inferred from the display's READY/OPEN MIC text.
class MiniCamTalkLatch {
 bool active=false,sawRecording=false;uint32_t armedAt=0;
public:
 bool pressed()const{return active;}
 void reset(){active=sawRecording=false;}
 void observe(uint32_t now,bool recording,bool canStart){
  if(!active)return;
  if(recording)sawRecording=true;
  else if(sawRecording||!canStart||now-armedAt>=1500)reset();
 }
 void click(uint32_t now,bool canStart){
  if(active)reset();else if(canStart){active=true;sawRecording=false;armedAt=now;}
 }
};
