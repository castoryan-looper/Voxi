#pragma once
#include <stdint.h>
struct TieredStandbyPolicy {
 uint32_t screenMinutes=1,linkMinutes=5,sleepMinutes=15;
 bool valid()const{return screenMinutes>=1&&screenMinutes<linkMinutes&&linkMinutes<sleepMinutes&&sleepMinutes<=1440;}
 int stage(uint32_t idle)const{return idle>=sleepMinutes*60000u?3:idle>=linkMinutes*60000u?2:idle>=screenMinutes*60000u?1:0;}
};
struct StandbyPolicy {
 uint32_t lastActivity=0;
 void activity(uint32_t now){lastActivity=now;}
 bool due(uint32_t now,bool busy,bool input,bool provisioning){
  if(busy||input||provisioning){activity(now);return false;}
  return uint32_t(now-lastActivity)>=60000;
 }
};
