#pragma once
// Optional hardware overrides only. Wi-Fi, gateway, token and CA are configured
// using the USB/AP web page and stored in the device's voxi-radio NVS namespace.
constexpr int PIN_PTT=9;
constexpr int PIN_ENC_A=16, PIN_ENC_B=17;
constexpr int SPEAKER_VOLUME=45;
constexpr float MICROPHONE_GAIN_DB=30.0f;
constexpr int MIC_SLOT=0;
#define ENABLE_EPAPER 1
