// Hardware SPI transport for the vendor 1.54G command driver.
#include "DEV_Config.h"
#include <SPI.h>
UBYTE DEV_Module_Init(){
 pinMode(EPD_PWR_PIN,OUTPUT);digitalWrite(EPD_PWR_PIN,LOW);
 pinMode(EPD_BUSY_PIN,INPUT);pinMode(EPD_RST_PIN,OUTPUT);pinMode(EPD_DC_PIN,OUTPUT);pinMode(EPD_CS_PIN,OUTPUT);digitalWrite(EPD_CS_PIN,HIGH);
 SPI.begin(EPD_SCK_PIN,-1,EPD_MOSI_PIN,EPD_CS_PIN);return 0;
}
void GPIO_Mode(UWORD pin,UWORD mode){pinMode(pin,mode?OUTPUT:INPUT);}
void DEV_SPI_WriteByte(UBYTE value){SPI.beginTransaction(SPISettings(4000000,MSBFIRST,SPI_MODE0));digitalWrite(EPD_CS_PIN,LOW);SPI.transfer(value);digitalWrite(EPD_CS_PIN,HIGH);SPI.endTransaction();}
UBYTE DEV_SPI_ReadByte(){return 0xff;}
void DEV_SPI_Write_nByte(UBYTE* bytes,UDOUBLE length){for(UDOUBLE i=0;i<length;i++)DEV_SPI_WriteByte(bytes[i]);}
void DEV_Module_Exit(){digitalWrite(EPD_PWR_PIN,HIGH);}
