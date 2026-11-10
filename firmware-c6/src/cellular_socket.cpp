#ifdef VOXI_BOARD_MINICAM
#include "cellular_socket.h"
#include "cellular_protocol.h"
#include "minicam_modem.h"
#include "diagnostics.h"
#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>
#include <mbedtls/error.h>
#include <mbedtls/net_sockets.h>
#include <time.h>
CellularSocket::CellularSocket(){initTls();}
CellularSocket::~CellularSocket(){freeTls();}
void CellularSocket::initTls(){mbedtls_ssl_init(&ssl);mbedtls_ssl_config_init(&config);mbedtls_x509_crt_init(&trust);mbedtls_ctr_drbg_init(&random);mbedtls_entropy_init(&entropy);}
void CellularSocket::freeTls(){mbedtls_ssl_free(&ssl);mbedtls_ssl_config_free(&config);mbedtls_x509_crt_free(&trust);mbedtls_ctr_drbg_free(&random);mbedtls_entropy_free(&entropy);tlsReady=false;}
bool CellularSocket::minicamConnected(){return minicamTcpConnected();}
void CellularSocket::begin(const char* h,uint16_t p,const char* url,const char* certificate){host=h;port=p;path=url;secure=certificate!=nullptr;ca=certificate?certificate:"";attemptAt=millis()-retryMs;}
int CellularSocket::sendBio(void*,const unsigned char* p,size_t n){int sent=minicamTcpSend(p,n);return sent<0?MBEDTLS_ERR_NET_SEND_FAILED:sent;}
int CellularSocket::readBio(void* context,unsigned char* p,size_t n){
 int count=minicamTcpRead(p,n);
 if(count){if(context)static_cast<CellularSocket*>(context)->handshakeReceived=true;return count;}
 return minicamTcpConnected()?MBEDTLS_ERR_SSL_WANT_READ:MBEDTLS_ERR_NET_CONN_RESET;
}
void CellularSocket::fail(const char* reason,int code){error=code;char text[160];snprintf(text,sizeof(text),"4G %s (%d)",reason,code);lastFailureText=text;lastFailureAt=millis();remoteCloseCode=0;diagnosticError(text);disconnect();minicamTlsStatus(false,code);}
void CellularSocket::disconnect(){bool was=connected;connected=false;buffered=messageLength=0;fragmented=false;heartbeat.reset(millis());minicamTcpClose();freeTls();initTls();attemptAt=millis();if(was&&callback)callback(WStype_DISCONNECTED,nullptr,0);}
int CellularSocket::readSome(uint8_t* p,size_t n){return secure?mbedtls_ssl_read(&ssl,p,n):readBio(nullptr,p,n);}
bool CellularSocket::writeAll(const uint8_t* p,size_t n){
 uint32_t at=millis();while(n){int wrote=secure?mbedtls_ssl_write(&ssl,p,n):sendBio(nullptr,p,n);
  if(wrote==MBEDTLS_ERR_SSL_WANT_READ||wrote==MBEDTLS_ERR_SSL_WANT_WRITE){if(millis()-at>20000)return false;vTaskDelay(pdMS_TO_TICKS(1));continue;}
  if(wrote<=0){error=wrote;return false;}p+=wrote;n-=wrote;
 }return true;
}
static String base64(const uint8_t* p,size_t n){unsigned char out[96];size_t len=0;if(mbedtls_base64_encode(out,sizeof(out),&len,p,n))return "";return String((char*)out,len);}
bool CellularSocket::connect(){
 if(!minicamModemReady()||(secure&&time(nullptr)<1700000000))return false;
 if(!minicamTcpConnect(host.c_str(),port)){fail("TCP connection failed");return false;}
 if(secure){
  const unsigned char seed[]="voxi-cellular";int rc=mbedtls_ctr_drbg_seed(&random,mbedtls_entropy_func,&entropy,seed,sizeof(seed));
  if(!rc)rc=mbedtls_x509_crt_parse(&trust,(const unsigned char*)ca.c_str(),ca.length()+1);
  if(!rc)rc=mbedtls_ssl_config_defaults(&config,MBEDTLS_SSL_IS_CLIENT,MBEDTLS_SSL_TRANSPORT_STREAM,MBEDTLS_SSL_PRESET_DEFAULT);
  if(rc){fail("TLS setup failed",rc);return false;}
  mbedtls_ssl_conf_authmode(&config,MBEDTLS_SSL_VERIFY_REQUIRED);mbedtls_ssl_conf_ca_chain(&config,&trust,nullptr);mbedtls_ssl_conf_rng(&config,mbedtls_ctr_drbg_random,&random);
  if((rc=mbedtls_ssl_setup(&ssl,&config))||(rc=mbedtls_ssl_set_hostname(&ssl,host.c_str()))){fail("TLS initialization failed",rc);return false;}
  handshakeReceived=false;
  mbedtls_ssl_set_bio(&ssl,this,sendBio,readBio,nullptr);uint32_t began=millis();
  while((rc=mbedtls_ssl_handshake(&ssl))!=0){
   if(handshakeReceived){recovery.received();waitingForTlsReply=false;}
   if(rc!=MBEDTLS_ERR_SSL_WANT_READ&&rc!=MBEDTLS_ERR_SSL_WANT_WRITE){fail("TLS handshake failed",rc);return false;}
   const uint32_t elapsed=millis()-began;
   if(!handshakeReceived&&elapsed>=CellularRecovery::firstTlsByteMs){
    waitingForTlsReply=true;
    const auto action=recovery.noTlsResponse(millis());
    fail("TLS handshake received no reply");
    if(action!=CellularRecovery::Retry)minicamModemRequestRedial(action==CellularRecovery::Reattach);
    return false;
   }
   if(elapsed>=CellularRecovery::tlsHandshakeMs){fail("TLS handshake timed out");return false;}
   vTaskDelay(pdMS_TO_TICKS(1));
  }
  recovery.received();waitingForTlsReply=false;
  if(mbedtls_ssl_get_verify_result(&ssl)){fail("certificate verification failed");return false;}tlsReady=true;minicamTlsStatus(true);
 }
 uint8_t nonce[16];esp_fill_random(nonce,sizeof(nonce));String key=base64(nonce,sizeof(nonce));
 String request="GET "+path+" HTTP/1.1\r\nHost: "+host+":"+port+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: "+key+"\r\n"+headers+"\r\n\r\n";
 if(!writeAll((const uint8_t*)request.c_str(),request.length())){fail("WebSocket request failed",error);return false;}
 String reply;reply.reserve(1024);uint32_t began=millis();
 while(!reply.endsWith("\r\n\r\n")){
  uint8_t c;int count=readSome(&c,1);if(count==1)reply+=(char)c;
  else if(count!=MBEDTLS_ERR_SSL_WANT_READ&&count!=MBEDTLS_ERR_SSL_WANT_WRITE){fail("WebSocket response failed",count);return false;}
  if(reply.length()>8192||millis()-began>20000){fail("WebSocket header timed out");return false;}if(count!=1)vTaskDelay(pdMS_TO_TICKS(1));
 }
 String magic=key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";unsigned char digest[20];mbedtls_sha1((const unsigned char*)magic.c_str(),magic.length(),digest);String accept=base64(digest,20);
 bool accepted=false,upgrade=false,connection=false;int at=reply.indexOf("\r\n")+2;
 while(at>1&&at<(int)reply.length()-2){int end=reply.indexOf("\r\n",at),colon=reply.indexOf(':',at);if(end<0)break;if(colon>=at&&colon<end){String name=reply.substring(at,colon),value=reply.substring(colon+1,end);name.toLowerCase();value.trim();if(name=="sec-websocket-accept")accepted=value==accept;else{value.toLowerCase();if(name=="upgrade")upgrade=value=="websocket";if(name=="connection")connection=value.indexOf("upgrade")>=0;}}at=end+2;}
 if(!reply.startsWith("HTTP/1.1 101 ")||!accepted||!upgrade||!connection){int code=reply.substring(9,12).toInt();fail("WebSocket upgrade rejected",code);return false;}
 connected=true;recovery.connected();buffered=messageLength=0;fragmented=false;heartbeat.reset(millis());
 if(callback)callback(WStype_CONNECTED,(uint8_t*)path.c_str(),path.length());return true;
}
bool CellularSocket::frame(uint8_t opcode,const uint8_t* p,size_t n){
 if(!isConnected()||n>2048||(opcode>=8&&n>125))return false;
 uint8_t data[2048+8],mask[4];esp_fill_random(mask,4);size_t header=n<126?2:4;
 data[0]=0x80|opcode;data[1]=0x80|(n<126?n:126);if(header==4){data[2]=n>>8;data[3]=n;}
 memcpy(data+header,mask,4);for(size_t i=0;i<n;i++)data[header+4+i]=p[i]^mask[i%4];
 if(!writeAll(data,n+header+4)){fail("WebSocket write failed",error);return false;}return true;
}
bool CellularSocket::receiveFrame(){
 CellularFrame f;int parsed=cellularFrameHeader(wire,buffered,f);if(parsed<0){fail("invalid WebSocket frame");return true;}
 if(!parsed||buffered<f.header+f.length)return false;
 heartbeat.received(millis());
 uint8_t* p=wire+f.header;
 if(f.opcode==8){remoteCloseCode=f.length>=2?(uint16_t(p[0])<<8)|p[1]:1005;lastFailureText="Gateway WS close "+String(remoteCloseCode);if(f.length>2){lastFailureText+=": ";for(size_t i=2;i<f.length;i++)lastFailureText+=p[i]>=32&&p[i]<127?char(p[i]):'?';}lastFailureAt=millis();diagnosticError(lastFailureText.c_str());disconnect();return true;}
 if(f.opcode==9){if(callback)callback(WStype_PING,p,f.length);if(!frame(10,p,f.length))return true;}
 else if(f.opcode==10){if(callback)callback(WStype_PONG,p,f.length);}
 else{
  if(f.opcode==0){if(!fragmented){fail("unexpected continuation");return true;}}
  else{if(fragmented){fail("overlapping messages");return true;}fragmentOpcode=f.opcode;messageLength=0;}
  if(messageLength+f.length>sizeof(message)){fail("WebSocket message too large");return true;}
  memcpy(message+messageLength,p,f.length);messageLength+=f.length;fragmented=!f.final;
  if(f.final&&callback){callback(fragmentOpcode==2?WStype_BIN:WStype_TEXT,message,messageLength);messageLength=0;}
 }
 size_t consumed=f.header+f.length;if(!connected)return true;memmove(wire,wire+consumed,buffered-consumed);buffered-=consumed;return true;
}
void CellularSocket::loop(){
 if(connected&&!minicamTcpConnected()){fail("TCP disconnected");return;}
 if(!connected){if(minicamModemReady()&&millis()-attemptAt>=retryMs){attemptAt=millis();connect();}return;}
 bool handled=receiveFrame();
 if(!connected)return;
 if(!handled){
  if(buffered==sizeof(wire)){fail("WebSocket receive buffer full");return;}
  int count=readSome(wire+buffered,sizeof(wire)-buffered);
  if(count>0){buffered+=count;receiveFrame();}
  else if(count!=MBEDTLS_ERR_SSL_WANT_READ&&count!=MBEDTLS_ERR_SSL_WANT_WRITE){fail("TLS read failed",count);return;}
 }
 if(!connected)return;
 // Consume available frames before testing liveness. Audio/control traffic proves
 // the peer is alive, even when a Pong is delayed behind queued voice data.
 // Never return early after a complete frame: a sustained receive backlog
 // otherwise starves the periodic client Ping despite a healthy RX stream.
 auto action=heartbeat.tick(millis());
 if(action==CellularHeartbeat::Dead){fail("heartbeat timeout");return;}
 if(action==CellularHeartbeat::Ping)frame(9,nullptr,0);
}
void CellularSocket::writeFailure(bool,size_t,uint32_t){char text[96];snprintf(text,sizeof(text),"4G transport write failed: TLS=%d",error);diagnosticError(text);}
#endif
