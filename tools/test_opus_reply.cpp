#include "../firmware-c6/include/opus_reply.h"
#include <cassert>
int main(){
 uint8_t packet[1280]={};
 assert(!opusReplyHeader(packet,4,0));assert(!opusReplyHeader(packet,1280,0));
 assert(opusReplyHeader(packet,64,0));assert(!opusReplyHeader(packet,64,1));
 packet[0]=0x78;packet[1]=0x56;packet[2]=0x34;packet[3]=0x12;
 assert(opusReplyHeader(packet,64,0x12345678));assert(!opusReplyHeader(packet,64,0));
 assert(OPUS_REPLY_SAMPLES==480);
}
