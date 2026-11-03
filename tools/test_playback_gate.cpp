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
 // S3 PSRAM profile absorbs the observed 3.05-second delivery gap.
 PlaybackGate s3(4*48000,8*48000,48000,true);
 assert(!s3.canWrite(4*48000-1,false));assert(s3.canWrite(4*48000,false));
 queued=4*48000;
 for(int i=0;i<305;i++){assert(s3.canWrite(queued,false));queued-=480;}
 assert(queued>0&&s3.rebuffers==0);
 assert(!s3.canWrite(0,false));assert(s3.targetBytes==5*48000);
 s3.reset();assert(s3.targetBytes==5*48000&&s3.rebuffers==0);
 for(int i=0;i<8;i++){assert(s3.canWrite(s3.targetBytes,false));assert(!s3.canWrite(0,false));}
 assert(s3.targetBytes==8*48000);s3.reset();assert(s3.canWrite(480,true));
 // Cellular reserve covers nearby pauses, not just one isolated 3-second gap.
 PlaybackGate cell(6*24000,12*24000,2*24000,true);
 queued=6*24000;
 for(int i=0;i<557;i++){assert(cell.canWrite(queued,false));queued-=240;}
 assert(queued>0&&cell.rebuffers==0);
 assert(!cell.canWrite(0,false));assert(cell.targetBytes==8*24000);
 cell.reset();assert(cell.targetBytes==8*24000);assert(cell.canWrite(240,true));
}
