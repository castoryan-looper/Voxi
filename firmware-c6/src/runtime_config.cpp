#include "runtime_config.h"
#include "board_audio.h"
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
static String key,apName,line;
static bool ap=false,configView=false,busyNow=false,cloudNow=false,scan=false,usbWas=false,chordTriggered=false;
static uint32_t restartAt=0,chordAt=0;
static int currentChannel=0;
static String normalCa(String s){s.replace("\\n","\n");s.replace("\r","");s.trim();if(s.length())s+='\n';return s;}
static bool validCa(const String& s){mbedtls_x509_crt c;mbedtls_x509_crt_init(&c);int ret=mbedtls_x509_crt_parse(&c,(const unsigned char*)s.c_str(),s.length()+1);mbedtls_x509_crt_free(&c);return ret==0;}
static void fillConfig(JsonDocument& d){
  d["ssid"]=radioConfig.ssid;d["host"]=radioConfig.host;d["port"]=radioConfig.port;d["tls"]=radioConfig.tls;d["ca"]=radioConfig.ca;
  d["passwordConfigured"]=radioConfig.password.length()>0;d["tokenConfigured"]=radioConfig.token.length()>0;
}
static void loadConfig(){
  JsonDocument d;if(deserializeJson(d,prefs.getString("config","")))return;
  radioConfig.ssid=d["ssid"]|"";radioConfig.password=d["password"]|"";radioConfig.host=d["host"]|"43.160.215.253";
  radioConfig.port=d["port"]|9443;radioConfig.tls=d["tls"]|true;radioConfig.ca=d["ca"]|"";radioConfig.token=d["token"]|"";
  radioConfig.valid=radioConfig.ssid.length()>0&&radioConfig.host.length()>0&&radioConfig.token.length()>=16&&(!radioConfig.tls||validCa(radioConfig.ca));
}
static void showSetup(){displaySetup(ap?apName.c_str():"USB SETUP",ap?key.c_str():"",ap);}
static void closeAp(){if(ap){dns.stop();web.stop();WiFi.softAPdisconnect(true);WiFi.mode(WIFI_STA);ap=false;}}
static void openSetup(){
  configView=true;
  if(HWCDC::isPlugged()){closeAp();showSetup();return;}
  if(!ap){WiFi.mode(WIFI_AP_STA);ap=WiFi.softAP(apName.c_str(),key.c_str());if(ap){dns.start(53,"*",WiFi.softAPIP());web.begin();}}
  showSetup();
}
static int fail(JsonDocument& out,const char* message){out["error"]=message;return 400;}
static int saveConfig(JsonVariantConst body,JsonDocument& out){
  if(busyNow){out["error"]="请先结束对讲和播放";return 409;}
  if(!body.is<JsonObjectConst>())return fail(out,"配置格式不正确");
  RadioConfig c=radioConfig;
  c.ssid=body["ssid"]|"";c.host=body["host"]|"";c.token=body["token"]|"";c.ca=normalCa(body["ca"]|"");
  String password=body["password"]|"";
  if(!c.token.length())c.token=radioConfig.token;
  if(body["clearWifiPassword"]|false)c.password="";
  else if(password.length())c.password=password;
  else if(c.ssid!=radioConfig.ssid)return fail(out,"新 Wi-Fi 请填写密码，或勾选开放网络");
  int port=body["port"]|0;c.tls=body["tls"]|true;
  if(!c.ssid.length()||c.ssid.length()>32)return fail(out,"Wi-Fi 名称需要 1–32 字节");
  if(c.password.length()&& (c.password.length()<8||c.password.length()>63))return fail(out,"Wi-Fi 密码需要 8–63 字符");
  if(!c.host.length()||c.host.length()>253)return fail(out,"请填写云端域名或 IP");
  for(unsigned i=0;i<c.host.length();i++){char ch=c.host[i];if(!isalnum((unsigned char)ch)&&ch!='.'&&ch!='-')return fail(out,"主机名不能包含协议、路径或端口");}
  if(port<1||port>65535)return fail(out,"端口需要 1–65535");c.port=port;
  if(c.token.length()<16||c.token.length()>256||c.token.indexOf('\n')>=0||c.token.indexOf('\r')>=0)return fail(out,"设备令牌需要 16–256 字符");
  if(c.ca.length()>6000|| (c.tls&&!validCa(c.ca)))return fail(out,"请粘贴有效 PEM 根 CA 证书");
  JsonDocument stored;stored["ssid"]=c.ssid;stored["password"]=c.password;stored["host"]=c.host;stored["port"]=c.port;stored["tls"]=c.tls;stored["token"]=c.token;stored["ca"]=c.ca;
  String json;serializeJson(stored,json);
  if(prefs.putString("config",json)!=json.length()){out["error"]="设备保存失败，原配置未替换，请检查 NVS 空间";return 500;}
  out["message"]="已保存，设备即将重启；USB 页面会尝试恢复连接。";restartAt=millis()+1800;return 200;
}
static int dispatch(const String& method,JsonVariantConst body,JsonDocument& out){
  if(method=="config")fillConfig(out);
  else if(method=="status"){
    out["firmware"]="voxi-c6-web-1";out["configured"]=radioConfig.valid;out["usbConnected"]=HWCDC::isPlugged();
    out["wifiConnected"]=WiFi.status()==WL_CONNECTED;out["ssid"]=WiFi.SSID();out["ip"]=WiFi.localIP().toString();
    out["cloudReady"]=cloudNow;out["busy"]=busyNow;out["channel"]=currentChannel+1;out["apActive"]=ap;
    out["timeReady"]=time(nullptr)>1700000000;
  }else if(method=="save")return saveConfig(body,out);
  else if(method=="scan_start"){
    if(busyNow){out["error"]="请先结束对讲和播放";return 409;}
    if(!scan){WiFi.scanDelete();int r=WiFi.scanNetworks(true);scan=r==WIFI_SCAN_RUNNING;if(r==WIFI_SCAN_FAILED)return fail(out,"Wi-Fi 扫描启动失败");}
    out["state"]="scanning";
  }else if(method=="scan_results"){
    int n=WiFi.scanComplete();
    if(n==WIFI_SCAN_RUNNING){out["state"]="scanning";}
    else if(n<0){scan=false;out["state"]="error";}
    else{scan=false;out["state"]="done";auto a=out["networks"].to<JsonArray>();for(int i=0;i<n&&i<32;i++){auto x=a.add<JsonObject>();x["ssid"]=WiFi.SSID(i);x["rssi"]=WiFi.RSSI(i);x["secure"]=WiFi.encryptionType(i)!=WIFI_AUTH_OPEN;}}
  }else if(method=="open")openSetup();
  else if(method=="close"){closeAp();configView=false;displayChannel(currentChannel,cloudNow);}
  else return fail(out,"未知配置操作");
  return 200;
}
static void webCall(const char* method){
  if(web.header("X-Setup-Key")!=key){web.send(401,"application/json","{\"error\":\"请填写设备屏幕上的 KEY\"}");return;}
  String origin=web.header("Origin");if(origin.length()&&origin!="http://"+web.hostHeader()){web.send(403);return;}
  JsonDocument body,out;
  if(web.arg("plain").length()>10000){web.send(413);return;}
  if(web.method()==HTTP_POST&&web.arg("plain").length()&&deserializeJson(body,web.arg("plain"))){web.send(400);return;}
  int code=dispatch(method,body.as<JsonVariantConst>(),out);String s;serializeJson(out,s);
  web.sendHeader("Cache-Control","no-store");web.send(code,"application/json; charset=utf-8",s);
}
void setupBegin(){
  prefs.begin("voxi-radio",false);loadConfig();key=prefs.getString("setup-key","");
  if(key.length()<12){char s[13];snprintf(s,sizeof(s),"%08lX%04lX",(unsigned long)esp_random(),(unsigned long)(esp_random()&0xffff));key=s;prefs.putString("setup-key",key);}
  char name[24];snprintf(name,sizeof(name),"VOXI-%06lX",(unsigned long)(ESP.getEfuseMac()&0xffffff));apName=name;
  const char* headers[]={"X-Setup-Key","Origin"};web.collectHeaders(headers,2);
  web.on("/",HTTP_GET,[](){web.sendHeader("Cache-Control","no-store");web.send_P(200,"text/html; charset=utf-8",SETUP_PAGE);});
  web.on("/api/config",HTTP_GET,[](){webCall("config");});web.on("/api/config",HTTP_POST,[](){webCall("save");});
  web.on("/api/status",HTTP_GET,[](){webCall("status");});
  web.on("/api/wifi/scan",HTTP_GET,[](){webCall("scan_results");});web.on("/api/wifi/scan",HTTP_POST,[](){webCall("scan_start");});
  web.onNotFound([](){web.sendHeader("Location","http://192.168.4.1/",true);web.send(302,"text/plain","");});
  WiFi.mode(WIFI_STA);WiFi.setSleep(false);
  if(radioConfig.valid)WiFi.begin(radioConfig.ssid.c_str(),radioConfig.password.c_str());
  else openSetup();
  Serial.println("VOXI setup ready; open http://127.0.0.1:8788/ and connect USB");
}
void setupTick(bool busy,bool cloudReady,int channel){
  busyNow=busy;cloudNow=cloudReady;currentChannel=channel;
  if(restartAt&&(int32_t)(millis()-restartAt)>=0)ESP.restart();
  bool usb=HWCDC::isPlugged();
  if(usb!=usbWas){usbWas=usb;if(usb&&ap){closeAp();if(configView)showSetup();}else if(configView)openSetup();}
  if(ap){dns.processNextRequest();web.handleClient();}
  bool chord=digitalRead(9)==LOW&&digitalRead(2)==LOW;
  if(chord&&!busy){if(!chordAt)chordAt=millis();if(!chordTriggered&&millis()-chordAt>3000){openSetup();chordTriggered=true;}}
  else {chordAt=0;chordTriggered=false;}
  if(!usb&&!ap&&WiFi.status()!=WL_CONNECTED&&millis()>30000)openSetup();
  // Bounded, newline-framed USB RPC; arbitrary serial log lines are ignored.
  for(int budget=0;budget<1024&&Serial.available();budget++){
    char ch=Serial.read();if(ch=='\r')continue;
    if(ch!='\n'){if(line.length()<12000)line+=ch;else line="";continue;}
    JsonDocument req,out,data;bool parsed=!deserializeJson(req,line);line="";
    if(!parsed||String(req["type"]|"")!="voxi_config")continue;
    out["id"]=req["id"];out["status"]=dispatch(req["method"]|"",req["body"].as<JsonVariantConst>(),data);out["data"]=data;
    String json;serializeJson(out,json);Serial.println("VOXI_USB "+json);
  }
}
