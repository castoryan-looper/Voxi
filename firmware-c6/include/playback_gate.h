#pragma once
#include <stddef.h>
#include <stdint.h>
struct PlaybackGate {
  bool primed=false;uint32_t rebuffers=0;size_t targetBytes=67200;
  void reset(){primed=false;rebuffers=0;targetBytes=67200;}
  bool canWrite(size_t bytes,bool ending){
    if(!primed){if(bytes>=targetBytes||(ending&&bytes))primed=true;else return false;}
    if(!bytes){if(!ending){rebuffers++;primed=false;if(targetBytes<81600)targetBytes+=7200;}return false;}
    return true;
  }
};
