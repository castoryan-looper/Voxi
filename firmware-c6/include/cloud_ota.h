#pragma once
// Withdrawn by the user on 2026-11-09. Redesign before enabling again.
#define VOXI_OTA_SUSPENDED 1
#include <ArduinoJson.h>
void cloudOtaBegin();
void cloudOtaTick(bool idle, bool healthy);
void cloudOtaStatus(JsonDocument& out);
bool radioSetWarmStandby(bool idle);
