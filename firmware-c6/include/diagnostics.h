#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
void diagnosticsBegin();
void diagnosticsJson(JsonDocument& out);
void diagnosticStage(const char* stage);
void diagnosticError(const char* error);
void diagnosticReconnect();
