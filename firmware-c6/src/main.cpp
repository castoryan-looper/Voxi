#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "board_audio.h"
#include "config.h"

// Waveshare C6: onboard ES8311, one full-duplex I2S port, Arduino 3.x.
WebSocketsClient ws;
constexpr size_t CAP=48000; // one second; fail closed instead of growing latency
uint8_t playback[CAP]; size_t head=0,tail=0,used=0;
bool ready=false,tx=false,ending=false,playing=false;
uint32_t played=0,lastReport=0,lastWifi=0,pressAt=0;
int channel=0; bool stable=false,candidate=false;uint32_t changedAt=0;
int encPrev=0,encSteps=0,pendingChannel=0;uint32_t encAt=0;

void control(const char* type){JsonDocument d;d["type"]=type;String s;serializeJson(d,s);ws.sendTXT(s);}
void flushAudio(){head=tail=used=0;ending=playing=false;played=0;audioFlush();}
void fault(){ready=tx=false;flushAudio();ws.disconnect();Serial.println("Link reset");}
void onWs(WStype_t t,uint8_t* data,size_t len){
  if(t==WStype_DISCONNECTED){ready=tx=false;flushAudio();displayChannel(channel,false);return;}
  if(t==WStype_CONNECTED){ready=false;return;}
  if(t==WStype_BIN){
    if(tx)return;
    if(len%2||len>CAP-used){Serial.println("Audio overflow");fault();return;}
    for(size_t i=0;i<len;i++){playback[head]=data[i];head=(head+1)%CAP;}used+=len;return;
  }
  if(t!=WStype_TEXT)return;
  JsonDocument d;if(deserializeJson(d,data,len))return;
  String type=d["type"]|"";
  if(type=="ready"){
    int actual=d["channel"]|0;
    if(actual!=channel){JsonDocument c;c["type"]="channel";c["channel"]=channel;String s;serializeJson(c,s);ws.sendTXT(s);}
    else{ready=true;displayChannel(channel,true);Serial.printf("Channel %d ready\n",channel+1);}
  }
  if(type=="connecting"||type=="offline"||type=="error"){ready=tx=false;flushAudio();Serial.write(data,len);Serial.println();if(type!="connecting")ws.disconnect();}
  if(type=="flush")flushAudio();
  if(type=="audio_start"){played=0;ending=false;playing=true;}
  if(type=="audio_end")ending=true;
}
void button(){
  bool down=digitalRead(PIN_PTT)==LOW;
  if(down!=candidate){candidate=down;changedAt=millis();}
  if(candidate!=stable&&millis()-changedAt>=15){
    stable=candidate;
    if(stable&&ready){
      flushAudio();control("ptt_down");tx=true;pressAt=millis();
      // Discard microphone backlog collected while receiving.
      int16_t discard[240];for(int i=0;i<5;i++)audioRead(discard,240);
    }else if(!stable&&tx){tx=false;control("ptt_up");}
  }
  if(tx&&millis()-pressAt>29000){tx=false;control("ptt_up");}
}
void encoder(){
  static const int8_t table[]={0,-1,1,0,1,0,0,-1,-1,0,0,1,0,1,-1,0};
  int now=(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B);
  if(now!=encPrev){encSteps+=table[(encPrev<<2)|now];encPrev=now;
    if(abs(encSteps)>=4){pendingChannel=(pendingChannel+(encSteps>0?1:3))%4;encSteps=0;encAt=millis();}}
  // Coalesce rapid rotation, and defer switching until PTT is released.
  if(!stable&&pendingChannel!=channel&&millis()-encAt>180){
    tx=false;ready=false;flushAudio();channel=pendingChannel;displayChannel(channel,false);
    JsonDocument d;d["type"]="channel";d["channel"]=channel;String s;serializeJson(d,s);ws.sendTXT(s);
  }
}
void audioTick(){
  int16_t mic[240];size_t samples=audioRead(mic,240);
  if(tx&&samples)ws.sendBIN((uint8_t*)mic,samples*2);
  // Prebuffer 40 ms; board layer handles ES8311 stereo slots.
  if(!tx&&playing&&(used>=1920||ending)){
    size_t count=min(used/2,(size_t)240);int16_t mono[240];
    for(size_t i=0;i<count;i++){uint8_t lo=playback[(tail+2*i)%CAP],hi=playback[(tail+2*i+1)%CAP];mono[i]=(int16_t)(lo|(hi<<8));}
    size_t written=count?audioWrite(mono,count):0;
    size_t consumed=written*2;tail=(tail+consumed)%CAP;used-=consumed;played+=consumed/2;
    if(ending&&used==0){playing=false;ending=false;}
  }
  if(millis()-lastReport>100){lastReport=millis();JsonDocument d;d["type"]="played";
    // Approximate DAC position: subtract maximum queued DMA (40 ms).
    d["ms"]=played>960?(played-960)/24:0;String s;serializeJson(d,s);if(ready)ws.sendTXT(s);}
}
void setup(){
  Serial.begin(115200);pinMode(PIN_PTT,INPUT_PULLUP);pinMode(PIN_ENC_A,INPUT_PULLUP);pinMode(PIN_ENC_B,INPUT_PULLUP);
  encPrev=(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B);
  boardInit();displayChannel(channel,false);WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);WiFi.setSleep(false);
#if GATEWAY_TLS
  // SNTP completes asynchronously. loop() waits before attempting TLS.
  configTime(0,0,"ntp.tencent.com","pool.ntp.org");
  ws.beginSslWithCA(GATEWAY_HOST,GATEWAY_PORT,"/radio",GATEWAY_ROOT_CA);
#else
  ws.begin(GATEWAY_HOST,GATEWAY_PORT,"/radio");
#endif
  ws.setExtraHeaders("Authorization: Bearer " DEVICE_TOKEN);ws.onEvent(onWs);ws.setReconnectInterval(1500);ws.enableHeartbeat(15000,3000,2);
}
void loop(){
  if(WiFi.status()==WL_CONNECTED){
#if GATEWAY_TLS
    if(time(nullptr)>1700000000)ws.loop();
#else
    ws.loop();
#endif
  }
  else{if(ready||tx||playing||used)flushAudio();ready=tx=false;if(millis()-lastWifi>5000){lastWifi=millis();WiFi.reconnect();}}
  button();encoder();audioTick();delay(1);
}
