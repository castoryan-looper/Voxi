# 正辰 MiniCam 2.0 英寸（ML307）适配记录

构建目标：`pio run -d firmware-c6 -e zhengchen_minicam_20`。

资料来源为用户提供的「2.0和2.8寸屏幕版本代码」中的 Wi-Fi / ML307 源码、接口说明和 2.0 英寸规格书；不使用双眼屏板型。按 ESP32-S3 N16R8、16MB Flash / 8MB OPI PSRAM 配置，烧录前仍需实机核验芯片容量并完整备份。

## 当前进度

已完成屏幕、音频、按键、PSRAM 播放缓冲与待机代码，构建及按键时序测试通过，C6 兼容构建通过。2026-11-04 已通过 COM15 烧录到实机：ESP32-S3 revision v0.2，16MB Flash / 8MB PSRAM；用户确认屏幕显示与两声本地测试音正常。录音缓存 LittleFS 已初始化，扬声器输出 18000 个采样且无 I2S 写入错误。用户已配置网关凭据；三键修正版上板后，主键开始/停止录音、麦克风采集、音频上传和 AI 回复均已实测通过。侧键音量/频道及待机仍需实机验收。

**本阶段云端对话仍走 Wi-Fi。4G 目前仅有非阻塞 AT 检测与 SIM / 注册 / 信号诊断，还没有接通云端传输；不可将“已注册”视为“4G 对话可用”。** 需要连接实机读取准确模块型号与能力，再完成并验证加密传输。不得为快速接通而禁用 CA 校验。

摄像头尚未接入 VOXI 对话协议；不启用厂家视觉、唤醒词、动画或自动激活服务。

## 引脚

| 部件 | 引脚 / 参数 |
| --- | --- |
| ES8388 I2C | SDA 1 / SCL 2，7 位地址 0x10 |
| I2S | MCLK 38 / BCLK 14 / WS 13 / MCU DOUT 45 / MCU DIN 12 |
| 屏幕 | ST7789，240×320，SPI mode 0，40MHz |
| 屏幕 SPI | DC 39 / CS 40 / CLK 46 / MOSI 41，无独立 RESET |
| 背光 | GPIO42，低电平点亮 |
| 主按键 | GPIO11，低电平有效（不是 ESP32 下载绑带 GPIO0） |
| 音量键 | GPIO9 ADC：0–700mV 减，900–3000mV 加；连续三次采样确认 |
| 电池 / 参考 ADC | GPIO3 / GPIO4，按厂家电路换算，百分比仅粗略估计 |
| ML307 UART1 | ESP TX47 → 模块 RX，ESP RX48 ← 模块 TX |

GPIO47/48 不用于 LED。ES8388 无独立 PA 控制脚。ESP32 为 I2S 时钟主机，codec 使用从机设置；左路录音，右路保留硬件参考。

## 操作与性能

- 单击主键开始录音，再次单击发送（短按上限 1.2 秒；硬件电源键不适合持续长按）。加减键短按分别加减音量 10%，长按 0.7 秒分别切换下一/上一频道；长按不同时改变音量。频道切换在录音、发送和回复结束后执行。
- 12 秒 PCM16 PSRAM 环形缓冲，沿用 S3 的 4 秒起播和自适应续播保护。屏幕使用独立任务和 PSRAM 画布；I2S 非阻塞写入，按实际写入量推进音频。
- 配置完成且空闲超过 60 秒进入待机；主键唤醒。此板没有已确认的触摸输入。待机关闭背光、屏幕和音频，并要求已检测的 modem 成功进入最小射频功能，否则暂缓休眠。
- 使用现有 USB / AP 配置页保存 Wi-Fi、网关令牌与 CA；新设备不会自动继承另一台的凭据。唯一设备 ID 来自 ESP32 eFuse MAC，沿用云端设备绑定、频道与长期记忆。

## 上板检查

1. 确认 Windows 枚举 USB 串口；只见灯闪不能说明数据线连接成功。
2. esptool 核对芯片、Flash，完整读取原厂固件并校验大小和 SHA256。
3. 烧录 VOXI，不全片擦除；新分区与厂家资产可能不同，缓存分区需在备份后单独确认初始化。
4. USB status 查看 `displayReady`、`psramBytes`、`audioCodec`、`cellularModel`、`cellularSimReady`、`cellularRegistered`；不输出 IMEI、ICCID 或 SIM PIN。
5. 测试屏幕方向、两声本地测试音、麦克风、按键、长回复连续性及休眠恢复。

## 本次烧录记录（2026-11-04）

- 唯一 ID：`esp32-d453097e9ec4`。原厂完整 16MB 备份位于本地 gitignore 的 `backups/minicam-c49e7e0953d4-factory-20261104.bin`，SHA256 `9155d5763f7c38ff638aade2b9d4dd762aca9569ccc116c1ecde844720e44c7c`。
- 原厂分区为 NVS / OTA 双 app / assets。完成备份后，写入新的 factory 分区表，并仅清除 0x410000–0xffffff 以初始化 VOXI 录音缓存；保留 0x9000 开始的 NVS 数据。
- **引导镜像必须保留 DIO 模式**（原厂和 PlatformIO bootloader 均为 DIO）；手动 esptool 写入时不可强制 QIO 引导。应用使用 qio_opi 内存配置不等于 ROM 引导也用 QIO。
- ML307R 在 UART1 / 921600 baud 识别成功，SIM ready、CEREG 已注册，CSQ 22–25；这些状态仅验证模组就绪，不代表已实现 4G VOXI 传输。
- 待完成：加密 4G 传输适配与验证、云端长回复连续性、侧键功能及休眠恢复。

## 三键交互修正

录音锁存改为跟踪实际 `tx` 状态，不根据 `READY` / `RECORDING` / `OPEN MIC` 屏幕文字推断。原逻辑在开麦提示音进入 `OPEN MIC` 时可能提前清掉录音锁存；正常短按也不再局限于 250ms 内释放。单击直接在释放后触发，不等待双击窗口。

USB 状态新增 `mainButtonRaw`、`volumeKeyMv`、`mainButtonClicks`、`talkLatched`、`recordingActive`、`canStartRecording`，用于区分按键接线、录音门控与麦克风输入问题。主键仅在允许录音时启动，发送/思考/播放期间短按会提示等待 READY；20 秒录音上限仍沿用项目现有规则。休眠唤醒按键被消耗，不会直接发起录音。

三键修正版实测：主键触发录音约 8.07 秒，`micBytes=sentBytes=387360`，麦克风峰值 5591；云端回复返回并进入 PLAYING，用户确认录音和回复均正常。验证完成后释放 USB 串口。
