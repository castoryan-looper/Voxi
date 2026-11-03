#pragma once
#include <ArduinoJson.h>
void minicamModemBegin();
void minicamModemDiagnostics(JsonDocument& out);
bool minicamModemStandby();
