# 语音延迟统计

本轮仅增加统计，未改变录音、发送、VAD、音量或播放缓冲策略。

设备 status.latency / 网页过程日志：

| 字段 | 口径 |
|---|---|
| recordedMs | 实际 PCM 样本时长，不含长按和提示音 |
| cueAndGuardMs | 长按确认到麦克风保护结束 |
| releaseToUploadMs | 松手/自动停止到缓存上传开始 |
| uploadMs | 上传开始到本机 WebSocket 成功写出 ptt_up；不是云端确认 |
| submittedToFirstPcmMs | 写出 ptt_up 到设备收到首段回复 PCM |
| firstPcmToVoiceWriteMs | 收到首段 PCM 到首次写入回复人声 I2S，包含预缓冲和开台音 |
| releaseToVoiceWriteMs | 松手到首次写入回复人声 I2S |
| dacQueueUpperBoundMs | 输出 DMA 队列最多约 60ms；实际扬声器起音需加此队列延迟，软件无法精确听测 |

尚未发生的阶段为 null，不能当成 0ms。各阶段使用本机单调时钟，跨服务器不直接相减时间戳。真实对话建议至少比较约 3 秒和 10 秒两轮，记录是否冷启动、是否重连及重新缓冲次数；一轮数据只代表该次网络状况。

Pocket Cloud 在回复起点发送 timing 事件并记录 Native voice timing：

- releaseToAudioStartMs：云端收到并提交本轮录音到回复起点事件/语音起点检测的时间。
- rtpEmittedMs：这轮队列中已交给 WebRTC track 的音频时长（含尾部静音），不是 AI 确认接收/识别进度。
- rtpQueuedMs：本轮录音时长加现有 800ms 尾部静音。

submittedToFirstPcmMs 包含网络、录音经 RTP 实时送出、VAD 和模型响应，当前协议未提供独立 ASR 完成时间，不能把此值全部称为识别耗时。代码确认云端在松手后才排队按实时播放速度发送录音，但首个回复的实际等待仍须测量，不能简单断言等于录音时长。
