#include "../firmware-c6/include/playback_gate.h"
#include <cassert>
int main(){
 PlaybackGate gate;
 assert(!gate.canWrite(0,false));assert(!gate.canWrite(23999,false));
 assert(gate.canWrite(24000,false));
 // The watermark applies only at startup, not to each following packet.
 assert(gate.canWrite(480,false));assert(gate.canWrite(2,false));
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(gate.targetBytes==31200);assert(!gate.canWrite(24000,false));assert(gate.canWrite(31200,false));
 assert(!gate.canWrite(0,false));assert(gate.targetBytes==38400);assert(gate.canWrite(38400,false));
 assert(!gate.canWrite(0,false));assert(gate.targetBytes==38400);
 gate.reset();assert(gate.rebuffers==0);
 // Short final replies and tails must drain without reaching 500ms.
 assert(gate.canWrite(480,true));assert(!gate.canWrite(0,true));assert(gate.rebuffers==0);
}
