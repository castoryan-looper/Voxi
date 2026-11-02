#pragma once
// Copy to config.h. Gateway and ESP32 must be on a trusted LAN.
#define WIFI_SSID "your-wifi"
#define WIFI_PASSWORD "your-password"
#define GATEWAY_HOST "192.168.1.100"
#define GATEWAY_PORT 8787
#define DEVICE_TOKEN "change-this-device-token"
// ESP32-S3-DevKitC-1 reference wiring; confirm against your actual board.
constexpr int PIN_PTT=4, PIN_ENC_A=5, PIN_ENC_B=6;
constexpr int MIC_BCLK=14, MIC_WS=15, MIC_DIN=16;
constexpr int AMP_BCLK=17, AMP_WS=18, AMP_DOUT=21;
constexpr int MIC_SHIFT=14; // INMP441 alignment/gain: tune after recording a sample.
