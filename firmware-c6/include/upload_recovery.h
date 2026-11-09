#pragma once
#include <stdint.h>
struct UploadRecovery {
  bool pending=false;unsigned attempts=0;uint32_t started=0;
  bool initialChannelWait=false;
  void reset(){pending=initialChannelWait=false;attempts=0;started=0;}
  void waitForChannel(uint32_t now){pending=initialChannelWait=true;started=now;}
  bool request(uint32_t now,bool uploading,bool submissionAttempted,bool probe){
    if(pending)return true;
    if(!uploading||submissionAttempted||probe||attempts>=1)return false;
    pending=true;started=now;return true;
  }
  void begin(){pending=false;if(!initialChannelWait)attempts++;initialChannelWait=false;}
  bool expired(uint32_t now)const{return pending&&uint32_t(now-started)>90000;}
};
