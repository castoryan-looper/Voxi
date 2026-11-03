#include "../firmware-c6/include/ptt_hold.h"
#include <cassert>
int main(){
 PttHold p;using E=PttHold;
 assert(p.update(0,true,true)==E::None);
 assert(p.update(499,true,true)==E::None);
 assert(p.update(499,false,true)==E::None);
 assert(p.update(1000,true,true)==E::None);
 assert(p.update(1500,true,true)==E::Start);
 assert(p.update(1550,true,true)==E::None);
 assert(p.update(1600,false,true)==E::Stop);
 assert(p.update(1601,false,true)==E::None);
 // Lost readiness / PWR chord cannot start later during the same hold.
 p.update(2000,true,false);assert(p.update(2600,true,true)==E::None);p.update(2601,false,true);
 p.update(3000,true,true);assert(p.update(3500,true,true,true)==E::None);assert(p.update(3600,true,true)==E::None);p.update(3601,false,true);
 p.update(4000,true,true);assert(p.update(4500,true,true)==E::Start);
 assert(p.update(24499,true,true)==E::None);
 assert(p.update(24500,true,true)==E::Stop);assert(p.update(34000,true,true)==E::None);p.update(34001,false,true);
 // millis wraparound.
 p.update(0xffffff00u,true,true);assert(p.update(244,true,true)==E::Start);assert(p.update(245,false,true)==E::Stop);
}
