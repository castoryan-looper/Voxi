#include "../firmware-c6/include/radio_squelch.h"
#include <cassert>
#include <cstdlib>
int main(){
  assert(RadioSquelch::sample(0,123)==0);
  assert(RadioSquelch::sample(RadioSquelch::samples-1,123)==0);
  assert(RadioSquelch::sample(RadioSquelch::samples,123)==0);
  long energy=0;bool different=false;
  for(size_t i=0;i<RadioSquelch::samples;i++){
    int a=RadioSquelch::sample(i,123);
    assert(std::abs(a)<=1024);energy+=std::abs(a);
    assert(a==RadioSquelch::sample(i,123));
    different|=a!=RadioSquelch::sample(i,456);
  }
  assert(energy>100000);assert(different);
}
