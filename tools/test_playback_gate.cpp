#include "../firmware-c6/include/playback_gate.h"
#include <assert.h>
int main(){
 PlaybackGate gate;
 assert(!gate.canWrite(0,false));assert(!gate.canWrite(67199,false));
 assert(gate.canWrite(67200,false));
 // The watermark applies only at startup, not to each following packet.
 assert(gate.canWrite(480,false));assert(gate.canWrite(2,false));
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(!gate.canWrite(0,false));assert(gate.rebuffers==1);
 assert(gate.targetBytes==74400);assert(!gate.canWrite(67200,false));assert(gate.canWrite(74400,false));
 assert(!gate.canWrite(0,false));assert(gate.targetBytes==81600);assert(gate.canWrite(81600,false));
 assert(!gate.canWrite(0,false));assert(gate.targetBytes==81600);
 gate.reset();assert(gate.rebuffers==0);
 // Reproduce a 1.28s delivery gap after priming. All 128 x 10ms
 // writes still have queued PCM; the old 500/800ms gate ran dry.
 size_t queued=gate.targetBytes;
 for(int frame=0;frame<128;frame++){
   assert(gate.canWrite(queued,false));queued-=480;
 }
 assert(queued>0);assert(gate.rebuffers==0);
 gate.reset();
 // Short final replies and tails must drain without reaching 1400ms.
 assert(gate.canWrite(480,true));assert(!gate.canWrite(0,true));assert(gate.rebuffers==0);
}
