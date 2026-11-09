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
 // Recovery of a cellular underrun needs only 2s, not another 8--12s
 // startup reserve. Retain the larger reserve for the next turn.
 PlaybackGate fastRecovery(6*24000,12*24000,2*24000,true);
 fastRecovery.resumeBytes=2*24000;
 assert(!fastRecovery.canWrite(2*24000,false));
 assert(fastRecovery.canWrite(6*24000,false));
 assert(!fastRecovery.canWrite(0,false));assert(fastRecovery.rebuffers==1);
 assert(fastRecovery.targetBytes==8*24000&&fastRecovery.threshold()==2*24000);
 assert(!fastRecovery.canWrite(2*24000-1,false));
 assert(fastRecovery.canWrite(2*24000,false));
 assert(fastRecovery.canWrite(240,false)); // do not gate each following frame
 assert(!fastRecovery.canWrite(0,false));assert(fastRecovery.rebuffers==2);
 assert(fastRecovery.canWrite(240,true)); // ended short tail still drains
 fastRecovery.reset();assert(fastRecovery.threshold()==10*24000);
 assert(!fastRecovery.canWrite(2*24000,false));
 assert(fastRecovery.canWrite(10*24000,false));
 // MiniCam adaptive recovery: 2s, 3s, 4s cap; final tail never waits.
 PlaybackGate adaptive(2*48000,6*48000,48000,true);
 adaptive.resumeBytes=2*48000;adaptive.recoveryStepBytes=48000;adaptive.recoveryMaxBytes=4*48000;
 assert(adaptive.canWrite(2*48000,false));
 for(int i=1;i<=6;i++){
   assert(!adaptive.canWrite(0,false));assert(adaptive.rebuffers==(unsigned)i);
   size_t threshold=(i==1?2:i==2?3:4)*48000;
   assert(adaptive.threshold()==threshold);assert(!adaptive.canWrite(threshold-1,false));
   assert(adaptive.canWrite(threshold,false));
 }
 adaptive.reset();assert(adaptive.canWrite(480,true));assert(adaptive.rebuffers==0);
 PlaybackGate shortGap(960,1920,480);
 assert(shortGap.canWrite(960,false));
 assert(!shortGap.canWrite(0,false,true));
 assert(shortGap.primed&&shortGap.rebuffers==0);
 assert(shortGap.canWrite(480,false,true)); // nearby packet, no re-prime
 assert(!shortGap.canWrite(0,false));
 assert(!shortGap.primed&&shortGap.rebuffers==1);
}
