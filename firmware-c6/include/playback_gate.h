#pragma once
#include <stddef.h>
#include <stdint.h>
struct PlaybackGate {
  bool primed=false;uint32_t rebuffers=0;
  void reset(){primed=false;rebuffers=0;}
  bool canWrite(size_t bytes,bool ending){
    if(!primed){if(bytes>=5760||(ending&&bytes))primed=true;else return false;}
    if(!bytes){if(!ending){rebuffers++;primed=false;}return false;}
    return true;
  }
};
