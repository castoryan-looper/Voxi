# 正辰 MiniCam 2.0 英寸（ML307）适配记录

构建目标：`pio run -d firmware-c6 -e zhengchen_minicam_20`。

资料来源为用户提供的「2.0和2.8寸屏幕版本代码」中的 Wi-Fi / ML307 源码、接口说明和 2.0 英寸规格书；不使用双眼屏板型。按 ESP32-S3 N16R8、16MB Flash / 8MB OPI PSRAM 配置，烧录前仍需实机核验芯片容量并完整备份。

## 当前进度

已完成屏幕、音频、按键、PSRAM 播放缓冲与待机代码，构建及按键时序测试通过，C6 兼容构建通过。2026-11-04 已通过 COM15 烧录到实机：ESP32-S3 revision v0.2，16MB Flash / 8MB PSRAM；用户确认屏幕显示与两声本地测试音正常。录音缓存 LittleFS 已初始化，扬声器输出 18000 个采样且无 I2S 写入错误。用户已配置网关凭据；三键修正版上板后，主键开始/停止录音、麦克风采集、音频上传和 AI 回复均已实测通过。后续已完成纯 4G 故事播放验收，详见 [4G 记录](MINICAM-4G.md)；侧键音量/频道及 4G 待机仍需实机验收。

**4G 已接通并上板验证**：Wi-Fi 关闭时，通过 ML307R 数据连接、ESP32 TLS 证书验证和现有 VOXI 网关完成录音上传及回复播放。连接模式、APN 和验证边界见 [4G 使用说明](MINICAM-4G.md)。

**按住录音交互更新（2026-11-04）**：主键按住版本已烧录，观察到 GPIO11 按住后开始采集音频，但数秒后 USB 消失；厂家说明明确主键长按开关机，用户也确认该硬件限制。因此改用音量＋作为 PTT，屏幕提示 `Hold +: talk / release: send`，主键不再输入录音。侧键时序测试覆盖主键长按不录音、音量＋按住录音/松开仅发送一次、长按不调音量/换频道、短按调音量、音量－长按换频道以及忙碌/超时门控。最新侧键版已构建通过并写入实机，写入 Hash 校验成功；重启诊断确认 `talkButton=volume_up`、`talkMode=hold_to_talk`、纯 4G、TLS 验证和 `cloudReady=true`，设备 ID 保持 `esp32-d453097e9ec4`。真人侧键对话验收待用户反馈。

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

- 按住音量＋键约 0.3 秒开始开麦提示，提示后继续按住说话，松开发送；单次录音上限仍为 20 秒，一直按住不会重复录音。加减键短按分别加减音量 10%，音量－长按 0.7 秒切换上一频道（四频道循环）；长按不同时改变音量。频道切换在录音、发送和回复结束后执行。主键仅保留硬件开关机和待机唤醒，不能用作持续按住录音。
- 12 秒 PCM16 PSRAM 环形缓冲，沿用 S3 的 4 秒起播和自适应续播保护。屏幕使用独立任务和 PSRAM 画布；I2S 非阻塞写入，按实际写入量推进音频。
- 配置完成后使用 [分级待机](MINICAM-STANDBY.md)：空闲 1 分钟关闭背光、屏幕和音频但保持连接；5 分钟关闭云端会话但保留网络；15 分钟关闭模组射频并进入原有休眠。前两级任一按键唤醒且不重启，第三级使用主键唤醒。此板没有已确认的触摸输入。三个阈值可在 USB 管理页调整并持久保存。
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
- ML307R 在 UART1 / 921600 baud 识别成功，SIM ready、CEREG 已注册，CSQ 22–25；后续 4G 版本增加 UHCI DMA 和 CA 验证，已完成纯 4G 对话测试。
- 待继续验收：不同运营商/专网 APN、云端长回复连续性、侧键功能及 4G 休眠恢复。

## 三键交互修正

早期单击录音版本曾改为跟踪实际 `tx` 状态，避免开麦提示音进入 `OPEN MIC` 时提前清掉录音锁存。现按用户要求移除单击锁存，改为与其他板型共用 `PttHold` 按住录音策略；音量＋ ADC 连续三次采样去抖后输入，松开结束录音。开麦提示期间提前松开会清除麦克风等待标记，避免随后误启动空录音上传。

USB 状态包含 `mainButtonRaw`、`volumeKeyMv`、`mainButtonClicks`（主键有效按下次数）、`mainButtonHeld`、`pttButtonHeld`、`talkButton=volume_up`、`talkMode=hold_to_talk`、`recordingActive`、`canStartRecording`；旧字段 `talkLatched` 固定为 false。音量＋仅在允许录音时启动，离线或忙碌时按住不会在恢复 READY 后自动开始，需松开重按。休眠唤醒按键被消耗，不会直接发起录音。

三键修正版实测：主键触发录音约 8.07 秒，`micBytes=sentBytes=387360`，麦克风峰值 5591；云端回复返回并进入 PLAYING，用户确认录音和回复均正常。验证完成后释放 USB 串口。

音量＋ PTT 版实测：侧键持续按住约 6 秒正常采集，主键 GPIO11 始终未按下；松开后自动结束录音并提交，`micBytes=sentBytes=291840`，采集/发送 CRC 均为 `2403396620`。纯 4G 下网关确认提交，随后收到回复并进入 PLAYING，全程未触发主键硬件关机。该项证明侧键录音、松开发送和回复接收已实机跑通；音频主观听感以用户反馈为准。

## 改线后使用主键对讲

接口说明的音量键图给出了 GPIO9 电阻分压以及音量＋的 CN2 接口。原厂接线可在 CN2 接常开瞬时按键，沿用 `zhengchen_minicam_20` 的音量＋对讲逻辑。短按仍调音量，按住约 0.3 秒开麦，松开发送。

原厂主键长按会触发硬件关机。若要用原主键做 PTT，先依据主键和电源电路原理图隔离按键的电源控制连接，保留 GPIO11 的低有效按键信号，并确认设备有独立的启动方式。当前接口附件没有这部分电路，不能据此指定要切断的走线或拆除的元件。

仅为已完成上述改线的板构建以下目标：

```powershell
python -m platformio run -d firmware-c6 -e zhengchen_minicam_20_gpio11_ptt
```

GPIO11 版本复用 0.3 秒 PTT、20 秒限长、松开收尾及云端发送流程。屏幕显示 `Hold main: talk / release: send`，USB 状态返回 `talkButton=gpio11`。改线前继续使用默认的 `zhengchen_minicam_20` 目标。烧录改线版后，验收时分别确认短按不录音、长按超过原来的关机时间仍在录音，以及松开只发送一次。
