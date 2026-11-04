#include "board_profile.h"
#include "standby.h"
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
#include "radio_network.h"
#ifdef VOXI_BOARD_MINICAM
#include "cellular_socket.h"
#endif
#include "diagnostics.h"
#include "ble_knob.h"
#include "ptt_hold.h"
#include "playback_gate.h"
#include "mulaw.h"
#include "playback_envelope.h"
#include "audio_cache.h"
#include "upload_recovery.h"
#include <errno.h>
#include "radio_squelch.h"
#include <esp_rom_crc.h>
#include <esp_heap_caps.h>
#include <esp_mac.h>
#include "device_identity.h"

// Waveshare C6: onboard ES8311, one full-duplex I2S port, Arduino 3.x.
class RadioSocket:public WebSocketsClient{
#ifdef VOXI_BOARD_MINICAM
  CellularSocket cell;
#endif
public:
#ifdef VOXI_BOARD_MINICAM
  void beginSslWithCA(const char* h,uint16_t p,const char* url,const char* ca){if(radioUsesCellular())cell.begin(h,p,url,ca);else WebSocketsClient::beginSslWithCA(h,p,url,ca);}
  void begin(const char* h,uint16_t p,const char* url){if(radioUsesCellular())cell.begin(h,p,url,nullptr);else WebSocketsClient::begin(h,p,url);}
  void setExtraHeaders(const char* h){if(radioUsesCellular())cell.setExtraHeaders(h);else WebSocketsClient::setExtraHeaders(h);}
  void onEvent(WebSocketClientEvent f){if(radioUsesCellular())cell.onEvent(f);else WebSocketsClient::onEvent(f);}
  void setReconnectInterval(uint32_t n){if(radioUsesCellular())cell.setReconnectInterval(n);else WebSocketsClient::setReconnectInterval(n);}
  void enableHeartbeat(uint32_t i,uint32_t t,uint8_t n){if(radioUsesCellular())cell.enableHeartbeat(i,t,n);else WebSocketsClient::enableHeartbeat(i,t,n);}
  void disableHeartbeat(){if(radioUsesCellular())cell.disableHeartbeat();else WebSocketsClient::disableHeartbeat();}
  void disconnect(){if(radioUsesCellular())cell.disconnect();else WebSocketsClient::disconnect();}
  bool isConnected(){return radioUsesCellular()?cell.isConnected():WebSocketsClient::isConnected();}
  void loop(){if(radioUsesCellular())cell.loop();else WebSocketsClient::loop();}
  bool sendTXT(uint8_t* p,size_t n){return radioUsesCellular()?cell.sendTXT(p,n):WebSocketsClient::sendTXT(p,n);}
#endif
  void resumeHeartbeat(){
#ifdef VOXI_BOARD_MINICAM
    if(radioUsesCellular()){cell.resumeHeartbeat();return;}
#endif
    enableHeartbeat(15000,3000,2);_client.lastPing=millis();_client.pongReceived=true;_client.pongTimeoutCount=0;}
  bool sendPcm(const uint8_t* data,size_t len){
#ifdef VOXI_BOARD_MINICAM
    if(radioUsesCellular())return cell.sendPcm(data,len);
#endif
    static uint8_t wire[2048+14];if(len>2048)return false;
    memcpy(wire+14,data,len);return sendBIN(wire,len,true);
  }
  void writeFailure(bool binary,size_t bytes,uint32_t elapsed){
#ifdef VOXI_BOARD_MINICAM
    if(radioUsesCellular()){cell.writeFailure(binary,bytes,elapsed);return;}
#endif
    int sys=errno,code=0;char tls[64]={},message[192];
    if(_client.ssl)code=_client.ssl->lastError(tls,sizeof(tls));
    if(code<0)snprintf(message,sizeof(message),"WS write failed %s %uB %lums errno=%d TLS=%d %.64s",binary?"PCM":"control",(unsigned)bytes,(unsigned long)elapsed,sys,code,tls);
    else snprintf(message,sizeof(message),"WS write failed %s %uB %lums errno=%d (no TLS error recorded)",binary?"PCM":"control",(unsigned)bytes,(unsigned long)elapsed,sys);
    diagnosticError(message);
  }
};
RadioSocket ws;
String authorizationHeader;
#if defined(VOXI_BOARD_S3G)||defined(VOXI_BOARD_AMOLED)||defined(VOXI_BOARD_MINICAM)
constexpr size_t CAP=12*48000; // Reserve 12 seconds in external PSRAM, not internal DMA RAM.
static uint8_t* playback=nullptr;
#else
constexpr size_t CAP=96000;
static uint8_t playback[CAP];
#endif
static void deviceIdentity(char* target,size_t size){uint8_t mac[6]={};if(esp_efuse_mac_get_default(mac)!=ESP_OK){if(size)target[0]=0;return;}formatDeviceIdentity(mac,target,size);}
static size_t replyBytesPerSample=2;
size_t head=0,tail=0,used=0;
static uint32_t lastReplyPacketAt=0,replyGapMaxMs=0;
static uint32_t playbackServiceAt=0,playbackServiceGapMaxMs=0;static size_t playbackPeakBytes=0;
static uint32_t replyRxCrc=0,replyConsumedCrc=0,replyRxBytes=0,replyConsumedBytes=0;static bool replyIntegrityComplete=false;
#if defined(VOXI_BOARD_S3G)||defined(VOXI_BOARD_AMOLED)||defined(VOXI_BOARD_MINICAM)
// The measured link has 2–3s gaps. Use PSRAM reserve and keep learned jitter
// protection across turns rather than resetting to the C6's small watermark.
static PlaybackGate playbackGate(4*48000,8*48000,48000,true);
#else
static PlaybackGate playbackGate;
#endif
static size_t fadeRemaining=120;
void playbackDiagnostics(JsonDocument& out){char identity[32];deviceIdentity(identity,sizeof(identity));out["deviceId"]=identity;out["replyTransportFormat"]=replyBytesPerSample==1?"mulaw8-24000":"pcm16-24000";out["replyWireBytesPerSecond"]=replyBytesPerSample*24000;out["board"]=BOARD_NAME;out["psramBytes"]=ESP.getPsramSize();out["freePsramBytes"]=ESP.getFreePsram();out["replyReceivedBytes"]=replyRxBytes;out["replyConsumedBytes"]=replyConsumedBytes;out["replyReceivedCrc"]=replyRxCrc;out["replyConsumedCrc"]=replyConsumedCrc;out["replyIntegrityComplete"]=replyIntegrityComplete;out["replyIntegrityPassed"]=replyIntegrityComplete&&replyRxBytes==replyConsumedBytes&&replyRxCrc==replyConsumedCrc;out["replyGapMaxMs"]=replyGapMaxMs;out["playbackCapacityMs"]=CAP/(replyBytesPerSample*24);out["playbackPeakMs"]=playbackPeakBytes/(replyBytesPerSample*24);out["playbackServiceGapMaxMs"]=playbackServiceGapMaxMs;out["playbackBufferedMs"]=used/(replyBytesPerSample*24);out["playbackRebuffers"]=playbackGate.rebuffers;out["playbackTargetMs"]=playbackGate.targetBytes/(replyBytesPerSample*24);}
volatile bool tx=false,uploading=false;
bool ready=false,ending=false,playing=false,gatewayLinked=false,backendError=false,thinking=false,replyPending=false;
uint32_t played=0,lastReport=0,pressAt=0;
int channel=0; bool stable=false,candidate=false;uint32_t changedAt=0;
int encPrev=0,encSteps=0,pendingChannel=0;uint32_t encAt=0;

