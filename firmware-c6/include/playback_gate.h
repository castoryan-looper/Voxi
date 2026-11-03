#pragma once
#include <stddef.h>
#include <stdint.h>
struct PlaybackGate {
  bool primed=false;uint32_t rebuffers=0;size_t targetBytes=9600;
  void reset(){primed=false;rebuffers=0;targetBytes=9600;}
  bool canWrite(size_t bytes,bool ending){
    if(!primed){if(bytes>=targetBytes||(ending&&bytes))primed=true;else return false;}
    if(!bytes){if(!ending){rebuffers++;primed=false;if(targetBytes<17280)targetBytes+=3840;}return false;}
    return true;
  }
};
