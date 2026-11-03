#pragma once
#ifdef VOXI_BOARD_MINICAM
#include <Arduino.h>
#include <WebSocketsClient.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include "cellular_protocol.h"
class CellularSocket {
 String host,path,ca,headers;uint16_t port=0;
 WebSocketsClient::WebSocketClientEvent callback;
 mbedtls_ssl_context ssl;mbedtls_ssl_config config;mbedtls_x509_crt trust;
 mbedtls_ctr_drbg_context random;mbedtls_entropy_context entropy;
 bool connected=false,tlsReady=false,secure=true,fragmented=false;
 uint32_t attemptAt=0,retryMs=5000;uint8_t fragmentOpcode=0;CellularHeartbeat heartbeat;
 int error=0;size_t buffered=0,messageLength=0;uint8_t wire[4096],message[2048];
 void initTls();void freeTls();bool connect();void fail(const char*,int code=0);
 bool writeAll(const uint8_t*,size_t);int readSome(uint8_t*,size_t);bool frame(uint8_t,const uint8_t*,size_t);
 bool receiveFrame();
 static int sendBio(void*,const unsigned char*,size_t);static int readBio(void*,unsigned char*,size_t);
public:
 CellularSocket();~CellularSocket();
 void begin(const char* h,uint16_t p,const char* url,const char* certificate);
 void onEvent(WebSocketsClient::WebSocketClientEvent f){callback=f;}
 void setExtraHeaders(const char* h){headers=h;}
 void setReconnectInterval(uint32_t ms){retryMs=ms;}
 void enableHeartbeat(uint32_t interval,uint32_t timeout,uint8_t count){heartbeat.configure(interval,timeout,count,millis());}
 void disableHeartbeat(){heartbeat.configure(0,15000,2,millis());}
 void resumeHeartbeat(){enableHeartbeat(15000,3000,2);}
 bool isConnected()const{return connected&&minicamConnected();}
 static bool minicamConnected();
 bool sendTXT(uint8_t* p,size_t n){return frame(1,p,n);}
 bool sendPcm(const uint8_t* p,size_t n){return frame(2,p,n);}
 void disconnect();void loop();void writeFailure(bool,size_t,uint32_t);
};
#endif
