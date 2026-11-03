#include <Arduino.h>
// USB status serialization and audio/file bookkeeping share the Arduino task.
SET_LOOP_TASK_STACK_SIZE(16384);
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
#include "playback_envelope.h"
#include "audio_cache.h"
#include "radio_squelch.h"
#include <esp_rom_crc.h>

// Waveshare C6: onboard ES8311, one full-duplex I2S port, Arduino 3.x.
class RadioSocket:public WebSocketsClient{
public:
  void resumeHeartbeat(){enableHeartbeat(15000,3000,2);_client.lastPing=millis();_client.pongReceived=true;_client.pongTimeoutCount=0;}
  void writeFailure(){
    char tls[96]={},message[160];int code=0;
    if(_client.ssl)code=_client.ssl->lastError(tls,sizeof(tls));
    snprintf(message,sizeof(message),"WebSocket send failed TLS=%d %.96s",code,tls);
    diagnosticError(message);
  }
};
RadioSocket ws;
String authorizationHeader;
constexpr size_t CAP=57600; // bounded 1.2s jitter buffer, including squelch pre-roll
uint8_t playback[CAP]; size_t head=0,tail=0,used=0;
static uint32_t lastReplyPacketAt=0,replyGapMaxMs=0;
static PlaybackGate playbackGate;static size_t fadeRemaining=120;
void playbackDiagnostics(JsonDocument& out){out["replyGapMaxMs"]=replyGapMaxMs;out["playbackCapacityMs"]=CAP/48;out["playbackBufferedMs"]=used/48;out["playbackRebuffers"]=playbackGate.rebuffers;out["playbackTargetMs"]=playbackGate.targetBytes/48;}
volatile bool tx=false,uploading=false;
bool ready=false,ending=false,playing=false,gatewayLinked=false,backendError=false,thinking=false,replyPending=false;
uint32_t played=0,lastReport=0,pressAt=0;
int channel=0; bool stable=false,candidate=false;uint32_t changedAt=0;
int encPrev=0,encSteps=0,pendingChannel=0;uint32_t encAt=0;

struct Packet{WStype_t type;size_t len;uint8_t data[2048];};
struct TxPacket{WStype_t type;size_t len;uint8_t data[2048];};
static QueueHandle_t incoming,outgoing;
static volatile bool resetLink=false,queueFault=false,networkBusy=false;
static volatile uint32_t networkLoopMaxMs=0,networkSendMaxMs=0,probeStallUntil=0;
static uint8_t micBatch[1920],uploadBlock[1920];static size_t micBatchUsed=0,uploadBlockUsed=0;
static bool uploadEof=false,submitQueued=false;
static volatile bool submitSent=false;
static uint32_t uploadAt=0,uploadProgressAt=0,uploadProgressBytes=0;
static bool probeRequested=false,probePassed=false;
static volatile bool probeActive=false,probeFinishing=false;
static uint32_t probeAt=0;static const char* probeState="idle";
static uint32_t probeRandom=0x564f5849;
static bool cueActive=false,replyCuePending=false,micCueGuard=false,cueRequested=false;
void requestRadioCueTest(){cueRequested=true;}
static size_t cuePosition=0;static uint32_t cueSeed=0x564f5849,micResumeAt=0;
static void startRadioCue(){cuePosition=0;cueSeed+=0x9e3779b9u;cueActive=true;}
static void radioCueTick(){
  if(!cueActive)return;
  int16_t block[240];size_t n=min((size_t)240,RadioSquelch::samples-cuePosition);
  for(size_t i=0;i<n;i++)block[i]=RadioSquelch::sample(cuePosition+i,cueSeed);
  cuePosition+=audioWrite(block,n);
  if(cuePosition==RadioSquelch::samples){cueActive=false;micResumeAt=millis()+100;}
}
static uint32_t captureCrc=0;static volatile uint32_t sentCrc=0;
void requestUploadTest(){probeRequested=true;}
void radioTransportDiagnostics(JsonDocument& out){out["networkLoopMaxMs"]=(uint32_t)networkLoopMaxMs;out["networkSendMaxMs"]=(uint32_t)networkSendMaxMs;out["uploadProbe"]=probeState;out["uploadProbePassed"]=probePassed;out["recordingCrc"]=(uint32_t)captureCrc;out["sentCrc"]=(uint32_t)sentCrc;out["uploading"]=uploading;audioCacheDiagnostics(out);}

