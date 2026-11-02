#pragma once
#include <ArduinoJson.h>
void bleBegin();
void bleTick(bool busy);
int bleAction();
int bleCommand(const char* method,JsonVariantConst body,JsonDocument& out);
void bleStatus(JsonDocument& out);
