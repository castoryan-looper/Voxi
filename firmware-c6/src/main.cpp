#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <HWCDC.h>
#include "board_audio.h"
#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif
#include "runtime_config.h"
#include "diagnostics.h"
#include "ble_knob.h"
#include "ptt_hold.h"
#include "playback_gate.h"

// Waveshare C6: onboard ES8311, one full-duplex I2S port, Arduino 3.x.
WebSocketsClient ws;
String authorizationHeader;
constexpr size_t CAP=24000; // half a second; fail closed instead of growing latency
uint8_t playback[CAP]; size_t head=0,tail=0,used=0;
static PlaybackGate playbackGate;
void playbackDiagnostics(JsonDocument& out){out["playbackBufferedMs"]=used/48;out["playbackRebuffers"]=playbackGate.rebuffers;}
bool ready=false,tx=false,ending=false,playing=false,gatewayLinked=false,backendError=false,thinking=false;
uint32_t played=0,lastReport=0,pressAt=0;
int channel=0; bool stable=false,candidate=false;uint32_t changedAt=0;
int encPrev=0,encSteps=0,pendingChannel=0;uint32_t encAt=0;

struct Packet{WStype_t type;size_t len;uint8_t data[2048];};
struct TxPacket{WStype_t type;size_t len;uint8_t data[512];};
static QueueHandle_t incoming,outgoing;
static volatile bool resetLink=false,queueFault=false;
static void networkFault(const char* reason){diagnosticError(reason);queueFault=true;}
static bool sendText(String text){TxPacket p{};p.type=WStype_TEXT;p.len=text.length();if(p.len>sizeof(p.data))return false;memcpy(p.data,text.c_str(),p.len);if(xQueueSend(outgoing,&p,pdMS_TO_TICKS(150))!=pdTRUE){networkFault("TX control queue full");return false;}return true;}
static void sendAudio(uint8_t* bytes,size_t n){TxPacket p{};p.type=WStype_BIN;p.len=n;if(n>sizeof(p.data))return;memcpy(p.data,bytes,n);if(xQueueSend(outgoing,&p,pdMS_TO_TICKS(10))!=pdTRUE)networkFault("TX audio queue full");}
static void socketEvent(WStype_t type,uint8_t* data,size_t len){if(type!=WStype_TEXT&&type!=WStype_BIN&&type!=WStype_CONNECTED&&type!=WStype_DISCONNECTED)return;Packet p{};p.type=type;p.len=len;if(len>sizeof(p.data)){networkFault("RX frame exceeds 2048 bytes");return;}if(len)memcpy(p.data,data,len);if(xQueueSend(incoming,&p,pdMS_TO_TICKS(20))!=pdTRUE)networkFault("RX event queue full");}
static void networkTask(void*){
  if(radioConfig.tls)ws.beginSslWithCA(radioConfig.host.c_str(),radioConfig.port,"/radio",radioConfig.ca.c_str());else ws.begin(radioConfig.host.c_str(),radioConfig.port,"/radio");
  authorizationHeader="Authorization: Bearer "+radioConfig.token;ws.setExtraHeaders(authorizationHeader.c_str());ws.onEvent(socketEvent);ws.setReconnectInterval(5000);ws.enableHeartbeat(15000,3000,2);
  TxPacket p;uint32_t retryAt=0;
  while(true){if(resetLink){resetLink=false;ws.disconnect();xQueueReset(outgoing);diagnosticReconnect();retryAt=millis()+5000;}
    if(WiFi.status()==WL_CONNECTED&&(!radioConfig.tls||time(nullptr)>1700000000)&&(int32_t)(millis()-retryAt)>=0){ws.loop();while(xQueueReceive(outgoing,&p,0)==pdTRUE){if(ws.isConnected()){if(p.type==WStype_BIN){if(ws.sendBIN(p.data,p.len))radioDebugTx(p.len);else networkFault("WebSocket audio send failed");}else{bool sent=ws.sendTXT(p.data,p.len);String text((const char*)p.data,p.len);if(sent&&text.indexOf("ptt_up")>=0)radioDebug("WAIT AI","PTT UP sent to gateway");if(!sent)networkFault("WebSocket control send failed");}}}}
    else xQueueReset(outgoing);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}
void control(const char* type){JsonDocument d;d["type"]=type;String s;serializeJson(d,s);sendText(s);}
void flushAudio(){playbackGate.reset();head=tail=used=0;ending=playing=thinking=false;played=0;audioFlush();}
void fault(){radioDebug("ERROR","Audio/queue fault: reconnect");ready=tx=false;thinking=false;flushAudio();resetLink=true;Serial.println("Link reset");}
void onWs(WStype_t t,uint8_t* data,size_t len){
  if(t==WStype_DISCONNECTED){radioDebug("OFFLINE","Gateway disconnected");gatewayLinked=false;diagnosticStage(backendError?"backend_error":"disconnected");ready=tx=false;thinking=false;flushAudio();if(!setupScreenActive())displayChannel(channel,false);return;}
  if(t==WStype_CONNECTED){radioDebug("WAIT AI","Gateway connected");gatewayLinked=true;diagnosticStage("cloud_handshake");ready=false;return;}
  if(t==WStype_BIN){
    radioDebugRx(len);
    if(tx)return;
    if(len%2||len>CAP-used){Serial.println("Audio overflow");fault();return;}
    for(size_t i=0;i<len;i++){playback[head]=data[i];head=(head+1)%CAP;}used+=len;return;
  }
  if(t!=WStype_TEXT)return;
  JsonDocument d;if(deserializeJson(d,data,len))return;
  String type=d["type"]|"";
  if(type=="ready"){
    int actual=d["channel"]|0;
    if(actual!=channel){JsonDocument c;c["type"]="channel";c["channel"]=channel;String s;serializeJson(c,s);sendText(s);}
    else{radioDebug("READY","Cloud READY confirmed");backendError=false;diagnosticError("");diagnosticStage("ready");thinking=false;ready=true;if(!setupScreenActive())displayChannel(channel,true);Serial.printf("Channel %d ready\n",channel+1);}
  }
  if(type=="connecting"||type=="offline"||type=="error"){ready=tx=false;thinking=false;flushAudio();Serial.write(data,len);Serial.println();diagnosticStage(type=="connecting"?"cloud_connecting":"cloud_error");if(type!="connecting"){radioDebug("ERROR","Cloud error: see USB web");backendError=true;diagnosticError(d["message"]|"cloud unavailable");resetLink=true;}}
  if(type=="recording")radioDebug("RECORDING","Gateway recording ACK");
  if(type=="thinking")radioDebug("WAIT AI","Gateway submitted audio");
  if(type=="busy"){ready=false;thinking=true;}
  if(type=="flush")flushAudio();
  if(type=="idle"){radioDebug("READY","Clip too short: not sent");thinking=false;}
  if(type=="audio_start"){playbackGate.reset();radioDebug("PLAYING","Reply audio started");thinking=false;played=0;ending=false;playing=true;}
  if(type=="audio_end"){radioDebug("DRAINING","Reply stream ended");ending=true;}
}
static PttHold ptt;
void button(){
  bool down=digitalRead(PIN_PTT)==LOW;
  if(down!=candidate){candidate=down;changedAt=millis();if(down)radioDebug(ready?"HOLD 0.5s":"NOT READY",ready?"BOOT down: hold 0.5s":"BOOT blocked: AI offline");else if(!tx&&ptt.held)radioDebug(ready?"READY":"NOT READY","Short press: no recording");}
  if(candidate!=stable&&millis()-changedAt>=15)stable=candidate;
  auto action=ptt.update(millis(),stable,ready,digitalRead(2)==LOW);
  if(action==PttHold::Start){
    radioDebugReset();radioDebug("RECORDING","REC started: release to send");
    flushAudio();
    // Never include audio from the initial 0.5s hold threshold.
    int16_t discard[240];for(int i=0;i<5;i++)audioRead(discard,240);
    control("ptt_down");thinking=false;tx=true;pressAt=millis();diagnosticStage("recording");
    Serial.println("VOXI_PTT recording");
  }else if(action==PttHold::Stop&&tx){
    radioDebug("SENDING","REC stopped: PTT UP queued");tx=false;thinking=true;control("ptt_up");diagnosticStage("thinking");Serial.println("VOXI_PTT submitted");
  }
}

void encoder(){
  int action=bleAction();if(action&1){pendingChannel=(pendingChannel+1)%4;encAt=millis();}if(action&2){pendingChannel=(pendingChannel+3)%4;encAt=millis();}
  static const int8_t table[]={0,-1,1,0,1,0,0,-1,-1,0,0,1,0,1,-1,0};
  int now=(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B);
  if(now!=encPrev){encSteps+=table[(encPrev<<2)|now];encPrev=now;
    if(abs(encSteps)>=4){pendingChannel=(pendingChannel+(encSteps>0?1:3))%4;encSteps=0;encAt=millis();}}
  // Coalesce rapid rotation, and defer switching until PTT is released.
  if(!stable&&pendingChannel!=channel&&millis()-encAt>180){
    tx=false;ready=false;flushAudio();channel=pendingChannel;if(!setupScreenActive())displayChannel(channel,false);
    JsonDocument d;d["type"]="channel";d["channel"]=channel;String s;serializeJson(d,s);sendText(s);
  }
}
void audioTick(){
  int16_t mic[240];size_t samples=audioRead(mic,240);
  if(tx&&samples){unsigned peak=0;for(size_t i=0;i<samples;i++)peak=max(peak,(unsigned)abs((int)mic[i]));radioDebugMic(samples*2,peak);sendAudio((uint8_t*)mic,samples*2);}
  // Prime once with 120ms, then continuously drain even below the watermark.
  // If input runs dry, count it and refill before restarting.
  uint32_t previousRefills=playbackGate.rebuffers;
  if(!tx&&playing&&playbackGate.canWrite(used,ending)){
    size_t count=min(used/2,(size_t)240);int16_t mono[240];
    for(size_t i=0;i<count;i++){uint8_t lo=playback[(tail+2*i)%CAP],hi=playback[(tail+2*i+1)%CAP];mono[i]=(int16_t)(lo|(hi<<8));}
    size_t written=count?audioWrite(mono,count):0;
    size_t consumed=written*2;tail=(tail+consumed)%CAP;used-=consumed;played+=consumed/2;
    if(ending&&used==0){radioDebug(ready?"READY":"WAIT AI","Speaker playback complete");playing=false;ending=false;thinking=false;}
  }
  if(playbackGate.rebuffers!=previousRefills)radioDebug("BUFFERING","Audio jitter: refilling");
  if(!tx&&playing&&ending&&used==0){playing=ending=thinking=false;radioDebug(ready?"READY":"WAIT AI","Speaker playback complete");}
  if(millis()-lastReport>100){lastReport=millis();JsonDocument d;d["type"]="played";
    // Approximate DAC position: subtract maximum queued DMA (60 ms).
    d["ms"]=played>1440?(played-1440)/24:0;String s;serializeJson(d,s);if(ready)sendText(s);}
}
void setup(){
  Serial.setRxBufferSize(16384);Serial.setTxBufferSize(8192);Serial.begin(115200);pinMode(PIN_PTT,INPUT_PULLUP);pinMode(PIN_ENC_A,INPUT_PULLUP);pinMode(PIN_ENC_B,INPUT_PULLUP);
  pinMode(2,INPUT_PULLUP);
  encPrev=(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B);
  diagnosticsBegin();boardInit();setupBegin();
  if(!radioConfig.valid){radioDebug("SETUP NEEDED","Cloud config not saved");displayConnection(channel,"SETUP NEEDED",WiFi.status()==WL_CONNECTED,false,HWCDC::isPlugged());return;}
  displayChannel(channel,false);
  if(radioConfig.tls)configTime(0,0,"ntp.tencent.com","pool.ntp.org");
  incoming=xQueueCreate(8,sizeof(Packet));outgoing=xQueueCreate(24,sizeof(TxPacket));
  if(!incoming||!outgoing||xTaskCreate(networkTask,"radio-network",12288,nullptr,1,nullptr)!=pdPASS){diagnosticError("network task allocation failed");radioConfig.valid=false;}

}
void loop(){
  displayDebugTick();boardStatusTick();setupTick(tx||playing||thinking,ready,channel);
  if(speakerTestPending()&&!tx&&!playing&&!thinking)speakerTestRun();
  if(!radioConfig.valid){
    button();
    static uint32_t screenAt=0;if(millis()-screenAt>1000&&!setupScreenActive()){screenAt=millis();displayConnection(channel,"SETUP NEEDED",WiFi.status()==WL_CONNECTED,false,HWCDC::isPlugged());}
    int16_t discard[240];audioRead(discard,240);delay(1);return;
  }
  Packet p;for(int i=0;i<8&&xQueueReceive(incoming,&p,0)==pdTRUE;i++)onWs(p.type,p.data,p.len);
  if(queueFault){queueFault=false;fault();}
  static bool wifiWas=false;bool wifiNow=WiFi.status()==WL_CONNECTED;if(wifiNow!=wifiWas){wifiWas=wifiNow;radioDebug(wifiNow?"WAIT AI":"NO WIFI",wifiNow?"WiFi connected":"WiFi disconnected");}
  if(WiFi.status()!=WL_CONNECTED){if(ready||tx||playing||used)flushAudio();ready=tx=false;diagnosticStage("wifi_connecting");}
  button();encoder();audioTick();
  static uint32_t lastScreen=0;
  if(millis()-lastScreen>500){lastScreen=millis();
    bool wifi=WiFi.status()==WL_CONNECTED;
    const char* label=!wifi?"WIFI CONNECT":radioConfig.tls&&time(nullptr)<=1700000000?"SYNC TIME":tx?"RECORDING":thinking?"THINKING":playing?"RECEIVING":ready?"READY":backendError?"BACKEND ERROR":gatewayLinked?"AI CONNECTING":"CLOUD CONNECT";
    if(ready)diagnosticStage(tx?"recording":thinking?"thinking":playing?"receiving":"ready");
    else diagnosticStage(!wifi?"wifi_connecting":radioConfig.tls&&time(nullptr)<=1700000000?"sync_time":backendError?"backend_error":gatewayLinked?"ai_connecting":"gateway_connecting");
    if(!setupScreenActive())displayConnection(channel,label,wifi,gatewayLinked,HWCDC::isPlugged());
  }
  delay(1);
}
