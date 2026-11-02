#pragma once
#include <Arduino.h>
void boardInit();
void audioFlush();
size_t audioRead(int16_t* mono,size_t samples);
size_t audioWrite(const int16_t* mono,size_t samples);
void displayChannel(int channel,bool online);
