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
static TieredStandbyPolicy tiers;
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
 Preferences p;if(p.begin("voxi-standby",true)){TieredStandbyPolicy loaded;if(p.getBytesLength("schedule")==sizeof(loaded))p.getBytes("schedule",&loaded,sizeof(loaded));p.end();if(loaded.valid())tiers=loaded;}
#endif
 if(esp_reset_reason()!=ESP_RST_SW||retained.magic!=0x5658534c)retained={0x5658534c,0,0,0,false};
 wakeGuard=retained.wakePending;wakeGuardUntil=millis()+500;retained.wakePending=false;policy.activity(millis());
 if(wakeGuard)radioDebug("WAKING","Standby wake: release to reconnect");
}
void standbyActivity(){
#ifdef VOXI_BOARD_MINICAM
 if(idleStage){int prior=idleStage;
  if(!boardSetIdle(false)){diagnosticError("Idle audio restore failed");ESP.restart();return;}
  idleStage=0;wakeAt=millis();
  if(prior>=2){radioSetWarmStandby(false);wakeGuard=true;wakeGuardUntil=millis()+150;radioDebug("WAKING","Restoring cloud session");}
 }
#endif
 policy.activity(millis());
}
bool standbySuppressInput(){if(!wakeGuard)return false;if((int32_t)(millis()-wakeGuardUntil)<0)return true;if(!inputDown())wakeGuard=false;return true;}
void standbyDiagnostics(JsonDocument& out){out["standbyIdleMs"]=uint32_t(millis()-policy.lastActivity);out["standbyTimeoutMs"]=60000;out["standbyMode"]="light_sleep";out["standbyCount"]=retained.count;out["standbyWakeCause"]=retained.wake;out["standbyLastError"]=retained.error;out["standbyWakeInputGuard"]=wakeGuard;
#ifdef VOXI_BOARD_MINICAM
 out["standbyMode"]="tiered";out["standbyStage"]=idleStage;out["standbyScreenMinutes"]=tiers.screenMinutes;out["standbyLinkMinutes"]=tiers.linkMinutes;out["standbySleepMinutes"]=tiers.sleepMinutes;out["standbyTimeoutMs"]=tiers.sleepMinutes*60000u;out["standbyLastWakeAtMs"]=wakeAt;
#endif
}
bool standbySaveSettings(JsonVariantConst body,JsonDocument& out){
#ifdef VOXI_BOARD_MINICAM
 const char* keys[]={"screenMinutes","linkMinutes","sleepMinutes"};for(auto key:keys)if(!body[key].is<uint32_t>()){out["error"]="待机时间需要整数分钟";return false;}
 TieredStandbyPolicy next;next.screenMinutes=body["screenMinutes"];next.linkMinutes=body["linkMinutes"];next.sleepMinutes=body["sleepMinutes"];
 if(!next.valid()){out["error"]="需要 1 ≤ 关屏 < 断开云端 < 休眠 ≤ 1440 分钟";return false;}
 // Store all three thresholds in one value so a failed write cannot mix schedules.
 Preferences p;if(!p.begin("voxi-standby",false)){out["error"]="无法保存待机设置";return false;}
 bool ok=p.putBytes("schedule",&next,sizeof(next))==sizeof(next);TieredStandbyPolicy check;
 ok=ok&&p.getBytes("schedule",&check,sizeof(check))==sizeof(check)&&check.screenMinutes==next.screenMinutes&&check.linkMinutes==next.linkMinutes&&check.sleepMinutes==next.sleepMinutes;p.end();
 if(!ok){out["error"]="待机设置保存失败";return false;}
 tiers=next;standbyActivity();standbyDiagnostics(out);out["message"]="待机时间已保存，立即生效";return true;
#else
 out["error"]="当前板型暂不支持分级待机";return false;
#endif
}
void standbyTick(bool busy,bool provisioning){
 static int encoderA=-1,encoderB=-1;
 bool input=inputDown();
 if(BOARD_ENCODER_A>=0){int a=digitalRead(BOARD_ENCODER_A),b=digitalRead(BOARD_ENCODER_B);if(encoderA>=0&&(a!=encoderA||b!=encoderB))input=true;encoderA=a;encoderB=b;}
#ifdef VOXI_BOARD_MINICAM
 if(busy||input||provisioning){standbyActivity();return;}
 int wanted=tiers.stage(uint32_t(millis()-policy.lastActivity));
 if(wanted>=1&&idleStage==0){if(!boardSetIdle(true)){diagnosticError("Idle audio shutdown failed");standbyActivity();return;}idleStage=1;}
 if(wanted>=2&&idleStage==1){if(!radioSetWarmStandby(true)){diagnosticError("Warm standby deferred");standbyActivity();return;}idleStage=2;}
 if(wanted<3)return;
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
