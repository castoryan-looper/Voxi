#pragma once
#include <ArduinoJson.h>
void standbyBegin();
void standbyActivity();
bool standbyScreenOff();
void standbyTick(bool busy,bool provisioning);
bool standbySuppressInput();
void standbyDiagnostics(JsonDocument& out);
bool standbySaveSettings(JsonVariantConst body,JsonDocument& out);
