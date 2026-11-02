#pragma once
#define WIFI_SSID "your-wifi"
#define WIFI_PASSWORD "your-password"
#define GATEWAY_HOST "43.160.215.253"
#define GATEWAY_PORT 9443
#define GATEWAY_TLS 1
#define DEVICE_TOKEN "replace-with-long-random-device-token"
// Set to the PEM root CA of your gateway certificate. Never use setInsecure().
// For trusted LAN mock only: GATEWAY_TLS=0, port=8787, host=LAN IPv4.
static const char GATEWAY_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_YOUR_TLS_ROOT_CA
-----END CERTIFICATE-----
)PEM";
constexpr int PIN_PTT=9;  // onboard BOOT; release during reset/boot
constexpr int PIN_ENC_A=16, PIN_ENC_B=17; // exposed UART pins, unused by USB CDC
constexpr int SPEAKER_VOLUME=45; // 0..100, applied in software
constexpr float MICROPHONE_GAIN_DB=30.0f;
// The ES8311 left slot is the microphone; right slot may be DAC reference.
constexpr int MIC_SLOT=0;
#define ENABLE_EPAPER 1
