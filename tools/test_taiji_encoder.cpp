#include "../firmware-c6/include/directional_pulse_encoder.h"
#include <cassert>
int main(){
 pocket::DirectionalPulseEncoder e;e.begin(3);
 // A and B are independent pulses; ordinary quadrature decoding loses steps.
 e.edge(2,100);e.edge(3,200);assert(e.take(200)==-1);
 e.edge(1,9000);e.edge(3,9200);assert(e.take(9200)==1);
 e.edge(2,18000);e.edge(3,18020);assert(e.take(18020)==0); // reject 20us noise
 e.edge(2,19000);e.edge(3,19200);assert(e.take(19200)==-1);
 e.edge(2,20000);e.edge(3,20200);assert(e.take(20200)==0); // reject bounce
 e.begin(3);e.edge(2,0xfffffff0u);e.edge(3,100);assert(e.take(100)==-1);
 for(unsigned i=0;i<50;i++){e.edge(1,10000+i*10000);e.edge(3,10200+i*10000);}
 assert(e.take(600000)==32);assert(e.take(600001)==0);
}
