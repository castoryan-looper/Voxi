# 微雪 ESP32-C6-ePaper-1.54 硬件适配

当前固件入口：`firmware-c6/`。旧 `firmware/` 仍是 S3 外接 I2S 音频版本，**不能刷到 C6**。

核对依据：微雪[产品文档](https://docs.waveshare.com/ESP32-C6-ePaper-1.54)、[官方示例](https://github.com/waveshareteam/ESP32-C6-ePaper-1.54)提交 `c4c47b6a8001f9daa50b38912393c158371e03be` 的原理图、Arduino 音频配置及 ESP-IDF `codec_board/board_cfg.txt`。Arduino 示例中的 board_cfg 缺少 C6 条目，因此按官方 IDF 的 C6 条目核对音频引脚，不复用 S3 条目。

| 功能 | 板载资源 / 引脚 |
|---|---|
| 音频 codec | ES8311，I2C 7bit 地址 0x18 |
| I2C | SDA=18，SCL=8；与 TCA9554/RTC/传感器共用 |
| I2S | MCLK=19，BCLK=21，WS=22，DIN=20，DOUT=23 |
| 电源 / 功放 | TCA9554 0x20：P0 墨水屏电源，P1 音频电源，P3 PA 使能，P5 电池供电保持 |
| PTT | 板载 BOOT / GPIO9，低电平按下；复位开机时不要按住 |
| 频道旋钮 | 外接 EC11 A→GPIO16、B→GPIO17、公共端→GND；使用 3.3V 电平 |
| 墨水屏 | 200×200；SPI CLK=6，MOSI=5，CS=7，DC=15，RST=11，BUSY=10 |
| PWR | GPIO2，保留，不作为 PTT；当前不实现长按关机 |

GPIO16/17 在扩展排针引出，原为 UART 信号；当前日志使用 USB CDC，不占用此 UART。旋钮不用 VCC 的裸 EC11 可直接接；带模块的编码器若接 VCC 则使用 3.3V，不能输入 5V。不要占用 GPIO8/18（I2C）、GPIO12/13（USB）或 TF/屏幕共享 SPI 引脚。外接 PTT 可与 BOOT 并联在 GPIO9/GND，同样注意启动绑带。

## 音频实现

C6 用一个 I2S0 同时创建 TX/RX，立体声 16bit、24kHz，ES8311 输入左槽转为协议单声道，回放把单声道复制为左右槽。ES8311 右槽可能是 DAC 回采参考，不能把左右平均当麦克风信号；`MIC_SLOT=0` 可在真机采样后核验。使用官方示例中 Espressif 的 esp_codec_dev 源码，保留 Apache-2.0 声明。

PA 在 codec 和时钟稳定后打开。断开或打断时重置播放 DMA 为静音，防止旧语音回流。关闭 Wi-Fi 省电，音频 10–20ms 分块，不依赖 PSRAM。

## 屏幕和按键

墨水屏低优先级独立任务显示频道和 READY/CONNECTING，不在按下或松开时刷新，避免刷新 BUSY 阻塞语音主循环。使用 GxEPD2 的 200×200 D67 驱动作为当前软件适配；屏幕型号/波形与真机尚需验证。若音频联调时出现显示异常，先把 `ENABLE_EPAPER` 设为 0，独立确认屏幕版本后再调波形。

BOOT 按住发射、松开接收；轻点不足 100ms 音频丢弃。EC11 默认四相变化换一档，停稳 180ms 生效，按住发射时换台延迟到松开。当前不做 PWR 长按关机，也不使用 TF/RTC/温湿度数据。

## 编译

使用 **Python 3.12** 与 PlatformIO 6.2.0；固定 pioarduino 55.03.33 / Arduino-ESP32 3.3.3（满足微雪要求的 3.3.0 以上）。Python 3.14 不受该平台支持。

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install platformio==6.2.0
Copy-Item firmware-c6/include/config.example.h firmware-c6/include/config.h
# 填 Wi-Fi、设备令牌和服务器根 CA
.\.venv\Scripts\python.exe -m platformio run --project-dir firmware-c6
.\.venv\Scripts\python.exe -m platformio run --project-dir firmware-c6 --target upload
.\.venv\Scripts\python.exe -m platformio device monitor --project-dir firmware-c6
```

板型使用通用 C6 DevKitC 定义，覆盖 Flash 为板载 16MB；硬件引脚由本项目板级驱动指定。先 USB 供电联调，接好板载扬声器接口，从保守音量开始。编译成功不代表已经验证板载电源、电池续航、左右槽、屏幕与真实语音延迟。
