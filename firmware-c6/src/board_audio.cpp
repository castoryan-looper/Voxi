#include "board_audio.h"
#include "diagnostics.h"
#include <WiFi.h>
#include <HWCDC.h>
#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif
#include <driver/i2s_std.h>
#include <driver/i2c_master.h>
#include <esp_codec_dev.h>
#include <esp_codec_dev_defaults.h>
#if ENABLE_EPAPER
#include <GxEPD2_BW.h>
#include <SPI.h>
#endif

static i2s_chan_handle_t output,input;
static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t expander;
static esp_codec_dev_handle_t codec;
static void expWrite(uint8_t reg,uint8_t value){uint8_t b[]={reg,value};ESP_ERROR_CHECK(i2c_master_transmit(expander,b,2,100));}

static int batteryMv=-1,batteryLevel=-1;
int batteryPercent(){return batteryLevel;}
int batteryMillivolts(){return batteryMv;}
void boardStatusTick(){
  static uint32_t last=0;
  if(last&&millis()-last<30000)return;
  last=millis();uint32_t total=0;
  // Board ADC channel 0 / GPIO0, calibrated millivolts, 1:2 divider.
  for(int i=0;i<16;i++)total+=analogReadMilliVolts(0);
  int mv=(total/16)*2;
  if(mv<2800||mv>4500){batteryMv=batteryLevel=-1;return;}
  batteryMv=mv;
  // Voltage estimate, not a coulomb counter. Match the board vendor range.
  int estimate=constrain((mv-3000)*100/1120,0,100);
  if(batteryLevel<0||abs(estimate-batteryLevel)>=3)batteryLevel=estimate;
}

#if ENABLE_EPAPER
static GxEPD2_BW<GxEPD2_154_D67,200> screen(GxEPD2_154_D67(7,15,11,10));
struct ScreenState{int channel=0,battery=-1,signal=0;bool online=false,setup=false,hotspot=false,wifi=false,gateway=false,usb=false;char name[24]={},key[16]={},label[24]={};};
static QueueHandle_t screenQueue;
static void statusIcons(const ScreenState& state){
  const int color=GxEPD_BLACK;
  // Wi-Fi arcs. A slash distinguishes disconnected from a weak signal.
  screen.fillCircle(20,23,2,color);
  for(int i=0;i<3;i++){
    int radius=5+i*4;
    if(state.wifi&&i<state.signal)screen.drawCircleHelper(20,24,radius,3,color);
    else if(!state.wifi)screen.drawCircleHelper(20,24,radius,3,color);
  }
  if(!state.wifi)screen.drawLine(7,10,32,27,color);
  screen.setTextSize(1);screen.setCursor(39,15);screen.print(state.wifi?"WiFi":"OFF");
  screen.drawRoundRect(146,9,31,15,2,color);screen.fillRect(177,13,3,7,color);
  screen.setCursor(108,14);
  if(state.battery<0){screen.print("--");screen.setCursor(158,13);screen.print('?');}
  else{screen.printf("~%d%%",state.battery);int cells=state.battery>0?max(1,(state.battery+24)/25):0;for(int i=0;i<cells;i++)screen.fillRect(149+i*6,12,4,9,color);}
  screen.drawFastHLine(10,33,180,color);
}

