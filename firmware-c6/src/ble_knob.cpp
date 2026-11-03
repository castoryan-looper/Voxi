#include "ble_knob.h"

// Bluetooth is excluded from this firmware. Keep the USB protocol compatible
// with older management pages without initializing a BLE stack or task.
void bleBegin() {}
void bleTick(bool) {}
int bleAction() { return 0; }
int bleCommand(const char*, JsonVariantConst, JsonDocument& out) {
  out["error"]="Bluetooth is disabled in this firmware";
  return 410;
}
void bleStatus(JsonDocument& out) {
  out["bluetoothEnabled"]=false;
  out["bluetoothConnected"]=false;
  out["bluetoothScanning"]=false;
  out["bluetoothPaired"]=false;
  out["bluetoothState"]="disabled";
  out["bluetoothDetail"]="Bluetooth removed to reserve memory for audio";
}
