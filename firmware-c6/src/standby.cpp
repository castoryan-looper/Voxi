#include "standby.h"
#include "standby_policy.h"
#include "board_audio.h"
#include "board_profile.h"
#include "diagnostics.h"
#include <Arduino.h>
#include <WiFi.h>
#include <esp_sleep.h>
#include <esp_system.h>
#include <driver/gpio.h>
#include <Preferences.h>

bool radioPrepareStandby();
bool radioSetWarmStandby(bool idle);
static StandbyPolicy policy;
static ConnectedStandbyPolicy connected;
static uint32_t restoreAt=0,wakeRestoreMs=0,restoreErrors=0;
static int idleStage=0;
static uint32_t wakeAt=0;
struct SleepState{uint32_t magic,count,wake,error;bool wakePending;};
RTC_NOINIT_ATTR static SleepState retained;
static bool wakeGuard=false;static uint32_t wakeGuardUntil=0;
static bool inputDown(){
#ifdef VOXI_BOARD_MINICAM
 if(boardIdleInputActive())return true;
#endif
 return digitalRead(BOARD_BOOT_KEY)==LOW||boardPowerPressed()||boardTouchActive();
}
void standbyBegin(){
#ifdef VOXI_BOARD_MINICAM
 Preferences p;if(p.begin("voxi-standby",true)){TieredStandbyPolicy loaded;if(p.getBytesLength("schedule")==sizeof(loaded))p.getBytes("schedule",&loaded,sizeof(loaded));if(loaded.valid())connected.screenMinutes=loaded.screenMinutes;connected.screenMinutes=p.getUInt("screen-live",connected.screenMinutes);p.end();if(!connected.valid())connected.screenMinutes=1;}
#endif
 if(esp_reset_reason()!=ESP_RST_SW||retained.magic!=0x5658534c)retained={0x5658534c,0,0,0,false};
 wakeGuard=retained.wakePending;wakeGuardUntil=millis()+500;retained.wakePending=false;policy.activity(millis());
 if(wakeGuard)radioDebug("WAKING","Standby wake: release to reconnect");
}
void standbyActivity(){
#ifdef VOXI_BOARD_MINICAM
 if(idleStage){
  uint32_t now=millis();if(restoreAt&&uint32_t(now-restoreAt)<1000)return;restoreAt=now;
  if(!boardSetIdle(false)){restoreErrors++;diagnosticError("Idle audio restore failed; retrying without radio reset");return;}
  wakeRestoreMs=millis()-now;idleStage=0;wakeAt=millis();restoreAt=0;
 }

#endif
 policy.activity(millis());
}
bool standbySuppressInput(){if(!wakeGuard)return false;if((int32_t)(millis()-wakeGuardUntil)<0)return true;if(!inputDown())wakeGuard=false;return true;}
void standbyDiagnostics(JsonDocument& out){out["standbyIdleMs"]=uint32_t(millis()-policy.lastActivity);out["standbyTimeoutMs"]=60000;out["standbyMode"]="light_sleep";out["standbyCount"]=retained.count;out["standbyWakeCause"]=retained.wake;out["standbyLastError"]=retained.error;out["standbyWakeInputGuard"]=wakeGuard;
#ifdef VOXI_BOARD_MINICAM
 out["standbyMode"]="connected";out["standbyStage"]=idleStage;out["standbyScreenMinutes"]=connected.screenMinutes;out["standbyLinkMinutes"]=0;out["standbySleepMinutes"]=0;out["standbyTimeoutMs"]=connected.screenMinutes*60000u;out["standbyLastWakeAtMs"]=wakeAt;out["standbyWakeRestoreMs"]=wakeRestoreMs;out["standbyRestoreErrors"]=restoreErrors;out["standbyDisconnectEnabled"]=false;out["standbySleepEnabled"]=false;
#endif
}
bool standbySaveSettings(JsonVariantConst body,JsonDocument& out){
#ifdef VOXI_BOARD_MINICAM
 if(!body["screenMinutes"].is<uint32_t>()){out["error"]="关屏时间需要整数分钟";return false;}
 ConnectedStandbyPolicy next;next.screenMinutes=body["screenMinutes"];
 if(!next.valid()){out["error"]="关屏时间需要 1–1440 分钟";return false;}
 Preferences p;if(!p.begin("voxi-standby",false)){out["error"]="无法保存待机设置";return false;}
 bool ok=p.putUInt("screen-live",next.screenMinutes)==sizeof(uint32_t)&&p.getUInt("screen-live",0)==next.screenMinutes;p.end();
 if(!ok){out["error"]="待机设置保存失败";return false;}
 connected=next;standbyActivity();standbyDiagnostics(out);out["message"]="已保存联网待机：关屏省电，保持4G和云端连接，不进入轻睡眠";return true;

#else
 out["error"]="当前板型暂不支持分级待机";return false;
#endif
}
void standbyTick(bool busy,bool provisioning){
 static int encoderA=-1,encoderB=-1;
 bool input=inputDown();
 if(BOARD_ENCODER_A>=0){int a=digitalRead(BOARD_ENCODER_A),b=digitalRead(BOARD_ENCODER_B);if(encoderA>=0&&(a!=encoderA||b!=encoderB))input=true;encoderA=a;encoderB=b;}
#ifdef VOXI_BOARD_MINICAM
 if(busy||input||provisioning||(idleStage&&restoreAt)){standbyActivity();return;}
 int wanted=connected.stage(uint32_t(millis()-policy.lastActivity));
 if(wanted>=1&&idleStage==0){if(!boardSetIdle(true)){diagnosticError("Idle audio shutdown failed");standbyActivity();return;}idleStage=1;}
 // Preserve TCP/TLS and registration at every idle duration.
 return;
#else
 if(!policy.due(millis(),busy,input,provisioning))return;
#endif
 esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
 int pins[]={BOARD_BOOT_KEY,BOARD_POWER_KEY,BOARD_ENCODER_A,BOARD_ENCODER_B,boardTouchWakePin()};
 bool configured=false;
 for(int pin:pins){if(pin<0)continue;pinMode(pin,INPUT_PULLUP);int level=digitalRead(pin);if(level==LOW&&pin!=BOARD_ENCODER_A&&pin!=BOARD_ENCODER_B){standbyActivity();return;}auto trigger=(pin==BOARD_ENCODER_A||pin==BOARD_ENCODER_B)?(level?GPIO_INTR_LOW_LEVEL:GPIO_INTR_HIGH_LEVEL):GPIO_INTR_LOW_LEVEL;esp_err_t result=gpio_wakeup_enable((gpio_num_t)pin,trigger);if(result!=ESP_OK){retained.error=result;standbyActivity();return;}configured=true;}
 if(!configured||esp_sleep_enable_gpio_wakeup()!=ESP_OK){retained.error=1;standbyActivity();return;}
 if(!radioPrepareStandby()){diagnosticError("Standby deferred: network still active");standbyActivity();return;}
 if(!boardPrepareStandby()){retained.error=2;ESP.restart();return;}
 WiFi.disconnect(false,false);WiFi.mode(WIFI_OFF);
 retained.count++;retained.error=0;
 Serial.println("VOXI_STANDBY entering: button/touch wake");Serial.flush();delay(30);
 esp_err_t result=esp_light_sleep_start();
 retained.error=result;retained.wake=esp_sleep_get_wakeup_cause();retained.wakePending=true;
 // Release strapping buttons before restarting, so BOOT wake is not a bootloader request.
 while(digitalRead(BOARD_BOOT_KEY)==LOW||boardPowerPressed())delay(10);
 // Restore drivers and TLS from a clean boot rather than reuse half-stopped DMA.
 ESP.restart();
}
