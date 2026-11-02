# 设备协议 v0

连接 `ws://<gateway>:8787/radio`；HTTP Header：`Authorization: Bearer <DEVICE_TOKEN>`。API Key 仅网关持有。

二进制消息双向均为无头 PCM16LE、24kHz、单声道。网关下行每帧最多 960 字节（20ms）；设备当前上行最多 480 字节（10ms）。不含 WAV 文件头。JSON 为文本帧，音频为 binary 帧；同连接顺序传输。

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

网关对模型生成的突发做有界实时发送，设备保留约 40ms 起播缓冲、最多 1 秒环形缓冲。慢连接超过阈值时终止而不无限排队。原型 played 是估算，不能当作精确硬件播放时钟。
