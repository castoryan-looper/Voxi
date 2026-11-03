#include "../firmware-c6/include/playback_envelope.h"
#include <cassert>
int main(){
 assert(playbackEnvelope(10000,0,120,480)==0);
 assert(playbackEnvelope(10000,120,120,480)==10000);
 assert(playbackEnvelope(10000,479,120,480)==0);
 for(int sample=-32768;sample<=32767;sample+=17){
  for(unsigned i=0;i<480;i++){
   int out=playbackEnvelope((int16_t)sample,i,120,480);
   assert(sample<0?(out>=sample&&out<=0):(out<=sample&&out>=0));
  }
 }
 // Writing two partial blocks must use the same envelope as one whole block.
 for(unsigned i=0;i<240;i++)assert(playbackEnvelope(12345,i,0,240)==playbackEnvelope(12345,240+i,120,480));
}
