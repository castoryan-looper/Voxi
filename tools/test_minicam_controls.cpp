#include "../firmware-c6/include/minicam_controls.h"
#include <cassert>
int main(){
 assert(MiniCamControls::volumeKey(0)==-1);assert(MiniCamControls::volumeKey(700)==-1);assert(MiniCamControls::volumeKey(701)==0);assert(MiniCamControls::volumeKey(899)==0);assert(MiniCamControls::volumeKey(900)==1);assert(MiniCamControls::volumeKey(3000)==1);assert(MiniCamControls::volumeKey(3001)==0);
 MiniCamControls c;
 c.sample(0,100,false);c.sample(20,100,false);assert(!c.sample(40,100,false).volumeDelta);
 c.sample(100,3200,false);c.sample(120,3200,false);assert(c.sample(140,3200,false).volumeDelta==-10);assert(!c.sample(160,3200,false).volumeDelta);
 c.sample(200,1000,false);c.sample(220,1000,false);c.sample(240,1000,false);
 assert(!c.sample(939,1000,false).channelDelta);assert(c.sample(940,1000,false).channelDelta==1);assert(!c.sample(960,1000,false).channelDelta);
 c.sample(1000,3200,false);c.sample(1020,3200,false);assert(!c.sample(1040,3200,false).volumeDelta);
 c.sample(1100,3200,true);c.sample(1120,3200,false);assert(!c.sample(1160,3200,false).toggleTalk); // bounce
 c.sample(1200,3200,true);c.sample(1240,3200,true);c.sample(1800,3200,false);assert(c.sample(1840,3200,false).toggleTalk); // normal 600ms press
 assert(!c.sample(1860,3200,false).toggleTalk);
 c.sample(2000,3200,true);c.sample(2040,3200,true);c.sample(4000,3200,false);assert(!c.sample(4040,3200,false).toggleTalk); // power hold
 MiniCamTalkLatch talk;talk.click(0,true);assert(talk.pressed());talk.observe(200,false,true);assert(talk.pressed());
 talk.observe(320,true,false);assert(talk.pressed()); // OPEN MIC cue does not cancel recording
 talk.observe(1000,true,false);assert(talk.pressed());talk.click(1100,false);assert(!talk.pressed()); // click sends
 talk.click(1200,false);assert(!talk.pressed()); // offline / busy
 talk.click(2000,true);talk.observe(2350,true,false);talk.observe(3000,false,true);assert(!talk.pressed()); // recording ends
 talk.click(4000,true);talk.observe(5600,false,true);assert(!talk.pressed()); // cache start failure
}
