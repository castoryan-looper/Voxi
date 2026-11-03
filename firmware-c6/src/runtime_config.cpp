#include "board_profile.h"
#include "runtime_config.h"
#include "board_audio.h"
#include "diagnostics.h"
#include "ble_knob.h"
#include "wifi_profile_policy.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <HWCDC.h>
#include <time.h>
#include <mbedtls/x509_crt.h>
#include "setup_page.h"

RadioConfig radioConfig;
static Preferences prefs;
static WebServer web(80);
static DNSServer dns;
static KnownWifiSet known={};
static String key,apName,line,configIssue="not_saved",lastSsid;
static bool storageReady=false,ap=false,configView=false,busyNow=false,cloudNow=false,manualScan=false,autoScan=false,usbWas=false,chordTriggered=false;
static uint32_t restartAt=0,chordAt=0,attemptAt=0,nextScan=0,scanAt=0,blocked[8]={};
static int currentChannel=0,attempt=-1;
static volatile int wifiReason=0;
static String normalCa(String s){s.replace("\\n","\n");s.replace("\r","");s.trim();if(s.length())s+='\n';return s;}
static bool validCa(const String& s){mbedtls_x509_crt c;mbedtls_x509_crt_init(&c);int ret=mbedtls_x509_crt_parse(&c,(const unsigned char*)s.c_str(),s.length()+1);mbedtls_x509_crt_free(&c);return ret==0;}
static bool configured(const RadioConfig& c,const KnownWifiSet& k){return k.count&&c.host.length()&&c.token.length()>=16&&(!c.tls||validCa(c.ca));}
static String readStored(){
  if(!storageReady)return "";
  if(prefs.isKey("config-v2")){
    size_t n=prefs.getBytesLength("config-v2");if(!n||n>10000){configIssue="invalid_storage_length";return "";}
    char* bytes=(char*)malloc(n+1);if(!bytes){configIssue="low_memory";return "";}
    bool ok=prefs.getBytes("config-v2",bytes,n)==n;bytes[n]=0;String result=ok?String(bytes):String();free(bytes);return result;
  }
  return prefs.isKey("config")?prefs.getString("config",""):String();
}
static void writeProfileJson(JsonDocument& d,const KnownWifiSet& set){
  auto rows=d["networks"].to<JsonArray>();
  for(unsigned i=0;i<set.count;i++){auto r=rows.add<JsonObject>();r["s"]=set.profiles[i].ssid;r["p"]=set.profiles[i].password;r["u"]=set.profiles[i].used;}
  d["preferred"]=set.preferred;d["clock"]=set.clock;
}
static bool persist(const RadioConfig& c,const KnownWifiSet& set){
  if(!storageReady)return false;
  JsonDocument d;d["ssid"]=c.ssid;d["password"]=c.password;d["host"]=c.host;d["port"]=c.port;d["tls"]=c.tls;d["token"]=c.token;d["ca"]=c.ca;d["revision"]=c.revision;writeProfileJson(d,set);
  String json;serializeJson(d,json);
  // NVS strings have a ~4KB limit; store the complete configuration as a blob.
  if(json.length()>10000||prefs.putBytes("config-v2",json.c_str(),json.length())!=json.length())return false;
  return readStored()==json; // Only acknowledge success after committed readback.
}
static void parseProfiles(JsonDocument& d,KnownWifiSet& set){
  set={};auto rows=d["networks"].as<JsonArray>();
  for(auto r:rows){String s=r["s"]|"",p=r["p"]|"";if(set.count==8||!knownWifiValid(s.c_str(),p.c_str())||knownWifiFind(set,s.c_str())>=0)continue;
    auto& row=set.profiles[set.count++];strlcpy(row.ssid,s.c_str(),sizeof(row.ssid));strlcpy(row.password,p.c_str(),sizeof(row.password));row.used=r["u"]|0U;set.clock=max(set.clock,row.used);}
  String preferred=d["preferred"]|"";
  if(knownWifiFind(set,preferred.c_str())>=0)strlcpy(set.preferred,preferred.c_str(),sizeof(set.preferred));
  else if(set.count)strlcpy(set.preferred,set.profiles[0].ssid,sizeof(set.preferred));
}
static void loadConfig(){
  JsonDocument d;String stored=readStored();
  if(stored.length()&&!deserializeJson(d,stored)){
    radioConfig.ssid=d["ssid"]|"";radioConfig.password=d["password"]|"";radioConfig.host=d["host"]|"43.160.215.253";radioConfig.port=d["port"]|9443;
    radioConfig.tls=d["tls"]|true;radioConfig.ca=d["ca"]|"";radioConfig.token=d["token"]|"";radioConfig.revision=d["revision"]|"legacy";parseProfiles(d,known);
    if(!known.count&&radioConfig.ssid.length())knownWifiUpsert(known,radioConfig.ssid.c_str(),radioConfig.password.c_str(),true);
    configIssue="incomplete_configuration";
  }else if(stored.length())configIssue="invalid_saved_json";
  // Bring forward only remembered Wi-Fi, never Pocket's unrelated server token.
  if(!known.count){Preferences old;if(old.begin("pocket",true)){String wire=old.isKey("wifi_known")?old.getString("wifi_known",""):String();old.end();JsonDocument networks;if(wire.length()&&!deserializeJson(networks,wire))parseProfiles(networks,known);}}
  int preferred=knownWifiFind(known,known.preferred);if(preferred>=0){radioConfig.ssid=known.profiles[preferred].ssid;radioConfig.password=known.profiles[preferred].password;}
  radioConfig.valid=configured(radioConfig,known);if(radioConfig.valid)configIssue="";else if(!radioConfig.token.length()&&!radioConfig.ca.length())configIssue="missing_token_and_ca";else if(!radioConfig.token.length())configIssue="missing_token";else if(radioConfig.tls&&!radioConfig.ca.length())configIssue="missing_ca";
}
static void profilesJson(JsonDocument& d){
  d["wifiProfileLimit"]=8;auto rows=d["wifiProfiles"].to<JsonArray>();
  for(unsigned i=0;i<known.count;i++){auto r=rows.add<JsonObject>();r["ssid"]=known.profiles[i].ssid;r["passwordSaved"]=known.profiles[i].password[0]!=0;r["preferred"]=!strcmp(known.preferred,known.profiles[i].ssid);r["connected"]=WiFi.status()==WL_CONNECTED&&WiFi.SSID()==known.profiles[i].ssid;}
}
static void fillConfig(JsonDocument& d){
  d["ssid"]=radioConfig.ssid;d["host"]=radioConfig.host;d["port"]=radioConfig.port;d["tls"]=radioConfig.tls;d["ca"]=radioConfig.ca;
  d["cloudConfigured"]=radioConfig.valid;d["caConfigured"]=radioConfig.ca.length()>0;d["passwordConfigured"]=radioConfig.password.length()>0;d["tokenConfigured"]=radioConfig.token.length()>0;d["configRevision"]=radioConfig.revision;profilesJson(d);
}
static void startKnown(int i){
  if(i<0||i>=(int)known.count)return;
  WiFi.setAutoReconnect(false);wifiReason=0;attempt=i;attemptAt=millis();autoScan=false;
  WiFi.setMinSecurity(known.profiles[i].password[0]?WIFI_AUTH_WPA_PSK:WIFI_AUTH_OPEN);
  WiFi.begin(known.profiles[i].ssid,known.profiles[i].password);
}
static void wifiTick(){
  if(restartAt)return;
  uint32_t now=millis();
  if(WiFi.status()==WL_CONNECTED){
    attempt=-1;autoScan=false;
    if(!busyNow&&WiFi.SSID()!=lastSsid){lastSsid=WiFi.SSID();KnownWifiSet updated=known;if(knownWifiTouch(updated,lastSsid.c_str())){known=updated;if(radioConfig.valid)persist(radioConfig,known);}}
    return;
  }
  if(!known.count||busyNow||manualScan)return;
  if(attempt>=0){
    bool auth=wifiReason==202||wifiReason==15||wifiReason==204;bool missing=wifiReason==201;
    if(now-attemptAt<12000&&(!(auth||missing)||now-attemptAt<1500))return;
    blocked[attempt]=now+(auth?300000:30000);attempt=-1;WiFi.disconnect(false,false);nextScan=now+400;
  }
  if(autoScan){
    int n=WiFi.scanComplete();if(n==WIFI_SCAN_RUNNING&&now-scanAt<15000)return;
    String names[40];KnownWifiVisible visible[40];unsigned count=0;
    if(n>=0)for(int i=0;i<n&&i<40;i++){names[count]=WiFi.SSID(i);visible[count]={names[count].c_str(),WiFi.RSSI(i),WiFi.encryptionType(i)!=WIFI_AUTH_OPEN};count++;}
    int best=knownWifiChoose(known,visible,count,blocked,now);if(best<0)best=knownWifiFallback(known,blocked,now);
    WiFi.scanDelete();autoScan=false;if(best>=0)startKnown(best);else nextScan=now+15000;return;
  }
  if((int32_t)(now-nextScan)<0)return;
  int r=WiFi.scanNetworks(true,false,false,120);if(r==WIFI_SCAN_RUNNING||r>=0){autoScan=true;scanAt=now;}else nextScan=now+15000;
}
static void showSetup(){displaySetup(ap?apName.c_str():"USB SETUP",ap?key.c_str():"",ap);}
static void closeAp(){if(ap){dns.stop();web.stop();WiFi.softAPdisconnect(true);WiFi.mode(WIFI_STA);ap=false;}}
static void openSetup(){
  configView=true;if(HWCDC::isPlugged()){closeAp();showSetup();return;}
  if(!ap){WiFi.mode(WIFI_AP_STA);ap=WiFi.softAP(apName.c_str(),key.c_str());if(ap){dns.start(53,"*",WiFi.softAPIP());web.begin();}}
  showSetup();
}
bool setupScreenActive(){return configView;}
static int fail(JsonDocument& out,const char* message){out["error"]=message;return 400;}
static int saveConfig(JsonVariantConst body,JsonDocument& out){
  if(busyNow){out["error"]="请先结束对讲和播放";return 409;}
  if(!body.is<JsonObjectConst>())return fail(out,"配置格式不正确");
  RadioConfig c=radioConfig;c.ssid=body["ssid"]|"";c.host=body["host"]|"";c.token=body["token"]|"";c.ca=normalCa(body["ca"]|"");if(!c.ca.length())c.ca=radioConfig.ca;if(!c.host.length())c.host=radioConfig.host;if(!c.ssid.length())c.ssid=radioConfig.ssid;
  String password=body["password"]|"";if(!c.token.length())c.token=radioConfig.token;
  int saved=knownWifiFind(known,c.ssid.c_str());
  if(body["clearWifiPassword"]|false)c.password="";
  else if(password.length())c.password=password;
  else if(saved>=0)c.password=known.profiles[saved].password;
  else return fail(out,"新 Wi-Fi 请填写密码，或勾选开放网络");
  int port=body["port"]|0;c.tls=body["tls"]|true;
  if(!knownWifiValid(c.ssid.c_str(),c.password.c_str()))return fail(out,"Wi-Fi 名称或密码长度无效");
  if(c.password.length()&&c.password.length()<8)return fail(out,"Wi-Fi 密码需要 8–63 字符");
  if(!c.host.length()||c.host.length()>253)return fail(out,"请填写云端域名或 IP");
  for(unsigned i=0;i<c.host.length();i++){char ch=c.host[i];if(!isalnum((unsigned char)ch)&&ch!='.'&&ch!='-')return fail(out,"主机名不能包含协议、路径或端口");}
  if(port<1||port>65535)return fail(out,"端口需要 1–65535");c.port=port;
  if(c.token.length()<16||c.token.length()>256||c.token.indexOf('\n')>=0||c.token.indexOf('\r')>=0)return fail(out,"设备令牌需要 16–256 字符");
  if(c.ca.length()>6000||(c.tls&&!validCa(c.ca)))return fail(out,"请粘贴有效 PEM 根 CA 证书");
  KnownWifiSet updated=known;knownWifiUpsert(updated,c.ssid.c_str(),c.password.c_str(),true,WiFi.SSID().c_str());
  char revision[12];snprintf(revision,sizeof(revision),"%08lX",(unsigned long)esp_random());c.revision=revision;
  if(!persist(c,updated)){out["error"]="设备存储写入或回读失败，未确认保存；请查看存储诊断";return 500;}
  out["saved"]=true;out["configRevision"]=c.revision;out["message"]="已写入并回读校验成功，设备即将重启。";restartAt=millis()+1800;return 200;
}
static int dispatch(const String& method,JsonVariantConst body,JsonDocument& out){
  if(method=="config")fillConfig(out);
  else if(method=="status"){
    out["firmware"]=BOARD_NAME;out["configured"]=radioConfig.valid;out["configIssue"]=configIssue;out["configRevision"]=radioConfig.revision;out["storageReady"]=storageReady;out["tokenConfigured"]=radioConfig.token.length()>0;out["caConfigured"]=radioConfig.ca.length()>0;out["cloudConfigured"]=radioConfig.valid;
    out["usbConnected"]=HWCDC::isPlugged();out["screen"]=configView?(ap?"hotspot_setup":"usb_setup"):"radio";out["wifiConnected"]=WiFi.status()==WL_CONNECTED;out["ssid"]=WiFi.SSID();out["ip"]=WiFi.localIP().toString();out["wifiReason"]=(int)wifiReason;
    out["cloudReady"]=cloudNow;out["busy"]=busyNow;out["channel"]=currentChannel+1;out["apActive"]=ap;out["timeReady"]=time(nullptr)>1700000000;
    diagnosticsJson(out);radioTransportDiagnostics(out);speakerDiagnostics(out);playbackDiagnostics(out);profilesJson(out);bleStatus(out);out["batteryPercent"]=batteryPercent();out["batteryMillivolts"]=batteryMillivolts();
  }else if(method=="save")return saveConfig(body,out);
  else if(method=="upload_test"){if(busyNow||!cloudNow){out["error"]="请等待云端 READY 且空闲后重试";return 409;}bool stall=body["simulateStall"]|true;requestUploadTest(stall,body["allowRecovery"]|false);out["message"]=stall?"开始20秒合成音频缓存自检，模拟3.5秒网络停顿，不提交AI":"开始20秒正常网络合成上传自检，不提交AI";}
  else if(method=="speaker_volume"){if(busyNow){out["error"]="请等待录音或播放结束后调节";return 409;}if(!body["volume"].is<int>()||!speakerSetVolume(body["volume"].as<int>()))return fail(out,"音量需要 0–100，或设备存储失败");out["speakerVolume"]=speakerVolume();out["message"]="音量已保存，下次开机自动恢复";}
  else if(method=="squelch_test"){if(busyNow||!radioConfig.valid){out["error"]="请等待设备配置完成且空闲";return 409;}requestRadioCueTest();out["message"]="即将播放220ms无线电开台噪声";}
  else if(method=="speaker_test"){if(busyNow){out["error"]="请先等待录音或回复结束";return 409;}speakerTestRequest();out["message"]="即将播放两声本地测试音（不经过云端）";}
  else if(method=="storage_test"){
    uint8_t* bytes=(uint8_t*)malloc(5000);bool ok=storageReady&&bytes;
    if(ok){for(unsigned i=0;i<5000;i++)bytes[i]=(uint8_t)(i*31+7);ok=prefs.putBytes("probe",bytes,5000)==5000;
      if(ok){memset(bytes,0,5000);ok=prefs.getBytes("probe",bytes,5000)==5000;for(unsigned i=0;i<5000&&ok;i++)ok=bytes[i]==(uint8_t)(i*31+7);}}
    free(bytes);if(storageReady)prefs.remove("probe");out["storageWritable"]=ok;out["testedBytes"]=5000;return ok?200:500;
  }else if(method.startsWith("bluetooth_"))return bleCommand(method.c_str(),body,out);
  else if(method=="wifi_forget"){
    if(busyNow||manualScan||autoScan){out["error"]="设备忙或正在扫描，请稍后重试";return 409;}
    String ssid=body["ssid"]|"";KnownWifiSet updated=known;if(!knownWifiForget(updated,ssid.c_str()))return fail(out,"此网络未保存");
    RadioConfig c=radioConfig;int i=knownWifiFind(updated,updated.preferred);c.ssid=i>=0?updated.profiles[i].ssid:"";c.password=i>=0?updated.profiles[i].password:"";
    if(!persist(c,updated)){out["error"]="保存失败，网络列表保持不变";return 500;}
    known=updated;radioConfig.ssid=c.ssid;radioConfig.password=c.password;radioConfig.valid=configured(radioConfig,known);memset(blocked,0,sizeof(blocked));attempt=-1;nextScan=millis();
    if(WiFi.SSID()==ssid)WiFi.disconnect(false,false);out["message"]="已忘记网络，将尝试其他已记住网络";
  }else if(method=="scan_start"){
    if(busyNow||autoScan){out["error"]="设备忙或正在自动搜索已记住网络，请稍后重试";return 409;}
    if(!manualScan){WiFi.scanDelete();int r=WiFi.scanNetworks(true);manualScan=r==WIFI_SCAN_RUNNING;if(r==WIFI_SCAN_FAILED)return fail(out,"Wi-Fi 扫描启动失败");}
    out["state"]="scanning";
  }else if(method=="scan_results"){
    int n=WiFi.scanComplete();if(n==WIFI_SCAN_RUNNING)out["state"]="scanning";
    else if(n<0){manualScan=false;out["state"]="error";}
    else{manualScan=false;out["state"]="done";auto a=out["networks"].to<JsonArray>();for(int i=0;i<n&&i<32;i++){auto x=a.add<JsonObject>();x["ssid"]=WiFi.SSID(i);x["rssi"]=WiFi.RSSI(i);x["secure"]=WiFi.encryptionType(i)!=WIFI_AUTH_OPEN;x["saved"]=knownWifiFind(known,WiFi.SSID(i).c_str())>=0;}}
  }else if(method=="open")openSetup();
  else if(method=="close"){configView=false;displayChannel(currentChannel,cloudNow);}
  else return fail(out,"未知配置操作");
  return 200;
}
static void webCall(const char* method){
  if(web.header("X-Setup-Key")!=key){web.send(401,"application/json","{\"error\":\"请填写设备屏幕上的 KEY\"}");return;}
  String origin=web.header("Origin");if(origin.length()&&origin!="http://"+web.hostHeader()){web.send(403);return;}
  JsonDocument body,out;if(web.arg("plain").length()>12000){web.send(413);return;}
  if(web.method()==HTTP_POST&&web.arg("plain").length()&&deserializeJson(body,web.arg("plain"))){web.send(400);return;}
  int code=dispatch(method,body.as<JsonVariantConst>(),out);String s;serializeJson(out,s);web.sendHeader("Cache-Control","no-store");web.send(code,"application/json; charset=utf-8",s);
}
void setupBegin(){
  storageReady=prefs.begin("voxi-radio",false);if(!storageReady)configIssue="storage_unavailable";loadConfig();
  key=storageReady&&prefs.isKey("setup-key")?prefs.getString("setup-key",""):String();
  if(key.length()<12){char s[13];snprintf(s,sizeof(s),"%08lX%04lX",(unsigned long)esp_random(),(unsigned long)(esp_random()&0xffff));key=s;if(storageReady)prefs.putString("setup-key",key);}
  char name[24];snprintf(name,sizeof(name),"VOXI-%06lX",(unsigned long)(ESP.getEfuseMac()&0xffffff));apName=name;
  const char* headers[]={"X-Setup-Key","Origin"};web.collectHeaders(headers,2);
  web.on("/",HTTP_GET,[](){web.sendHeader("Cache-Control","no-store");web.send_P(200,"text/html; charset=utf-8",SETUP_PAGE);});
  web.on("/api/config",HTTP_GET,[](){webCall("config");});web.on("/api/config",HTTP_POST,[](){webCall("save");});web.on("/api/status",HTTP_GET,[](){webCall("status");});
  web.on("/api/wifi/scan",HTTP_GET,[](){webCall("scan_results");});web.on("/api/wifi/scan",HTTP_POST,[](){webCall("scan_start");});web.on("/api/wifi/forget",HTTP_POST,[](){webCall("wifi_forget");});
  web.on("/api/bluetooth/scan",HTTP_POST,[](){webCall("bluetooth_scan_start");});web.on("/api/bluetooth/scan",HTTP_GET,[](){webCall("bluetooth_scan_results");});
  web.on("/api/bluetooth/pair",HTTP_POST,[](){webCall("bluetooth_pair");});web.on("/api/bluetooth/forget",HTTP_POST,[](){webCall("bluetooth_forget");});
  web.on("/api/speaker/volume",HTTP_POST,[](){webCall("speaker_volume");});
  web.on("/api/speaker/test",HTTP_POST,[](){webCall("speaker_test");});
  web.on("/api/setup/open",HTTP_POST,[](){webCall("open");});web.on("/api/setup/close",HTTP_POST,[](){webCall("close");});
  web.onNotFound([](){web.sendHeader("Location","http://192.168.4.1/",true);web.send(302,"text/plain","");});
  WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.setAutoReconnect(false);
  WiFi.onEvent([](arduino_event_id_t event,arduino_event_info_t info){if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED){wifiReason=info.wifi_sta_disconnected.reason;diagnosticWifiEvent(false,wifiReason);}else if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP)diagnosticWifiEvent(true);});
  if(known.count)startKnown(knownWifiFind(known,known.preferred));
  bleBegin();
  Serial.printf("VOXI_CONFIG valid=%d profiles=%u storage=%d\n",radioConfig.valid,known.count,storageReady);
}
void setupTick(bool busy,bool cloudReady,int channel){
  busyNow=busy;cloudNow=cloudReady;currentChannel=channel;bleTick(busy);wifiTick();
  if(restartAt&&(int32_t)(millis()-restartAt)>=0){restartAt=0;Serial.println("VOXI_CONFIG_REBOOT");ESP.restart();}
  bool usb=HWCDC::isPlugged();
  static bool usbCandidate=false;static uint32_t usbChangedAt=0;
  if(usb!=usbCandidate){usbCandidate=usb;usbChangedAt=millis();}
  if(usbCandidate!=usbWas&&millis()-usbChangedAt>=400){
    usbWas=usbCandidate;
    if(usbWas){closeAp();configView=true;showSetup();}
    else{configView=false;displayChannel(currentChannel,cloudNow);}
  }
  if(ap){dns.processNextRequest();web.handleClient();}
  bool chord=digitalRead(BOARD_BOOT_KEY)==LOW&&digitalRead(BOARD_POWER_KEY)==LOW;
  if(chord&&!busy){if(!chordAt)chordAt=millis();if(!chordTriggered&&millis()-chordAt>3000){openSetup();chordTriggered=true;}}
  else{chordAt=0;chordTriggered=false;}
  // Standby remains visible offline; BOOT+PWR or the web button opens setup.
  for(int budget=0;budget<1024&&Serial.available();budget++){
    char ch=Serial.read();if(ch=='\r')continue;if(ch!='\n'){if(line.length()<14000)line+=ch;else line="";continue;}
    JsonDocument req,out,data;bool parsed=!deserializeJson(req,line);line="";if(!parsed||String(req["type"]|"")!="voxi_config")continue;
    out["id"]=req["id"];out["status"]=dispatch(req["method"]|"",req["body"].as<JsonVariantConst>(),data);out["data"]=data;String json;serializeJson(out,json);Serial.println("VOXI_USB "+json);
  }
}
