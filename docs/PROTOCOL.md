# 设备协议 v0

连接 `ws://<gateway>:8787/radio`；HTTP Header：`Authorization: Bearer <DEVICE_TOKEN>`。API Key 仅网关持有。

默认二进制消息双向均为无头 PCM16LE、24kHz、单声道。C6可协商下行μ-law8，见后文。网关下行每帧最多 960 字节（20ms）；设备当前上行最多 480 字节（10ms）。不含 WAV 文件头。JSON 为文本帧，音频为 binary 帧；同连接顺序传输。

| 方向 | JSON | 含义 |
|---|---|---|
| 上行 | `{"type":"ptt_down"}` | 打断上次回复，清输入缓冲，开始本轮 |
| 上行 | `{"type":"ptt_up"}` | 停止采集，提交并生成回复 |
| 上行 | `{"type":"channel","channel":0}` | 频道 0–3；重建云端会话 |
| 上行 | `{"type":"played","ms":240}` | 当前 AI item 已播放时长，约 100ms 报告一次 |
| 下行 | `{"type":"connecting","channel":0}` | 等待语音会话配置成功 |
| 下行 | `{"type":"ready","channel":0,"name":"营地"}` | 可以开始讲话 |
| 下行 | `{"type":"flush"}` | 丢弃软件与 DMA 中旧音频 |
| 下行 | `{"type":"recording"}` | 已接受按下 |
| 下行 | `{"type":"thinking"}` | 已接受松开，准备回复 |
| 下行 | `{"type":"audio_start"}` | 当前回复播放计数归零 |
| 下行 | `{"type":"audio_end"}` | 音频发送完，设备播完剩余缓冲 |
| 下行 | `{"type":"idle","reason":"too_short"}` | 音频不足 100ms，不生成 |
| 下行 | `{"type":"error","message":"..."}` / `{"type":"offline"}` | 停播放、关闭并重连 |

先收到 ready 再发 ptt_down，随后流式 binary，最后 ptt_up。少于 100ms 丢弃，超过 30s 断开。按键不支持双击/锁定发射。换台清空所有本轮输入和上下文；旧上游连接事件通过 epoch 丢弃，取消轮次通过 response metadata 与 response_id 排除旧音回流。

网关对模型生成的突发做有界实时发送。C6在PCM模式下使用2秒环形缓冲、1.4秒起播水位；协商μ-law后为4秒容量、3秒起播水位。S3使用12秒PSRAM环形缓冲、4秒起播水位。水位仅用于起播和耗尽后的重缓冲，正常连续播放不重复等待。played是扣除最大DMA队列后的估算，不能当作精确硬件播放时钟。

## C6 可协商下行 μ-law（24kHz）

C6新固件在握手发送 `X-Voxi-Audio-Format: mulaw8-24000`，网关在每个ready中确认 `audioFormat: mulaw8-24000` 后，才使用每样本1字节的G.711 μ-law压扩编码下行；采样时钟仍为24kHz，不是电话8kHz。上行麦克风、Pocket WebRTC和记忆转写仍是PCM16，不受影响。旧固件或S3未声明此能力，网关继续PCM16；新C6连接旧网关若ready未确认格式，自动使用PCM16。

网关在滤波和实时节流后编码，不改变20ms帧时长和audio_end排序。设备按协商格式计算采样数、播放时间和缓冲时长；CRC比较传输的编码字节，不代表上游没有丢音。新C6保持96000字节环形缓冲，μ-law可存4000ms，起播3000ms，耗尽后最高3600ms；增加开口延迟并带来少量压扩量化损失，不能找回WebRTC已丢失的语音。S3继续PCM16和12秒PSRAM缓冲。

USB状态新增 `deviceId`、`replyTransportFormat`、`replyWireBytesPerSecond`，可验证设备绑定和压缩协商。μ-law优化仅需升级Voxi网关，不需要再次修改Pocket语音协议。
