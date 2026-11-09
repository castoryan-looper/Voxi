#pragma once
#include <stddef.h>
#include <stdint.h>
struct PlaybackGate {
  bool primed=false,recovering=false;uint32_t rebuffers=0;size_t targetBytes;
  size_t resumeBytes=0;
  size_t recoveryStepBytes=0,recoveryMaxBytes=0;
  size_t initialBytes,maxBytes,stepBytes;bool retainLearning;
  PlaybackGate(size_t initial=67200,size_t maximum=81600,size_t step=7200,bool retain=false):targetBytes(initial),initialBytes(initial),maxBytes(maximum),stepBytes(step),retainLearning(retain){}
  void configure(size_t initial,size_t maximum,size_t step,bool retain){initialBytes=initial;maxBytes=maximum;stepBytes=step;retainLearning=retain;targetBytes=initial;primed=recovering=false;resumeBytes=0;rebuffers=0;}
  void reset(){primed=recovering=false;rebuffers=0;if(!retainLearning)targetBytes=initialBytes;}
  size_t threshold()const{
    if(!recovering||!resumeBytes)return targetBytes;
    size_t reserve=resumeBytes;
    if(recoveryMaxBytes&&recoveryStepBytes&&rebuffers>1){
      size_t steps=rebuffers-1,room=recoveryMaxBytes>reserve?recoveryMaxBytes-reserve:0;
      reserve+=steps>room/recoveryStepBytes?room:steps*recoveryStepBytes;
    }
    return reserve<targetBytes?reserve:targetBytes;
  }
  bool canWrite(size_t bytes,bool ending,bool dmaGrace=false){
    if(!primed){if(bytes>=threshold()||(ending&&bytes))primed=true;else return false;}
    if(!bytes&&dmaGrace&&!ending)return false;
    if(!bytes){if(!ending){rebuffers++;primed=false;recovering=true;if(targetBytes<maxBytes)targetBytes=stepBytes>maxBytes-targetBytes?maxBytes:targetBytes+stepBytes;}return false;}
    return true;
  }
};
