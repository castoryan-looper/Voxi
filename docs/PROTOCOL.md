# 设备协议 · Opus 下行 v1

## 低带宽档位

网关支持 `OPUS_DOWNLINK_BITRATE=8000`、`12000` 或 `16000`，默认仍为 16000。该设置作用于本网关全部设备及 mock/OpenAI/Pocket 模式的回复下行；采样率、20ms 帧、序号格式和录音上行保持原配置。8kbps 每帧为 20 字节 Opus 加 4 字节序号，约 1200B/s；12kbps 约 1700B/s；16kbps 约 2200B/s。这些数字均未计入 WebSocket/TLS/TCP 开销。

在服务器 `/etc/voxi/gateway.env` 设置该变量并重新部署网关。`/healthz` 与设备 `ready.audioBitrate` 返回实际档位。`sudo bash deploy/check-opus.sh` 可核对运行版本、帧大小和解码。已接入 MiniCam 可运行 `python tools/test_opus_device.py COM4 8000` 验证真实芯片解码，无需为此改变固件协议。低码率会影响音质，实际卡顿和心跳超时仍需分别实测。

连接 `ws://<gateway>:8787/radio`（生产环境使用受信任 CA 的 WSS）；HTTP Header：`Authorization: Bearer <DEVICE_TOKEN>` 和 `X-Voxi-Audio-Format: opus-24000-v1`。API Key 仅网关持有。缺失或声明旧下行格式时返回 `opus_required` 错误并以 1008 关闭；不再回退到 PCM/µ-law。

上行录音仍为无头 PCM16LE、24kHz 单声道，每帧最多 1920 字节；本次只统一回复下行。所有维护中的 C6/S3 板型、Wi-Fi/4G 连接和网关 mock/OpenAI/Pocket 模式均只发送 Opus 下行：24kHz 单声道、20ms、16kbps CBR。每个 binary 消息为 4 字节 little-endian 顺序号加一个原始 Opus packet，编号在每个 audio_start 从 0 开始。20ms 帧通常共 44 字节，约 2200B/s，不含 WebSocket/TLS/TCP 开销。JSON 为文本帧，音频为 binary 帧；同连接顺序传输。

| 方向 | JSON | 含义 |
|---|---|---|
| 上行 | `{"type":"ptt_down"}` | 打断上次回复，清输入缓冲，开始本轮 |
| 上行 | `{"type":"ptt_up"}` | 停止采集，提交并生成回复 |
| 上行 | `{"type":"channel","channel":0}` | 频道 0–3；重建云端会话 |
| 上行 | `{"type":"played","ms":240}` | 当前 AI item 已播放时长，约 100ms 报告一次 |
| 下行 | `{"type":"connecting","channel":0}` | 等待语音会话配置成功 |
| 下行 | `{"type":"ready","channel":0,"audioFormat":"opus-24000-v1","audioBitrate":16000}` | 已确认 Opus，可以开始讲话 |
| 下行 | `{"type":"flush"}` | 丢弃软件与 DMA 中旧音频 |
| 下行 | `{"type":"recording"}` | 已接受按下 |
| 下行 | `{"type":"thinking"}` | 已接受松开，准备回复 |
| 下行 | `{"type":"audio_start"}` | 当前回复播放计数归零 |
| 下行 | `{"type":"audio_end"}` | 音频发送完，设备播完剩余缓冲 |
| 下行 | `{"type":"idle","reason":"too_short"}` | 音频不足 100ms，不生成 |
| 下行 | `{"type":"error","message":"..."}` / `{"type":"offline"}` | 停播放、关闭并重连 |

先收到带正确 audioFormat 的 ready 再发 ptt_down，随后流式 binary，最后 ptt_up。少于 100ms 丢弃，超过 20s 录音上限断开。按键不支持双击/锁定发射。换台清空所有本轮输入和上下文；旧上游连接事件通过 epoch 丢弃，取消轮次通过 response metadata 与 response_id 排除旧音回流。

网关对模型生成的突发做有界实时发送。设备在主音频任务解码为 PCM 后播放。C6 使用 2 秒内部 PCM 环形缓冲，水位始终小于容量；S3 使用 12 秒 PSRAM PCM 环形缓冲、2 秒初始起播水位，最多自适应至 6 秒。中途恢复水位独立设置，正常连续播放不重复等待。played 是扣除最大 DMA 队列后的估算，不能当作精确硬件播放时钟。

## 完整性与版本

错序、缺失或无效的 Opus 帧明确报错，不丢帧续播。每轮尾帧补齐后排空编码器延迟，避免最后一个音节被截断；最多额外约 40ms。`audio_end` 在所有 Opus 尾帧之后发送。

`replyWireReceivedBytes` 统计压缩数据；`replyReceivedBytes`、`replyConsumedBytes` 和 CRC 比较本机解码后 PCM 的接收/播放完整性，不比较有损压缩前后的 PCM。`replyCodecConfirmed` 表示云端已确认正确协议，不能仅凭字段名称判断连接已可录音。

所有设备需更新固件后再连接统一网关；未连接到电脑的设备不能远程假定已烧录。`firmware/` 是历史外接音频原型，不属于当前维护的固件入口，也不再兼容此网关。编码细节与部署见 [Opus 说明](MINICAM-OPUS.md)。
