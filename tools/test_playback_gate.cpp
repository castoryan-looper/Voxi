#include "../firmware-c6/include/playback_gate.h"
#include <cassert>
int main(){
 PlaybackGate gate;
 assert(!gate.canWrite(0,false));assert(!gate.canWrite(5759,false));
 assert(gate.canWrite(5760,false));
 // The watermark applies only at startup, not to each following packet.
 assert(gate.canWrite(480,false));assert(gate.canWrite(2,false));
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(!gate.canWrite(960,false));assert(gate.canWrite(5760,false));
 gate.reset();assert(gate.rebuffers==0);
 // Short final replies and tails must drain without reaching 120ms.
 assert(gate.canWrite(480,true));assert(!gate.canWrite(0,true));assert(gate.rebuffers==0);
}
