#include "../firmware-c6/include/output_gain.h"
#include <cassert>
int main(){
 int previous=-31001;
 for(int n=-32768;n<=32767;n++){
   int out=speakerSample((int16_t)n,100);
   assert(out>=-31000&&out<=31000);assert(out>=previous);previous=out;
   assert(speakerSample((int16_t)n,0)==0);
   assert(speakerSample((int16_t)n,75)==out*75/100);
 }
 assert(speakerSample(1000,100)==4000);
 assert(speakerSample(32767,100)>30000);
 for(int n=0;n<=32767;n++)assert(speakerSample((int16_t)n,100)==-speakerSample((int16_t)-n,100));
}
