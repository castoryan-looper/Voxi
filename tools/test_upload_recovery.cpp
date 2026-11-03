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
}
