# ESP32-S3 录音上行 Opus

MiniCam 的标准音量＋录音和 GPIO11 改装目标支持压缩上行，Wi-Fi/ML307 共用；后续也已移植到 S3 AMOLED 和 S3G（宏 `VOXI_OPUS_UPLINK`），两类任务的栈均使用 32KB。C6 暂保留原有 PCM 上行。所有维护板型的回复下行仍统一为 16kbps Opus。

## 目的与边界

原始麦克风 PCM 为 24kHz、单声道、16bit，约 48KB/s。ML307 上传故障导致一次 6.6 秒录音的松手到起声耗时 40.73 秒，其中重连及上传 28.874 秒、云端到首包 8.471 秒、播放预缓冲 3.385 秒。上行改为 16kbps CBR Opus，并每五个 20ms 帧合并发送一次，满包约 2.25KB/s，减少流量和模组 AT 命令频次。合包最多引入 100ms 等待；部分包在结束录音时立即发出。

首轮录音补传的重连等待由 5 秒缩短到 1 秒；只允许一次补传，后续连接失败仍使用原来的重试间隔。提交 `ptt_up` 已尝试后不自动重发整轮，以免重复触发 AI。

这项优化不等于修复所有播放断线。已观察到云端 ICE consent 过期与设备上传失败两类问题。新增设备诊断保留 WebSocket 关闭码和关闭原因，首个回复中断原因不会被后续重连错误覆盖。

## 数据与恢复

麦克风仍先写原有 Flash PCM 缓存，再由网络任务编码，不在录音/播放任务里编码。重连补传从缓存起点重新编码并重置序号。`micBytes`、`sentBytes` 和上传 CRC 继续衡量原始 PCM 是否完整进入发送流程，不是压缩后的数据量，也不是服务端解码后 PCM 的 CRC。Opus 有损，不能要求解码 PCM 与原始 PCM CRC 一致。压缩线路字节数单独记录。

编码器结尾补零并发送一个额外帧排出算法延迟，避免截掉最后音节；实际提供给 Pocket 的音频最多比录音多不足 40ms。原始录音仍限制 20 秒，序号、包长度和累计采样数均由网关检查。内部 Pocket 链路继续使用 PCM，不需要更新 Pocket 后端。

原始 PCM 压测 `upload_test` 特意保留 PCM，用于测试大流量与缓存补传，并非 Opus 性能测试。实际芯片编码/网关解码自检使用 `tools/test_uplink_device.py COM15`，只生成测试信号，不上传私人录音。

## 协议

网关 READY 增加 `uplinkFormat: "opus-24000-uplink-v1"`。MiniCam 仅在网关明确确认后在 `ptt_down` 带 `audioFormat` 同值，随后本轮使用压缩包；尚未更新的网关不会被误送压缩音频。原有板型及合成 PCM 压测省略该字段，沿用 PCM。网关下行 Opus-only 要求保持不变。

每个二进制包：

- 4 字节小端首帧序号，随后 1 字节帧数（1–5）。
- 每帧 2 字节小端原始有效采样数（0–480），2 字节小端 Opus 长度（固定 40），以及 Opus 数据。
- 满帧有效数 480，末尾部分帧小于 480，排延迟帧有效数 0 且必须是最后一帧。每帧解码均为 480 个 24kHz 采样。
- 满包 225 字节，单帧 49 字节。序号在每次 `ptt_down` 归零；重试也是新轮。

设备状态增加 `uplinkOpusReady`、`opusUplinkFrames`、`opusUplinkErrors`、`opusUplinkMaxUs`、`opusUplinkWireBytes`、`cellularLinkFailure`、`cellularLinkFailureAtMs`、`cellularRemoteCloseCode`。网关 `device_upload` 记录该轮格式、线路字节数、解码字节数和原始采样数。

## 部署

设备固件与网关需要配合更新；当前 Pocket 无需改变。

```bash
cd ~/Voxi
git -c core.hooksPath=/dev/null pull --ff-only
sudo bash deploy/deploy.sh
sudo bash deploy/check-uplink.sh
```

自检应显示 `uplinkFormat:opus-24000-uplink-v1`、`audioBitrate:16000`。实际启用需再确认设备 `uplinkOpusReady:true`，并在一次真实对话后检查 `device_upload`。

## 已完成验证

- 网关 55 项测试通过：解码与转发到 Pocket、结束标记顺序、原始时长上限、帧序号、尾帧、非法格式与畸形包拒绝。
- 真实 S3 编码自检：原始 9600 字节/4800 采样，11 帧共 499 线路字节，网关解码 10560 字节且测试信号能量正常；编码错误 0，最慢帧约 9.067ms。
- 实机发现 SILK 编码所需栈超过原有任务空间，MiniCam 的 Arduino 和网络任务调整为 32KB 后通过真实编码测试；后续 AMOLED/S3G 上行适配也使用同一栈配置，C6 栈大小不变。
- 全部五个维护目标最终构建通过；最终标准 MiniCam 固件已烧录，Hash 校验通过。最终芯片自检最慢帧 9.227ms，尾帧 RMS 5604，确认尾部延迟音频排出。
- 用户已部署 `595bf72274fadabeaed02a123b5d77292f342a02`，`check-uplink.sh` 通过；USB 确认 `uplinkOpusReady:true`、READY。自检时可用内部堆约 39KB、最低约 27KB。
- 云端正式部署后的真实麦克风长故事、丢网补传、实际耗电仍需现场验证，不能把合成自检当作已根治 offline。已启动真实对话采集；新诊断曾保留一条 `4G heartbeat timeout (0)`，不能仅凭这条历史记录解释此前所有中断。

### 首轮真实压缩上传

实测 4.26 秒录音：原始 204480 字节，Opus 线路 9631 字节，214 帧、编码错误 0、重试 0，原始录音和发送流程 CRC 一致。松手后设备发送收尾约 117ms，录音过程中已发送 199680 字节对应的原始内容。

同轮下行仍有超过 21 秒收包空档，首包到实际播放约 43.172 秒，松手到起声约 53.466 秒；解码、扬声器、DMA 错误仍为 0。因此不能用上行 117ms 收尾来宣称端到端响应已变成 117ms，或宣称整体等待已根治。已请求播放时的云端 TCP 统计继续定位。`opusUplinkMaxUs` 在实际任务中记录到约 56ms，包含任务抢占时间；它不是编码器纯 CPU 耗时，不能沿用合成测试 9ms 作为实际帧最坏上界。