struct Packet{WStype_t type;size_t len;uint8_t data[2048];};
struct TxPacket{WStype_t type;size_t len;uint8_t data[2048];};
static QueueHandle_t incoming,outgoing;
static volatile bool resetLink=false,queueFault=false,networkBusy=false,standbyNetworkRequested=false,standbyNetworkReady=false;
static volatile uint32_t networkLoopMaxMs=0,networkSendMaxMs=0,probeStallUntil=0;
static uint8_t micBatch[1920],uploadBlock[1920];static size_t micBatchUsed=0,uploadBlockUsed=0;
static bool uploadEof=false,submitQueued=false;
static volatile bool submitSent=false;
static uint32_t uploadAt=0,uploadProgressAt=0,uploadProgressBytes=0,liveQueuedBytes=0,cachedProducedBytes=0;
static bool liveFallback=false;
static UploadRecovery uploadRecovery;static bool captureSealed=false;
static volatile bool submissionAttempted=false,retryableWriteFailure=false;
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
static bool probeSimulateStall=true,probeAllowRecovery=false;static uint32_t probeTailMs=0;
void requestUploadTest(bool simulateStall,bool allowRecovery){probeAllowRecovery=allowRecovery;probeSimulateStall=simulateStall;probeTailMs=0;probeRequested=true;}
struct TurnTiming {uint32_t confirmed=0,recording=0,released=0,upload=0,firstPcm=0,voice=0,finished=0;};
static TurnTiming turnTiming;static volatile uint32_t turnSubmittedAt=0;
static uint32_t bytesSentAtRelease=0;
static int cloudReleaseToAudioMs=-1,cloudRtpEmittedMs=-1,cloudRtpQueuedMs=-1;
static void resetTurnTiming(){turnTiming={};bytesSentAtRelease=0;turnSubmittedAt=0;cloudReleaseToAudioMs=cloudRtpEmittedMs=cloudRtpQueuedMs=-1;}
static void intervalJson(JsonObject o,const char* name,uint32_t from,uint32_t to){if(from&&to)o[name]=(uint32_t)(to-from);else o[name]=nullptr;}
static void turnTimingJson(JsonDocument& out){
  auto o=out["latency"].to<JsonObject>();
  o["recordedMs"]=radioDebugRead().micBytes/48;
  intervalJson(o,"cueAndGuardMs",turnTiming.confirmed,turnTiming.recording);
  o["streamingUpload"]=true;o["bytesSentAtRelease"]=bytesSentAtRelease;
  if(turnTiming.released&&turnTiming.upload)o["releaseToUploadMs"]=turnTiming.upload<=turnTiming.released?0:(uint32_t)(turnTiming.upload-turnTiming.released);else o["releaseToUploadMs"]=nullptr;
  intervalJson(o,"captureUploadSpanMs",turnTiming.upload,(uint32_t)turnSubmittedAt);
  intervalJson(o,"uploadMs",turnTiming.released,(uint32_t)turnSubmittedAt);
  intervalJson(o,"submittedToFirstPcmMs",(uint32_t)turnSubmittedAt,turnTiming.firstPcm);
  intervalJson(o,"firstPcmToVoiceWriteMs",turnTiming.firstPcm,turnTiming.voice);
  intervalJson(o,"releaseToVoiceWriteMs",turnTiming.released,turnTiming.voice);
  if(cloudReleaseToAudioMs>=0)o["cloudReleaseToAudioMs"]=cloudReleaseToAudioMs;
  if(cloudRtpEmittedMs>=0)o["cloudRtpEmittedMs"]=cloudRtpEmittedMs;
  if(cloudRtpQueuedMs>=0)o["cloudRtpQueuedMs"]=cloudRtpQueuedMs;
  o["dacQueueUpperBoundMs"]=60;
}
static volatile uint32_t wsPings=0,wsPongs=0,wsPingAt=0,wsPongAt=0,wsDisconnectedAt=0,rxPauseAt=0,rxPauseMax=0;
void radioTransportDiagnostics(JsonDocument& out){out["wsPingCount"]=(uint32_t)wsPings;out["wsPongCount"]=(uint32_t)wsPongs;out["lastWsPingAtMs"]=(uint32_t)wsPingAt;out["lastWsPongAtMs"]=(uint32_t)wsPongAt;out["gatewayDisconnectedAtMs"]=(uint32_t)wsDisconnectedAt;out["rxBackpressureActive"]=rxPauseAt!=0;out["rxBackpressureMaxMs"]=max((uint32_t)rxPauseMax,rxPauseAt?millis()-rxPauseAt:0);
turnTimingJson(out);out["uploadRetries"]=uploadRecovery.attempts;out["uploadRetryPending"]=uploadRecovery.pending;out["networkLoopMaxMs"]=(uint32_t)networkLoopMaxMs;out["networkSendMaxMs"]=(uint32_t)networkSendMaxMs;out["uploadProbe"]=probeState;out["uploadProbePassed"]=probePassed;out["uploadProbeTailMs"]=probeTailMs;out["uploadProbeRecoveryEnabled"]=probeAllowRecovery;out["recordingCrc"]=(uint32_t)captureCrc;out["sentCrc"]=(uint32_t)sentCrc;out["uploading"]=uploading;audioCacheDiagnostics(out);}

