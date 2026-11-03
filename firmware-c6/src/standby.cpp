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

bool radioPrepareStandby();
static StandbyPolicy policy;
struct SleepState{uint32_t magic,count,wake,error;bool wakePending;};
RTC_NOINIT_ATTR static SleepState retained;
static bool wakeGuard=false;static uint32_t wakeGuardUntil=0;
static bool inputDown(){
 return digitalRead(BOARD_BOOT_KEY)==LOW||boardPowerPressed()||boardTouchActive();
}
void standbyBegin(){
 if(esp_reset_reason()!=ESP_RST_SW||retained.magic!=0x5658534c)retained={0x5658534c,0,0,0,false};
 wakeGuard=retained.wakePending;wakeGuardUntil=millis()+500;retained.wakePending=false;policy.activity(millis());
 if(wakeGuard)radioDebug("WAKING","Standby wake: release to reconnect");
}
void standbyActivity(){policy.activity(millis());}
bool standbySuppressInput(){if(!wakeGuard)return false;if((int32_t)(millis()-wakeGuardUntil)<0)return true;if(!inputDown())wakeGuard=false;return true;}
void standbyDiagnostics(JsonDocument& out){out["standbyIdleMs"]=uint32_t(millis()-policy.lastActivity);out["standbyTimeoutMs"]=60000;out["standbyMode"]="light_sleep";out["standbyCount"]=retained.count;out["standbyWakeCause"]=retained.wake;out["standbyLastError"]=retained.error;out["standbyWakeInputGuard"]=wakeGuard;}
void standbyTick(bool busy,bool provisioning){
 static int encoderA=-1,encoderB=-1;
 bool input=inputDown();
 if(BOARD_ENCODER_A>=0){int a=digitalRead(BOARD_ENCODER_A),b=digitalRead(BOARD_ENCODER_B);if(encoderA>=0&&(a!=encoderA||b!=encoderB))input=true;encoderA=a;encoderB=b;}
 if(!policy.due(millis(),busy,input,provisioning))return;
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
