#include "../firmware-c6/include/ptt_hold.h"
#include <cassert>
int main(){
 PttHold p;using E=PttHold;
 assert(p.update(0,true,true)==E::None);
 assert(p.update(299,true,true)==E::None);
 assert(p.update(299,false,true)==E::None);
 assert(p.update(1000,true,true)==E::None);
 assert(p.update(1300,true,true)==E::Start);
 assert(p.update(1550,true,true)==E::None);
 assert(p.update(1600,false,true)==E::Stop);
 assert(p.update(1601,false,true)==E::None);
 // Lost readiness / PWR chord cannot start later during the same hold.
 p.update(2000,true,false);assert(p.update(2600,true,true)==E::None);p.update(2601,false,true);
 p.update(3000,true,true);assert(p.update(3500,true,true,true)==E::None);assert(p.update(3600,true,true)==E::None);p.update(3601,false,true);
 p.update(4000,true,true);assert(p.update(4300,true,true)==E::Start);
 assert(p.update(24299,true,true)==E::None);
 assert(p.update(24300,true,true)==E::Stop);assert(p.update(34000,true,true)==E::None);p.update(34001,false,true);
 // millis wraparound.
 p.update(0xffffff00u,true,true);assert(p.update(44,true,true)==E::Start);assert(p.update(45,false,true)==E::Stop);
}
