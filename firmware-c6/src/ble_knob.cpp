#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
static volatile bool recording=false,uploadPending=false,captureRequested=false,imageDirty=false;
#include "bluetooth_knob.h"
#include "ble_knob.h"
static bool started=false;
static void ensureStarted(){if(!started){started=true;initKnob();}}
void bleBegin(){
  Preferences p;
  if(p.begin("voxi-radio",true)){bool saved=p.isKey("bt_knob");p.end();if(saved)ensureStarted();}
}
void bleTick(bool busy){recording=busy;}
int bleAction(){
  KnobInput input;
  if(knobQueue&&xQueueReceive(knobQueue,&input,0)==pdTRUE&&input.epoch==knobEpoch&&millis()-input.at<1500)return input.action;
  return 0;
}
int bleCommand(const char* method,JsonVariantConst body,JsonDocument& out){
  ensureStarted();
  if(!strcmp(method,"bluetooth_scan_start"))return knobScanStart(out);
  if(!strcmp(method,"bluetooth_scan_results")){knobScanResults(out);return 200;}
  return knobCommand(!strcmp(method,"bluetooth_forget"),out,body["address"]|"");
}
void bleStatus(JsonDocument& out){knobStatusJson(out);}
