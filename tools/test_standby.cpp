#include "../firmware-c6/include/standby_policy.h"
#include <assert.h>
int main(){
 TieredStandbyPolicy tiers;assert(tiers.valid());
 assert(tiers.stage(59999)==0);assert(tiers.stage(60000)==1);
 assert(tiers.stage(299999)==1);assert(tiers.stage(300000)==2);
 assert(tiers.stage(899999)==2);assert(tiers.stage(900000)==3);
 tiers.linkMinutes=1;assert(!tiers.valid());tiers.linkMinutes=5;tiers.sleepMinutes=1441;assert(!tiers.valid());
 tiers.screenMinutes=0;assert(!tiers.valid());
 StandbyPolicy policy;policy.activity(100);
 assert(!policy.due(60099,false,false,false));assert(policy.due(60100,false,false,false));
 assert(!policy.due(70000,true,false,false));assert(!policy.due(129999,false,false,false));
 assert(!policy.due(130000,false,true,false));assert(!policy.due(190000,false,false,true));
 assert(!policy.due(249999,false,false,false));assert(policy.due(250000,false,false,false));
 // Busy speech continuously postpones idle sleep, regardless of reply length.
 for(uint32_t t=300000;t<600000;t+=1000)assert(!policy.due(t,true,false,false));
 assert(!policy.due(658999,false,false,false));assert(policy.due(659000,false,false,false));
 policy.activity(0xfffffff0u);assert(!policy.due(0x20u,false,false,false));
 assert(policy.due(uint32_t(0xfffffff0u+60000u),false,false,false));
}
