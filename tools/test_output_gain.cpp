#include "../firmware-c6/include/output_gain.h"
#include <cassert>
int main(){
 int previous=-15501;
 for(int n=-32768;n<=32767;n++){
   int out=speakerSample((int16_t)n,100);
   assert(out>=-15500&&out<=15500);assert(out>=previous);previous=out;
   assert(speakerSample((int16_t)n,0)==0);
   assert(speakerSample((int16_t)n,75)==out*75/100);
 }
 assert(speakerSample(1000,100)==8000);
 assert(speakerSample(32767,100)>15000);
 for(int n=0;n<=32767;n++)assert(speakerSample((int16_t)n,100)==-speakerSample((int16_t)-n,100));
}
