#include "diagnostics.h"
#include <esp_system.h>
#include <esp_heap_caps.h>
#include <time.h>
RTC_DATA_ATTR static uint32_t magic=0,boots=0;
static char stage[32]="starting",lastError[192]={},lastFault[192]={};
static uint32_t lastFaultAt=0,turnFailureAt=0;
static char turnFailure[192]={};
static uint32_t reconnects=0;
static uint32_t wifiLostAt=0,wifiRestoredAt=0,wifiLossCount=0;static int wifiLossReason=0;static uint64_t wifiLostEpochMs=0;
static portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
void diagnosticsBegin(){if(magic!=0x564F5849){magic=0x564F5849;boots=0;}boots++;Serial.printf("VOXI_BOOT count=%lu reason=%d\n",(unsigned long)boots,(int)esp_reset_reason());}
void diagnosticStage(const char* s){portENTER_CRITICAL(&lock);strlcpy(stage,s,sizeof(stage));portEXIT_CRITICAL(&lock);}
void diagnosticError(const char* s){portENTER_CRITICAL(&lock);strlcpy(lastError,s,sizeof(lastError));if(s[0]){strlcpy(lastFault,s,sizeof(lastFault));lastFaultAt=millis();}portEXIT_CRITICAL(&lock);}
void diagnosticTurnFailure(const char* reason){portENTER_CRITICAL(&lock);if(!turnFailure[0]){strlcpy(turnFailure,reason,sizeof(turnFailure));turnFailureAt=millis();}portEXIT_CRITICAL(&lock);}
void diagnosticReconnect(){portENTER_CRITICAL(&lock);reconnects++;portEXIT_CRITICAL(&lock);}
void diagnosticWifiEvent(bool connected,int reason){
  uint32_t at=millis();time_t epoch=time(nullptr);
  portENTER_CRITICAL(&lock);
  if(connected)wifiRestoredAt=at;
  else{wifiLostAt=at;wifiLossReason=reason;wifiLossCount++;wifiLostEpochMs=epoch>1700000000?(uint64_t)epoch*1000:0;}
  portEXIT_CRITICAL(&lock);
}
void diagnosticsJson(JsonDocument& d){
  char s[32],e[192],f[192],turn[192];uint32_t n,faultAt,turnAt;
  portENTER_CRITICAL(&lock);strlcpy(s,stage,sizeof(s));strlcpy(e,lastError,sizeof(e));n=reconnects;strlcpy(f,lastFault,sizeof(f));faultAt=lastFaultAt;strlcpy(turn,turnFailure,sizeof(turn));turnAt=turnFailureAt;portEXIT_CRITICAL(&lock);
  d["turnFailure"]=turn;d["turnFailureAtMs"]=turnAt;d["lastFault"]=f;d["lastFaultAtMs"]=faultAt;d["connectionStage"]=s;d["lastError"]=e;d["uptimeMs"]=millis();d["bootCount"]=boots;d["resetReason"]=(int)esp_reset_reason();
  uint32_t lost,restored,losses;int reason;uint64_t epoch;
  portENTER_CRITICAL(&lock);lost=wifiLostAt;restored=wifiRestoredAt;losses=wifiLossCount;reason=wifiLossReason;epoch=wifiLostEpochMs;portEXIT_CRITICAL(&lock);
  d["wifiDisconnectedAtMs"]=lost;d["wifiConnectedAtMs"]=restored;d["wifiDisconnectCount"]=losses;d["wifiDisconnectReason"]=reason;d["wifiDisconnectedEpochMs"]=epoch;
  auto flowState=radioDebugRead();auto flowJson=d["radioDebug"].to<JsonObject>();flowJson["phase"]=flowState.phase;flowJson["micBytes"]=flowState.micBytes;flowJson["sentBytes"]=flowState.txBytes;flowJson["receivedBytes"]=flowState.rxBytes;flowJson["micPeak"]=flowState.peak;auto rows=flowJson["events"].to<JsonArray>();for(auto& row:flowState.logs)if(row[0])rows.add(row);
  d["internalFreeHeap"]=heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);d["internalLargestFreeBlock"]=heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);d["freeHeap"]=ESP.getFreeHeap();d["minFreeHeap"]=ESP.getMinFreeHeap();d["reconnects"]=n;
}

static RadioDebugSnapshot flow;
void radioDebug(const char* phase,const char* event){
  char row[32];snprintf(row,sizeof(row),"%lus %s",(unsigned long)(millis()/1000),event);
  portENTER_CRITICAL(&lock);
  if(phase&&phase[0])strlcpy(flow.phase,phase,sizeof(flow.phase));
  memcpy(flow.logs[0],flow.logs[1],sizeof(flow.logs[0]));memcpy(flow.logs[1],flow.logs[2],sizeof(flow.logs[1]));strlcpy(flow.logs[2],row,sizeof(flow.logs[2]));
  portEXIT_CRITICAL(&lock);
}
void radioDebugReset(){portENTER_CRITICAL(&lock);turnFailure[0]=0;turnFailureAt=0;flow.micBytes=flow.txBytes=flow.rxBytes=0;flow.peak=0;portEXIT_CRITICAL(&lock);}
void radioDebugMic(size_t bytes,unsigned peak){portENTER_CRITICAL(&lock);flow.micBytes+=bytes;flow.peak=max(flow.peak,peak);portEXIT_CRITICAL(&lock);}
void radioDebugRestartTx(){portENTER_CRITICAL(&lock);flow.txBytes=0;portEXIT_CRITICAL(&lock);}
void radioDebugTx(size_t bytes){portENTER_CRITICAL(&lock);flow.txBytes+=bytes;portEXIT_CRITICAL(&lock);}
void radioDebugRx(size_t bytes){portENTER_CRITICAL(&lock);flow.rxBytes+=bytes;portEXIT_CRITICAL(&lock);}
RadioDebugSnapshot radioDebugRead(){portENTER_CRITICAL(&lock);auto result=flow;portEXIT_CRITICAL(&lock);return result;}
