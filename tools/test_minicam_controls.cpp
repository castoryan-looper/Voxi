#include "../firmware-c6/include/minicam_controls.h"
#include "../firmware-c6/include/ptt_hold.h"
#include <cassert>
int main(){
 assert(MiniCamControls::volumeKey(0)==-1);assert(MiniCamControls::volumeKey(700)==-1);assert(MiniCamControls::volumeKey(701)==0);assert(MiniCamControls::volumeKey(899)==0);assert(MiniCamControls::volumeKey(900)==1);assert(MiniCamControls::volumeKey(3000)==1);assert(MiniCamControls::volumeKey(3001)==0);
 MiniCamControls c;
 c.sample(0,100,false);c.sample(20,100,false);assert(!c.sample(40,100,false).volumeDelta);
 c.sample(100,3200,false);c.sample(120,3200,false);assert(c.sample(140,3200,false).volumeDelta==-10);assert(!c.sample(160,3200,false).volumeDelta);
 c.sample(200,1000,false);c.sample(220,1000,false);c.sample(240,1000,false);
 assert(!c.sample(939,1000,false).channelDelta);assert(c.sample(940,1000,false).channelDelta==1);assert(!c.sample(960,1000,false).channelDelta);
 c.sample(1000,3200,false);c.sample(1020,3200,false);assert(!c.sample(1040,3200,false).volumeDelta);
 c.sample(1100,3200,true);c.sample(1120,3200,false);assert(!c.sample(1160,3200,false).talkChanged);assert(!c.pressed()); // bounce
 PttHold talk;
 c.sample(1200,3200,true);assert(c.sample(1240,3200,true).talkChanged);assert(c.pressed());
 assert(talk.update(1240,c.pressed(),true)==PttHold::None);
 assert(talk.update(1539,c.pressed(),true)==PttHold::None);
 assert(talk.update(1540,c.pressed(),true)==PttHold::Start);
 assert(talk.update(1800,c.pressed(),true)==PttHold::None); // no second click required
 c.sample(2000,3200,false);assert(c.pressed()); // release debounce
 assert(c.sample(2040,3200,false).talkChanged);assert(!c.pressed());
 assert(talk.update(2040,c.pressed(),true)==PttHold::Stop);
 assert(talk.update(2060,c.pressed(),true)==PttHold::None); // exactly one submission
 c.sample(2200,3200,true);c.sample(2240,3200,true);
 assert(talk.update(2240,c.pressed(),true)==PttHold::None);
 c.sample(2300,3200,false);c.sample(2340,3200,false);
 assert(talk.update(2340,c.pressed(),true)==PttHold::None); // short tap never records
 assert(talk.update(3000,true,false)==PttHold::None);
 assert(talk.update(3400,true,true)==PttHold::None); // READY while held must not start
 talk.update(3500,false,true);talk.update(3600,true,true);
 assert(talk.update(3900,true,true)==PttHold::Start);
 assert(talk.update(3900+RECORDING_MAX_MS,true,true)==PttHold::Stop);
 assert(talk.update(4000+RECORDING_MAX_MS,true,true)==PttHold::None); // one recording per hold
}
