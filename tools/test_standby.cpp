#include "../firmware-c6/include/standby_policy.h"
#include <assert.h>
int main(){
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
