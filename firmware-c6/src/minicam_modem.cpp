#ifdef VOXI_BOARD_MINICAM
#include "minicam_modem.h"
#include <Arduino.h>
#include <HardwareSerial.h>
#include <ctype.h>
// GPIO47/48 are reserved for the modem; never drive them as indicator LEDs.
static HardwareSerial modem(1);
static SemaphoreHandle_t stateMutex;
static volatile bool stopping=false,stopped=false;
struct State{bool detected=false,simReady=false,registered=false;int baud=0,signal=-1;char model[64]={},status[48]="probing";};
static State state;
static String command(const char* text,uint32_t timeout=1500){
 while(modem.available())modem.read();modem.print(text);modem.print("\r\n");
 String reply;uint32_t began=millis();
 while(millis()-began<timeout){while(modem.available()){char c=modem.read();if(reply.length()<1024)reply+=c;}if(reply.indexOf("\r\nOK\r\n")>=0||reply.indexOf("\r\nERROR\r\n")>=0||reply.indexOf("+CME ERROR:")>=0)break;vTaskDelay(pdMS_TO_TICKS(5));}
 return reply;
}
static void worker(void*){
 State local;
 for(int baud:{115200,921600,460800}){
  if(stopping)break;modem.begin(baud,SERIAL_8N1,48,47);delay(100);
  if(command("AT",600).indexOf("OK")>=0){local.detected=true;local.baud=baud;break;}modem.end();
 }
 if(local.detected){
  command("ATE0");String model=command("AT+CGMM");model.replace("\r","");
  for(int start=0;start<(int)model.length();){int end=model.indexOf('\n',start);if(end<0)end=model.length();String line=model.substring(start,end);line.trim();if(line.length()&&line!="OK"&&!line.startsWith("AT")){line.toCharArray(local.model,sizeof(local.model));break;}start=end+1;}
  // Restore the radio after standby. No APN, SIM PIN, identity or firmware changes.
  command("AT+CFUN=1",3000);
 }
 for(;;){
  if(stopping){
   bool ok=true;if(local.detected)ok=command("AT+CFUN=0",3000).indexOf("OK")>=0;
   stopped=ok;vTaskSuspend(nullptr);
  }
  if(local.detected){
   local.simReady=command("AT+CPIN?").indexOf("READY")>=0;
   String reg=command("AT+CEREG?");int at=reg.indexOf("+CEREG:");int comma=reg.indexOf(',',at);int registration=at<0?-1:reg.substring(comma>=0?comma+1:at+7).toInt();local.registered=registration==1||registration==5;
   String csq=command("AT+CSQ");at=csq.indexOf("+CSQ:");local.signal=at>=0?csq.substring(at+5).toInt():-1;
  }
  strlcpy(local.status,!local.detected?"no AT response":!local.simReady?"SIM not ready":local.registered?"registered; transport not enabled":"waiting for registration",sizeof(local.status));
  xSemaphoreTake(stateMutex,portMAX_DELAY);state=local;xSemaphoreGive(stateMutex);
  for(int i=0;i<300&&!stopping;i++)vTaskDelay(pdMS_TO_TICKS(100));
 }
}
void minicamModemBegin(){stateMutex=xSemaphoreCreateMutex();assert(stateMutex);xTaskCreatePinnedToCore(worker,"ml307-probe",4096,nullptr,1,nullptr,0);}
void minicamModemDiagnostics(JsonDocument& out){State copy;if(!stateMutex)return;xSemaphoreTake(stateMutex,portMAX_DELAY);copy=state;xSemaphoreGive(stateMutex);out["cellularDetected"]=copy.detected;out["cellularModel"]=copy.model;out["cellularBaud"]=copy.baud;out["cellularSimReady"]=copy.simReady;out["cellularRegistered"]=copy.registered;out["cellularSignal"]=copy.signal;out["cellularStatus"]=copy.status;out["cellularTransportEnabled"]=false;}
bool minicamModemStandby(){stopping=true;uint32_t began=millis();while(!stopped&&millis()-began<10000)delay(10);return stopped;}
#endif
