#pragma once
#include "board_profile.h"
// Optional hardware overrides only. Wi-Fi, gateway, token and CA are configured
// using the USB/AP web page and stored in the device's voxi-radio NVS namespace.
constexpr int PIN_PTT=BOARD_BOOT_KEY;
constexpr int PIN_ENC_A=BOARD_ENCODER_A, PIN_ENC_B=BOARD_ENCODER_B;
constexpr int SPEAKER_VOLUME=45;
constexpr float MICROPHONE_GAIN_DB=30.0f;
constexpr int MIC_SLOT=0;
#define ENABLE_EPAPER 1
