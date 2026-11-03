#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
bool audioCacheInit();
bool audioCacheStart();
bool audioCacheWrite(const uint8_t* data,size_t length);
bool audioCacheFinish();
bool audioCacheOpenUpload();
size_t audioCacheRead(uint8_t* data,size_t capacity);
void audioCacheClose();
void audioCacheRemove();
void audioCacheDiagnostics(JsonDocument& out);

bool audioCacheEnd();
