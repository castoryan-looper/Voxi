#ifdef VOXI_BOARD_TAIJI
#include "board_audio.h"
#include "board_profile.h"
#include "diagnostics.h"
#include "runtime_config.h"
#include "output_gain.h"
#include "standby.h"
#include "directional_pulse_encoder.h"
#include <WiFi.h>
#include <HWCDC.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <driver/i2s_pdm.h>
#include <driver/i2s_std.h>
#include <driver/spi_master.h>
#include <esp_lcd_panel_io.h>
#include <esp_lcd_panel_ops.h>
#include <esp_heap_caps.h>
#include <math.h>
#include "esp_lcd_sh8601.h"
extern "C" {extern const sh8601_lcd_init_cmd_t taiji_lcd_init_cmds[];extern const unsigned taiji_lcd_init_count;}
void requestChannelDelta(int delta);
static i2s_chan_handle_t input=nullptr,output=nullptr;
static esp_lcd_panel_handle_t panel=nullptr;
static SemaphoreHandle_t done;
static uint16_t *stripe=nullptr,*pixels=nullptr;
static bool displayReady=false,touchReady=false,touchHeld=false,pttHeld=false,dimmed=false;
static uint32_t displayFrames=0,touchSamples=0,outputSamples=0,outputErrors=0,lastInput=0;
static int volumePercent=45,touchX=-1,touchY=-1;
static uint32_t micSamples=0,micPeak=0,encoderSteps=0;
static volatile bool testPending=false;
static pocket::DirectionalPulseEncoder dial;
static portMUX_TYPE dialLock=portMUX_INITIALIZER_UNLOCKED;
static uint8_t dialPins(){return digitalRead(8)|(digitalRead(7)<<1);}
static void IRAM_ATTR dialEdge(){portENTER_CRITICAL_ISR(&dialLock);dial.edge(dialPins(),micros());portEXIT_CRITICAL_ISR(&dialLock);}
static bool IRAM_ATTR transfer(esp_lcd_panel_io_handle_t,esp_lcd_panel_io_event_data_t*,void*){BaseType_t wake=pdFALSE;xSemaphoreGiveFromISR(done,&wake);return wake==pdTRUE;}
class Canvas:public Adafruit_GFX{public:Canvas():Adafruit_GFX(360,360){} void drawPixel(int16_t x,int16_t y,uint16_t c)override{if(x>=0&&y>=0&&x<360&&y<360)pixels[y*360+x]=c;} void fillScreen(uint16_t c)override{for(unsigned i=0;i<360*360;i++)pixels[i]=c;}};
static Canvas canvas;
struct View{int channel=0;bool setup=false,hotspot=false;char name[24]{},key[16]{};ChannelLabel label;RadioDebugSnapshot debug;bool wifi=false;int rssi=0;};
static QueueHandle_t views;
static View base;
static constexpr uint16_t bg=0x0842,white=0xffff,muted=0x8410,accent=0x6fdb;
static void centered(const char* text,int y,int size,uint16_t color){canvas.setTextSize(size);canvas.setTextColor(color);canvas.setCursor(180-strlen(text)*6*size/2,y);canvas.print(text);}
static void screenTask(void*){
 View v,previous{};bool drawn=false;
 while(true){
  if(xQueueReceive(views,&v,pdMS_TO_TICKS(100))!=pdTRUE)continue;
  if(drawn&&v.channel==previous.channel&&v.setup==previous.setup&&v.wifi==previous.wifi&&v.rssi/5==previous.rssi/5&&!memcmp(&v.label,&previous.label,sizeof(v.label))&&!strcmp(v.debug.phase,previous.debug.phase)&&!strcmp(v.name,previous.name)&&!strcmp(v.key,previous.key))continue;
  previous=v;drawn=true;canvas.fillScreen(bg);canvas.drawCircle(180,180,176,muted);
  centered("VOXI",28,3,white);canvas.setTextSize(1);canvas.setTextColor(muted);canvas.setCursor(253,74);canvas.print("SETUP");
  canvas.setCursor(65,74);if(v.wifi)canvas.printf("WiFi %ddBm",v.rssi);else canvas.print("WiFi OFF");
  if(v.setup){
   centered("USB SETUP",115,2,white);centered(v.name,150,1,accent);
   centered(v.hotspot?"192.168.4.1":"127.0.0.1:8788",177,2,white);
   centered(v.hotspot?v.key:"Connect USB in Chrome / Edge",210,1,muted);
   centered("Tap here to return",270,1,white);
  }else{
   char text[32];if(v.label.disabled())strlcpy(text,"CH --",sizeof(text));else snprintf(text,sizeof(text),"CH %02d",v.label.number(v.channel));
   centered(text,105,4,white);
   if(v.label.hasBitmap)canvas.drawBitmap(120,153,v.label.bitmap,ChannelLabel::width,ChannelLabel::height,accent);
   else if(v.label.asciiName())centered(v.label.name,153,1,accent);
   centered(v.debug.phase[0]?v.debug.phase:"STARTING",188,2,white);
   canvas.fillRoundRect(103,240,154,58,25,0x18e5);canvas.drawRoundRect(103,240,154,58,25,accent);
   centered("HOLD TO TALK",260,2,white);centered("Rotate: channel",319,1,muted);
  }
  for(int top=0;top<360&&displayReady;top+=12){
   for(int row=0;row<12;row++)for(int x=0;x<360;x++){uint16_t c=pixels[(359-top-row)*360+359-x];stripe[row*360+x]=(c>>8)|(c<<8);}
   while(xSemaphoreTake(done,0)==pdTRUE){}
   if(esp_lcd_panel_draw_bitmap(panel,0,top,360,top+12,stripe)!=ESP_OK||xSemaphoreTake(done,pdMS_TO_TICKS(1000))!=pdTRUE){displayReady=false;diagnosticError("Taiji LCD transfer timeout");}
  }
  displayFrames++;
 }
}
static void post(){if(!views)return;View v=base;v.label=radioChannelLabel(v.channel);v.debug=radioDebugRead();v.wifi=WiFi.status()==WL_CONNECTED;v.rssi=v.wifi?WiFi.RSSI():0;xQueueOverwrite(views,&v);}
void displayChannel(int channel,bool){base.channel=channel;base.setup=false;post();}
void displayConnection(int channel,const char*,bool,bool,bool){base.channel=channel;post();}
void displaySetup(const char* name,const char* key,bool hotspot){base.setup=true;base.hotspot=hotspot;strlcpy(base.name,name,sizeof(base.name));strlcpy(base.key,key,sizeof(base.key));post();}
void displayDebugTick(){static uint32_t at=0;if(millis()-at<200)return;at=millis();base.setup=setupScreenActive();post();}
int batteryPercent(){return -1;}int batteryMillivolts(){return -1;}
int speakerVolume(){return volumePercent;}
bool speakerSetVolume(int value){if(value<0||value>100)return false;Preferences p;if(!p.begin("voxi-audio",false))return false;bool ok=p.putUChar("volume",value)==1;p.end();if(ok)volumePercent=value;return ok;}
void boardStatusTick(){
 portENTER_CRITICAL(&dialLock);int steps=dial.take(micros());portEXIT_CRITICAL(&dialLock);
 if(steps){encoderSteps+=abs(steps);lastInput=millis();standbyActivity();while(steps){requestChannelDelta(steps>0?1:-1);steps+=steps>0?-1:1;}}
 static uint32_t at=0;if(millis()-at<15)return;at=millis();
 bool was=touchHeld;touchHeld=false;pttHeld=false;
 Wire.beginTransmission(0x15);Wire.write(0x02);
 if(Wire.endTransmission(false)==0&&Wire.requestFrom((uint8_t)0x15,(uint8_t)5)==5){
  uint8_t d[5];for(auto &b:d)b=Wire.read();
  int x=((d[1]&15)<<8)|d[2],y=((d[3]&15)<<8)|d[4];
  if((d[0]&15)&&x<360&&y<360){touchHeld=true;touchX=359-x;touchY=359-y;touchSamples++;lastInput=millis();
   if(!was){if(base.setup&&touchY>240)requestCloseSetupScreen();else if(touchY<100&&touchX>240)requestSetupScreen();}
   pttHeld=!base.setup&&touchY>=230&&touchY<=310&&touchX>=90&&touchX<=270;
  }
 }
 bool wanted=millis()-lastInput>=60000;if(dimmed!=wanted){dimmed=wanted;ledcWrite(47,(dimmed?5:65)*511/100);}
}
bool boardPowerPressed(){return false;}bool boardTouchPttPressed(){return pttHeld;}bool boardTouchActive(){return touchHeld;}int boardTouchWakePin(){return -1;}bool boardPrepareStandby(){return false;}
void boardInit(){
 pinMode(0,OUTPUT);digitalWrite(0,HIGH); // Shared DAC belongs to S3; this is not a PTT pin.
 Preferences p;if(p.begin("voxi-audio",true)){volumePercent=p.getUChar("volume",45);p.end();}
 Wire.begin(11,12,300000);Wire.setTimeOut(20);Wire.beginTransmission(0x15);Wire.write(0);Wire.write(0);touchReady=Wire.endTransmission()==0;
 pinMode(8,INPUT_PULLUP);pinMode(7,INPUT_PULLUP);dial.begin(dialPins());attachInterrupt(8,dialEdge,CHANGE);attachInterrupt(7,dialEdge,CHANGE);
 done=xSemaphoreCreateBinary();stripe=(uint16_t*)heap_caps_malloc(360*12*2,MALLOC_CAP_DMA|MALLOC_CAP_INTERNAL);pixels=(uint16_t*)heap_caps_malloc(360*360*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);assert(done&&stripe&&pixels);
 spi_bus_config_t bus=SH8601_PANEL_BUS_QSPI_CONFIG(13,15,16,17,18,360*12*2);ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST,&bus,SPI_DMA_CH_AUTO));
 esp_lcd_panel_io_spi_config_t ioCfg=SH8601_PANEL_IO_QSPI_CONFIG(14,transfer,nullptr);ioCfg.pclk_hz=40000000;ioCfg.trans_queue_depth=1;esp_lcd_panel_io_handle_t io;
 ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST,&ioCfg,&io));
 sh8601_vendor_config_t vendor={};vendor.init_cmds=taiji_lcd_init_cmds;vendor.init_cmds_size=taiji_lcd_init_count;vendor.flags.use_qspi_interface=1;
 esp_lcd_panel_dev_config_t dev={};dev.reset_gpio_num=21;dev.rgb_ele_order=LCD_RGB_ELEMENT_ORDER_RGB;dev.bits_per_pixel=16;dev.vendor_config=&vendor;
 ESP_ERROR_CHECK(esp_lcd_new_panel_sh8601(io,&dev,&panel));ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
 ESP_ERROR_CHECK(ledcAttach(47,50000,9)?ESP_OK:ESP_FAIL);ledcWrite(47,65*511/100);displayReady=true;
 i2s_chan_config_t rx=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);rx.dma_desc_num=6;rx.dma_frame_num=240;
 ESP_ERROR_CHECK(i2s_new_channel(&rx,nullptr,&input));i2s_pdm_rx_config_t mic={};mic.clk_cfg=I2S_PDM_RX_CLK_DEFAULT_CONFIG(24000);mic.slot_cfg=I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_MONO);mic.gpio_cfg.clk=GPIO_NUM_45;mic.gpio_cfg.din=GPIO_NUM_46;
 ESP_ERROR_CHECK(i2s_channel_init_pdm_rx_mode(input,&mic));ESP_ERROR_CHECK(i2s_channel_enable(input));
 i2s_chan_config_t tx=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1,I2S_ROLE_MASTER);tx.dma_desc_num=6;tx.dma_frame_num=240;tx.auto_clear=true;
 ESP_ERROR_CHECK(i2s_new_channel(&tx,&output,nullptr));i2s_std_config_t dac={};dac.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(24000);dac.slot_cfg=I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_STEREO);dac.gpio_cfg.mclk=I2S_GPIO_UNUSED;dac.gpio_cfg.bclk=GPIO_NUM_39;dac.gpio_cfg.ws=GPIO_NUM_40;dac.gpio_cfg.dout=GPIO_NUM_41;dac.gpio_cfg.din=I2S_GPIO_UNUSED;
 ESP_ERROR_CHECK(i2s_channel_init_std_mode(output,&dac));ESP_ERROR_CHECK(i2s_channel_enable(output));audioFlush();
 views=xQueueCreate(1,sizeof(View));assert(views);xTaskCreatePinnedToCore(screenTask,"taiji_lcd",6144,nullptr,1,nullptr,0);post();
}
void audioFlush(){if(!output)return;i2s_channel_disable(output);static const uint8_t silence[5760]={};size_t loaded=0;i2s_channel_preload_data(output,silence,sizeof(silence),&loaded);i2s_channel_enable(output);}
size_t audioRead(int16_t* mono,size_t count){size_t bytes=0;i2s_channel_read(input,mono,min(count,(size_t)240)*2,&bytes,0);for(size_t i=0;i<bytes/2;i++)micPeak=max(micPeak,(uint32_t)abs((int)mono[i]));micSamples+=bytes/2;return bytes/2;}
size_t audioWrite(const int16_t* mono,size_t count){count=min(count,(size_t)240);int16_t stereo[480];for(size_t i=0;i<count;i++)stereo[i*2]=stereo[i*2+1]=speakerSample(mono[i],volumePercent);size_t bytes=0;esp_err_t e=i2s_channel_write(output,stereo,count*4,&bytes,0);if(e!=ESP_OK&&e!=ESP_ERR_TIMEOUT)outputErrors++;outputSamples+=bytes/4;return bytes/4;}
void speakerTestRequest(){testPending=true;}bool speakerTestPending(){return testPending;}
void speakerTestRun(){testPending=false;audioFlush();radioDebug("SPEAKER TEST","Headphone output: two quiet tones");size_t pos=0;uint32_t at=millis();while(pos<18000&&millis()-at<3000){int16_t b[240];for(int i=0;i<240;i++){int f=pos+i<6000?660:pos+i<12000?0:880;b[i]=f?int16_t(1500*sin(6.2831853*f*(pos+i)/24000)):0;}pos+=audioWrite(b,min((size_t)240,18000-pos));delay(1);}radioDebug(pos==18000?"TEST DONE":"TEST ERROR","Headphone tone test finished");}
void speakerDiagnostics(JsonDocument& d){d["displayReady"]=displayReady;d["displayFrames"]=displayFrames;d["displayWidth"]=360;d["displayHeight"]=360;d["touchReady"]=touchReady;d["touchSamples"]=touchSamples;d["touchX"]=touchX;d["touchY"]=touchY;d["displayDimmed"]=dimmed;d["speakerVolume"]=volumePercent;d["speakerWrittenSamples"]=outputSamples;d["speakerWriteErrors"]=outputErrors;d["audioOutput"]="PCM5100A headphone / active speaker";d["microphone"]="PDM 24kHz mono";d["microphoneSamples"]=micSamples;d["microphonePeak"]=micPeak;d["encoderSteps"]=encoderSteps;}
#endif
