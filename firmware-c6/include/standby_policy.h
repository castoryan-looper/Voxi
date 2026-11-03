#pragma once
#include <stdint.h>
struct StandbyPolicy {
 uint32_t lastActivity=0;
 void activity(uint32_t now){lastActivity=now;}
 bool due(uint32_t now,bool busy,bool input,bool provisioning){
  if(busy||input||provisioning){activity(now);return false;}
  return uint32_t(now-lastActivity)>=60000;
 }
};
