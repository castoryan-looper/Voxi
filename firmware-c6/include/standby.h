#pragma once
#include <ArduinoJson.h>
void standbyBegin();
void standbyActivity();
void standbyTick(bool busy,bool provisioning);
bool standbySuppressInput();
void standbyDiagnostics(JsonDocument& out);
