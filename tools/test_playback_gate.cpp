#include "../firmware-c6/include/playback_gate.h"
#include <cassert>
int main(){
 PlaybackGate gate;
 assert(!gate.canWrite(0,false));assert(!gate.canWrite(9599,false));
 assert(gate.canWrite(9600,false));
 // The watermark applies only at startup, not to each following packet.
 assert(gate.canWrite(480,false));assert(gate.canWrite(2,false));
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(gate.targetBytes==13440);assert(!gate.canWrite(9600,false));assert(gate.canWrite(13440,false));
 assert(!gate.canWrite(0,false));assert(gate.targetBytes==17280);assert(gate.canWrite(17280,false));
 assert(!gate.canWrite(0,false));assert(gate.targetBytes==17280);
 gate.reset();assert(gate.rebuffers==0);
 // Short final replies and tails must drain without reaching 200ms.
 assert(gate.canWrite(480,true));assert(!gate.canWrite(0,true));assert(gate.rebuffers==0);
}
