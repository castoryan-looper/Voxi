#include "diagnostics.h"
#include <esp_system.h>
RTC_DATA_ATTR static uint32_t magic=0,boots=0;
static char stage[32]="starting",lastError[192]={};
static uint32_t reconnects=0;
static portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
void diagnosticsBegin(){if(magic!=0x564F5849){magic=0x564F5849;boots=0;}boots++;Serial.printf("VOXI_BOOT count=%lu reason=%d\n",(unsigned long)boots,(int)esp_reset_reason());}
void diagnosticStage(const char* s){portENTER_CRITICAL(&lock);strlcpy(stage,s,sizeof(stage));portEXIT_CRITICAL(&lock);}
void diagnosticError(const char* s){portENTER_CRITICAL(&lock);strlcpy(lastError,s,sizeof(lastError));portEXIT_CRITICAL(&lock);}
void diagnosticReconnect(){portENTER_CRITICAL(&lock);reconnects++;portEXIT_CRITICAL(&lock);}
void diagnosticsJson(JsonDocument& d){
  char s[32],e[192];uint32_t n;
  portENTER_CRITICAL(&lock);strlcpy(s,stage,sizeof(s));strlcpy(e,lastError,sizeof(e));n=reconnects;portEXIT_CRITICAL(&lock);
  d["connectionStage"]=s;d["lastError"]=e;d["uptimeMs"]=millis();d["bootCount"]=boots;d["resetReason"]=(int)esp_reset_reason();
  auto flowState=radioDebugRead();auto flowJson=d["radioDebug"].to<JsonObject>();flowJson["phase"]=flowState.phase;flowJson["micBytes"]=flowState.micBytes;flowJson["sentBytes"]=flowState.txBytes;flowJson["receivedBytes"]=flowState.rxBytes;flowJson["micPeak"]=flowState.peak;auto rows=flowJson["events"].to<JsonArray>();for(auto& row:flowState.logs)if(row[0])rows.add(row);
  d["freeHeap"]=ESP.getFreeHeap();d["minFreeHeap"]=ESP.getMinFreeHeap();d["reconnects"]=n;
}

static RadioDebugSnapshot flow;
void radioDebug(const char* phase,const char* event){
  char row[32];snprintf(row,sizeof(row),"%lus %s",(unsigned long)(millis()/1000),event);
  portENTER_CRITICAL(&lock);
  if(phase&&phase[0])strlcpy(flow.phase,phase,sizeof(flow.phase));
  memcpy(flow.logs[0],flow.logs[1],sizeof(flow.logs[0]));memcpy(flow.logs[1],flow.logs[2],sizeof(flow.logs[1]));strlcpy(flow.logs[2],row,sizeof(flow.logs[2]));
  portEXIT_CRITICAL(&lock);
}
void radioDebugReset(){portENTER_CRITICAL(&lock);flow.micBytes=flow.txBytes=flow.rxBytes=0;flow.peak=0;portEXIT_CRITICAL(&lock);}
void radioDebugMic(size_t bytes,unsigned peak){portENTER_CRITICAL(&lock);flow.micBytes+=bytes;flow.peak=max(flow.peak,peak);portEXIT_CRITICAL(&lock);}
void radioDebugTx(size_t bytes){portENTER_CRITICAL(&lock);flow.txBytes+=bytes;portEXIT_CRITICAL(&lock);}
void radioDebugRx(size_t bytes){portENTER_CRITICAL(&lock);flow.rxBytes+=bytes;portEXIT_CRITICAL(&lock);}
RadioDebugSnapshot radioDebugRead(){portENTER_CRITICAL(&lock);auto result=flow;portEXIT_CRITICAL(&lock);return result;}
