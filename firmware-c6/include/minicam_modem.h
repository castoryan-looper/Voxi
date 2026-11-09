#pragma once
#include <ArduinoJson.h>
void minicamModemBegin();
void minicamModemConfigure(bool enabled,const char* apn);
void minicamModemDiagnostics(JsonDocument& out);
bool minicamModemStandby();
void minicamModemSetScreenOff(bool off);
bool minicamModemReady();
int minicamSignal();
bool minicamTcpConnect(const char* host,uint16_t port);
void minicamTcpClose();
bool minicamTcpConnected();
int minicamTcpSend(const uint8_t* bytes,size_t length);
int minicamTcpRead(uint8_t* bytes,size_t capacity);
void minicamTlsStatus(bool verified,int error=0);