static void screenTask(void*){
  pinMode(7,OUTPUT);pinMode(11,OUTPUT);pinMode(15,OUTPUT);
  SPI.begin(6,4,5,7);
  screen.init(0,true,20,false);
  ScreenState state,previous;bool drawn=false;unsigned refreshes=0;
  while(true){
    if(xQueueReceive(screenQueue,&state,portMAX_DELAY)!=pdTRUE)continue;
    // Coalesce rapid channel changes. Screen BUSY waits run in this low-priority task.
    vTaskDelay(pdMS_TO_TICKS(1000));ScreenState next;
    while(xQueueReceive(screenQueue,&next,0)==pdTRUE)state=next;
    if(drawn&&state.channel==previous.channel&&state.online==previous.online&&state.setup==previous.setup&&state.hotspot==previous.hotspot&&!strcmp(state.name,previous.name)&&!strcmp(state.key,previous.key)&&state.battery==previous.battery&&state.signal==previous.signal&&state.wifi==previous.wifi&&state.gateway==previous.gateway&&state.usb==previous.usb&&!strcmp(state.label,previous.label))continue;
    previous=state;
    if(!drawn||++refreshes>=20){screen.setFullWindow();refreshes=0;}else screen.setPartialWindow(0,0,200,200);
    drawn=true;screen.firstPage();
    do{
      screen.fillScreen(GxEPD_WHITE);screen.setTextColor(GxEPD_BLACK);screen.setTextSize(2);
      statusIcons(state);
      screen.setTextSize(1);screen.setCursor(12,41);screen.print("VOXI / AI RADIO");
      if(state.setup){
        screen.setTextSize(2);screen.setCursor(12,65);screen.print(state.name);
        screen.setTextSize(1);screen.setCursor(12,100);
        if(state.hotspot){screen.print("http://192.168.4.1/");screen.setCursor(12,125);screen.printf("KEY: %s",state.key);}
        else{screen.print("Open on your computer:");screen.setCursor(12,120);screen.print("http://127.0.0.1:8788/");screen.setCursor(12,145);screen.print("Chrome / Edge: Connect USB");screen.setCursor(12,168);screen.print("Unplug USB: radio standby");}
      }else{
        screen.setTextSize(4);screen.setCursor(18,64);screen.printf("CH %02d",state.channel+1);
        screen.setTextSize(2);screen.drawRoundRect(8,109,184,32,5,GxEPD_BLACK);screen.setCursor(12,118);screen.print(state.label[0]?state.label:state.online?"READY":"CONNECTING");
        screen.setTextSize(1);screen.setCursor(10,151);screen.printf("WiFi:%s  Gateway:%s",state.wifi?"OK":"--",state.gateway?"OK":"--");
        screen.setCursor(10,166);screen.print(state.online?"Hold BOOT to talk":"AI not ready - see USB web");
        screen.setCursor(10,181);screen.print(state.usb?"USB: 127.0.0.1:8788":"BOOT+PWR 3s: setup");

      }
    }while(screen.nextPage());
    screen.powerOff();
  }
}
#endif
static int signalBars(bool connected){
  static uint32_t sampled=0;static int bars=0;
  if(!connected){bars=0;return 0;}
  if(!bars||millis()-sampled>=10000){sampled=millis();int rssi=WiFi.RSSI();
    if(!bars)bars=rssi>-55?3:rssi>-72?2:1;
    else if(bars==3&&rssi<-58)bars=2;
    else if(bars==2){if(rssi>-52)bars=3;else if(rssi<-75)bars=1;}
    else if(bars==1&&rssi>-69)bars=2;
  }return bars;
}
void displayChannel(int channel,bool online){
#if ENABLE_EPAPER
  if(screenQueue){ScreenState s;s.channel=channel;s.online=online;s.battery=batteryLevel;s.wifi=WiFi.status()==WL_CONNECTED;s.usb=HWCDC::isPlugged();s.signal=signalBars(s.wifi);xQueueOverwrite(screenQueue,&s);}
#endif
}
void displayConnection(int channel,const char* label,bool wifi,bool gateway,bool usb){
#if ENABLE_EPAPER
  if(screenQueue){ScreenState s;s.channel=channel;s.battery=batteryLevel;s.signal=signalBars(wifi);s.wifi=wifi;s.gateway=gateway;s.usb=usb;s.online=!strcmp(label,"READY");strlcpy(s.label,label,sizeof(s.label));xQueueOverwrite(screenQueue,&s);}
#endif
}
void displaySetup(const char* name,const char* key,bool hotspot){
#if ENABLE_EPAPER
  if(screenQueue){ScreenState s;s.battery=batteryLevel;s.wifi=WiFi.status()==WL_CONNECTED;s.signal=signalBars(s.wifi);s.setup=true;s.hotspot=hotspot;strlcpy(s.name,name,sizeof(s.name));strlcpy(s.key,key,sizeof(s.key));xQueueOverwrite(screenQueue,&s);}
#endif
}
void boardInit(){
  analogReadResolution(12);analogSetPinAttenuation(0,ADC_11db);boardStatusTick();
  i2c_master_bus_config_t b={};b.i2c_port=I2C_NUM_0;b.sda_io_num=GPIO_NUM_18;b.scl_io_num=GPIO_NUM_8;
  b.clk_source=I2C_CLK_SRC_DEFAULT;b.glitch_ignore_cnt=7;b.flags.enable_internal_pullup=true;
  ESP_ERROR_CHECK(i2c_new_master_bus(&b,&bus));
  i2c_device_config_t e={};e.dev_addr_length=I2C_ADDR_BIT_LEN_7;e.device_address=0x20;e.scl_speed_hz=100000;
  ESP_ERROR_CHECK(i2c_master_bus_add_device(bus,&e,&expander));
  // TCA9554: P0 e-paper power, P1 audio power, P3 PA, P5 battery latch.
  // Write outputs before changing direction; preserve other pins as inputs.
  expWrite(1,0x23);expWrite(3,0xD4);delay(30); // PA initially muted
  i2s_chan_config_t c=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
  c.dma_desc_num=4;c.dma_frame_num=240;c.auto_clear=true;
  ESP_ERROR_CHECK(i2s_new_channel(&c,&output,&input));
  i2s_std_config_t s={};s.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(24000);
  s.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_STEREO);
  s.gpio_cfg.mclk=GPIO_NUM_19;s.gpio_cfg.bclk=GPIO_NUM_21;s.gpio_cfg.ws=GPIO_NUM_22;
  s.gpio_cfg.dout=GPIO_NUM_23;s.gpio_cfg.din=GPIO_NUM_20;
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
  ESP_ERROR_CHECK(esp_codec_dev_set_out_vol(codec,80));
  ESP_ERROR_CHECK(esp_codec_dev_set_in_gain(codec,MICROPHONE_GAIN_DB));
  audioFlush();expWrite(1,0x2B); // enable amplifier after clocks/codec are stable
#if ENABLE_EPAPER
  screenQueue=xQueueCreate(1,sizeof(ScreenState));assert(screenQueue);
  xTaskCreate(screenTask,"epaper",4096,nullptr,1,nullptr);
#endif
}
void audioFlush(){
  // Stop DMA and replace the whole four-descriptor queue with silence.
  if(!output)return;
  esp_err_t stopped=i2s_channel_disable(output);
  if(stopped!=ESP_OK&&stopped!=ESP_ERR_INVALID_STATE){diagnosticError("audio disable failed");return;}
  static const uint8_t silence[3840]={};size_t loaded=0;
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
size_t audioWrite(const int16_t* mono,size_t samples){
  int16_t stereo[480];samples=min(samples,(size_t)240);
  for(size_t i=0;i<samples;i++)stereo[2*i]=stereo[2*i+1]=(int32_t)mono[i]*SPEAKER_VOLUME/100;
  size_t bytes=0;i2s_channel_write(output,stereo,samples*4,&bytes,0);return bytes/4;
}
