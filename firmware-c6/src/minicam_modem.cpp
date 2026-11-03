#ifdef VOXI_BOARD_MINICAM
#include "minicam_modem.h"
#include "cellular_protocol.h"
#include <Arduino.h>
#include <uart_uhci.h>
#include <driver/uart.h>
#include <driver/gpio.h>
#include <esp_heap_caps.h>
#include <atomic>
#include <sys/time.h>
#include <freertos/event_groups.h>
// ML307 AT socket sequence matches 78/esp-ml307; TLS runs on the ESP32.
static UartUhci modem;
struct DmaItem {UartUhci::RxBuffer* buffer;size_t size;};
static QueueHandle_t dmaQueue;
static std::atomic<uint32_t> dmaDrops{0};
static SemaphoreHandle_t commandMutex,stateMutex,ringMutex;
static EventGroupHandle_t events;
static constexpr EventBits_t DONE=1,FAILED=2,OPENED=4,OPEN_FAILED=8,SENT=16,CLOSED=32;
static std::atomic<int> sentCount{-1};
static std::atomic<bool> configured{false},selected{false},stopping{false},stopped{false},socketUp{false},ipUp{false};
static std::atomic<bool> waiting{false};
static char apn[64]={},response[2048]={};static size_t responseLength=0;
static constexpr size_t RING_SIZE=128*1024,LINE_SIZE=128*1024+256;
static uint8_t* ring;static size_t ringHead=0,ringTail=0,ringUsed=0;
struct State{bool detected=false,simReady=false,registered=false,tlsVerified=false;int signal=-1,tlsError=0,socketError=0;uint32_t rxBytes=0,txBytes=0,overflows=0,largestPacket=0,largestLine=0,ringPeak=0,pollFailures=0,dropAt=0;char dropReason[64]={};char model[48]={},status[48]="probing",lastAt[20]={};};
static State state;
static void tcpFailed(const char* reason){socketUp=false;xSemaphoreTake(stateMutex,portMAX_DELAY);strlcpy(state.dropReason,reason,sizeof(state.dropReason));state.dropAt=millis();xSemaphoreGive(stateMutex);}
static void status(const char* text){xSemaphoreTake(stateMutex,portMAX_DELAY);strlcpy(state.status,text,sizeof(state.status));xSemaphoreGive(stateMutex);}
static bool command(const String& text,uint32_t timeout=3000,String* reply=nullptr){
 if(!commandMutex||xSemaphoreTake(commandMutex,pdMS_TO_TICKS(timeout))!=pdTRUE)return false;
 xSemaphoreTake(stateMutex,portMAX_DELAY);size_t name=text.indexOf('=');if(name>19)name=min(text.length(),size_t(19));memcpy(state.lastAt,text.c_str(),name);state.lastAt[name]=0;xSemaphoreGive(stateMutex);
 xEventGroupClearBits(events,DONE|FAILED);responseLength=0;response[0]=0;waiting=true;
 String commandLine=text+"\r\n";
 if(modem.Transmit((const uint8_t*)commandLine.c_str(),commandLine.length(),timeout)!=ESP_OK){waiting=false;xSemaphoreGive(commandMutex);return false;}
 auto result=xEventGroupWaitBits(events,DONE|FAILED,pdFALSE,pdFALSE,pdMS_TO_TICKS(timeout));
 waiting=false;if(reply)*reply=response;xSemaphoreGive(commandMutex);
 return (result&DONE)&&!(result&FAILED);
}
static void receiveHex(std::string_view hex,size_t bytes){
 if(bytes>RING_SIZE||hex.size()!=bytes*2){tcpFailed("invalid modem TCP length");status("invalid modem TCP data");return;}
 xSemaphoreTake(ringMutex,portMAX_DELAY);
 if(bytes>RING_SIZE-ringUsed){xSemaphoreGive(ringMutex);tcpFailed("TCP receive ring overflow");xSemaphoreTake(stateMutex,portMAX_DELAY);state.overflows++;xSemaphoreGive(stateMutex);status("TCP receive overflow");return;}
 for(size_t i=0;i<bytes;i++){int a=cellularHexDigit(hex[i*2]),b=cellularHexDigit(hex[i*2+1]);if(a<0||b<0){xSemaphoreGive(ringMutex);tcpFailed("invalid modem TCP hex");status("invalid TCP hex");return;}}
 for(size_t i=0;i<bytes;i++){ring[ringHead]=(cellularHexDigit(hex[i*2])<<4)|cellularHexDigit(hex[i*2+1]);ringHead=(ringHead+1)%RING_SIZE;}ringUsed+=bytes;xSemaphoreGive(ringMutex);
 xSemaphoreTake(stateMutex,portMAX_DELAY);state.rxBytes+=bytes;state.largestPacket=max(state.largestPacket,(uint32_t)bytes);state.ringPeak=max(state.ringPeak,(uint32_t)ringUsed);xSemaphoreGive(stateMutex);
}
static void parseLine(std::string_view line){
 if(line.empty())return;
 xSemaphoreTake(stateMutex,portMAX_DELAY);state.largestLine=max(state.largestLine,(uint32_t)line.size());xSemaphoreGive(stateMutex);
 if(line=="OK"){if(waiting)xEventGroupSetBits(events,DONE);return;}
 if(line=="ERROR"||line.substr(0,11)=="+CME ERROR:"){if(waiting)xEventGroupSetBits(events,FAILED);return;}
 auto colon=line.find(':');std::string_view args[8];bool quoted[8]={};size_t count=0;
 if(colon!=line.npos)count=cellularCsv(line.substr(colon+1),args,8,quoted);
 auto name=line.substr(0,colon);
 if(name=="+MIPURC"&&count>=2){
  if(args[1]=="0"&&args[0]=="rtcp"&&count==4){int bytes=cellularInteger(args[2]);if(bytes>=0)receiveHex(args[3],bytes);else tcpFailed("invalid MIPURC byte count");}
  else if(args[1]=="0"&&args[0]=="disconn"){int code=count>2?cellularInteger(args[2]):-1;char reason[64];snprintf(reason,sizeof(reason),"modem MIPURC disconnect: %d",code);tcpFailed(reason);}
  return;
 }
 if(name=="+MIPOPEN"&&count==2&&args[0]=="0"){
  int code=cellularInteger(args[1]);socketUp=code==0;xSemaphoreTake(stateMutex,portMAX_DELAY);state.socketError=code;xSemaphoreGive(stateMutex);xEventGroupSetBits(events,code==0?OPENED:OPEN_FAILED);
 }else if(name=="+MIPCLOSE"&&count&&args[0]=="0"){socketUp=false;xEventGroupSetBits(events,CLOSED);}
 else if(name=="+MIPSEND"&&count>=2&&args[0]=="0"){sentCount=cellularInteger(args[1]);xEventGroupSetBits(events,SENT);}
 else if(name=="+MIPCALL"&&count>=2&&args[0]=="1")ipUp=args[1]=="1";
 else if(name=="+CEREG"&&count){int v=cellularInteger(args[count>1&&!quoted[1]?1:0]);xSemaphoreTake(stateMutex,portMAX_DELAY);state.registered=v==1||v==5;xSemaphoreGive(stateMutex);if(v!=1&&v!=5){ipUp=false;char reason[48];snprintf(reason,sizeof(reason),"LTE registration lost: %d",v);tcpFailed(reason);}}
 else if(name=="+CSQ"&&count){xSemaphoreTake(stateMutex,portMAX_DELAY);state.signal=cellularInteger(args[0]);xSemaphoreGive(stateMutex);}
 else if(name=="+CPIN"&&count){xSemaphoreTake(stateMutex,portMAX_DELAY);state.simReady=args[0]=="READY";xSemaphoreGive(stateMutex);}
 if(waiting&&responseLength+line.size()+2<sizeof(response)){memcpy(response+responseLength,line.data(),line.size());responseLength+=line.size();response[responseLength++]='\n';response[responseLength]=0;}
}
static void receiver(void*){
 char* line=(char*)heap_caps_malloc(LINE_SIZE,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);assert(line);size_t used=0;bool dropping=false;
 for(;;){DmaItem item;
  if(xQueueReceive(dmaQueue,&item,pdMS_TO_TICKS(100))==pdTRUE){
   for(size_t i=0;i<item.size;i++){char c=item.buffer->data[i];
    if(c=='\n'){if(!dropping){if(used&&line[used-1]=='\r')used--;parseLine({line,used});}used=0;dropping=false;}
    else if(!dropping){if(used+1<LINE_SIZE)line[used++]=c;else{dropping=true;tcpFailed("modem UART line overflow");xSemaphoreTake(stateMutex,portMAX_DELAY);state.overflows++;xSemaphoreGive(stateMutex);status("modem line overflow");}}
   }
   modem.ReturnBuffer(item.buffer);
  }
  modem.ReclaimDeferredBuffers();
  uint32_t dropped=dmaDrops.exchange(0);if(modem.CheckAndClearOverflow())dropped++;
  if(dropped){tcpFailed("modem DMA receive overflow");xSemaphoreTake(stateMutex,portMAX_DELAY);state.overflows+=dropped;xSemaphoreGive(stateMutex);status("modem DMA overflow");}
 }

}
static void manager(void*){
 while(!configured)vTaskDelay(pdMS_TO_TICKS(20));delay(200);
 bool detected=false;while(!detected&&!stopping){detected=command("AT",800);if(!detected){status("waiting for modem");delay(500);}}
 xSemaphoreTake(stateMutex,portMAX_DELAY);state.detected=detected;xSemaphoreGive(stateMutex);
 if(!detected){stopped=true;vTaskSuspend(nullptr);return;}
 command("ATE0");String reply;
 if(command("AT+CGMM",3000,&reply)){reply.trim();xSemaphoreTake(stateMutex,portMAX_DELAY);reply.toCharArray(state.model,sizeof(state.model));xSemaphoreGive(stateMutex);}
 if(selected&&apn[0]){command("AT+CFUN=0",5000);if(!command(String("AT+CGDCONT=1,\"IP\",\"")+apn+"\""))status("APN configuration rejected");}
 command("AT+CFUN=1",5000);command("AT+CEREG=2");
 uint32_t activationAt=0;
 for(;;){
  if(stopping){minicamTcpClose();bool ok=command("AT+CFUN=0",5000);if(ok)modem.StopReceive();stopped=ok;vTaskSuspend(nullptr);}
  if(!command("AT+CPIN?")){xSemaphoreTake(stateMutex,portMAX_DELAY);state.pollFailures++;xSemaphoreGive(stateMutex);}command("AT+CEREG?");command("AT+CSQ");
  if(selected){
   command("AT+MIPCALL?");
   if(!ipUp&&millis()-activationAt>15000){activationAt=millis();command(apn[0]?String("AT+MIPCALL=1,1,\"")+apn+"\"":String("AT+MIPCALL=1,1"),10000);}
   if(time(nullptr)<1700000000&&command("AT+CCLK?",3000,&reply)){
    int at=reply.indexOf(':');int64_t epoch=at>=0?cellularClock(std::string_view(reply.c_str()+at+1,reply.length()-at-1)):0;
    // Drop the trailing line terminator before parsing a quoted CCLK field.
    if(!epoch){reply.trim();at=reply.indexOf(':');if(at>=0)epoch=cellularClock({reply.c_str()+at+1,reply.length()-at-1});}
    if(epoch){timeval tv={(time_t)epoch,0};settimeofday(&tv,nullptr);}
   }
  }
  xSemaphoreTake(stateMutex,portMAX_DELAY);bool sim=state.simReady,reg=state.registered;xSemaphoreGive(stateMutex);
  status(!sim?"SIM not ready":!reg?"registering":selected?(ipUp?"4G data ready":"activating data"):"registered; Wi-Fi selected");
  for(int i=0;i<100&&!stopping;i++)vTaskDelay(pdMS_TO_TICKS(100));
 }
}
void minicamModemBegin(){
 commandMutex=xSemaphoreCreateMutex();stateMutex=xSemaphoreCreateMutex();ringMutex=xSemaphoreCreateMutex();events=xEventGroupCreate();ring=(uint8_t*)heap_caps_malloc(RING_SIZE,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);assert(commandMutex&&stateMutex&&ringMutex&&events&&ring);
 dmaQueue=xQueueCreate(64,sizeof(DmaItem));assert(dmaQueue);
 uart_config_t uart={};uart.baud_rate=921600;uart.data_bits=UART_DATA_8_BITS;uart.parity=UART_PARITY_DISABLE;uart.stop_bits=UART_STOP_BITS_1;uart.source_clk=UART_SCLK_DEFAULT;
 ESP_ERROR_CHECK(uart_param_config(UART_NUM_1,&uart));ESP_ERROR_CHECK(uart_set_pin(UART_NUM_1,47,48,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE));gpio_set_pull_mode(GPIO_NUM_48,GPIO_PULLUP_ONLY);
 UartUhci::Config config={UART_NUM_1,32,{64,512}};ESP_ERROR_CHECK(modem.Init(config));
 modem.SetRxCallback([](const UartUhci::RxEventData& event,void*)->bool{
  BaseType_t higher=pdFALSE;DmaItem item={event.buffer,event.recv_size};
  if(!event.buffer)return false;
  if(!event.recv_size){modem.DeferReturnBuffer(event.buffer);return false;}
  if(xQueueSendFromISR(dmaQueue,&item,&higher)!=pdTRUE){modem.DeferReturnBuffer(event.buffer);dmaDrops.fetch_add(1);}
  return higher==pdTRUE;
 },nullptr);
 ESP_ERROR_CHECK(modem.StartReceive());
 assert(xTaskCreatePinnedToCore(receiver,"ml307-rx",4096,nullptr,4,nullptr,0)==pdPASS);
 assert(xTaskCreatePinnedToCore(manager,"ml307-net",6144,nullptr,1,nullptr,0)==pdPASS);
}
void minicamModemConfigure(bool enabled,const char* value){selected=enabled;strlcpy(apn,value,sizeof(apn));configured=true;}
bool minicamModemReady(){return selected&&ipUp&&!stopping;}
int minicamSignal(){xSemaphoreTake(stateMutex,portMAX_DELAY);int v=state.signal;xSemaphoreGive(stateMutex);return v;}
bool minicamTcpConnected(){return socketUp;}
void minicamTcpClose(){socketUp=false;xEventGroupClearBits(events,CLOSED);if(command("AT+MIPCLOSE=0",2000))xEventGroupWaitBits(events,CLOSED,pdTRUE,pdFALSE,pdMS_TO_TICKS(1500));xSemaphoreTake(ringMutex,portMAX_DELAY);ringHead=ringTail=ringUsed=0;xSemaphoreGive(ringMutex);minicamTlsStatus(false);}
bool minicamTcpConnect(const char* host,uint16_t port){
 if(!minicamModemReady())return false;minicamTcpClose();xEventGroupClearBits(events,OPENED|OPEN_FAILED);
 if(!command("AT+MIPCFG=\"ssl\",0,0,0")||!command("AT+MIPCFG=\"encoding\",0,1,1"))return false;
 if(!command(String("AT+MIPOPEN=0,\"TCP\",\"")+host+"\","+port+",,0",5000))return false;
 auto bits=xEventGroupWaitBits(events,OPENED|OPEN_FAILED,pdFALSE,pdFALSE,pdMS_TO_TICKS(20000));return (bits&OPENED)&&socketUp;
}
int minicamTcpSend(const uint8_t* bytes,size_t length){
 size_t sent=0;const char hex[]="0123456789ABCDEF";
 while(sent<length){if(!socketUp)return -1;// ML307 HEX input allows 1460 encoded characters, i.e. 730 data bytes.
 size_t n=min(length-sent,size_t(730));String text="AT+MIPSEND=0,"+String(n)+",";text.reserve(text.length()+n*2);
  for(size_t i=0;i<n;i++){uint8_t b=bytes[sent+i];text+=hex[b>>4];text+=hex[b&15];}
  sentCount=-1;xEventGroupClearBits(events,SENT);
  if(!command(text,7000)||!(xEventGroupWaitBits(events,SENT,pdTRUE,pdFALSE,pdMS_TO_TICKS(5000))&SENT)||sentCount!=(int)n){tcpFailed("modem TCP send failed");status("modem send timeout");return -1;}
  sent+=n;
 }
 xSemaphoreTake(stateMutex,portMAX_DELAY);state.txBytes+=sent;xSemaphoreGive(stateMutex);return sent;
}
int minicamTcpRead(uint8_t* bytes,size_t capacity){xSemaphoreTake(ringMutex,portMAX_DELAY);size_t n=min(capacity,ringUsed);for(size_t i=0;i<n;i++){bytes[i]=ring[ringTail];ringTail=(ringTail+1)%RING_SIZE;}ringUsed-=n;xSemaphoreGive(ringMutex);return n;}
void minicamTlsStatus(bool verified,int error){xSemaphoreTake(stateMutex,portMAX_DELAY);state.tlsVerified=verified;state.tlsError=error;xSemaphoreGive(stateMutex);}
void minicamModemDiagnostics(JsonDocument& out){State s;xSemaphoreTake(stateMutex,portMAX_DELAY);s=state;xSemaphoreGive(stateMutex);
 out["cellularLastDropReason"]=s.dropReason;out["cellularLastDropAtMs"]=s.dropAt;out["cellularLargestPacket"]=s.largestPacket;out["cellularLargestLine"]=s.largestLine;out["cellularRingPeakBytes"]=s.ringPeak;out["cellularPollFailures"]=s.pollFailures;out["cellularUartDriver"]="UHCI DMA";out["cellularDetected"]=s.detected;out["cellularModel"]=s.model;out["cellularBaud"]=921600;out["cellularSimReady"]=s.simReady;out["cellularRegistered"]=s.registered;out["cellularSignal"]=s.signal;out["cellularStatus"]=s.status;out["cellularTransportEnabled"]=(bool)selected;out["cellularDataReady"]=(bool)ipUp;out["cellularTcpConnected"]=(bool)socketUp;out["cellularTlsVerified"]=s.tlsVerified;out["cellularTlsError"]=s.tlsError;out["cellularSocketError"]=s.socketError;out["cellularLastAt"]=s.lastAt;out["cellularRxBytes"]=s.rxBytes;out["cellularTxBytes"]=s.txBytes;out["cellularRxOverflows"]=s.overflows;
 xSemaphoreTake(ringMutex,portMAX_DELAY);out["cellularTcpBufferedBytes"]=ringUsed;xSemaphoreGive(ringMutex);
}
bool minicamModemStandby(){stopping=true;uint32_t began=millis();while(!stopped&&millis()-began<15000)delay(10);return stopped;}
#endif
