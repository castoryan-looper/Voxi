#ifdef VOXI_BOARD_MINICAM
#include "board_audio.h"
#include "board_profile.h"
#include "diagnostics.h"
#include "runtime_config.h"
#include "radio_network.h"
#include "output_gain.h"
#include "config.example.h"
#include "standby.h"
#include "minicam_modem.h"
#include "minicam_controls.h"
#include <WiFi.h>
#include <HWCDC.h>
#include <Preferences.h>
#include <math.h>
#include <driver/i2s_std.h>
#include <driver/i2c_master.h>
#include <esp_codec_dev.h>
#include <esp_codec_dev_defaults.h>
#include <Arduino_GFX_Library.h>
#include <esp_heap_caps.h>
static i2s_chan_handle_t output,input;
static i2c_master_bus_handle_t bus;
static esp_codec_dev_handle_t codec;
static const audio_codec_ctrl_if_t* codecControl;
static esp_err_t codecWrite(uint8_t reg,uint8_t value){return codecControl->write_reg(codecControl,reg,1,&value,1);}
static int volumePercent=45,batteryMv=-1,batteryLevel=-1;
static bool displayReady=false;
static bool mainHeld=false,pttHeld=false;
#ifdef VOXI_MINICAM_GPIO11_PTT
static constexpr bool mainKeyPtt=true;
static constexpr const char* talkButtonName="gpio11";
static constexpr const char* talkHint="Hold main: talk / release: send";
#else
static constexpr bool mainKeyPtt=false;
static constexpr const char* talkButtonName="volume_up";
static constexpr const char* talkHint="Hold +: talk / release: send";
#endif
static int mainRaw=1,volumeKeyMv=0;
static uint32_t mainClicks=0;
static volatile bool standbyRequested=false,standbyDisplayReady=false;
static volatile uint32_t displayFrames=0;
int speakerVolume(){return volumePercent;}
bool speakerSetVolume(int value){if(value<0||value>100)return false;Preferences p;if(!p.begin("voxi-audio",false))return false;bool ok=p.putUChar("volume",value)==1;p.end();if(ok)volumePercent=value;return ok;}
int batteryPercent(){return batteryLevel;}
int batteryMillivolts(){return batteryMv;}
bool boardPowerPressed(){return false;}
bool boardTouchPttPressed(){return pttHeld;}
bool boardTouchActive(){return false;}
int boardTouchWakePin(){return -1;}
struct View{int channel=0,battery=-1,rssi=0,volume=0;bool setup=false,hotspot=false,wifi=false,usb=false,cellular=false;char name[32]={},key[16]={};RadioDebugSnapshot debug;};
static View baseView;static QueueHandle_t views;
static Arduino_ESP32SPI displayBus(39,40,46,41,GFX_NOT_DEFINED);
static Arduino_ST7789 panel(&displayBus,GFX_NOT_DEFINED,0,true,240,320,0,0);
class PsramCanvas:public Arduino_Canvas{
 public:PsramCanvas():Arduino_Canvas(240,320,&panel){}
 bool begin(int32_t speed=GFX_NOT_DEFINED)override{
  _framebuffer=(uint16_t*)heap_caps_malloc(240*320*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  return _framebuffer&&Arduino_Canvas::begin(speed);
 }
};
static PsramCanvas canvas;
static void postView(){if(!views)return;View s=baseView;s.debug=radioDebugRead();s.cellular=radioUsesCellular();s.wifi=radioNetworkConnected();s.rssi=s.cellular?(-113+2*minicamSignal()):(s.wifi?WiFi.RSSI():0);s.battery=batteryLevel;s.usb=HWCDC::isPlugged();s.volume=volumePercent;xQueueOverwrite(views,&s);}
void boardStatusTick(){
 uint32_t now=millis();static uint32_t sampleAt=0,batteryAt=0;static MiniCamControls controls;
 if(now-sampleAt>=20){sampleAt=now;
  mainRaw=digitalRead(BOARD_BOOT_KEY);volumeKeyMv=analogReadMilliVolts(9);
  auto action=controls.sample(now,volumeKeyMv,mainRaw==LOW);
  if(standbySuppressInput()){controls=MiniCamControls();action={};}
  mainHeld=controls.pressed();
  pttHeld=controls.pttPressed(mainKeyPtt);
  if(action.volumeDelta){standbyActivity();speakerSetVolume(constrain(volumePercent+action.volumeDelta,0,100));postView();}
  if(action.channelDelta){standbyActivity();requestChannelDelta(action.channelDelta);}
  if(action.talkChanged){
   if(mainHeld)mainClicks++;
   standbyActivity();
  }
 }
 if(!batteryAt||now-batteryAt>10000){batteryAt=now;int mv=analogReadMilliVolts(3),ref=analogReadMilliVolts(4);batteryMv=ref>2300?mv*2:ref>500?mv*2540/ref:-1;batteryLevel=batteryMv>0?constrain((batteryMv-3400)*100/800,0,100):-1;}
}
static void screenTask(void*){
 if(!canvas.begin(40000000)){diagnosticError("ST7789 initialization failed");vTaskDelete(nullptr);return;}
 panel.invertDisplay(true);digitalWrite(42,LOW);displayReady=true;canvas.setTextWrap(false);
 View s,previous;bool drawn=false;
 for(;;){
  if(standbyRequested){digitalWrite(42,HIGH);panel.displayOff();standbyDisplayReady=true;vTaskSuspend(nullptr);}
  if(xQueueReceive(views,&s,pdMS_TO_TICKS(25))!=pdTRUE)continue;
  View next;while(xQueueReceive(views,&next,0)==pdTRUE)s=next;
  if(drawn&&!memcmp(&s,&previous,sizeof(s)))continue;previous=s;drawn=true;
  canvas.fillScreen(0x0843);canvas.setTextColor(0xffff);canvas.setTextSize(3);canvas.setCursor(12,12);canvas.print("VOXI");
  canvas.setTextSize(1);canvas.setCursor(164,24);canvas.print(s.usb?"USB":"RADIO");
  canvas.setTextSize(2);canvas.setTextColor(s.wifi?0x4f5b:0xfd20);canvas.setCursor(12,48);if(s.cellular)canvas.printf(s.wifi?"4G %ddBm":"4G CONNECT",s.rssi);else canvas.printf(s.wifi?"WiFi %ddBm":"WiFi OFF",s.rssi);
  canvas.fillRoundRect(10,76,220,76,8,0x10a5);canvas.setTextColor(0xffff);canvas.setTextSize(3);canvas.setCursor(20,86);canvas.printf("CH %02d",s.channel+1);
  canvas.setTextSize(2);canvas.setTextColor(!strcmp(s.debug.phase,"READY")?0x4f5b:0xfd20);canvas.setCursor(20,124);canvas.print(s.debug.phase);
  canvas.setTextColor(0x8c92);canvas.setTextSize(1);canvas.setCursor(12,166);canvas.printf("MIC %luK TX %luK RX %luK",(unsigned long)(s.debug.micBytes/1024),(unsigned long)(s.debug.txBytes/1024),(unsigned long)(s.debug.rxBytes/1024));
  canvas.setCursor(12,181);canvas.printf("VOL %d%%   BAT %d%%",s.volume,s.battery);
  for(int i=0;i<3;i++){canvas.setCursor(12,200+i*15);canvas.print(s.debug.logs[i]);}
  canvas.setCursor(12,253);canvas.print(s.setup?(s.hotspot?s.name:"USB SETUP: 127.0.0.1:8788"):talkHint);
  canvas.setCursor(12,268);if(s.setup&&s.hotspot)canvas.printf("KEY %s / 192.168.4.1",s.key);else canvas.print("Hold -: previous channel");
  canvas.setCursor(12,290);canvas.print("Tap +/-: volume - / +");
  canvas.flush();displayFrames++;vTaskDelay(pdMS_TO_TICKS(100));
 }
}
void displayChannel(int channel,bool){baseView.channel=channel;postView();}
void displayConnection(int channel,const char*,bool,bool,bool){baseView.channel=channel;postView();}
void displaySetup(const char* name,const char* key,bool hotspot){baseView.setup=true;baseView.hotspot=hotspot;strlcpy(baseView.name,name,sizeof(baseView.name));strlcpy(baseView.key,key,sizeof(baseView.key));postView();}
void displayDebugTick(){static uint32_t at=0;if(millis()-at<250)return;at=millis();baseView.setup=setupScreenActive();postView();}
void boardInit(){
 minicamModemBegin();
 pinMode(42,OUTPUT);digitalWrite(42,HIGH);pinMode(11,INPUT_PULLUP);
 analogReadResolution(12);analogSetPinAttenuation(3,ADC_11db);analogSetPinAttenuation(4,ADC_11db);analogSetPinAttenuation(9,ADC_11db);
 Preferences p;if(p.begin("voxi-audio",true)){volumePercent=p.getUChar("volume",45);p.end();}
 i2c_master_bus_config_t b={};b.i2c_port=I2C_NUM_0;b.sda_io_num=(gpio_num_t)BOARD_I2C_SDA;b.scl_io_num=(gpio_num_t)BOARD_I2C_SCL;b.clk_source=I2C_CLK_SRC_DEFAULT;b.glitch_ignore_cnt=7;b.flags.enable_internal_pullup=true;
 ESP_ERROR_CHECK(i2c_new_master_bus(&b,&bus));
  i2s_chan_config_t c=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
  c.dma_desc_num=6;c.dma_frame_num=240;c.auto_clear=true;
  ESP_ERROR_CHECK(i2s_new_channel(&c,&output,&input));
  i2s_std_config_t s={};s.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(24000);
  s.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_STEREO);
  s.gpio_cfg.mclk=(gpio_num_t)BOARD_I2S_MCLK;s.gpio_cfg.bclk=(gpio_num_t)BOARD_I2S_BCLK;s.gpio_cfg.ws=(gpio_num_t)BOARD_I2S_WS;
  s.gpio_cfg.dout=(gpio_num_t)BOARD_I2S_DOUT;s.gpio_cfg.din=(gpio_num_t)BOARD_I2S_DIN;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(output,&s));ESP_ERROR_CHECK(i2s_channel_init_std_mode(input,&s));
  audio_codec_i2s_cfg_t data={};data.port=0;data.rx_handle=input;data.tx_handle=output;
  audio_codec_i2c_cfg_t ctrl={};ctrl.port=0;ctrl.addr=ES8388_CODEC_DEFAULT_ADDR;ctrl.bus_handle=bus;
  es8388_codec_cfg_t chip={};chip.ctrl_if=codecControl=audio_codec_new_i2c_ctrl(&ctrl);chip.gpio_if=audio_codec_new_gpio();
  chip.codec_mode=ESP_CODEC_DEV_WORK_MODE_BOTH;chip.pa_pin=-1;chip.master_mode=false;chip.hw_gain.pa_voltage=5;chip.hw_gain.codec_dac_voltage=3.3;
  esp_codec_dev_cfg_t dev={};dev.dev_type=ESP_CODEC_DEV_TYPE_IN_OUT;
  dev.codec_if=es8388_codec_new(&chip);dev.data_if=audio_codec_new_i2s_data(&data);
  codec=esp_codec_dev_new(&dev);assert(codec);
  esp_codec_dev_sample_info_t fs={};fs.sample_rate=24000;fs.channel=2;fs.bits_per_sample=16;
  ESP_ERROR_CHECK(esp_codec_dev_open(codec,&fs));
  ESP_ERROR_CHECK(esp_codec_dev_set_out_vol(codec,80));
  ESP_ERROR_CHECK(esp_codec_dev_set_in_gain(codec,24));
  // Left ADC is the microphone; right ADC is the acoustic reference.
  ESP_ERROR_CHECK(codecWrite(0x09,0xb0));
  for(int reg=46;reg<=49;reg++)ESP_ERROR_CHECK(codecWrite(reg,30));
  ESP_ERROR_CHECK(esp_codec_dev_set_out_mute(codec,false));
  audioFlush();

 views=xQueueCreate(1,sizeof(View));assert(views);xTaskCreatePinnedToCore(screenTask,"st7789",6144,nullptr,1,nullptr,0);boardStatusTick();
}
bool boardPrepareStandby(){if(!minicamModemStandby())return false;standbyRequested=true;uint32_t began=millis();while(!standbyDisplayReady&&millis()-began<5000)delay(10);if(!standbyDisplayReady)return false;esp_codec_dev_set_out_mute(codec,true);esp_codec_dev_close(codec);i2s_channel_disable(output);i2s_channel_disable(input);return true;}
void audioFlush(){
  // Stop DMA and replace the whole six-descriptor queue with silence.
  if(!output)return;
  esp_err_t stopped=i2s_channel_disable(output);
  if(stopped!=ESP_OK&&stopped!=ESP_ERR_INVALID_STATE){diagnosticError("audio disable failed");return;}
  static const uint8_t silence[5760]={};size_t loaded=0;
  if(i2s_channel_preload_data(output,silence,sizeof(silence),&loaded)!=ESP_OK)diagnosticError("audio preload failed");
  esp_err_t enabled=i2s_channel_enable(output);
  if(enabled!=ESP_OK&&enabled!=ESP_ERR_INVALID_STATE)diagnosticError("audio enable failed");
}
size_t audioRead(int16_t* mono,size_t samples){
  int16_t stereo[480];samples=min(samples,(size_t)240);size_t bytes=0;
  i2s_channel_read(input,stereo,samples*4,&bytes,0);
  for(size_t i=0;i<bytes/4;i++)mono[i]=stereo[2*i+MIC_SLOT];
  return bytes/4;
}
static uint32_t outputSamples=0,outputErrors=0;static unsigned outputPeak=0;static volatile bool testPending=false;
void speakerTestRequest(){testPending=true;}
bool speakerTestPending(){return testPending;}
void speakerDiagnostics(JsonDocument& out){out["displayController"]="ST7789";out["displayReady"]=displayReady;out["displayFrames"]=(uint32_t)displayFrames;out["mainButtonRaw"]=mainRaw;out["volumeKeyMv"]=volumeKeyMv;out["mainButtonClicks"]=mainClicks;out["talkLatched"]=false;out["mainButtonHeld"]=mainHeld;out["pttButtonHeld"]=pttHeld;out["talkButton"]=talkButtonName;out["talkMode"]="hold_to_talk";out["recordingActive"]=radioRecordingActive();out["canStartRecording"]=radioCanStartRecording();out["audioCodec"]="ES8388";minicamModemDiagnostics(out);out["speakerVolume"]=volumePercent;out["speakerWrittenSamples"]=outputSamples;out["speakerPeak"]=outputPeak;out["speakerWriteErrors"]=outputErrors;}

