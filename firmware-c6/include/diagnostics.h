#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
void diagnosticsBegin();
void diagnosticsJson(JsonDocument& out);
void diagnosticStage(const char* stage);
void diagnosticError(const char* error);
void diagnosticReconnect();
void diagnosticWifiEvent(bool connected,int reason=0);
void diagnosticTurnFailure(const char* reason);

struct RadioDebugSnapshot {
  char phase[24]="WAIT CLOUD",logs[3][32]={};
  uint32_t micBytes=0,txBytes=0,rxBytes=0;unsigned peak=0;
};
void radioDebug(const char* phase,const char* event);
void radioDebugReset();
void radioDebugMic(size_t bytes,unsigned peak);
void radioDebugTx(size_t bytes);
void radioDebugRestartTx();
void radioDebugRx(size_t bytes);
RadioDebugSnapshot radioDebugRead();
