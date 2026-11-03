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


## 并行上传一轮

新固件 streamingUpload=true：在开台提示音和麦克风保护结束后发 ptt_down，采样继续顺序写 Flash，同一批 PCM 在发送队列有余量时直接上传。录音期间不回读文件，避免读写切换阻塞采样。队列没有余量时保留已排队前缀，并把其余数据留在 Flash；这轮不再跨越未发送区直接发送后续数据，松开后从已排队前缀末尾顺序补发，因此不会漏包、重复或乱序。松开/20秒上限后才封口，最后一个 PCM 包写出后再发送 ptt_up。文件写入和尾部读取由主任务处理，删除由独立任务执行；清理期间禁止开始下一轮以避免文件生命周期冲突。网络任务不操作文件。网络读取即使阻塞也不再用 RAM 队列承接整段录音，因此恢复了上传期间的 WebSocket 接收，以处理控制帧和心跳。

本轮保持 Pocket Cloud 在 ptt_up 后才把完整录音提交到实时 RTP。自动断句协议尚没有验证过严格的手动结束控制，直接向模型流式送入会有中途停顿触发提前回答的风险。本轮优先消除上传与录音串行的等待，不声称已消除云端实时重放成本。

计时口径同步：uploadMs 在新固件表示松手到本机写出 ptt_up 的收尾等待；captureUploadSpanMs 为整个边录边传跨度；bytesSentAtRelease 表示松手时已发送的 PCM 字节数。旧版 uploadMs 从松手后的上传开始计时，比较时应结合 streamingUpload 标记。缓存 IO 新增 cacheWriteMaxMs/cacheReadMaxMs/cacheFinishMs/cacheRemoveMs 用于定位文件操作延迟。


实机压力测试还发现：单个读写句柄反复 seek 时最大读写操作约 275ms，删除约 7.7 秒。最终实现避免录音中回读，并异步清理，不能让缓存删除阻塞接收回复。缓存保护目标是保证网络积压时不因队列满而丢录音，弱网情况下仍可能退回松手后补发；不保证每轮都完全隐藏上传耗时。


上传恢复：尚未尝试写出 ptt_up 时发生发送失败或断线，保留本轮完整缓存；录音尚未结束时继续本地录音，重连 READY 后从头重传到新会话，每轮最多一次，90秒内未恢复则保留缓存并报错。只要开始尝试写出 ptt_up 就禁止自动重放，因为无法确认服务端是否已收到，不可冒险重复提交 AI。uploadRetries / uploadRetryPending 表示恢复状态；重试会增加本轮等待，不保证消除网络故障。

底层 Arduino NetworkClientSecure 的 lastError 在握手成功后可能仍保存正数 socket 描述符（观察到 48）。因此不能把旧版 TLS=48 当作真实 TLS 错误。诊断仅在负值时解码 TLS 错误，另记录失败帧类别、字节数、写入耗时和 errno（后者也不是完整网络根因）。音频使用带预留头部的缓冲合并为一次 WebSocket 帧写入。内部 upload_test 可设置 body.simulateStall=false 做正常链路完整性测试；默认仍模拟3.5秒停顿，二者都不提交给模型，结果 uploadProbeTailMs 是停止采样到完整上传的收尾时间。


缓存文件系统：优先挂载 LittleFS。旧 SPIFFS 只有在根目录为空或仅含本程序的 voxi-turn.pcm、且无子目录时才迁移为 LittleFS；若存在其他文件就保留原文件系统，未知非空分区仍拒绝格式化。该迁移针对已授权的录音缓存分区，不改变分区表；此前原始分区备份保存在本机 backups 中。SPIFFS 反复循环写入时实测写操作超过500ms，LittleFS 迁移后已验证挂载成功，不能仅凭挂载成功声称链路故障已消失。

内部完整性测试默认不恢复，便于暴露原始链路失败；显式 body.allowRecovery=true 时才按真实录音的未提交恢复路径测试。无论该选项如何，合成测试都在完整发送后断开临时会话，不发送 ptt_up 给模型。报告必须同时列出 uploadRetries 与失败/通过状态，不可把重试成功当成零故障。
