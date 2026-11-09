#include "../firmware-c6/include/upload_recovery.h"
#include <cassert>
int main(){
 UploadRecovery r;
 assert(!r.request(10,false,false,false));
 assert(!r.request(10,true,true,false)); // Never replay an attempted AI submission.
 assert(!r.request(10,true,false,true)); // Transport probes must report failures.
 assert(r.request(10,true,false,false));
 assert(r.request(20,false,false,false));assert(r.started==10); // Duplicate disconnect.
 assert(!r.expired(90010));assert(r.expired(90011));
 r.begin();assert(!r.pending&&r.attempts==1);
 assert(!r.request(30,true,false,false)); // One recovery per physical hold.
 r.reset();assert(r.request(0xffffff00u,true,false,false));
 assert(!r.expired(44));assert(r.expired(100000));
 r.reset();r.waitForChannel(100);
 assert(r.pending&&r.initialChannelWait&&!r.expired(90100));
 assert(r.request(150,false,false,false)&&r.started==100);
 r.begin();assert(!r.pending&&!r.initialChannelWait&&r.attempts==0);
 assert(r.request(200,true,false,false));
 r.begin();assert(r.attempts==1);
}
