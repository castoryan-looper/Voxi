#pragma once
#include <ArduinoJson.h>
void cloudOtaBegin();
void cloudOtaTick(bool idle, bool healthy);
void cloudOtaStatus(JsonDocument& out);
bool radioSetWarmStandby(bool idle);
