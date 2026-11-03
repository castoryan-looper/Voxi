#pragma once
#include <Adafruit_GFX.h>
#include "EPD_1in54g.h"
#define GxEPD_BLACK 0x0000
#define GxEPD_WHITE 0xffff
class S3GScreen:public Adafruit_GFX{
 uint8_t pixels[10000];
 public:
 S3GScreen():Adafruit_GFX(200,200){memset(pixels,0x55,sizeof(pixels));}
 void drawPixel(int16_t x,int16_t y,uint16_t color)override{
  if(x<0||y<0||x>=200||y>=200)return;
  uint8_t value=color==0xffff?1:color==0xffe0?2:color==0xf800?3:0;
  size_t offset=y*50+x/4;unsigned shift=(3-x%4)*2;
  pixels[offset]=(pixels[offset]&~(3<<shift))|(value<<shift);
 }
 void init(int,bool,int,bool){DEV_Module_Init();}
 void setFullWindow(){}
 void setPartialWindow(int,int,int,int){} // This panel has no BW partial-refresh path.
 void firstPage(){}
 bool nextPage(){EPD_1IN54G_Init_Fast();EPD_1IN54G_Display(pixels);return false;}
 void powerOff(){EPD_1IN54G_Sleep();}
};