static void networkFault(const char* reason){if(!queueFault){diagnosticError(reason);queueFault=true;}}
static void socketWriteFault(bool binary,size_t bytes,uint32_t elapsed){if(!queueFault){retryableWriteFailure=true;ws.writeFailure(binary,bytes,elapsed);queueFault=true;}}
static bool sendText(String text){TxPacket p{};p.type=WStype_TEXT;p.len=text.length();if(p.len>sizeof(p.data))return false;memcpy(p.data,text.c_str(),p.len);if(xQueueSend(outgoing,&p,pdMS_TO_TICKS(150))!=pdTRUE){networkFault("TX control queue full");return false;}return true;}
static bool sendAudio(uint8_t* bytes,size_t n){TxPacket p{};p.type=WStype_BIN;p.len=n;if(n>sizeof(p.data))return false;memcpy(p.data,bytes,n);if(xQueueSend(outgoing,&p,pdMS_TO_TICKS(10))!=pdTRUE){networkFault("TX audio queue full");return false;}return true;}
static bool flushMicBatch(){
  if(!micBatchUsed)return true;
  bool ok=audioCacheWrite(micBatch,micBatchUsed);
  if(ok){
    if(uploading&&!liveFallback&&liveQueuedBytes==cachedProducedBytes){
      if(uxQueueMessagesWaiting(outgoing)<6){if(sendAudio(micBatch,micBatchUsed))liveQueuedBytes+=micBatchUsed;}
      else liveFallback=true;
    }
    cachedProducedBytes+=micBatchUsed;
  }
  micBatchUsed=0;
  if(!ok){diagnosticError("Recording cache write failed");queueFault=true;}return ok;
}
static void batchAudio(uint8_t* bytes,size_t n){
  while(n&&!queueFault){size_t count=min(n,sizeof(micBatch)-micBatchUsed);memcpy(micBatch+micBatchUsed,bytes,count);micBatchUsed+=count;bytes+=count;n-=count;if(micBatchUsed==sizeof(micBatch))flushMicBatch();}
}
static void socketEvent(WStype_t type,uint8_t* data,size_t len){
  if(type==WStype_PING){wsPings++;wsPingAt=millis();return;}
  if(type==WStype_PONG){wsPongs++;wsPongAt=millis();return;}
  if(type==WStype_DISCONNECTED)wsDisconnectedAt=millis();
if(type!=WStype_TEXT&&type!=WStype_BIN&&type!=WStype_CONNECTED&&type!=WStype_DISCONNECTED)return;Packet p{};p.type=type;p.len=len;if(len>sizeof(p.data)){networkFault("RX frame exceeds 2048 bytes");return;}if(len)memcpy(p.data,data,len);if(xQueueSend(incoming,&p,pdMS_TO_TICKS(20))!=pdTRUE)networkFault("RX event queue full");}
static void pumpSocket(){
  if(uxQueueSpacesAvailable(incoming)<2){if(!rxPauseAt)rxPauseAt=millis();return;}
  if(rxPauseAt){rxPauseMax=max((uint32_t)rxPauseMax,millis()-rxPauseAt);rxPauseAt=0;}
uint32_t at=millis();ws.loop();networkLoopMaxMs=max((uint32_t)networkLoopMaxMs,millis()-at);}
static void networkTask(void*){
  if(radioConfig.tls)ws.beginSslWithCA(radioConfig.host.c_str(),radioConfig.port,"/radio",radioConfig.ca.c_str());else ws.begin(radioConfig.host.c_str(),radioConfig.port,"/radio");
  char identity[32];deviceIdentity(identity,sizeof(identity));
  authorizationHeader="Authorization: Bearer "+radioConfig.token+"\r\nX-Voxi-Device-Id: "+identity;
#if !defined(VOXI_BOARD_S3G)&&!defined(VOXI_BOARD_AMOLED)&&!defined(VOXI_BOARD_MINICAM)
  authorizationHeader+="\r\nX-Voxi-Audio-Format: mulaw8-24000";
#elif defined(VOXI_BOARD_MINICAM)
  if(radioUsesCellular())authorizationHeader+="\r\nX-Voxi-Audio-Format: mulaw8-24000";
#endif
  ws.setExtraHeaders(authorizationHeader.c_str());ws.onEvent(socketEvent);ws.setReconnectInterval(5000);ws.enableHeartbeat(15000,3000,2);
  TxPacket p;uint32_t retryAt=0;bool heartbeatPaused=false;
  while(true){if(standbyNetworkRequested){ws.disconnect();xQueueReset(outgoing);xQueueReset(incoming);if(standbyNetworkRequested){standbyNetworkReady=true;vTaskSuspend(nullptr);}}
    if(resetLink){resetLink=false;ws.disconnect();xQueueReset(outgoing);diagnosticReconnect();retryAt=millis()+5000;}
    if(radioNetworkConnected()&&(!radioConfig.tls||time(nullptr)>1700000000)&&(int32_t)(millis()-retryAt)>=0){
      if(probeStallUntil&&(int32_t)(millis()-probeStallUntil)<0){vTaskDelay(pdMS_TO_TICKS(10));continue;}
      bool connected=ws.isConnected();
      if(!connected)xQueueReset(outgoing);
      bool sending=connected&&(uploading||uxQueueMessagesWaiting(outgoing)>0);
      if(sending&&!heartbeatPaused){ws.disableHeartbeat();heartbeatPaused=true;}
      if(!sending&&heartbeatPaused){ws.resumeHeartbeat();heartbeatPaused=false;}
      pumpSocket();
      // Flash absorbs slow reads; receive control/heartbeat frames while uploading.
      for(int budget=0;budget<4&&!resetLink&&!queueFault;budget++){
        if(!ws.isConnected()||xQueueReceive(outgoing,&p,0)!=pdTRUE)break;
        networkBusy=true;uint32_t sendAt=millis();
        if(p.type==WStype_TEXT){String c((const char*)p.data,p.len);if(c.indexOf("ptt_up")>=0)submissionAttempted=true;}
        bool sent=p.type==WStype_BIN?ws.sendPcm(p.data,p.len):ws.sendTXT(p.data,p.len);
        networkSendMaxMs=max((uint32_t)networkSendMaxMs,millis()-sendAt);
        if(!sent){networkBusy=false;socketWriteFault(p.type==WStype_BIN,p.len,millis()-sendAt);pumpSocket();break;}
        if(p.type==WStype_BIN){sentCrc=esp_rom_crc32_le(sentCrc,p.data,p.len);radioDebugTx(p.len);}
        else{String text((const char*)p.data,p.len);if(text.indexOf("ptt_up")>=0){turnSubmittedAt=millis();submitSent=true;radioDebug("WAIT AI","PTT UP sent to gateway");}}
        networkBusy=false;
        if(!uploading&&uxQueueMessagesWaiting(outgoing)==0)pumpSocket();
      }
    }
    else xQueueReset(outgoing);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}
bool radioPrepareStandby(){
 if(!incoming||!outgoing)return true;
 standbyNetworkReady=false;standbyNetworkRequested=true;uint32_t at=millis();
 while(!standbyNetworkReady&&millis()-at<5000)delay(10);
 if(!standbyNetworkReady){standbyNetworkRequested=false;return false;}
 return true;
}
void control(const char* type){JsonDocument d;d["type"]=type;String s;serializeJson(d,s);sendText(s);}
void flushAudio(){cueActive=replyCuePending=micCueGuard=false;playbackGate.reset();fadeRemaining=120;head=tail=used=0;ending=playing=thinking=false;played=0;audioFlush();}
static bool deferUploadRecovery(){
  if(uploadRecovery.pending){ready=false;return true;}
  if(!uploadRecovery.request(millis(),uploading,submissionAttempted,(probeActive||probeFinishing)&&!probeAllowRecovery))return false;
  uploading=false;ready=false;thinking=false;replyPending=false;liveFallback=true;resetLink=true;
  if(!tx)audioCacheClose();
  radioDebug(tx?"RECORDING":"RETRY LINK","Keep recording: cache retry");return true;
}
void fault(){if(retryableWriteFailure){retryableWriteFailure=false;if(deferUploadRecovery())return;}uploadRecovery.pending=false;replyPending=false;audioCacheClose();uploading=false;micBatchUsed=0;if(probeActive||probeFinishing){probeState="failed";probeActive=false;probeFinishing=false;probePassed=false;}radioDebug("ERROR","Audio/queue fault: reconnect");ready=false;tx=false;thinking=false;flushAudio();resetLink=true;Serial.println("Link reset");}
void onWs(WStype_t t,uint8_t* data,size_t len){
  if(t==WStype_DISCONNECTED){gatewayLinked=false;if(deferUploadRecovery())return;if(playing||thinking||replyPending)diagnosticTurnFailure("Gateway disconnected during reply");replyPending=false;audioCacheClose();uploading=false;micBatchUsed=0;if(probeActive||probeFinishing){probeActive=false;probeFinishing=false;probePassed=false;probeState="failed";}radioDebug("OFFLINE","Gateway disconnected");gatewayLinked=false;diagnosticStage(backendError?"backend_error":"disconnected");ready=false;tx=false;thinking=false;flushAudio();if(!setupScreenActive())displayChannel(channel,false);return;}
  if(t==WStype_CONNECTED){radioDebug("WAIT AI","Gateway connected");gatewayLinked=true;diagnosticStage("cloud_handshake");ready=false;return;}
  if(t==WStype_BIN){
    if(!turnTiming.firstPcm)turnTiming.firstPcm=millis();
    radioDebugRx(len);
    if(playing){uint32_t now=millis();if(lastReplyPacketAt)replyGapMaxMs=max(replyGapMaxMs,now-lastReplyPacketAt);lastReplyPacketAt=now;}
    if(tx)return;
    if(len%replyBytesPerSample||len>CAP-used){diagnosticError(len%replyBytesPerSample?"Reply PCM sample alignment error":"Reply playback buffer overflow");diagnosticTurnFailure(len%replyBytesPerSample?"Reply PCM sample alignment error":"Reply playback buffer overflow");fault();return;}
    replyRxCrc=esp_rom_crc32_le(replyRxCrc,data,len);replyRxBytes+=len;
    for(size_t i=0;i<len;i++){playback[head]=data[i];head=(head+1)%CAP;}used+=len;playbackPeakBytes=max(playbackPeakBytes,used);return;
  }
  if(t!=WStype_TEXT)return;
  JsonDocument d;if(deserializeJson(d,data,len))return;
  String type=d["type"]|"";
  if(type=="timing"){cloudReleaseToAudioMs=d["releaseToAudioStartMs"]|-1;cloudRtpEmittedMs=d["rtpEmittedMs"]|-1;cloudRtpQueuedMs=d["rtpQueuedMs"]|-1;}
  if(type=="ready"){
#ifdef VOXI_BOARD_MINICAM
    if(radioUsesCellular()){
      size_t negotiated=String(d["audioFormat"]|"")=="mulaw8-24000"?1:2;
      if(negotiated!=replyBytesPerSample||playbackGate.initialBytes!=6*24000*negotiated){replyBytesPerSample=negotiated;playbackGate.configure(6*24000*negotiated,12*24000*negotiated,2*24000*negotiated,true);}
      // A mid-sentence refill must not repeat the growing 6--12s startup reserve.
      playbackGate.resumeBytes=2*24000*negotiated;
    }
#endif
#if !defined(VOXI_BOARD_S3G)&&!defined(VOXI_BOARD_AMOLED)&&!defined(VOXI_BOARD_MINICAM)
    size_t negotiated=String(d["audioFormat"]|"")=="mulaw8-24000"?1:2;
    if(negotiated!=replyBytesPerSample){replyBytesPerSample=negotiated;if(negotiated==1)playbackGate.configure(72000,86400,7200,true);else playbackGate.configure(67200,81600,7200,true);}
#endif
    if(uploading||replyPending)return;
    int actual=d["channel"]|0;
    if(actual!=channel){JsonDocument c;c["type"]="channel";c["channel"]=channel;String s;serializeJson(c,s);sendText(s);}
    else{if(uploadRecovery.pending&&tx){ready=true;backendError=false;diagnosticError("");radioDebug("RECORDING","Link restored: keep recording");return;}radioDebug("READY","Cloud READY confirmed");backendError=false;diagnosticError("");diagnosticStage("ready");thinking=false;ready=true;if(!setupScreenActive())displayChannel(channel,true);Serial.printf("Channel %d ready\n",channel+1);}
  }
  if(uploadRecovery.pending&&(type=="connecting"||type=="offline"||type=="error")){
    ready=false;if(type!="connecting"){diagnosticError(d["message"]|"Upload reconnect unavailable");resetLink=true;}return;
  }
  if(type=="connecting"||type=="offline"||type=="error"){if(type!="connecting"&&(playing||thinking||replyPending))diagnosticTurnFailure(d["message"]|"Pocket disconnected during reply");if(type!="connecting"){replyPending=false;audioCacheClose();uploading=false;}ready=false;tx=false;thinking=false;flushAudio();Serial.write(data,len);Serial.println();diagnosticStage(type=="connecting"?"cloud_connecting":"cloud_error");if(type!="connecting"){radioDebug("ERROR","Cloud error: see USB web");backendError=true;diagnosticError(d["message"]|"cloud unavailable");resetLink=true;}}
  if(type=="recording")radioDebug(tx?"RECORDING":"SENDING","Gateway recording ACK");
  if(type=="thinking")radioDebug("WAIT AI","Gateway submitted audio");
  if(type=="busy"){ready=false;thinking=true;}
  if(type=="flush")flushAudio();
  if(type=="idle"){replyPending=false;ready=gatewayLinked;radioDebug("READY","Clip too short: not sent");thinking=false;}
  if(type=="audio_start"){replyRxCrc=replyConsumedCrc=replyRxBytes=replyConsumedBytes=0;replyIntegrityComplete=false;lastReplyPacketAt=replyGapMaxMs=0;playbackServiceAt=playbackServiceGapMaxMs=0;playbackPeakBytes=0;replyCuePending=true;playbackGate.reset();fadeRemaining=120;radioDebug("PLAYING","Reply audio started");thinking=false;played=0;ending=false;playing=true;}
  if(type=="audio_end"){replyPending=false;radioDebug("DRAINING","Reply stream ended");ending=true;}
}
static bool startCachedUpload(bool test){
  submissionAttempted=false;liveQueuedBytes=cachedProducedBytes=0;liveFallback=false;
  if(!tx&&!audioCacheOpenUpload()){diagnosticError("Cannot reopen recording cache");fault();return false;}
  uploading=true;ready=false;thinking=false;uploadBlockUsed=0;uploadEof=false;submitQueued=false;submitSent=false;uploadAt=uploadProgressAt=millis();turnTiming.upload=uploadAt;uploadProgressBytes=0;
  probeStallUntil=test&&probeSimulateStall?millis()+3500:0;
  control("ptt_down");radioDebug("SENDING",test?(probeSimulateStall?"Test: 3.5s network stall":"Test: normal live uplink"):(tx?"Recording: live uplink":"Cache tail: upload"));return true;
}
static void cachedUploadTick(){
  if(!uploading)return;
  auto progress=radioDebugRead();
  if(progress.txBytes!=uploadProgressBytes){uploadProgressBytes=progress.txBytes;uploadProgressAt=millis();}
  if(millis()-uploadAt>UPLOAD_MAX_MS||millis()-uploadProgressAt>UPLOAD_STALL_MS){diagnosticError("Cached upload timed out; recording kept");fault();return;}
  if(tx)return; // Never seek/read the recording file while the microphone is active.
  if(uxQueueMessagesWaiting(outgoing)<6&&!uploadEof){
    if(!uploadBlockUsed){uploadBlockUsed=audioCacheRead(uploadBlock,sizeof(uploadBlock));if(!uploadBlockUsed){if(tx)return;if(!audioCacheEnd()){diagnosticError("Recording cache read failed");fault();return;}uploadEof=true;}}
    if(uploadBlockUsed&&sendAudio(uploadBlock,uploadBlockUsed))uploadBlockUsed=0;
  }
  if(uploadEof&&!uploadBlockUsed&&uxQueueMessagesWaiting(outgoing)<6){
    if(probeFinishing){
      if(!networkBusy&&uxQueueMessagesWaiting(outgoing)==0){auto d=radioDebugRead();probePassed=d.micBytes==RECORDING_MAX_BYTES&&d.micBytes==d.txBytes&&captureCrc==sentCrc;probeTailMs=turnTiming.released?millis()-turnTiming.released:0;probeState=probePassed?"passed":"failed";probeFinishing=false;uploading=false;audioCacheRemove();resetLink=true;radioDebug(probePassed?"UPLOAD PASS":"UPLOAD FAIL","Cached test done: reconnect");}
    }else{
      if(!submitQueued){replyPending=true;control("ptt_up");submitQueued=true;}
      if(submitSent){uploading=false;thinking=true;audioCacheRemove();radioDebug("WAIT AI","Upload complete: awaiting AI");}
    }
  }
}
bool radioCanStartRecording(){return ready&&!tx&&!uploading&&!thinking&&!playing&&!audioCacheBusy()&&!probeActive&&!probeFinishing&&!uploadRecovery.pending;}
bool radioRecordingActive(){return tx;}
static PttHold ptt;
void button(){
  if(standbySuppressInput())return;
  if(probeActive||probeFinishing||(uploading&&!tx))return;
#ifdef VOXI_BOARD_MINICAM
  // MiniCam supplies the debounced physical key, sharing the normal hold-to-talk policy.
  bool down=boardTouchPttPressed();
#else
  bool down=digitalRead(PIN_PTT)==LOW||boardTouchPttPressed();
#endif
  if(down!=candidate){
    candidate=down;changedAt=millis();
    // READY is recording availability, not transport liveness. A blocked key
    // during a reply must not overwrite PLAYING/BUFFERING with NOT READY.
    bool busy=tx||playing||thinking||uploading||replyPending;
    if(down&&!busy)radioDebug(radioCanStartRecording()?"HOLD 0.3s":(gatewayLinked?"WAIT AI":"OFFLINE"),radioCanStartRecording()?"PTT down: hold 0.3s":"PTT blocked: waiting for AI");
    else if(!down&&!busy&&ptt.held)radioDebug(ready?"READY":(gatewayLinked?"WAIT AI":"OFFLINE"),"Short press: no recording");
  }
  if(candidate!=stable&&millis()-changedAt>=15)stable=candidate;
  auto action=ptt.update(millis(),stable,(tx||(ready&&!audioCacheBusy()))&&!thinking&&!playing,boardPowerPressed());
  if(action==PttHold::Start){
    if(!audioCacheStart()){radioDebug("CACHE ERROR","Cannot start local recording");diagnosticError("Audio cache start failed");return;}
    uploadRecovery.reset();captureSealed=false;submissionAttempted=retryableWriteFailure=false;resetTurnTiming();turnTiming.confirmed=millis();micBatchUsed=0;captureCrc=0;sentCrc=0;radioDebugReset();radioDebug("RECORDING","REC started: release to send");
    flushAudio();
    // Never include audio from the initial 0.3s hold threshold.
    int16_t discard[240];for(int i=0;i<5;i++)audioRead(discard,240);
    tx=true;thinking=false;pressAt=millis();micCueGuard=true;startRadioCue();
    radioDebug("OPEN MIC","TX squelch: mic guard");diagnosticStage("recording");
    Serial.println("VOXI_PTT recording");
  }else if(action==PttHold::Stop&&tx){
    micCueGuard=false;
    turnTiming.released=millis();bytesSentAtRelease=radioDebugRead().txBytes;tx=false;
    if(!radioDebugRead().micBytes&&!uploading){audioCacheRemove();flushAudio();radioDebug("READY","Released during TX cue");return;}
    if(!flushMicBatch()||!audioCacheFinish()){fault();return;}
    captureSealed=true;if(uploadRecovery.pending){radioDebug("RETRY LINK","Recording saved: reconnect");return;}
    if(uploading){if(!audioCacheOpenUpload(liveQueuedBytes))fault();}else startCachedUpload(false);
  }
}

void requestChannelDelta(int delta){standbyActivity();pendingChannel=(pendingChannel+delta+4)%4;encAt=millis();}
void encoder(){
  int action=bleAction();if(action&1){pendingChannel=(pendingChannel+1)%4;encAt=millis();}if(action&2){pendingChannel=(pendingChannel+3)%4;encAt=millis();}
  static const int8_t table[]={0,-1,1,0,1,0,0,-1,-1,0,0,1,0,1,-1,0};
  int now=PIN_ENC_A>=0&&PIN_ENC_B>=0?(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B):encPrev;
  if(now!=encPrev){encSteps+=table[(encPrev<<2)|now];encPrev=now;
    if(abs(encSteps)>=4){pendingChannel=(pendingChannel+(encSteps>0?1:3))%4;encSteps=0;encAt=millis();}}
  // Coalesce rapid rotation, and defer switching until PTT is released.
  if(!stable&&!uploading&&!uploadRecovery.pending&&!thinking&&!playing&&pendingChannel!=channel&&millis()-encAt>180){
    tx=false;ready=false;flushAudio();channel=pendingChannel;if(!setupScreenActive())displayChannel(channel,false);
    JsonDocument d;d["type"]="channel";d["channel"]=channel;String s;serializeJson(d,s);sendText(s);
  }
}
void audioTick(){
  int16_t mic[240];size_t samples=audioRead(mic,240);
  radioCueTick();
  if(micCueGuard&&!cueActive&&(int32_t)(millis()-micResumeAt)>=0){
    micCueGuard=false;ptt.started=millis();turnTiming.recording=millis();if(!uploading&&!startCachedUpload(false))return;radioDebug("RECORDING","REC started: release to send");
  }
  if(tx&&!micCueGuard&&samples){samples=min(samples,(size_t)((RECORDING_MAX_BYTES-radioDebugRead().micBytes)/2));if(probeActive)for(size_t i=0;i<samples;i++){probeRandom=probeRandom*1664525u+1013904223u;mic[i]=(int16_t)((probeRandom>>20)&1023)-512;}unsigned peak=0;for(size_t i=0;i<samples;i++)peak=max(peak,(unsigned)abs((int)mic[i]));captureCrc=esp_rom_crc32_le(captureCrc,(const uint8_t*)mic,samples*2);radioDebugMic(samples*2,peak);batchAudio((uint8_t*)mic,samples*2);
    if(tx&&radioDebugRead().micBytes>=RECORDING_MAX_BYTES){
      turnTiming.released=millis();bytesSentAtRelease=radioDebugRead().txBytes;tx=false;if(!flushMicBatch()||!audioCacheFinish()){fault();return;}
      if(probeActive){probeActive=false;probeFinishing=true;probeState="uploading";}
      captureSealed=true;if(uploadRecovery.pending){radioDebug("RETRY LINK","20s saved: reconnect");return;}
      radioDebug("SENDING","20s limit: recording stopped");if(uploading){if(!audioCacheOpenUpload(liveQueuedBytes))fault();}else startCachedUpload(probeFinishing);
    }
  }
  // Watermarks apply only when priming/refilling, never to continuous playback.
  if(playing){uint32_t now=millis();if(playbackServiceAt)playbackServiceGapMaxMs=max(playbackServiceGapMaxMs,now-playbackServiceAt);playbackServiceAt=now;}
  // If input runs dry, count it and refill before restarting.
  uint32_t previousRefills=playbackGate.rebuffers;
  bool waitingForBuffer=!playbackGate.primed;
  for(int budget=0;budget<6&&!tx&&playing&&!cueActive&&playbackGate.canWrite(used,ending);budget++){
    if(replyCuePending){replyCuePending=false;startRadioCue();radioDebug("PLAYING","RX squelch: reply begins");return;}
    if(waitingForBuffer){radioDebug("PLAYING","Audio buffer ready: resumed");waitingForBuffer=false;}
    size_t count=min(used/replyBytesPerSample,(size_t)240);int16_t mono[240];
    for(size_t i=0;i<count;i++){int16_t sample;if(replyBytesPerSample==1)sample=decodeMulaw(playback[(tail+i)%CAP]);else{uint8_t lo=playback[(tail+2*i)%CAP],hi=playback[(tail+2*i+1)%CAP];sample=(int16_t)(lo|(hi<<8));}mono[i]=playbackEnvelope(sample,i,fadeRemaining,used/replyBytesPerSample);}
    size_t written=count?audioWrite(mono,count):0;
    if(!written)break; // DMA full: retry next loop without consuming any PCM.
    if(written&&!turnTiming.voice)turnTiming.voice=millis();
    fadeRemaining=written>=fadeRemaining?0:fadeRemaining-written;
    size_t consumed=written*replyBytesPerSample;
    size_t first=min(consumed,CAP-tail);replyConsumedCrc=esp_rom_crc32_le(replyConsumedCrc,playback+tail,first);
    if(first<consumed)replyConsumedCrc=esp_rom_crc32_le(replyConsumedCrc,playback,consumed-first);
    replyConsumedBytes+=consumed;
    tail=(tail+consumed)%CAP;used-=consumed;played+=written;if(used==0)fadeRemaining=120;
    if(ending&&used==0){replyIntegrityComplete=true;turnTiming.finished=millis();radioDebug(ready?"READY":"WAIT AI","Speaker playback complete");playing=false;ending=false;thinking=false;}
  }
  if(playbackGate.rebuffers!=previousRefills){fadeRemaining=120;radioDebug("BUFFERING","Audio jitter: refilling");}
  if(!tx&&playing&&ending&&used==0){replyIntegrityComplete=true;playing=ending=thinking=false;turnTiming.finished=millis();radioDebug(ready?"READY":"WAIT AI","Speaker playback complete");}
  if(millis()-lastReport>250){lastReport=millis();JsonDocument d;d["type"]="played";
    // Approximate DAC position: subtract maximum queued DMA (60 ms).
    static uint32_t lastReported=UINT32_MAX;
    d["ms"]=played>1440?(played-1440)/24:0;String s;serializeJson(d,s);
    // A synchronous TLS write must not block incoming speech just to report position.
    if(ready&&!tx&&!uploading&&!playing&&!cueActive&&played!=lastReported&&sendText(s))lastReported=played;}
}
void setup(){
  Serial.setRxBufferSize(16384);Serial.setTxBufferSize(8192);Serial.begin(115200);pinMode(PIN_PTT,INPUT_PULLUP);if(PIN_ENC_A>=0)pinMode(PIN_ENC_A,INPUT_PULLUP);if(PIN_ENC_B>=0)pinMode(PIN_ENC_B,INPUT_PULLUP);
  if(BOARD_POWER_KEY>=0)pinMode(BOARD_POWER_KEY,INPUT_PULLUP);
  encPrev=PIN_ENC_A>=0&&PIN_ENC_B>=0?(digitalRead(PIN_ENC_A)<<1)|digitalRead(PIN_ENC_B):0;
  diagnosticsBegin();boardInit();audioCacheInit();setupBegin();standbyBegin();
#if defined(VOXI_BOARD_S3G)||defined(VOXI_BOARD_AMOLED)||defined(VOXI_BOARD_MINICAM)
  playback=(uint8_t*)heap_caps_malloc(CAP,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  if(!playback){diagnosticError("S3 PSRAM unavailable: check OPI PSRAM settings");radioConfig.valid=false;}
#endif
  if(!radioConfig.valid){radioDebug("SETUP NEEDED","Cloud config not saved");displayConnection(channel,"SETUP NEEDED",radioNetworkConnected(),false,HWCDC::isPlugged());return;}
  displayChannel(channel,false);
  if(radioConfig.tls&&!radioUsesCellular())configTime(0,0,"ntp.tencent.com","pool.ntp.org");
  incoming=xQueueCreate(8,sizeof(Packet));outgoing=xQueueCreate(8,sizeof(TxPacket));
#if defined(VOXI_BOARD_S3G)||defined(VOXI_BOARD_AMOLED)||defined(VOXI_BOARD_MINICAM)
  BaseType_t networkStarted=incoming&&outgoing?xTaskCreatePinnedToCore(networkTask,"radio-network",12288,nullptr,2,nullptr,0):pdFAIL;
#else
  BaseType_t networkStarted=incoming&&outgoing?xTaskCreate(networkTask,"radio-network",12288,nullptr,1,nullptr):pdFAIL;
#endif
  if(networkStarted!=pdPASS){diagnosticError("network task allocation failed");radioConfig.valid=false;}

}
void loop(){
  displayDebugTick();boardStatusTick();setupTick(tx||uploading||uploadRecovery.pending||playing||thinking||cueActive||audioCacheBusy(),ready,channel);
  if(speakerTestPending()&&!tx&&!uploading&&!playing&&!thinking)speakerTestRun();
  if(!radioConfig.valid){
    button();
    static uint32_t screenAt=0;if(millis()-screenAt>1000&&!setupScreenActive()){screenAt=millis();displayConnection(channel,"SETUP NEEDED",radioNetworkConnected(),false,HWCDC::isPlugged());}
    int16_t discard[240];audioRead(discard,240);delay(1);return;
  }
  Packet p;
  for(int i=0;i<8&&xQueuePeek(incoming,&p,0)==pdTRUE;i++){
    // Leave a valid PCM frame queued until playback frees room. This pauses
    // socket reads via the bounded incoming queue, instead of discarding audio.
    if(p.type==WStype_BIN&&p.len%replyBytesPerSample==0&&p.len<=CAP&&p.len>CAP-used)break;
    if(xQueueReceive(incoming,&p,0)!=pdTRUE)break;
    onWs(p.type,p.data,p.len);
  }
  if(queueFault){queueFault=false;fault();}
  if(probeRequested&&ready&&!audioCacheBusy()&&!tx&&!uploading&&!playing&&!thinking){
    probeRequested=false;
    if(audioCacheStart()){probeActive=true;probePassed=false;probeState="recording";probeRandom=0x564f5849;probeAt=millis();uploadRecovery.reset();captureSealed=false;submissionAttempted=retryableWriteFailure=false;resetTurnTiming();turnTiming.recording=probeAt;micBatchUsed=0;captureCrc=0;sentCrc=0;networkLoopMaxMs=networkSendMaxMs=0;radioDebugReset();flushAudio();tx=true;radioDebug("UPLOAD TEST","Recording 20s synthetic PCM");startCachedUpload(true);}
    else{probeState="failed";diagnosticError("Audio cache start failed");}
  }
  if(probeActive&&millis()-probeAt>30000){diagnosticError("Recording probe capture stalled");fault();}
  if(cueRequested&&!tx&&!uploading&&!playing&&!thinking){cueRequested=false;flushAudio();startRadioCue();radioDebug("SQUELCH TEST","Local 220ms radio static");}
  if(uploadRecovery.expired(millis())){uploadRecovery.pending=false;diagnosticError("Upload reconnect timed out; cache kept");fault();}
  if(uploadRecovery.pending&&captureSealed&&!tx&&ready&&!audioCacheBusy()){
    uploadRecovery.begin();sentCrc=0;radioDebugRestartTx();startCachedUpload(false);
  }
  cachedUploadTick();
  static bool wifiWas=false;bool wifiNow=radioNetworkConnected();if(wifiNow!=wifiWas){wifiWas=wifiNow;radioDebug(wifiNow?"WAIT AI":(radioUsesCellular()?"NO 4G":"NO WIFI"),wifiNow?(radioUsesCellular()?"4G connected":"WiFi connected"):(radioUsesCellular()?"4G disconnected":"WiFi disconnected"));}
  if(!radioNetworkConnected()){if(uploading)deferUploadRecovery();if(!uploadRecovery.pending){if(ready||tx||playing||used)flushAudio();tx=false;}ready=false;diagnosticStage(radioUsesCellular()?"cellular_connecting":"wifi_connecting");}
  button();encoder();audioTick();
  static uint32_t lastScreen=0;
  if(millis()-lastScreen>500){lastScreen=millis();
    bool wifi=radioNetworkConnected();
    const char* label=!wifi?(radioUsesCellular()?"4G CONNECT":"WIFI CONNECT"):radioConfig.tls&&time(nullptr)<=1700000000?"SYNC TIME":tx?"RECORDING":uploading?"SENDING":thinking?"THINKING":playing?"RECEIVING":ready?"READY":backendError?"BACKEND ERROR":gatewayLinked?"AI CONNECTING":"CLOUD CONNECT";
    if(tx)diagnosticStage("recording");else if(uploading)diagnosticStage("sending");else if(thinking)diagnosticStage("thinking");else if(playing)diagnosticStage("receiving");else if(ready)diagnosticStage("ready");
    else diagnosticStage(!wifi?(radioUsesCellular()?"cellular_connecting":"wifi_connecting"):radioConfig.tls&&time(nullptr)<=1700000000?"sync_time":backendError?"backend_error":gatewayLinked?"ai_connecting":"gateway_connecting");
    if(!setupScreenActive())displayConnection(channel,label,wifi,gatewayLinked,HWCDC::isPlugged());
  }
  standbyTick(tx||uploading||uploadRecovery.pending||playing||thinking||replyPending||cueActive||audioCacheBusy()||speakerTestPending(),!radioConfig.valid||(WiFi.getMode()&WIFI_AP));
  delay(1);
}
