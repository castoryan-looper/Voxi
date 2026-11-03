#pragma once
#include <stddef.h>
#include <stdint.h>
struct PlaybackGate {
  bool primed=false;uint32_t rebuffers=0;size_t targetBytes;
  size_t initialBytes,maxBytes,stepBytes;bool retainLearning;
  PlaybackGate(size_t initial=67200,size_t maximum=81600,size_t step=7200,bool retain=false):targetBytes(initial),initialBytes(initial),maxBytes(maximum),stepBytes(step),retainLearning(retain){}
  void configure(size_t initial,size_t maximum,size_t step,bool retain){initialBytes=initial;maxBytes=maximum;stepBytes=step;retainLearning=retain;targetBytes=initial;primed=false;rebuffers=0;}
  void reset(){primed=false;rebuffers=0;if(!retainLearning)targetBytes=initialBytes;}
  bool canWrite(size_t bytes,bool ending){
    if(!primed){if(bytes>=targetBytes||(ending&&bytes))primed=true;else return false;}
    if(!bytes){if(!ending){rebuffers++;primed=false;if(targetBytes<maxBytes)targetBytes=stepBytes>maxBytes-targetBytes?maxBytes:targetBytes+stepBytes;}return false;}
    return true;
  }
};
