# Waveshare ESP32-S3-Touch-AMOLED-1.8 V2

支持CO5300/CST820和SH8601/FT3168两组硬件，启动时根据触摸地址0x15/0x38选择对应显示驱动。用户确认背面V2标记，但COM14实测触摸响应0x38；使用SH8601后用户确认屏幕点亮。因此不可只依赖外壳/背面版本文字选择驱动。实测ESP32-S3、16MB Flash、8MB PSRAM。

官方参考：https://docs.waveshare.com/ESP32-S3-Touch-AMOLED-1.8
引脚、复位和CO5300偏移参考厂商仓库78e13f852929c2ab4f9d5e0ad1c50ea378dbf2b4的examples/arduino-v2。依赖固定Arduino_GFX 1.6.4、XPowersLib 0.2.6。不使用LVGL；PSRAM帧缓冲由低优先级显示任务刷新，主循环负责触摸与音频，网络任务core0、主循环core1。

## 构建

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
python -m platformio run -d firmware-c6 -e waveshare_amoled18_v2
python -m platformio run -d firmware-c6 -e waveshare_amoled18_v2 -t upload --upload-port COMxx
```

本工作区可用 `.\.venv-pio\Scripts\python.exe`。共用firmware-c6工程，但硬件实现独立为board_amoled.cpp，原board_audio.cpp只用于墨水屏板。AMOLED使用16MB分区表partitions.csv，不覆盖NVS，保留原数据保护逻辑。12秒PCM环形缓冲与368×448 RGB565画布从PSRAM分配，I2S DMA使用内部RAM。

## 硬件

- BOOT GPIO0用于PTT。PWR由AXP2101管理，不作为普通GPIO读取；设置改用触摸SETUP或USB网页。
- I2C SDA15/SCL14，共用ESP-IDF新master总线；ES8311 0x18、AXP2101 0x34、TCA9554 0x20、CST820 0x15。XPowers通过回调使用现有总线，避免混用旧I2C驱动。
- I2S MCLK16、BCLK9、WS45、MCU TX8、MCU RX10；功放PA46高有效。
- 扩展IO P0/P1/P2在QSPI启动前执行高100ms→低300ms→高200ms复位，保留其余位；回读输出和方向用于诊断，参考厂商仓库V2黑屏问题#12。
- QSPI CS12/SCLK11/D0=4/D1=5/D2=6/D3=7，CO5300分辨率368×448、列偏移16；若触摸地址探测为0x38，则使用厂商另一版SH8601/FT3168组合（无列偏移）。实际接入板响应0x38，丝印版本与芯片组合需要分别核验。
- CST820按原生坐标读取。触摸区域与显示区域一致：PTT(16,328)-(352,396)，底部CH-/SETUP/CH+三按钮；边界与间隙不触发。
- 不启用SD卡、IMU、RTC业务或蓝牙；不配置外部编码器，以免占用板载SD/其他IO。

## 交互

顶部显示Wi-Fi图标、信号、电量；中间频道、READY/录音/等待/播放阶段、音频计数和三条日志；底部触摸对讲键与频道/设置按钮。画布约每200ms检查更新并整帧提交，避免先清屏再逐行绘制造成白闪。

按住BOOT或屏幕HOLD TO TALK超过0.3秒开始录音，松开提交；仍保留原提示音、最长20秒输入、单轮恢复和完整性诊断。滑出PTT区域或松手停止触摸按压；侧键PWR维持硬件电源功能。SETUP请求在设备空闲时打开，避免打断当前语音。

新板需在USB管理页单独保存Wi-Fi、Voxi设备令牌与根CA，云端协议不变。默认云端支持2台并发；无需为本板升级协议。

## 验证边界

已完成16MB原Flash备份（本地backups/，不入Git）、三板编译、触摸按钮边界回归和分区保护测试。COM14烧录并校验通过；用户确认屏幕点亮；实际触摸样本48次，PMU和LittleFS正常。扬声器测试写入18000样本、写错误0（听感仍需用户确认）。设备未保存令牌/CA/Wi-Fi，真实麦克风/云端对讲与持续播放尚未验证。
