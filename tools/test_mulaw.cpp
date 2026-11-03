#include "../firmware-c6/include/mulaw.h"
#include "../firmware-c6/include/playback_gate.h"
#include <assert.h>
#include <string.h>
#include "../firmware-c6/include/device_identity.h"
int main(){
 uint8_t mac[]={0x20,0x6e,0xf1,0x16,0xa3,0xd8};char id[32];formatDeviceIdentity(mac,id,sizeof(id));assert(!strcmp(id,"esp32-d8a316f16e20"));char shortId[2];formatDeviceIdentity(mac,shortId,sizeof(shortId));assert(shortId[0]==0);
 assert(decodeMulaw(255)==0);assert(decodeMulaw(127)==0);
 assert(decodeMulaw(0)==-32124);assert(decodeMulaw(128)==32124);
 assert(decodeMulaw(206)==988);assert(decodeMulaw(78)==-988);
 PlaybackGate c6;c6.configure(72000,86400,7200,true);
 // Three-second prime fits the unchanged 96000-byte C6 ring.
 assert(!c6.canWrite(71999,false));assert(c6.canWrite(72000,false));
 size_t queued=72000;for(int i=0;i<280;i++){assert(c6.canWrite(queued,false));queued-=240;}
 assert(queued==4800);assert(!c6.canWrite(0,false));assert(c6.targetBytes==79200);
 c6.reset();assert(c6.targetBytes==79200);assert(c6.canWrite(1,true));
}
