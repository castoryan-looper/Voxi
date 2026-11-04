#include "opus_reply.h"
#include <esp_opus_dec.h>
#include <esp_timer.h>
static void* decoder=nullptr;
static uint32_t sequence=0;
uint32_t opusReplyFrames=0,opusReplyErrors=0,opusReplyMaxUs=0;
void opusReplyClose(){if(decoder){esp_opus_dec_close(decoder);decoder=nullptr;}}
bool opusReplyReset(){
 sequence=opusReplyFrames=opusReplyErrors=opusReplyMaxUs=0;
 if(decoder)return esp_opus_dec_reset(decoder)==ESP_AUDIO_ERR_OK;
 esp_opus_dec_cfg_t config={};config.sample_rate=24000;config.channel=1;
 config.frame_duration=ESP_OPUS_DEC_FRAME_DURATION_20_MS;config.self_delimited=false;
 return esp_opus_dec_open(&config,sizeof(config),&decoder)==ESP_AUDIO_ERR_OK;
}
bool opusReplyDecode(const uint8_t* wire,size_t bytes,int16_t* pcm){
 if(!decoder||!opusReplyHeader(wire,bytes,sequence)){opusReplyErrors++;return false;}
 esp_audio_dec_in_raw_t input={};input.buffer=const_cast<uint8_t*>(wire+4);input.len=bytes-4;
 esp_audio_dec_out_frame_t output={};output.buffer=reinterpret_cast<uint8_t*>(pcm);output.len=OPUS_REPLY_SAMPLES*2;
 esp_audio_dec_info_t info={};int64_t started=esp_timer_get_time();
 auto rc=esp_opus_dec_decode(decoder,&input,&output,&info);
 uint32_t elapsed=esp_timer_get_time()-started;if(elapsed>opusReplyMaxUs)opusReplyMaxUs=elapsed;
 if(rc!=ESP_AUDIO_ERR_OK||input.consumed!=input.len||output.decoded_size!=OPUS_REPLY_SAMPLES*2||info.sample_rate!=24000||info.channel!=1){opusReplyErrors++;return false;}
 sequence++;opusReplyFrames++;return true;
}