static void networkFault(const char* reason){if(!queueFault){diagnosticError(reason);queueFault=true;}}
static void socketWriteFault(){if(!queueFault){ws.writeFailure();queueFault=true;}}
static bool sendText(String text){TxPacket p{};p.type=WStype_TEXT;p.len=text.length();if(p.len>sizeof(p.data))return false;memcpy(p.data,text.c_str(),p.len);if(xQueueSend(outgoing,&p,pdMS_TO_TICKS(150))!=pdTRUE){networkFault("TX control queue full");return false;}return true;}
static bool sendAudio(uint8_t* bytes,size_t n){TxPacket p{};p.type=WStype_BIN;p.len=n;if(n>sizeof(p.data))return false;memcpy(p.data,bytes,n);if(xQueueSend(outgoing,&p,pdMS_TO_TICKS(10))!=pdTRUE){networkFault("TX audio queue full");return false;}return true;}
static bool flushMicBatch(){
  if(!micBatchUsed)return true;
  bool ok=audioCacheWrite(micBatch,micBatchUsed);micBatchUsed=0;
  if(!ok){diagnosticError("Recording cache write failed");queueFault=true;}return ok;
}
static void batchAudio(uint8_t* bytes,size_t n){
  while(n&&!queueFault){size_t count=min(n,sizeof(micBatch)-micBatchUsed);memcpy(micBatch+micBatchUsed,bytes,count);micBatchUsed+=count;bytes+=count;n-=count;if(micBatchUsed==sizeof(micBatch))flushMicBatch();}
}
static void socketEvent(WStype_t type,uint8_t* data,size_t len){if(type!=WStype_TEXT&&type!=WStype_BIN&&type!=WStype_CONNECTED&&type!=WStype_DISCONNECTED)return;Packet p{};p.type=type;p.len=len;if(len>sizeof(p.data)){networkFault("RX frame exceeds 2048 bytes");return;}if(len)memcpy(p.data,data,len);if(xQueueSend(incoming,&p,pdMS_TO_TICKS(20))!=pdTRUE)networkFault("RX event queue full");}
static void pumpSocket(){uint32_t at=millis();ws.loop();networkLoopMaxMs=max((uint32_t)networkLoopMaxMs,millis()-at);}
static void networkTask(void*){
  if(radioConfig.tls)ws.beginSslWithCA(radioConfig.host.c_str(),radioConfig.port,"/radio",radioConfig.ca.c_str());else ws.begin(radioConfig.host.c_str(),radioConfig.port,"/radio");
  authorizationHeader="Authorization: Bearer "+radioConfig.token;ws.setExtraHeaders(authorizationHeader.c_str());ws.onEvent(socketEvent);ws.setReconnectInterval(5000);ws.enableHeartbeat(15000,3000,2);
  TxPacket p;uint32_t retryAt=0;bool heartbeatPaused=false;
  while(true){if(resetLink){resetLink=false;ws.disconnect();xQueueReset(outgoing);diagnosticReconnect();retryAt=millis()+5000;}
    if(WiFi.status()==WL_CONNECTED&&(!radioConfig.tls||time(nullptr)>1700000000)&&(int32_t)(millis()-retryAt)>=0){
      if(probeStallUntil&&(int32_t)(millis()-probeStallUntil)<0){vTaskDelay(pdMS_TO_TICKS(10));continue;}
      bool connected=ws.isConnected();
      if(!connected)xQueueReset(outgoing);
      bool sending=connected&&(uploading||uxQueueMessagesWaiting(outgoing)>0);
      if(sending&&!heartbeatPaused){ws.disableHeartbeat();heartbeatPaused=true;}
      if(!sending&&heartbeatPaused){ws.resumeHeartbeat();heartbeatPaused=false;}
      if(!sending)pumpSocket();
      // Half-duplex: drain queued mic data first; read replies only after release.
      for(int budget=0;budget<4&&!resetLink&&!queueFault;budget++){
        if(!ws.isConnected()||xQueueReceive(outgoing,&p,0)!=pdTRUE)break;
        networkBusy=true;uint32_t sendAt=millis();
        bool sent=p.type==WStype_BIN?ws.sendBIN(p.data,p.len):ws.sendTXT(p.data,p.len);
        networkSendMaxMs=max((uint32_t)networkSendMaxMs,millis()-sendAt);
        if(!sent){networkBusy=false;socketWriteFault();pumpSocket();break;}
        if(p.type==WStype_BIN){sentCrc=esp_rom_crc32_le(sentCrc,p.data,p.len);radioDebugTx(p.len);}
        else{String text((const char*)p.data,p.len);if(text.indexOf("ptt_up")>=0){submitSent=true;radioDebug("WAIT AI","PTT UP sent to gateway");}}
        networkBusy=false;
        if(!uploading&&uxQueueMessagesWaiting(outgoing)==0)pumpSocket();
      }
    }
    else xQueueReset(outgoing);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}
void control(const char* type){JsonDocument d;d["type"]=type;String s;serializeJson(d,s);sendText(s);}
void flushAudio(){cueActive=replyCuePending=micCueGuard=false;playbackGate.reset();fadeRemaining=120;head=tail=used=0;ending=playing=thinking=false;played=0;audioFlush();}
void fault(){replyPending=false;audioCacheClose();uploading=false;micBatchUsed=0;if(probeActive||probeFinishing){probeState="failed";probeActive=false;probeFinishing=false;probePassed=false;}radioDebug("ERROR","Audio/queue fault: reconnect");ready=false;tx=false;thinking=false;flushAudio();resetLink=true;Serial.println("Link reset");}
void onWs(WStype_t t,uint8_t* data,size_t len){
  if(t==WStype_DISCONNECTED){if(playing||thinking||replyPending)diagnosticTurnFailure("Gateway disconnected during reply");replyPending=false;audioCacheClose();uploading=false;micBatchUsed=0;if(probeActive||probeFinishing){probeActive=false;probeFinishing=false;probePassed=false;probeState="failed";}radioDebug("OFFLINE","Gateway disconnected");gatewayLinked=false;diagnosticStage(backendError?"backend_error":"disconnected");ready=false;tx=false;thinking=false;flushAudio();if(!setupScreenActive())displayChannel(channel,false);return;}
  if(t==WStype_CONNECTED){radioDebug("WAIT AI","Gateway connected");gatewayLinked=true;diagnosticStage("cloud_handshake");ready=false;return;}
  if(t==WStype_BIN){
    radioDebugRx(len);
    if(playing){uint32_t now=millis();if(lastReplyPacketAt)replyGapMaxMs=max(replyGapMaxMs,now-lastReplyPacketAt);lastReplyPacketAt=now;}
    if(tx)return;
    if(len%2||len>CAP-used){diagnosticError(len%2?"Reply PCM sample alignment error":"Reply playback buffer overflow");diagnosticTurnFailure(len%2?"Reply PCM sample alignment error":"Reply playback buffer overflow");fault();return;}
    for(size_t i=0;i<len;i++){playback[head]=data[i];head=(head+1)%CAP;}used+=len;return;
  }
  if(t!=WStype_TEXT)return;
  JsonDocument d;if(deserializeJson(d,data,len))return;
  String type=d["type"]|"";
  if(type=="ready"){
    if(uploading||replyPending)return;
    int actual=d["channel"]|0;
    if(actual!=channel){JsonDocument c;c["type"]="channel";c["channel"]=channel;String s;serializeJson(c,s);sendText(s);}
    else{radioDebug("READY","Cloud READY confirmed");backendError=false;diagnosticError("");diagnosticStage("ready");thinking=false;ready=true;if(!setupScreenActive())displayChannel(channel,true);Serial.printf("Channel %d ready\n",channel+1);}
  }
  if(type=="connecting"||type=="offline"||type=="error"){if(type!="connecting"&&(playing||thinking||replyPending))diagnosticTurnFailure(d["message"]|"Pocket disconnected during reply");if(type!="connecting"){replyPending=false;audioCacheClose();uploading=false;}ready=false;tx=false;thinking=false;flushAudio();Serial.write(data,len);Serial.println();diagnosticStage(type=="connecting"?"cloud_connecting":"cloud_error");if(type!="connecting"){radioDebug("ERROR","Cloud error: see USB web");backendError=true;diagnosticError(d["message"]|"cloud unavailable");resetLink=true;}}
  if(type=="recording")radioDebug("SENDING","Gateway recording ACK");
  if(type=="thinking")radioDebug("WAIT AI","Gateway submitted audio");
  if(type=="busy"){ready=false;thinking=true;}
  if(type=="flush")flushAudio();
  if(type=="idle"){replyPending=false;ready=gatewayLinked;radioDebug("READY","Clip too short: not sent");thinking=false;}
  if(type=="audio_start"){lastReplyPacketAt=replyGapMaxMs=0;replyCuePending=true;playbackGate.reset();fadeRemaining=120;radioDebug("PLAYING","Reply audio started");thinking=false;played=0;ending=false;playing=true;}
  if(type=="audio_end"){replyPending=false;radioDebug("DRAINING","Reply stream ended");ending=true;}
}
static bool startCachedUpload(bool test){
  if(!audioCacheOpenUpload()){diagnosticError("Cannot reopen recording cache");fault();return false;}
  uploading=true;ready=false;thinking=false;uploadBlockUsed=0;uploadEof=false;submitQueued=false;submitSent=false;uploadAt=uploadProgressAt=millis();uploadProgressBytes=0;
  if(test)probeStallUntil=millis()+3500;
  control("ptt_down");radioDebug("SENDING",test?"Test: 3.5s network stall":"Local recording saved: upload");return true;
}
static void cachedUploadTick(){
  if(!uploading)return;
  auto progress=radioDebugRead();
  if(progress.txBytes!=uploadProgressBytes){uploadProgressBytes=progress.txBytes;uploadProgressAt=millis();}
  if(millis()-uploadAt>UPLOAD_MAX_MS||millis()-uploadProgressAt>UPLOAD_STALL_MS){diagnosticError("Cached upload timed out; recording kept");fault();return;}
  if(uxQueueMessagesWaiting(outgoing)<6&&!uploadEof){
    if(!uploadBlockUsed){uploadBlockUsed=audioCacheRead(uploadBlock,sizeof(uploadBlock));if(!uploadBlockUsed){if(!audioCacheEnd()){diagnosticError("Recording cache read failed");fault();return;}uploadEof=true;}}
    if(uploadBlockUsed&&sendAudio(uploadBlock,uploadBlockUsed))uploadBlockUsed=0;
  }
  if(uploadEof&&!uploadBlockUsed&&uxQueueMessagesWaiting(outgoing)<6){
    if(probeFinishing){
      if(!networkBusy&&uxQueueMessagesWaiting(outgoing)==0){auto d=radioDebugRead();probePassed=d.micBytes==RECORDING_MAX_BYTES&&d.micBytes==d.txBytes&&captureCrc==sentCrc;probeState=probePassed?"passed":"failed";probeFinishing=false;uploading=false;audioCacheRemove();resetLink=true;radioDebug(probePassed?"UPLOAD PASS":"UPLOAD FAIL","Cached test done: reconnect");}
    }else{
      if(!submitQueued){replyPending=true;control("ptt_up");submitQueued=true;}
      if(submitSent){uploading=false;thinking=true;audioCacheRemove();radioDebug("WAIT AI","Upload complete: awaiting AI");}
    }
  }
}
static PttHold ptt;
void button(){
  if(probeActive||probeFinishing||uploading)return;
  bool down=digitalRead(PIN_PTT)==LOW;
  if(down!=candidate){candidate=down;changedAt=millis();if(down)radioDebug(ready?"HOLD 0.3s":"NOT READY",ready?"BOOT down: hold 0.3s":"BOOT blocked: AI offline");else if(!tx&&ptt.held)radioDebug(ready?"READY":"NOT READY","Short press: no recording");}
  if(candidate!=stable&&millis()-changedAt>=15)stable=candidate;
  auto action=ptt.update(millis(),stable,ready&&!thinking&&!playing,digitalRead(2)==LOW);
  if(action==PttHold::Start){
    if(!audioCacheStart()){radioDebug("CACHE ERROR","Cannot start local recording");diagnosticError("Audio cache start failed");return;}
    micBatchUsed=0;captureCrc=0;sentCrc=0;radioDebugReset();radioDebug("RECORDING","REC started: release to send");
    flushAudio();
    // Never include audio from the initial 0.3s hold threshold.
    int16_t discard[240];for(int i=0;i<5;i++)audioRead(discard,240);
    tx=true;thinking=false;pressAt=millis();micCueGuard=true;startRadioCue();
    radioDebug("OPEN MIC","TX squelch: mic guard");diagnosticStage("recording");
    Serial.println("VOXI_PTT recording");
  }else if(action==PttHold::Stop&&tx){
    tx=false;
    if(!radioDebugRead().micBytes){audioCacheRemove();flushAudio();radioDebug("READY","Released during TX cue");return;}
    if(!flushMicBatch()||!audioCacheFinish()){fault();return;}
    startCachedUpload(false);
  }
}

void encoder(){
  int action=bleAction();if(action&1){pendingChannel=(pendingChannel+1)%4;encAt=millis();}if(action&2){pendingChannel=(pendingChannel+3)%4;encAt=millis();}
  static const int8_t table[]={0,-1,1,0,1,0,0,-1,-1,0,0,1,0,1,-1,0};
  int now=(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B);
  if(now!=encPrev){encSteps+=table[(encPrev<<2)|now];encPrev=now;
    if(abs(encSteps)>=4){pendingChannel=(pendingChannel+(encSteps>0?1:3))%4;encSteps=0;encAt=millis();}}
  // Coalesce rapid rotation, and defer switching until PTT is released.
  if(!stable&&!uploading&&!thinking&&!playing&&pendingChannel!=channel&&millis()-encAt>180){
    tx=false;ready=false;flushAudio();channel=pendingChannel;if(!setupScreenActive())displayChannel(channel,false);
    JsonDocument d;d["type"]="channel";d["channel"]=channel;String s;serializeJson(d,s);sendText(s);
  }
}
void audioTick(){
  int16_t mic[240];size_t samples=audioRead(mic,240);
  radioCueTick();
  if(micCueGuard&&!cueActive&&(int32_t)(millis()-micResumeAt)>=0){
    micCueGuard=false;ptt.started=millis();radioDebug("RECORDING","REC started: release to send");
  }
  if(tx&&!micCueGuard&&samples){samples=min(samples,(size_t)((RECORDING_MAX_BYTES-radioDebugRead().micBytes)/2));if(probeActive)for(size_t i=0;i<samples;i++){probeRandom=probeRandom*1664525u+1013904223u;mic[i]=(int16_t)((probeRandom>>20)&1023)-512;}unsigned peak=0;for(size_t i=0;i<samples;i++)peak=max(peak,(unsigned)abs((int)mic[i]));captureCrc=esp_rom_crc32_le(captureCrc,(const uint8_t*)mic,samples*2);radioDebugMic(samples*2,peak);batchAudio((uint8_t*)mic,samples*2);
    if(tx&&radioDebugRead().micBytes>=RECORDING_MAX_BYTES){
      tx=false;if(!flushMicBatch()||!audioCacheFinish()){fault();return;}
      if(probeActive){probeActive=false;probeFinishing=true;probeState="uploading";}
      radioDebug("SENDING","20s limit: recording stopped");startCachedUpload(probeFinishing);
    }
  }
  // Prime with 500ms (adapt up to 800ms after gaps), then continuously drain even below the watermark.
  // If input runs dry, count it and refill before restarting.
  uint32_t previousRefills=playbackGate.rebuffers;
  if(!tx&&playing&&!cueActive&&playbackGate.canWrite(used,ending)){
    if(replyCuePending){replyCuePending=false;startRadioCue();radioDebug("PLAYING","RX squelch: reply begins");return;}
    size_t count=min(used/2,(size_t)240);int16_t mono[240];
    for(size_t i=0;i<count;i++){uint8_t lo=playback[(tail+2*i)%CAP],hi=playback[(tail+2*i+1)%CAP];mono[i]=playbackEnvelope((int16_t)(lo|(hi<<8)),i,fadeRemaining,used/2);}
    size_t written=count?audioWrite(mono,count):0;
    fadeRemaining=written>=fadeRemaining?0:fadeRemaining-written;
    size_t consumed=written*2;tail=(tail+consumed)%CAP;used-=consumed;played+=consumed/2;if(used==0)fadeRemaining=120;
    if(ending&&used==0){radioDebug(ready?"READY":"WAIT AI","Speaker playback complete");playing=false;ending=false;thinking=false;}
  }
  if(playbackGate.rebuffers!=previousRefills){fadeRemaining=120;radioDebug("BUFFERING","Audio jitter: refilling");}
  if(!tx&&playing&&ending&&used==0){playing=ending=thinking=false;radioDebug(ready?"READY":"WAIT AI","Speaker playback complete");}
  if(millis()-lastReport>250){lastReport=millis();JsonDocument d;d["type"]="played";
    // Approximate DAC position: subtract maximum queued DMA (60 ms).
    static uint32_t lastReported=UINT32_MAX;
    d["ms"]=played>1440?(played-1440)/24:0;String s;serializeJson(d,s);
    // A synchronous TLS write must not block incoming speech just to report position.
    if(ready&&!tx&&!uploading&&!playing&&!cueActive&&played!=lastReported&&sendText(s))lastReported=played;}
}
void setup(){
  Serial.setRxBufferSize(16384);Serial.setTxBufferSize(8192);Serial.begin(115200);pinMode(PIN_PTT,INPUT_PULLUP);pinMode(PIN_ENC_A,INPUT_PULLUP);pinMode(PIN_ENC_B,INPUT_PULLUP);
  pinMode(2,INPUT_PULLUP);
  encPrev=(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B);
  diagnosticsBegin();boardInit();audioCacheInit();setupBegin();
  if(!radioConfig.valid){radioDebug("SETUP NEEDED","Cloud config not saved");displayConnection(channel,"SETUP NEEDED",WiFi.status()==WL_CONNECTED,false,HWCDC::isPlugged());return;}
  displayChannel(channel,false);
  if(radioConfig.tls)configTime(0,0,"ntp.tencent.com","pool.ntp.org");
  incoming=xQueueCreate(8,sizeof(Packet));outgoing=xQueueCreate(8,sizeof(TxPacket));
  if(!incoming||!outgoing||xTaskCreate(networkTask,"radio-network",12288,nullptr,1,nullptr)!=pdPASS){diagnosticError("network task allocation failed");radioConfig.valid=false;}

}
void loop(){
  displayDebugTick();boardStatusTick();setupTick(tx||uploading||playing||thinking||cueActive,ready,channel);
  if(speakerTestPending()&&!tx&&!uploading&&!playing&&!thinking)speakerTestRun();
  if(!radioConfig.valid){
    button();
    static uint32_t screenAt=0;if(millis()-screenAt>1000&&!setupScreenActive()){screenAt=millis();displayConnection(channel,"SETUP NEEDED",WiFi.status()==WL_CONNECTED,false,HWCDC::isPlugged());}
    int16_t discard[240];audioRead(discard,240);delay(1);return;
  }
  Packet p;for(int i=0;i<8&&xQueueReceive(incoming,&p,0)==pdTRUE;i++)onWs(p.type,p.data,p.len);
  if(queueFault){queueFault=false;fault();}
  if(probeRequested&&ready&&!tx&&!uploading&&!playing&&!thinking){
    probeRequested=false;
    if(audioCacheStart()){probeActive=true;probePassed=false;probeState="recording";probeRandom=0x564f5849;probeAt=millis();micBatchUsed=0;captureCrc=0;sentCrc=0;networkLoopMaxMs=networkSendMaxMs=0;radioDebugReset();flushAudio();tx=true;radioDebug("UPLOAD TEST","Recording 20s synthetic PCM");}
    else{probeState="failed";diagnosticError("Audio cache start failed");}
  }
  if(probeActive&&millis()-probeAt>30000){diagnosticError("Recording probe capture stalled");fault();}
  if(cueRequested&&!tx&&!uploading&&!playing&&!thinking){cueRequested=false;flushAudio();startRadioCue();radioDebug("SQUELCH TEST","Local 220ms radio static");}
  cachedUploadTick();
  static bool wifiWas=false;bool wifiNow=WiFi.status()==WL_CONNECTED;if(wifiNow!=wifiWas){wifiWas=wifiNow;radioDebug(wifiNow?"WAIT AI":"NO WIFI",wifiNow?"WiFi connected":"WiFi disconnected");}
  if(WiFi.status()!=WL_CONNECTED){if(ready||tx||playing||used)flushAudio();ready=false;tx=false;diagnosticStage("wifi_connecting");}
  button();encoder();audioTick();
  static uint32_t lastScreen=0;
  if(millis()-lastScreen>500){lastScreen=millis();
    bool wifi=WiFi.status()==WL_CONNECTED;
    const char* label=!wifi?"WIFI CONNECT":radioConfig.tls&&time(nullptr)<=1700000000?"SYNC TIME":tx?"RECORDING":uploading?"SENDING":thinking?"THINKING":playing?"RECEIVING":ready?"READY":backendError?"BACKEND ERROR":gatewayLinked?"AI CONNECTING":"CLOUD CONNECT";
    if(tx)diagnosticStage("recording");else if(uploading)diagnosticStage("sending");else if(thinking)diagnosticStage("thinking");else if(playing)diagnosticStage("receiving");else if(ready)diagnosticStage("ready");
    else diagnosticStage(!wifi?"wifi_connecting":radioConfig.tls&&time(nullptr)<=1700000000?"sync_time":backendError?"backend_error":gatewayLinked?"ai_connecting":"gateway_connecting");
    if(!setupScreenActive())displayConnection(channel,label,wifi,gatewayLinked,HWCDC::isPlugged());
  }
  delay(1);
}
