#pragma once
#include <stdint.h>
#include "recording_policy.h"
// One recording per physical hold. Short presses never start a cloud turn.
struct PttHold {
  enum Event { None, Start, Stop };
  bool held=false,armed=false,active=false;
  uint32_t pressed=0,started=0;
  Event update(uint32_t now,bool down,bool ready,bool cancel=false){
    if(!down){held=armed=false;if(active){active=false;return Stop;}return None;}
    if(!held){held=true;armed=ready&&!cancel;pressed=now;}
    if(cancel||!ready){armed=false;if(active){active=false;return Stop;}return None;}
    if(active&&uint32_t(now-started)>=RECORDING_MAX_MS){active=armed=false;return Stop;}
    if(armed&&!active&&uint32_t(now-pressed)>=500){active=true;armed=false;started=now;return Start;}
    return None;
  }
};
