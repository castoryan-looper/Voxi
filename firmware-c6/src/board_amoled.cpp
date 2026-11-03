#ifdef VOXI_BOARD_AMOLED
#include "board_audio.h"
#include "board_profile.h"
#include "diagnostics.h"
#include "runtime_config.h"
#include "output_gain.h"
#include "amoled_controls.h"
#include "config.example.h"
#include <WiFi.h>
#include <HWCDC.h>
#include <Preferences.h>
#include <math.h>
#include <driver/i2s_std.h>
#include <driver/i2c_master.h>
#include <esp_codec_dev.h>
#include <esp_codec_dev_defaults.h>
#define XPOWERS_CHIP_AXP2101
#include <XPowersLib.h>
#include <Arduino_GFX_Library.h>
#include <esp_heap_caps.h>
static i2s_chan_handle_t output,input;
static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t expander,pmuDevice,touchDevice,touch38Device;
static esp_codec_dev_handle_t codec;
static XPowersPMU pmu;
static int volumePercent=45,codecDacRegister=-1,batteryMv=-1,batteryLevel=-1;
static bool pmuReady=false,touchReady=false,displayReady=false,touchPtt=false;
static volatile uint32_t displayFrames=0,touchSamples=0;
static int touchX=-1,touchY=-1,expanderOutput=-1,expanderConfig=-1;
static bool expanderReady=false,touch38Present=false;
static uint8_t pmuRails[3]={};
static int regRead(uint8_t address,uint8_t reg,uint8_t* data,uint8_t length){
 auto device=address==0x34?pmuDevice:address==0x15?touchDevice:address==0x38?touch38Device:expander;
 return i2c_master_transmit_receive(device,&reg,1,data,length,50)==ESP_OK?0:-1;
}
static int regWrite(uint8_t address,uint8_t reg,uint8_t* data,uint8_t length){
 auto device=address==0x34?pmuDevice:address==0x15?touchDevice:address==0x38?touch38Device:expander;
 uint8_t bytes[257];bytes[0]=reg;memcpy(bytes+1,data,length);
 return i2c_master_transmit(device,bytes,length+1,50)==ESP_OK?0:-1;
}
static void writeReg(uint8_t address,uint8_t reg,uint8_t value){regWrite(address,reg,&value,1);}
int speakerVolume(){return volumePercent;}
bool speakerSetVolume(int value){if(value<0||value>100)return false;Preferences p;if(!p.begin("voxi-audio",false))return false;bool ok=p.putUChar("volume",value)==1;p.end();if(ok)volumePercent=value;return ok;}
int batteryPercent(){return batteryLevel;}
int batteryMillivolts(){return batteryMv;}
bool boardPowerPressed(){return false;} // PWR is PMIC-managed; use on-screen SETUP.
bool boardTouchPttPressed(){return touchPtt;}


