#include "../firmware-c6/include/minicam_controls.h"
#include "../firmware-c6/include/ptt_hold.h"
#include <cassert>
int main(){
 assert(MiniCamControls::volumeKey(0)==-1);assert(MiniCamControls::volumeKey(700)==-1);assert(MiniCamControls::volumeKey(701)==0);assert(MiniCamControls::volumeKey(899)==0);assert(MiniCamControls::volumeKey(900)==1);assert(MiniCamControls::volumeKey(3000)==1);assert(MiniCamControls::volumeKey(3001)==0);
 MiniCamControls c;
 c.sample(0,100,false);c.sample(20,100,false);assert(!c.sample(40,100,false).volumeDelta);
 c.sample(100,3200,false);c.sample(120,3200,false);assert(c.sample(140,3200,false).volumeDelta==-10);assert(!c.sample(160,3200,false).volumeDelta);
 c.sample(200,100,false);c.sample(220,100,false);c.sample(240,100,false);
 assert(!c.sample(939,100,false).channelDelta);assert(c.sample(940,100,false).channelDelta==-1);assert(!c.sample(960,100,false).channelDelta);
 c.sample(1000,3200,false);c.sample(1020,3200,false);assert(!c.sample(1040,3200,false).volumeDelta);
 c.sample(1100,3200,true);c.sample(1120,3200,false);assert(!c.sample(1160,3200,false).talkChanged);assert(!c.pressed()); // bounce
 assert(!c.pttPressed()); // hardware power key must never be PTT
 c.sample(1200,3200,true);assert(c.sample(1240,3200,true).talkChanged);assert(c.pressed());
 assert(!c.pttPressed());c.sample(5000,3200,true);assert(!c.pttPressed());
 c.sample(5100,3200,false);c.sample(5140,3200,false);
 PttHold talk;
 c.sample(5200,1000,false);c.sample(5220,1000,false);c.sample(5240,1000,false);
 assert(c.pttPressed());assert(talk.update(5240,c.pttPressed(),true)==PttHold::None);
 c.sample(5540,1000,false);assert(talk.update(5540,c.pttPressed(),true)==PttHold::Start);
 assert(!c.sample(9000,1000,false).channelDelta); // long PTT must not switch channel
 assert(talk.update(9000,c.pttPressed(),true)==PttHold::None);
 c.sample(9100,3200,false);c.sample(9120,3200,false);
 assert(!c.sample(9140,3200,false).volumeDelta); // held PTT must not change volume
 assert(!c.pttPressed());assert(talk.update(9140,c.pttPressed(),true)==PttHold::Stop);
 assert(talk.update(9160,c.pttPressed(),true)==PttHold::None);
 c.sample(10000,1000,false);c.sample(10020,1000,false);c.sample(10040,1000,false);
 talk.update(10040,c.pttPressed(),true);
 c.sample(10100,3200,false);c.sample(10120,3200,false);
 assert(c.sample(10140,3200,false).volumeDelta==10); // short + tap changes volume
 assert(talk.update(10140,c.pttPressed(),true)==PttHold::None);
 assert(talk.update(11000,true,false)==PttHold::None);
 assert(talk.update(11400,true,true)==PttHold::None);
 talk.update(11500,false,true);talk.update(11600,true,true);
 assert(talk.update(11900,true,true)==PttHold::Start);
 assert(talk.update(11900+RECORDING_MAX_MS,true,true)==PttHold::Stop);
 assert(talk.update(12000+RECORDING_MAX_MS,true,true)==PttHold::None);
}
