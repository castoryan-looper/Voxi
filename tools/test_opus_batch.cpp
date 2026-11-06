#include "../firmware-c6/include/opus_reply.h"
#include <assert.h>
int main(){
 OpusReplySpan frames[3];
 const uint8_t packet[]={0,0,0,0,42};
 assert(opusReplyPackets(packet,sizeof(packet),false,frames)==1);
 assert(opusReplyHeader(frames[0].data,frames[0].bytes,0));
 const uint8_t batch[]={3,5,0,0,0,0,0,42,5,0,1,0,0,0,43,5,0,2,0,0,0,44};
 assert(opusReplyPackets(batch,sizeof(batch),true,frames)==3);
 for(unsigned i=0;i<3;i++)assert(opusReplyHeader(frames[i].data,frames[i].bytes,i));
 // Every possible truncation must fail without handing partial audio to decode.
 for(size_t n=0;n<sizeof(batch);n++)assert(!opusReplyPackets(batch,n,true,frames));
 uint8_t broken[sizeof(batch)+1];
 for(size_t i=0;i<sizeof(batch);i++)broken[i]=batch[i];
 broken[sizeof(batch)]=0;assert(!opusReplyPackets(broken,sizeof(broken),true,frames));
 broken[0]=4;assert(!opusReplyPackets(broken,sizeof(batch),true,frames));
 broken[0]=0;assert(!opusReplyPackets(broken,sizeof(batch),true,frames));
 broken[0]=3;broken[1]=255;broken[2]=255;assert(!opusReplyPackets(broken,sizeof(batch),true,frames));
 const uint8_t one[]={1,5,0,0,0,0,0,42};assert(opusReplyPackets(one,sizeof(one),true,frames)==1);
 assert(!opusReplyPackets(nullptr,10,true,frames));
}
