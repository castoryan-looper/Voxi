#include "cloud_ota.h"
#if defined(VOXI_OTA) && !VOXI_OTA_SUSPENDED
#include "runtime_config.h"
#include <WiFi.h>
#include <NetworkClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_timer.h>
#include <esp_app_desc.h>
#include <esp_image_format.h>
#include "board_audio.h"
#include "diagnostics.h"
#include <mbedtls/sha256.h>
#include <time.h>
#ifndef CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
#error OTA requires a rollback-enabled bootloader
#endif
// Override Arduino's early unconditional acceptance. Confirm only after setup and READY.
extern "C" bool verifyRollbackLater(){return true;}
static const char imageTag[]="VOXI_OTA_IMAGE:" VOXI_OTA_TARGET;
static Preferences prefs;
static bool pending=false;
static esp_timer_handle_t deadline=nullptr;
static uint32_t nextCheck=60000,healthyAt=0,idleAt=0;
static const char* state="waiting";

static void rollback(void*){esp_ota_mark_app_invalid_rollback_and_reboot();esp_restart();}
void cloudOtaBegin(){
  bool storage=prefs.begin("voxi-ota",false);
  esp_ota_img_states_t status;
  pending=esp_ota_get_state_partition(esp_ota_get_running_partition(),&status)==ESP_OK&&status==ESP_OTA_IMG_PENDING_VERIFY;
  if(pending){
    if(!storage)rollback(nullptr);
    state="verifying_boot";
    esp_timer_create_args_t args={};args.callback=rollback;args.name="ota-health";
    if(esp_timer_create(&args,&deadline)!=ESP_OK||esp_timer_start_once(deadline,180000000)!=ESP_OK)rollback(nullptr);
  }else if(prefs.isKey("candidate")){
    // We returned to the old app: quarantine the failing release until replaced.
    prefs.putString("failed",prefs.getString("candidate"));prefs.remove("candidate");state="rolled_back";
  }
}
static String url(const String& path){return "https://"+radioConfig.host+":"+String(radioConfig.port)+path;}
static bool start(HTTPClient& http,NetworkClientSecure& client,const String& path){
  client.setCACert(radioConfig.ca.c_str());client.setHandshakeTimeout(12);
  http.setConnectTimeout(10000);http.setTimeout(15000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(client,url(path)))return false;
  http.addHeader("Authorization","Bearer "+radioConfig.token);return true;
}
static void update(){
  NetworkClientSecure client;HTTPClient http;
  String base="/api/firmware/" VOXI_OTA_TARGET;
  state="checking";
  if(!start(http,client,base+"/manifest.json")){state="connection_failed";return;}
  int code=http.GET();
  if(code==204||code==404){http.end();state="up_to_date";return;}
  if(code!=200||http.getSize()<1||http.getSize()>2048){http.end();state="manifest_failed";return;}
  String raw=http.getString();http.end();JsonDocument d;
  if(deserializeJson(d,raw)||String(d["target"]|"")!=VOXI_OTA_TARGET||d["schema"]!=1){state="manifest_invalid";return;}
  String hash=d["sha256"]|"";size_t size=d["size"]|0U;
  if(hash.length()!=64){state="manifest_invalid";return;}
  for(char c:hash)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f'))){state="manifest_invalid";return;}
  if(hash==prefs.getString("installed")||hash==prefs.getString("failed")){state="unchanged_or_quarantined";return;}
  const esp_partition_t* part=esp_ota_get_next_update_partition(nullptr);
  if(!part||part==esp_ota_get_running_partition()||size<sizeof(esp_image_header_t)+sizeof(esp_image_segment_header_t)+sizeof(esp_app_desc_t)||size>part->size){state="image_size_invalid";return;}
  if(!start(http,client,base+"/"+hash+".bin")){state="connection_failed";return;}
  code=http.GET();if(code!=200||http.getSize()!=int(size)){http.end();state="image_response_invalid";return;}
  displayConnection(0,"UPDATING",true,false,false);
  diagnosticStage("ota_update");
  esp_ota_handle_t handle=0;
  if(esp_ota_begin(part,OTA_WITH_SEQUENTIAL_WRITES,&handle)!=ESP_OK){http.end();state="flash_begin_failed";return;}
  mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);mbedtls_sha256_starts(&sha,0);
  uint8_t buffer[4096];size_t received=0;uint32_t last=millis(),began=last;bool ok=true,targetSeen=false;size_t tagMatched=0;
  auto* stream=http.getStreamPtr();state="downloading";
  while(received<size){
    size_t n=min(size-received,min(sizeof(buffer),size_t(stream->available())));
    if(n){int got=stream->read(buffer,n);if(got<=0){ok=false;break;}
      if(esp_ota_write(handle,buffer,got)!=ESP_OK){ok=false;break;}
      for(int i=0;i<got&&!targetSeen;i++){
        if(buffer[i]==uint8_t(imageTag[tagMatched])){if(++tagMatched==sizeof(imageTag))targetSeen=true;}
        else tagMatched=buffer[i]==uint8_t(imageTag[0])?1:0;
      }
      mbedtls_sha256_update(&sha,buffer,got);received+=got;last=millis();
    }else if(!http.connected()||millis()-last>15000){ok=false;break;}
    if(millis()-began>300000){ok=false;break;}delay(1);
  }
  uint8_t digest[32];char actual[65];mbedtls_sha256_finish(&sha,digest);mbedtls_sha256_free(&sha);
  for(int i=0;i<32;i++)sprintf(actual+2*i,"%02x",digest[i]);http.end();
  if(!ok||!targetSeen||received!=size||hash!=actual){esp_ota_abort(handle);state="download_or_hash_failed";return;}
  // IDF validates the executable header, chip ID and image checksum before activation.
  if(esp_ota_end(handle)!=ESP_OK){state="image_invalid";return;}
  if(prefs.putString("candidate",hash)!=hash.length()){state="storage_failed";return;}
  if(esp_ota_set_boot_partition(part)!=ESP_OK){prefs.remove("candidate");state="activation_failed";return;}
  Serial.println("VOXI_OTA rebooting");delay(100);ESP.restart();
}
void cloudOtaTick(bool idle,bool healthy){
  if(pending){
    if(!healthy)healthyAt=0;else if(!healthyAt)healthyAt=millis();
    if(healthyAt&&millis()>30000&&millis()-healthyAt>10000){
      if(esp_ota_mark_app_valid_cancel_rollback()==ESP_OK){
        esp_timer_stop(deadline);esp_timer_delete(deadline);pending=false;
        prefs.putString("installed",prefs.getString("candidate"));prefs.remove("candidate");state="boot_confirmed";
      }
    }
    return;
  }
  if(!idle){idleAt=0;return;}
  if(!idleAt)idleAt=millis();
  if(millis()-idleAt<15000||int32_t(millis()-nextCheck)<0)return;
  if(!radioConfig.valid||!radioConfig.tls||!radioConfig.ca.length()||radioConfig.networkMode!="wifi"||WiFi.status()!=WL_CONNECTED||time(nullptr)<1700000000)return;
  nextCheck=millis()+1800000+(esp_random()%60000);
  if(!radioSetWarmStandby(true)){state="radio_busy";return;}
  update();radioSetWarmStandby(false);
}
void cloudOtaStatus(JsonDocument& out){out["otaImageTag"]=imageTag;out["otaEnabled"]=true;out["otaTarget"]=VOXI_OTA_TARGET;out["otaState"]=state;out["otaPendingVerify"]=pending;}
#else
void cloudOtaBegin(){}
void cloudOtaTick(bool,bool){}
void cloudOtaStatus(JsonDocument& out){out["otaEnabled"]=false;out["otaState"]="suspended";}
#endif
