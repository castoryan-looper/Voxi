#include "opus_uplink.h"
#ifdef VOXI_OPUS_UPLINK
#include <esp_opus_enc.h>
#include <esp_timer.h>
#include <string.h>
static void* encoder=nullptr;
static uint8_t pending[960],encoded[1276],bundle[225];
static size_t used=0,bundleUsed=5;static uint32_t sequence=0;static bool hasAudio=false;
uint32_t opusUplinkFrames=0,opusUplinkErrors=0,opusUplinkMaxUs=0,opusUplinkWireBytes=0;
static void closeInline(){if(encoder){esp_opus_enc_close(encoder);encoder=nullptr;}}
static bool resetInline(){
 used=0;bundleUsed=5;sequence=0;hasAudio=false;memset(bundle,0,5);
 opusUplinkFrames=opusUplinkErrors=opusUplinkMaxUs=opusUplinkWireBytes=0;
 if(encoder)return esp_opus_enc_reset(encoder)==ESP_AUDIO_ERR_OK;
 esp_opus_enc_config_t c={};c.sample_rate=24000;c.channel=1;c.bits_per_sample=16;c.bitrate=16000;
 c.frame_duration=ESP_OPUS_ENC_FRAME_DURATION_20_MS;c.application_mode=ESP_OPUS_ENC_APPLICATION_VOIP;c.complexity=0;
 if(esp_opus_enc_open(&c,sizeof(c),&encoder)!=ESP_AUDIO_ERR_OK){opusUplinkErrors++;return false;}
 int in=0,out=0;if(esp_opus_enc_get_frame_size(encoder,&in,&out)!=ESP_AUDIO_ERR_OK||in!=960||out>sizeof(encoded)){closeInline();opusUplinkErrors++;return false;}
 return true;
}
static bool flush(OpusUplinkSend send){
 if(!bundle[4])return true;
 if(!send(bundle,bundleUsed))return false;
 opusUplinkWireBytes+=bundleUsed;bundleUsed=5;bundle[4]=0;return true;
}
static bool frame(uint16_t valid,OpusUplinkSend send){
 esp_audio_enc_in_frame_t in={pending,960};esp_audio_enc_out_frame_t out={};out.buffer=encoded;out.len=sizeof(encoded);
 int64_t at=esp_timer_get_time();auto rc=esp_opus_enc_process(encoder,&in,&out);
 uint32_t elapsed=esp_timer_get_time()-at;if(elapsed>opusUplinkMaxUs)opusUplinkMaxUs=elapsed;
 if(rc!=ESP_AUDIO_ERR_OK||out.encoded_bytes!=40){opusUplinkErrors++;return false;}
 if(!bundle[4])for(int i=0;i<4;i++)bundle[i]=uint8_t(sequence>>(8*i));
 bundle[bundleUsed++]=valid;bundle[bundleUsed++]=valid>>8;
 bundle[bundleUsed++]=40;bundle[bundleUsed++]=0;memcpy(bundle+bundleUsed,encoded,40);bundleUsed+=40;
 bundle[4]++;sequence++;opusUplinkFrames++;
 return bundle[4]<5||flush(send);
}
static bool audioInline(const uint8_t* pcm,size_t bytes,OpusUplinkSend send){
 if(!encoder||bytes%2)return false;
 if(bytes)hasAudio=true;
 while(bytes){size_t n=bytes<sizeof(pending)-used?bytes:sizeof(pending)-used;memcpy(pending+used,pcm,n);used+=n;pcm+=n;bytes-=n;
  if(used==sizeof(pending)){if(!frame(480,send))return false;used=0;}
 }
 return true;
}
static bool finishInline(OpusUplinkSend send){
 if(!encoder)return false;
 if(used){uint16_t valid=used/2;memset(pending+used,0,sizeof(pending)-used);if(!frame(valid,send))return false;used=0;}
 if(hasAudio){memset(pending,0,sizeof(pending));if(!frame(0,send))return false;}
 hasAudio=false;return flush(send);
}
#ifdef VOXI_OPUS_C6
// C6 has no PSRAM. Run encoder calls on a temporary stack, and release that
// stack at end-of-turn. Never reserve another permanent 32KB task at idle.
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
enum class EncoderOp {Reset,Audio,Finish,Close};
struct EncoderJob {EncoderOp op;const uint8_t* pcm;size_t bytes;OpusUplinkSend send;bool result=false;};
static QueueHandle_t encoderQueue=nullptr;
static SemaphoreHandle_t encoderDone=nullptr;
static StaticSemaphore_t encoderLockStorage;
static SemaphoreHandle_t encoderLock=xSemaphoreCreateMutexStatic(&encoderLockStorage);
static void encoderTask(void*) {
 for(;;){
  EncoderJob* job=nullptr;
  if(xQueueReceive(encoderQueue,&job,portMAX_DELAY)!=pdTRUE)continue;
  switch(job->op){
   case EncoderOp::Reset:job->result=resetInline();break;
   case EncoderOp::Audio:job->result=audioInline(job->pcm,job->bytes,job->send);break;
   case EncoderOp::Finish:job->result=finishInline(job->send);break;
   case EncoderOp::Close:closeInline();job->result=true;break;
  }
  bool closing=job->op==EncoderOp::Close;
  xSemaphoreGive(encoderDone);
  if(closing)vTaskDelete(nullptr);
 }
}
static bool encoderCall(EncoderOp op,const uint8_t* pcm=nullptr,size_t bytes=0,OpusUplinkSend send=nullptr){
 if(!encoderLock||xSemaphoreTake(encoderLock,portMAX_DELAY)!=pdTRUE)return false;
 if(!encoderQueue&&op==EncoderOp::Reset){
  encoderQueue=xQueueCreate(1,sizeof(EncoderJob*));encoderDone=xSemaphoreCreateBinary();
  if(!encoderQueue||!encoderDone||xTaskCreate(encoderTask,"opus-encode",32768,nullptr,1,nullptr)!=pdPASS){
   if(encoderQueue)vQueueDelete(encoderQueue);if(encoderDone)vSemaphoreDelete(encoderDone);
   encoderQueue=nullptr;encoderDone=nullptr;opusUplinkErrors++;xSemaphoreGive(encoderLock);return false;
  }
 }
 if(!encoderQueue){xSemaphoreGive(encoderLock);return op==EncoderOp::Close;}
 EncoderJob job{op,pcm,bytes,send};EncoderJob* pointer=&job;
 // Wait through the operation: timed-out stack pointers must never outlive
 // their caller, including a slow but valid TLS send callback.
 xQueueSend(encoderQueue,&pointer,portMAX_DELAY);xSemaphoreTake(encoderDone,portMAX_DELAY);
 if(op==EncoderOp::Close){vQueueDelete(encoderQueue);vSemaphoreDelete(encoderDone);encoderQueue=nullptr;encoderDone=nullptr;vTaskDelay(1);}
 xSemaphoreGive(encoderLock);return job.result;
}
bool opusUplinkReset(){return encoderCall(EncoderOp::Reset);}
bool opusUplinkAudio(const uint8_t* pcm,size_t bytes,OpusUplinkSend send){return encoderCall(EncoderOp::Audio,pcm,bytes,send);}
bool opusUplinkFinish(OpusUplinkSend send){bool ok=encoderCall(EncoderOp::Finish,nullptr,0,send);opusUplinkClose();return ok;}
void opusUplinkClose(){encoderCall(EncoderOp::Close);}
#else
bool opusUplinkReset(){return resetInline();}
bool opusUplinkAudio(const uint8_t* pcm,size_t bytes,OpusUplinkSend send){return audioInline(pcm,bytes,send);}
bool opusUplinkFinish(OpusUplinkSend send){bool ok=finishInline(send);closeInline();return ok;}
void opusUplinkClose(){closeInline();}
#endif

bool opusUplinkWorkerActive(){
#ifdef VOXI_OPUS_C6
 return encoderQueue!=nullptr;
#else
 return encoder!=nullptr;
#endif
}
#endif
