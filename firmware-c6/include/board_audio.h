#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "channel_catalog.h"
void boardInit();
void audioFlush();
size_t audioRead(int16_t* mono,size_t samples);
size_t audioWrite(const int16_t* mono,size_t samples);
void displayChannel(int channel,bool online);
const ChannelLabel& radioChannelLabel(int channel);
const char* radioTaskState();
void displaySetup(const char* name,const char* key,bool hotspot);

void displayConnection(int channel,const char* label,bool wifi,bool gateway,bool usb);

void boardStatusTick();
int batteryPercent();
int batteryMillivolts();

void displayDebugTick();

void speakerTestRequest();
bool speakerTestPending();
void speakerTestRun();
void speakerDiagnostics(JsonDocument& out);

bool speakerSetVolume(int percent);
int speakerVolume();

bool boardPowerPressed();
bool boardTouchPttPressed();
bool boardTouchActive();
int boardTouchWakePin();
bool boardPrepareStandby();
#ifdef VOXI_BOARD_MINICAM
bool boardSetIdle(bool idle);
bool boardIdleInputActive();
#endif
