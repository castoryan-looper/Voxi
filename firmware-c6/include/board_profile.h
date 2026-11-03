#pragma once
#if defined(VOXI_BOARD_MINICAM)
#define BOARD_NAME "zhengchen-minicam-2.0-ml307"
#define BOARD_BOOT_KEY 11
#define BOARD_POWER_KEY -1
#define BOARD_BAT_ADC 3
#define BOARD_I2C_SDA 1
#define BOARD_I2C_SCL 2
#define BOARD_I2S_MCLK 38
#define BOARD_I2S_BCLK 14
#define BOARD_I2S_WS 13
#define BOARD_I2S_DOUT 45
#define BOARD_I2S_DIN 12
#define BOARD_ENCODER_A -1
#define BOARD_ENCODER_B -1
#elif defined(VOXI_BOARD_AMOLED)
#define BOARD_NAME "waveshare-s3-touch-amoled-1.8-v2"
#define BOARD_BOOT_KEY 0
#define BOARD_POWER_KEY -1
#define BOARD_BAT_ADC -1
#define BOARD_I2C_SDA 15
#define BOARD_I2C_SCL 14
#define BOARD_I2S_MCLK 16
#define BOARD_I2S_BCLK 9
#define BOARD_I2S_WS 45
#define BOARD_I2S_DOUT 8
#define BOARD_I2S_DIN 10
#define BOARD_ENCODER_A -1
#define BOARD_ENCODER_B -1
#elif defined(VOXI_BOARD_S3G)
#define BOARD_NAME "waveshare-s3-epaper-1.54g"
#define BOARD_BOOT_KEY 0
#define BOARD_POWER_KEY 18
#define BOARD_BAT_ADC 4
#define BOARD_I2C_SDA 47
#define BOARD_I2C_SCL 48
#define BOARD_I2S_MCLK 14
#define BOARD_I2S_BCLK 15
#define BOARD_I2S_WS 38
#define BOARD_I2S_DOUT 45
#define BOARD_I2S_DIN 16
#define BOARD_ENCODER_A 1
#define BOARD_ENCODER_B 2
#else
#define BOARD_NAME "waveshare-c6-epaper-1.54"
#define BOARD_BOOT_KEY 9
#define BOARD_POWER_KEY 2
#define BOARD_BAT_ADC 0
#define BOARD_I2C_SDA 18
#define BOARD_I2C_SCL 8
#define BOARD_I2S_MCLK 19
#define BOARD_I2S_BCLK 21
#define BOARD_I2S_WS 22
#define BOARD_I2S_DOUT 23
#define BOARD_I2S_DIN 20
#define BOARD_ENCODER_A 16
#define BOARD_ENCODER_B 17
#endif
