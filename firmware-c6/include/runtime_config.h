#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
struct RadioConfig {
  String ssid,password,host="43.160.215.253",token,ca,revision;
  uint16_t port=9443;
  bool tls=true,valid=false;
};
extern RadioConfig radioConfig;
void setupBegin();
void setupTick(bool busy,bool cloudReady,int channel);
bool setupScreenActive();

void playbackDiagnostics(JsonDocument& out);
