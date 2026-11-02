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
  d["freeHeap"]=ESP.getFreeHeap();d["minFreeHeap"]=ESP.getMinFreeHeap();d["reconnects"]=n;
}