struct View{int channel=0,battery=-1,rssi=0;bool setup=false,hotspot=false,wifi=false,usb=false,pressed=false;char name[24]={},key[16]={};RadioDebugSnapshot debug;};
static View baseView;static QueueHandle_t views;
static Arduino_ESP32QSPI displayBus(12,11,4,5,6,7);
static Arduino_CO5300 panelV2(&displayBus,GFX_NOT_DEFINED,0,368,448,16,0,0,0);
static Arduino_SH8601 panelV1(&displayBus,GFX_NOT_DEFINED,0,368,448);
static Arduino_OLED* activePanel=&panelV2;
class PsramCanvas:public Arduino_Canvas{
 public:PsramCanvas():Arduino_Canvas(368,448,&panelV2){}
 bool begin(int32_t speed=GFX_NOT_DEFINED)override{
  _output=activePanel;
  _framebuffer=(uint16_t*)heap_caps_malloc(368*448*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  return _framebuffer&&Arduino_Canvas::begin(speed);
 }
};
static PsramCanvas canvas;
static void postView(){if(!views)return;View s=baseView;s.debug=radioDebugRead();s.wifi=WiFi.status()==WL_CONNECTED;s.rssi=s.wifi?WiFi.RSSI():0;s.battery=batteryLevel;s.usb=HWCDC::isPlugged();s.pressed=touchPtt;xQueueOverwrite(views,&s);}
void boardStatusTick(){
 static uint32_t touchAt=0,batteryAt=0,touchProbeAt=0;uint32_t now=millis();
 if(!touchReady&&now-touchProbeAt>=1000){touchProbeAt=now;if(i2c_master_probe(bus,0x15,5)==ESP_OK){writeReg(0x15,0xfa,0x40);touchReady=true;}}
 if(pmuReady&&(!batteryAt||now-batteryAt>=10000)){batteryAt=now;batteryMv=pmu.getBattVoltage();batteryLevel=pmu.isBatteryConnect()?pmu.getBatteryPercent():-1;}
 if(touchReady&&now-touchAt>=25){
  touchAt=now;uint8_t data[5];static bool was=false;
  if(regRead(touch38Present?0x38:0x15,2,data,5)==0){
   bool down=(data[0]&15)>0;touchX=((data[1]&15)<<8)|data[2];touchY=((data[3]&15)<<8)|data[4];
   if(down)touchSamples++;
   auto action=amoledTouchAction(down,touchX,touchY);touchPtt=action==AmoledAction::Ptt;
   if(down&&!was){if(action==AmoledAction::Previous)requestChannelDelta(-1);else if(action==AmoledAction::Next)requestChannelDelta(1);else if(action==AmoledAction::Setup)requestSetupScreen();}
   was=down;
  }else{touchPtt=false;was=false;}
 }
}
static void screenTask(void*){
 if(!canvas.begin(40000000)){diagnosticError("AMOLED canvas or QSPI initialization failed");vTaskDelete(nullptr);return;}
 // Use the board-specific CO5300 settings from the factory V2 driver.
 if(!touch38Present){displayBus.beginWrite();displayBus.writeC8D8(0xfe,0x20);
 displayBus.writeC8D8(0x19,0x10);displayBus.writeC8D8(0x1c,0xa0);
 displayBus.writeC8D8(0xfe,0x00);displayBus.endWrite();}
 activePanel->displayOn();activePanel->setBrightness(200);displayReady=true;canvas.setTextWrap(false);
 View s,previous;bool drawn=false;
 const uint16_t bg=0x0843,card=0x10a5,white=0xffff,muted=0x8c92,accent=0x4f5b,orange=0xfd20;
 for(;;){
  if(xQueueReceive(views,&s,portMAX_DELAY)!=pdTRUE)continue;
  View next;while(xQueueReceive(views,&next,0)==pdTRUE)s=next;
  if(drawn&&!memcmp(&s,&previous,sizeof(s)))continue;previous=s;drawn=true;
  canvas.fillScreen(bg);canvas.setTextSize(3);canvas.setTextColor(white);canvas.setCursor(18,17);canvas.print("VOXI");
  canvas.setTextSize(1);canvas.setTextColor(muted);canvas.setCursor(265,25);canvas.print(s.usb?"USB CONNECTED":"WI-FI RADIO");
  canvas.setTextSize(2);canvas.setTextColor(s.wifi?accent:orange);canvas.setCursor(48,58);canvas.printf(s.wifi?"WiFi %ddBm":"WiFi OFF",s.rssi);
  for(int bar=0;bar<4;bar++){int height=3+bar*4;int level=!s.wifi?0:s.rssi>-55?4:s.rssi>-65?3:s.rssi>-75?2:1;canvas.fillRect(18+bar*6,74-height,4,height,bar<level?accent:card);}
  if(!s.wifi)canvas.drawLine(16,57,42,76,orange);
  canvas.drawRoundRect(321,58,27,14,3,muted);canvas.fillRect(348,62,3,6,muted);if(s.battery>0)canvas.fillRect(324,61,21*s.battery/100,8,accent);
  canvas.setTextColor(muted);canvas.setCursor(270,58);if(s.battery>=0)canvas.printf("%d%%",s.battery);else canvas.print("USB");
  canvas.fillRoundRect(16,88,336,104,14,card);canvas.setTextColor(white);canvas.setTextSize(4);canvas.setCursor(30,100);canvas.printf("CH %02d",s.channel+1);
  canvas.setTextSize(2);canvas.setTextColor(!strcmp(s.debug.phase,"READY")?accent:orange);canvas.setCursor(30,154);canvas.print(s.debug.phase);
  canvas.setTextSize(1);canvas.setTextColor(muted);canvas.setCursor(18,206);canvas.printf("MIC %luK   TX %luK   RX %luK",(unsigned long)(s.debug.micBytes/1024),(unsigned long)(s.debug.txBytes/1024),(unsigned long)(s.debug.rxBytes/1024));
  canvas.setCursor(18,223);canvas.printf("MIC PEAK %u  /  VOL %d%%",s.debug.peak,volumePercent);
  for(int i=0;i<3;i++){canvas.setCursor(18,245+i*17);canvas.print(s.debug.logs[i]);}
  canvas.setTextColor(muted);canvas.setCursor(18,302);canvas.print(s.setup?(s.hotspot?"Hotspot: open 192.168.4.1":"USB setup: open 127.0.0.1:8788"):"Hold BOOT or the touch button to talk");
  canvas.fillRoundRect(16,328,336,68,14,s.pressed?0x0412:accent);canvas.setTextColor(bg);canvas.setTextSize(3);canvas.setCursor(40,351);canvas.print(s.pressed?"RELEASE TO SEND":"HOLD TO TALK");
  canvas.setTextSize(2);canvas.setTextColor(white);
  canvas.fillRoundRect(16,404,84,32,8,card);canvas.setCursor(28,413);canvas.print("CH -");
  canvas.fillRoundRect(112,404,144,32,8,card);canvas.setCursor(154,413);canvas.print("SETUP");
  canvas.fillRoundRect(268,404,84,32,8,card);canvas.setCursor(280,413);canvas.print("CH +");
  canvas.flush();displayFrames++;vTaskDelay(pdMS_TO_TICKS(100));
 }
}
void displayChannel(int channel,bool){baseView.channel=channel;postView();}
void displayConnection(int channel,const char*,bool,bool,bool){baseView.channel=channel;postView();}
void displaySetup(const char* name,const char* key,bool hotspot){baseView.setup=true;baseView.hotspot=hotspot;strlcpy(baseView.name,name,sizeof(baseView.name));strlcpy(baseView.key,key,sizeof(baseView.key));postView();}
void displayDebugTick(){static uint32_t at=0;if(millis()-at<200)return;at=millis();baseView.setup=setupScreenActive();postView();}


void boardInit(){

 Preferences prefs;if(prefs.begin("voxi-audio",true)){volumePercent=prefs.getUChar("volume",45);prefs.end();}
 i2c_master_bus_config_t b={};b.i2c_port=I2C_NUM_0;b.sda_io_num=(gpio_num_t)BOARD_I2C_SDA;b.scl_io_num=(gpio_num_t)BOARD_I2C_SCL;b.clk_source=I2C_CLK_SRC_DEFAULT;b.glitch_ignore_cnt=7;b.flags.enable_internal_pullup=true;
 ESP_ERROR_CHECK(i2c_new_master_bus(&b,&bus));
 auto addDevice=[](uint8_t address,i2c_master_dev_handle_t* handle){i2c_device_config_t cfg={};cfg.dev_addr_length=I2C_ADDR_BIT_LEN_7;cfg.device_address=address;cfg.scl_speed_hz=100000;ESP_ERROR_CHECK(i2c_master_bus_add_device(bus,&cfg,handle));};
 addDevice(0x20,&expander);addDevice(0x34,&pmuDevice);addDevice(0x15,&touchDevice);addDevice(0x38,&touch38Device);
 expanderReady=i2c_master_probe(bus,0x20,50)==ESP_OK;
 // V2 requires a full high/low/high reset pulse before QSPI initialization.
 // Preserve unrelated expander pins (including SD chip select).
 uint8_t cfg=0xff,levels=0xff;
 if(expanderReady){
  regRead(0x20,3,&cfg,1);regRead(0x20,1,&levels,1);
  writeReg(0x20,3,cfg&~7);writeReg(0x20,1,levels|7);delay(100);
  writeReg(0x20,1,levels&~7);delay(300);
  writeReg(0x20,1,levels|7);delay(200);
  uint8_t v;if(regRead(0x20,1,&v,1)==0)expanderOutput=v;
  if(regRead(0x20,3,&v,1)==0)expanderConfig=v;
 }else diagnosticError("AMOLED reset expander not detected");
 pmuReady=pmu.begin(0x34,regRead,regWrite);
 if(pmuReady){pmu.enableBattDetection();pmu.enableBattVoltageMeasure();pmu.enableVbusVoltageMeasure();pmu.enableSystemVoltageMeasure();}
 else diagnosticError("AXP2101 not detected");
 touch38Present=i2c_master_probe(bus,0x38,50)==ESP_OK;
 for(int i=0;i<3;i++){uint8_t r=i==0?0x80:i==1?0x90:0x91;regRead(0x34,r,&pmuRails[i],1);}
 writeReg(0x15,0xfa,0x40);delay(20);touchReady=i2c_master_probe(bus,0x15,5)==ESP_OK;
 if(touchReady)writeReg(0x15,0xfa,0x40);
 if(touch38Present){activePanel=&panelV1;touchReady=true;writeReg(0x38,0xa5,0);}
 pinMode(46,OUTPUT);digitalWrite(46,LOW);

  i2s_chan_config_t c=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
  c.dma_desc_num=6;c.dma_frame_num=240;c.auto_clear=true;
  ESP_ERROR_CHECK(i2s_new_channel(&c,&output,&input));
  i2s_std_config_t s={};s.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(24000);
  s.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_STEREO);
  s.gpio_cfg.mclk=(gpio_num_t)BOARD_I2S_MCLK;s.gpio_cfg.bclk=(gpio_num_t)BOARD_I2S_BCLK;s.gpio_cfg.ws=(gpio_num_t)BOARD_I2S_WS;
  s.gpio_cfg.dout=(gpio_num_t)BOARD_I2S_DOUT;s.gpio_cfg.din=(gpio_num_t)BOARD_I2S_DIN;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(output,&s));ESP_ERROR_CHECK(i2s_channel_init_std_mode(input,&s));
  audio_codec_i2s_cfg_t data={};data.port=0;data.rx_handle=input;data.tx_handle=output;
  audio_codec_i2c_cfg_t ctrl={};ctrl.port=0;ctrl.addr=ES8311_CODEC_DEFAULT_ADDR;ctrl.bus_handle=bus;
  es8311_codec_cfg_t chip={};chip.ctrl_if=audio_codec_new_i2c_ctrl(&ctrl);chip.gpio_if=audio_codec_new_gpio();
  chip.codec_mode=ESP_CODEC_DEV_WORK_MODE_BOTH;chip.pa_pin=-1;chip.use_mclk=true;chip.hw_gain.pa_gain=6;
  esp_codec_dev_cfg_t dev={};dev.dev_type=ESP_CODEC_DEV_TYPE_IN_OUT;
  dev.codec_if=es8311_codec_new(&chip);dev.data_if=audio_codec_new_i2s_data(&data);
  codec=esp_codec_dev_new(&dev);assert(codec);
  esp_codec_dev_sample_info_t fs={};fs.sample_rate=24000;fs.channel=2;fs.bits_per_sample=16;
  ESP_ERROR_CHECK(esp_codec_dev_open(codec,&fs));
  // Use the codec DAC volume curve for +6dB versus the previous output setting.
  esp_codec_dev_vol_map_t points[]={{0,-50.0f},{100,6.0f}};
  esp_codec_dev_vol_curve_t curve={points,2};
  ESP_ERROR_CHECK(esp_codec_dev_set_vol_curve(codec,&curve));
  ESP_ERROR_CHECK(esp_codec_dev_set_out_vol(codec,100));
  ESP_ERROR_CHECK(esp_codec_dev_read_reg(codec,0x32,&codecDacRegister));
  ESP_ERROR_CHECK(esp_codec_dev_set_in_gain(codec,MICROPHONE_GAIN_DB));
  ESP_ERROR_CHECK(esp_codec_dev_set_out_mute(codec,false));

  audioFlush();digitalWrite(46,HIGH);
 views=xQueueCreate(1,sizeof(View));assert(views);xTaskCreatePinnedToCore(screenTask,"amoled",6144,nullptr,1,nullptr,0);boardStatusTick();
}
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
void speakerDiagnostics(JsonDocument& out){out["displayController"]=touch38Present?"SH8601":"CO5300";out["touch38Present"]=touch38Present;out["pmuDcEnable"]=pmuRails[0];out["pmuLdoEnable"]=pmuRails[1];out["pmuLdoEnable2"]=pmuRails[2];out["expanderReady"]=expanderReady;out["expanderOutput"]=expanderOutput;out["expanderConfig"]=expanderConfig;out["displayReady"]=displayReady;out["displayFrames"]=(uint32_t)displayFrames;out["touchReady"]=touchReady;out["touchSamples"]=(uint32_t)touchSamples;out["touchX"]=(int)touchX;out["touchY"]=(int)touchY;out["pmuReady"]=pmuReady;out["codecDacRegister"]=codecDacRegister;out["speakerVolume"]=volumePercent;out["speakerWrittenSamples"]=outputSamples;out["speakerPeak"]=outputPeak;out["speakerWriteErrors"]=outputErrors;}

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
  audioFlush();esp_codec_dev_set_out_mute(codec,false);esp_codec_dev_set_out_vol(codec,100);
  digitalWrite(46,HIGH);
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
