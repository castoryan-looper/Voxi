# Taiji Knob32 / Waveshare ESP32-S3-Knob-Touch-LCD-1.8

## Build and flash

Use PlatformIO environment `taiji_knob32` in `firmware-c6`:

```powershell
pio run -e taiji_knob32
pio run -e taiji_knob32 -t upload --upload-port COM12
node tools/setup-server.mjs
```

The dual-MCU USB-C connection depends on plug orientation. CH340 is the classic
ESP32 audio companion, not the S3 main controller. Flip the device-side plug to
obtain the native USB/JTAG port, then confirm `esptool flash-id` identifies an
ESP32-S3, 16MB Flash and 8MB PSRAM. Do not flash this image to CH340.

Back up all 16MB before converting Pocket firmware. This target preserves the
old NVS, legacy FAT and coredump boundaries. The disposable 2MB Voxi recording
cache occupies the old unused app1 area; verify it is blank before first use.
Unknown nonblank filesystems are never automatically formatted. Old Pocket
Wi-Fi profiles migrate; Pocket server credentials intentionally do not migrate.
Enroll the hardware ID shown by USB in an enabled Voxi account and provision
its own Voxi token and trusted gateway CA. Never share another device's token.

## Controls

- Rotate the physical ring: move through enabled cloud channels (up to 16).
- Channel names use the existing cloud-provided Chinese label bitmap.
- Hold the on-screen TALK area for at least 300ms; release to send.
- Tap SETUP at top right to show USB/hotspot instructions; tap bottom to return.
- Idle 60 seconds dims the LCD to 5%; touch/rotation restores 65% brightness.
  Wi-Fi stays connected. Deep sleep is disabled until a wake circuit is verified.
- Audio output requires a 3.5mm headset or active speaker. No onboard speaker
  or battery gauge is assumed. Bluetooth headset output is not implemented.

## Hardware contracts

360x360 QSPI with the existing verified vendor panel init sequence; rotate both
screen and touch 180 degrees. LCD CLK13, CS14, D0..D3=15..18, RESET21,
backlight47 at 50kHz/9bit. Touch I2C SDA11/SCL12, address0x15.
Encoder GPIO8/7 emits independent direction pulses, not quadrature.
GPIO0 stays OUTPUT HIGH to select the S3 as DAC owner; it must never be PTT.
PDM mic I2S0: CLK45/DATA46, 24kHz mono16. PCM5100A I2S1:
BCLK39/WS40/DATA41, 24kHz MSB stereo16. Shared Voxi Opus uplink/downlink,
playback gate, recording cache and channel catalogue remain in use.

Panel driver provenance and Apache license are in `firmware-c6/lib/taiji_display`.

## Verification 2026-11-21

Main MCU detected on COM12: ESP32-S3 rev0.2, 16MB Flash/8MB PSRAM.
Full flash backup saved privately outside version control and SHA256 recorded
in local verification notes. Flash write hashes verified. USB reports LCD ready
360x360, touch ready, live PDM samples, mounted LittleFS recording cache and
successful remembered Wi-Fi association. Per-device cloud enrollment and real
spoken/headphone listening are separate checks; do not infer them from I2S writes.
