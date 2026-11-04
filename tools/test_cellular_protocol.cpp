#include "../firmware-c6/include/cellular_protocol.h"
#include <cassert>
int main(){
 std::string_view a[8];assert(cellularCsv(" \"rtcp\",0,3,\"000aFF\"",a,8)==4);assert(a[0]=="rtcp"&&a[3]=="000aFF");assert(!cellularCsv("\"unterminated",a,8));assert(!cellularCsv("1,2,3",a,2));
 assert(cellularHexDigit('F')==15&&cellularHexDigit('g')==-1);assert(cellularInteger("42")==42&&cellularInteger("4x")==-1);
 assert(cellularClock(" \"26/11/04,08:00:00+32\"\r\n")==1793750400);assert(cellularClock("\"26/11/04,00:00:00+00\"")==1793750400);
 assert(!cellularClock("\"26/02/30,00:00:00+00\""));assert(!cellularClock("\"00/01/01,00:00:00+00\""));
 bool quoted[8];assert(cellularCsv("1,\"0123\",\"ABCD\",7",a,8,quoted)==4);assert(quoted[1]);assert(cellularCsv("2,1,\"0123\",\"ABCD\",7",a,8,quoted)==5);assert(!quoted[1]);
 CellularFrame f;uint8_t normal[]={0x82,3,0,1,2};assert(cellularFrameHeader(normal,1,f)==0);assert(cellularFrameHeader(normal,5,f)==1&&f.length==3&&f.opcode==2&&f.final);
 uint8_t masked[]={0x82,0x83};assert(cellularFrameHeader(masked,2,f)==-1);
 uint8_t large[]={0x82,126,8,1};assert(cellularFrameHeader(large,4,f)==-1);large[3]=0;assert(cellularFrameHeader(large,3,f)==0);assert(cellularFrameHeader(large,4,f)==1&&f.length==2048);
 uint8_t control[]={0x09,1};assert(cellularFrameHeader(control,2,f)==-1);control[0]=0x89;assert(cellularFrameHeader(control,2,f)==1);
 uint8_t reserved[]={0xc2,0};assert(cellularFrameHeader(reserved,2,f)==-1);
 CellularHeartbeat h;h.configure(15000,3000,2,0);assert(h.timeout==15000);assert(h.tick(14999)==CellularHeartbeat::None);assert(h.tick(15000)==CellularHeartbeat::Ping);
 h.received(18154);assert(h.tick(20000)==CellularHeartbeat::None); // delayed voice instead of Pong keeps the peer alive
 h.reset(0);
 for(uint32_t now=1000;now<=120000;now+=1000){h.received(now);assert(h.tick(now)==(now%15000==0?CellularHeartbeat::Ping:CellularHeartbeat::None));}
 h.configure(15000,3000,2,0);assert(h.tick(15000)==CellularHeartbeat::Ping);assert(h.tick(29999)==CellularHeartbeat::None);assert(h.tick(30000)==CellularHeartbeat::Ping);assert(h.tick(45000)==CellularHeartbeat::Dead);
  h.configure(15000,3000,2,0);
  // Wi-Fi uses this same policy: valid speech/control frames prove liveness,
  // even when a Pong is delayed behind TCP retransmissions for over 3 seconds.
  for(uint32_t now=0;now<=120000;now+=1000){if(now%9000==0)h.received(now);assert(h.tick(now)!=CellularHeartbeat::Dead);}
  h.reset(0);assert(h.tick(15000)==CellularHeartbeat::Ping);assert(h.tick(30000)==CellularHeartbeat::Ping);assert(h.tick(45000)==CellularHeartbeat::Dead);
  h.configure(0,3000,2,0);assert(h.tick(100000)==CellularHeartbeat::None);
}

