#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string_view>
#include <stdio.h>
inline int cellularHexDigit(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
inline size_t cellularCsv(std::string_view text,std::string_view* args,size_t capacity,bool* quoted=nullptr){
 size_t count=0,start=0;bool quote=false;
 for(size_t i=0;i<=text.size();i++){
  if(i<text.size()&&text[i]=='"')quote=!quote;
  if(i==text.size()||(!quote&&text[i]==',')){
   if(count==capacity)return 0;auto v=text.substr(start,i-start);
   while(!v.empty()&&v.front()==' ')v.remove_prefix(1);
   while(!v.empty()&&(v.back()==' '||v.back()=='\r'||v.back()=='\n'))v.remove_suffix(1);
   if(quoted)quoted[count]=v.size()>=2&&v.front()=='"';
   if(v.size()>=2&&v.front()=='"'&&v.back()=='"'){v.remove_prefix(1);v.remove_suffix(1);}
   args[count++]=v;start=i+1;
  }
 }
 return quote?0:count;
}
inline int cellularInteger(std::string_view s){
 if(s.empty())return -1;int v=0;for(char c:s){if(c<'0'||c>'9'||v>10000000)return -1;v=v*10+c-'0';}return v;
}
inline int64_t cellularClock(std::string_view s){
 int y,m,d,h,mi,se,tz=0;char sign='+';std::string_view a[2];
 if(cellularCsv(s,a,2)!=1)return 0;
 char b[48];if(a[0].size()>=sizeof(b))return 0;for(size_t i=0;i<a[0].size();i++)b[i]=a[0][i];b[a[0].size()]=0;
 int n=sscanf(b,"%d/%d/%d,%d:%d:%d%c%d",&y,&m,&d,&h,&mi,&se,&sign,&tz);
 // CCLK must be a single quoted field, including its date/time comma.
 if(n!=6&&n!=8)return 0;
 if(y<100)y+=2000;if(y<2024||y>2099||m<1||m>12||d<1||d>31||h<0||h>23||mi<0||mi>59||se<0||se>59||tz<0||tz>56||(sign!='+'&&sign!='-'))return 0;
 const int lengths[]={31,28,31,30,31,30,31,31,30,31,30,31};if(d>lengths[m-1]+(m==2&&y%4==0))return 0;
 int year=y-(m<=2),era=year/400;unsigned yo=year-era*400,mo=m+(m>2?-3:9);
 int64_t days=era*146097+(yo*365+yo/4-yo/100+(153*mo+2)/5+d-1)-719468;
 return days*86400+h*3600+mi*60+se-(sign=='-'?-tz:tz)*900;
}
struct CellularFrame {size_t header=0,length=0;uint8_t opcode=0;bool final=false;};
// 0: incomplete header, 1: complete header, -1: invalid/oversized server frame.
inline int cellularFrameHeader(const uint8_t* p,size_t n,CellularFrame& f){
 if(n<2)return 0;if((p[0]&0x70)||(p[1]&0x80))return -1;
 f.final=p[0]&0x80;f.opcode=p[0]&15;f.header=2;size_t len=p[1]&127;
 if(len==126){if(n<4)return 0;len=(size_t(p[2])<<8)|p[3];f.header=4;if(len<126)return -1;}
 else if(len==127)return -1;
 if(len>2048||(f.opcode>=8&&(!f.final||len>125)))return -1;
 if(f.opcode!=0&&f.opcode!=1&&f.opcode!=2&&f.opcode!=8&&f.opcode!=9&&f.opcode!=10)return -1;
 f.length=len;return 1;
}

struct CellularHeartbeat {
 enum Action{None,Ping,Dead};
 uint32_t interval=15000,timeout=15000,lastRx=0,lastPing=0;uint8_t missed=0,limit=2;bool waiting=false,trafficResetsPing=false;
 void reset(uint32_t now){lastRx=lastPing=now;waiting=false;missed=0;}
 void configure(uint32_t i,uint32_t t,uint8_t n,uint32_t now,bool traffic=false){trafficResetsPing=traffic;interval=i;timeout=t<15000?15000:t;limit=n?n:1;reset(now);}
 void received(uint32_t now){lastRx=now;if(trafficResetsPing)lastPing=now;waiting=false;missed=0;}
 Action tick(uint32_t now){
  if(!interval)return None;
  if(waiting&&uint32_t(now-lastPing)>=timeout){if(++missed>=limit)return Dead;waiting=false;}
  // Legacy clients keep periodic probes; connected standby uses incoming Ping/Pong/traffic.
  // Keep a bidirectional probe cadence during continuous downlink too. Only
  // probing on RX silence can leave the server without any timely peer traffic.
  if(!waiting&&uint32_t(now-lastPing)>=interval){waiting=true;lastPing=now;return Ping;}
  return None;
 }
};
