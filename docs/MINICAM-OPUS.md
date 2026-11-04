# MiniCam 4G Opus 下行 · 2026-11-04

## 目标和兼容

4G 回复由 `mulaw8-24000`（192kbps）升级为 `opus-24000-v1`：24kHz、单声道、20ms 帧、Opus VOIP、24kbps CBR。有效音频约 3000B/s，加每帧 4 字节顺序编号后约 3200B/s；WebSocket、TLS、TCP 和串口 HEX 开销另算。Wi-Fi 和其他板型保留原音频路径；录音上传仍为原来的 PCM，暂未压缩。

设备继续带 `X-Voxi-Audio-Format: mulaw8-24000`，另带 `X-Voxi-Downlink-Codecs: opus-24000-v1,mulaw8-24000,pcm16-24000`。新 Pocket 网关选择 Opus，并通过 `ready.audioFormat` 返回实际格式。旧网关忽略新能力字段、继续使用 µ-law，新固件按返回格式解码。未确认 Opus 前绝不将旧 PCM/µ-law 当作 Opus。

## 协议与播放

每个 WebSocket 二进制消息是一帧：4 字节 little-endian 顺序号（每个 audio_start 从 0 开始）加原始 Opus packet。每帧解码为 480 个 16-bit PCM 采样。错序、缺帧、损坏帧或解码失败显式报错并断开恢复，不跳过字词。编码器按 audio_start 重置；尾帧补零并额外排空一帧编码器延迟，避免最后一个音节被截断，附加不足 40ms 尾部时间。

S3 在主音频任务中解码，使用原有 PSRAM PCM 环形缓冲和 I2S 播放。只有确认 Opus 的 4G 连接使用 2 秒首次预缓冲、自适应最多 6 秒、1 秒中途恢复门槛。原有 µ-law 的参数不变。audio_start 显示 BUFFERING，真正开始输出音频后显示 PLAYING。

`replyWireReceivedBytes` 是压缩消息字节；Opus 模式下 `replyReceivedBytes` / `replyConsumedBytes` 及对应 CRC 比较的是本机解码后 PCM 的接收/播放完整性，不是与有损压缩前源 PCM 比较。`opusDecodedFrames`、`opusDecodeErrors`、`opusDecodeMaxUs` 用于性能和错误诊断。

## 依赖与验证

云端使用固定版本 `opusscript@0.1.1` 的 libopus WASM，不依赖 Alpine 原生编译工具。设备使用 Espressif `esp_audio_codec` 2.6.2 的 ESP32-S3 专用库，仅链接 Opus decoder。来源、提交和许可证见 `firmware-c6/vendor/esp_audio_opus/NOTICE`；该预编译库仅用于 Espressif 设备，不在服务器执行。

自动测试覆盖 24kbps 固定码率、帧序号、实际解码、尾帧排空、跨轮状态重置、PCM/µ-law 回退、Pocket 网关端到端传输。固件另有空闲时的 `opus_probe` USB 自检：传入从序号 0 开始的单帧十六进制消息，返回解码采样数、峰值、耗时和 CRC，不播放声音，也不提交 AI。

## 云端部署

只更新 Voxi 网关，无需改动 codex-pocket-cloud 后端：

```bash
cd ~/Voxi
git -c core.hooksPath=/dev/null pull --ff-only
sudo bash deploy/deploy.sh
sudo bash deploy/check-opus.sh
```

自检应显示 `ok:true`、`format:opus-24000-v1`、`audioBitrate:24000` 和 `wireBytesPerSecond:3200`。随后设备重连，USB 状态中的 `replyTransportFormat` 必须变为 `opus-24000-v1` 才表示实际启用；仅烧录新设备固件而不部署云端，仍是旧格式。

## 本机验证状态

- 网关 49 项测试通过，包括真实 Opus 编解码、固定码率、尾部排空和旧格式兼容；帧序号、播放门控和按键本地测试通过。
- MiniCam 和 C6 构建通过。当前音量＋录音版 MiniCam 已烧录新固件，写入 Hash 校验成功，保留 Wi-Fi/4G、令牌、CA 和唯一设备 ID。
- 网关编码器生成的真实帧已通过 USB 送入实际 ESP32-S3：解码为 480 采样，峰值 9339、耗时约 2965µs；错序和非法帧拒绝测试通过。
- 云端尚需部署本版本，才能实际协商 Opus；旧云端上的当前连接继续按旧格式运行。长故事改善程度、低信号和高重传效果仍待部署后现场验证。压缩降低带宽需求，不保证消除断网或严重 TCP 重传。
