# 微雪 ESP32-S3-ePaper-1.54G（四彩屏）

支持目标是 **ESP32-S3-ePaper-1.54G / ESP32-S3-ePaper-1.54G-EN**，不是黑白版1.54，也不是最早 firmware/ 外接I2S音频原型。

官方资料：https://docs.waveshare.com/ESP32-S3-ePaper-1.54G
引脚及命令驱动参考厂商仓库55eb1278f482c0cfd1e0cba5611a4132022eea48；移植驱动位于firmware-c6/lib/s3g_epaper/，保留原许可声明。

## 构建与烧录

共用firmware-c6源码，以构建环境区分硬件，默认环境仍为C6。S3G使用8MB Flash / OPI 8MB PSRAM；分区表为partitions-s3g.csv，保留NVS 0x9000/0x6000和PHY 0xf000，应用从0x10000开始4MB，storage从0x410000到0x800000。不刷入会覆盖NVS的boot_app0.bin。

在仓库根目录，用Python 3.10至3.13的PlatformIO执行：

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
python -m platformio run -d firmware-c6 -e waveshare_s3g
# 替换COMxx为实际S3串口；不要把仍连接的C6串口直接用于此命令。
python -m platformio run -d firmware-c6 -e waveshare_s3g -t upload --upload-port COMxx
```

本工作区已配置的环境也可用 `.\.venv-pio\Scripts\python.exe` 代替python。只编译C6用 `-e waveshare_c6`。已有的旧config.h若包含C6固定引脚，不要跨板复用；无config.h时默认配置会按环境选择正确引脚。

## 配置与交互

USB管理页、Wi-Fi、WSS/根CA/设备令牌与现有云端一致，无需改变云端协议或部署。新板需单独保存配置，原C6的NVS不会通过代码迁移到新板。

- BOOT GPIO0：按住0.3秒后讲话，松开提交；最长输入仍20秒。
- PWR GPIO18：与BOOT同时按住3秒进入设置；此版没有新增软件关机功能。
- 有线EC11：GPIO1/2为两相信号，公共端接GND；蓝牙仍禁用。
- ES8311 I2C：SDA47、SCL48；MCLK14、BCLK15、WS38、MCU TX45、MCU RX16。
- 音频供电GPIO42低有效，功放GPIO46高有效；电池电源锁存GPIO17高；电池采样GPIO4，分压系数2。
- 四彩屏：PWR6低有效、BUSY8、RST9、DC10、CS11、SCK12、MOSI13。

## PSRAM与任务

播放容量为576000B（12秒24kHz/16bit/mono）并明确从PSRAM分配，I2S DMA仍使用内部RAM。**容量不是起播等待时间**，起播水位继续1.4秒，断流后最高1.7秒。大容量可吸收更多积压，但不能制造尚未到达的音频，也不保证解决网络/云端故障。

PSRAM不可用时显示配置/诊断错误并停止启动语音链路，不降级到内部RAM以免分配失败。status中检查board、psramBytes、freePsramBytes、playbackCapacityMs。网络任务固定core0、Arduino主循环core1（框架S3默认），彩屏低优先级core0，避免20秒刷新阻塞主音频循环。

## 彩屏刷新策略

此面板是红/黄/黑/白四彩屏，官方标注快刷约15秒、全刷约20秒。它与C6黑白屏不同，不能依赖黑白局刷驱动。使用厂商1.54G命令表和2bit像素帧缓冲，界面使用红黄点缀。

只显示静态频道/USB/热点入口；录音、播放、缓冲过程不触发更新，实时连接、电量和音频统计以USB网页为准。刷新中的硬件闪动无法由软件消除，首次启动/切频道/换页面仍可能长时间闪动。相同页面忽略实时状态变化，避免反复刷屏。

## 验收与边界

构建成功只能证明工具链兼容。首次上板需依次检查：
1. board为waveshare-s3-epaper-1.54g，PSRAM约8MB，播放容量12000ms。
2. 页面配置保存、重启后保留，Wi-Fi及云端READY。
3. 网页两声本地测试音，麦克风采样与真实收发、实际音量。
4. 彩屏颜色、文字方向、USB/热点页面和电池供电。
5. 长故事的重缓冲/CRC/心跳记录，和同网络下C6对照。

2026-11-03已在COM13识别ESP32-S3-PICO-1并烧录、校验通过。实机检测PSRAM=8388608B、播放容量12000ms、LittleFS已挂载，ES8311寄存器读回198；本地两声测试提交18000个样本，I2S写入错误0。扬声器实际听感、屏幕颜色/方向、麦克风与真实云端对讲尚待验证。新板Wi-Fi、令牌、CA尚未保存。不得把C6已通过的实测自动当作S3G已通过。若现有Flash包含未知文件系统，沿用保留数据、不自动格式化的策略；不要为使缓存挂载而直接整片擦除。
