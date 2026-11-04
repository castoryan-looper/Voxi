# Firmware defaults

- All maintained C6/S3 targets must enable **both Opus microphone uplink and Opus reply downlink by default**, per the user's requirement. Do not ship a board with PCM-only microphone uplink or silently fall back during a normal voice turn.
- Gateway negotiation must explicitly confirm both formats. PCM remains allowed only for explicitly selected diagnostic tests and the internal Pocket bridge.
- Preserve board-specific pins, display, power management, device ID and saved configuration. Default codec support does not mean every board has 4G, PSRAM or the same UI.
- Validate defaults with `tools/test_opus_defaults.cpp` for each board macro and build every maintained PlatformIO environment after codec changes. Distinguish build success, chip codec probes and actual voice conversations.
- C6 has no PSRAM: its temporary encoder task must release its stack and encoder before reply playback memory is restored. Preserve the existing 96KB playback capacity; do not solve heap pressure by silently shrinking it.
- Never publish raw chat logs, device credentials, NVS/Flash backups or private server settings. See `docs/handoffs/LATEST.md` before resuming hardware work.