size_t audioWrite(const int16_t* mono,size_t samples){
  int16_t stereo[480];samples=min(samples,(size_t)240);
  for(size_t i=0;i<samples;i++)stereo[2*i]=stereo[2*i+1]=speakerSample(mono[i],volumePercent);
  size_t bytes=0;esp_err_t err=i2s_channel_write(output,stereo,samples*4,&bytes,0);
  if(err!=ESP_OK&&err!=ESP_ERR_TIMEOUT){outputErrors++;diagnosticError("I2S speaker write failed");}
  size_t written=bytes/4;outputSamples+=written;
  for(size_t i=0;i<written;i++)outputPeak=max(outputPeak,(unsigned)abs((int)stereo[2*i]));
  return written;
}
void speakerTestRun(){
  testPending=false;radioDebug("SPEAKER TEST","Local test: 2 quiet tones");
  audioFlush();esp_codec_dev_set_out_mute(codec,false);

  outputPeak=0;uint32_t start=millis();size_t position=0;
  while(position<18000&&millis()-start<3000){
    int16_t block[240];size_t n=min((size_t)240,18000-position);
    for(size_t i=0;i<n;i++){
      size_t t=position+i;int frequency=t<6000?660:t<12000?0:880;
      block[i]=frequency?(int16_t)(3500*sin(2*3.141592653589793*frequency*t/24000)):0;
    }
    position+=audioWrite(block,n);delay(1);
  }
  delay(50);radioDebug(position==18000?"TEST DONE":"TEST ERROR",position==18000?"2 tones written to speaker":"Local tone write timeout");
}


#endif
