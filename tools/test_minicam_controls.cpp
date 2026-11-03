#include "../firmware-c6/include/minicam_controls.h"
#include <cassert>
int main(){
 assert(MiniCamControls::volumeKey(0)==-1);assert(MiniCamControls::volumeKey(700)==-1);assert(MiniCamControls::volumeKey(701)==0);assert(MiniCamControls::volumeKey(899)==0);assert(MiniCamControls::volumeKey(900)==1);assert(MiniCamControls::volumeKey(3000)==1);assert(MiniCamControls::volumeKey(3001)==0);
 MiniCamControls c;assert(!c.sample(0,100,false).volumeDelta);assert(!c.sample(20,100,false).volumeDelta);assert(c.sample(40,100,false).volumeDelta==-10);assert(!c.sample(60,100,false).volumeDelta);
 c.sample(100,3200,true);c.sample(120,3200,false);assert(!c.sample(160,3200,false).nextChannel); // bounce
 c.sample(200,3200,true);c.sample(240,3200,true);c.sample(300,3200,false);assert(!c.sample(340,3200,false).nextChannel);
 c.sample(400,3200,true);c.sample(440,3200,true);c.sample(500,3200,false);assert(c.sample(540,3200,false).nextChannel);
 c.sample(600,3200,true);c.sample(640,3200,true);c.sample(1600,3200,false);assert(!c.sample(1640,3200,false).nextChannel); // recording hold
 c.sample(1700,3200,true);c.sample(1740,3200,true);c.sample(1800,3200,false);assert(!c.sample(1840,3200,false).nextChannel);assert(c.sample(2300,3200,false).toggleTalk);assert(!c.sample(2320,3200,false).toggleTalk);
}
