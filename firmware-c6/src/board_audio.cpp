#include "board_audio.h"
#include "config.h"
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

#if ENABLE_EPAPER
static GxEPD2_BW<GxEPD2_154_D67,200> screen(GxEPD2_154_D67(7,15,11,10));
struct ScreenState{int channel;bool online;};
static QueueHandle_t screenQueue;
static void screenTask(void*){
  SPI.begin(6,4,5,7);
  screen.init(115200,true,20,false);
  ScreenState state;
  while(true){
    if(xQueueReceive(screenQueue,&state,portMAX_DELAY)!=pdTRUE)continue;
    // Coalesce rapid channel changes. Screen BUSY waits run in this low-priority task.
    vTaskDelay(pdMS_TO_TICKS(1000));ScreenState next;
    while(xQueueReceive(screenQueue,&next,0)==pdTRUE)state=next;
    screen.setFullWindow();screen.firstPage();
    do{
      screen.fillScreen(GxEPD_WHITE);screen.setTextColor(GxEPD_BLACK);screen.setTextSize(2);
      screen.setCursor(18,25);screen.print("AI RADIO");
      screen.setTextSize(4);screen.setCursor(18,70);screen.printf("CH %02d",state.channel+1);
      screen.setTextSize(2);screen.setCursor(18,125);screen.print(state.online?"READY":"CONNECTING");
      screen.setTextSize(1);screen.setCursor(18,170);screen.print("Hold BOOT to talk");
    }while(screen.nextPage());
    screen.hibernate();
  }
}
#endif
void displayChannel(int channel,bool online){
#if ENABLE_EPAPER
  if(screenQueue){ScreenState s{channel,online};xQueueOverwrite(screenQueue,&s);}
#endif
}
void boardInit(){
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
  ESP_ERROR_CHECK(i2s_channel_disable(output));
  static const uint8_t silence[3840]={};size_t loaded=0;
  ESP_ERROR_CHECK(i2s_channel_preload_data(output,silence,sizeof(silence),&loaded));
  ESP_ERROR_CHECK(i2s_channel_enable(output));
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
