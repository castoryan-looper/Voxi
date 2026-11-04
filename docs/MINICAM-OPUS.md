# 统一 Opus 下行 · 2026-11-04

## 目标和兼容

当前维护的 C6、S3G、AMOLED 和 MiniCam（含 GPIO11 改装目标）统一使用 `opus-24000-v1` 下行，Wi-Fi 与 4G、网关 mock/OpenAI/Pocket 均相同：24kHz、单声道、20ms 帧、Opus VOIP、16kbps CBR。标识中的 24000 是采样率，不是码率。首版 24kbps 仍遇到重传/卡顿，因此默认进一步降至 16kbps。有效音频约 2000B/s，加每帧 4 字节顺序编号后约 2200B/s；WebSocket、TLS、TCP 和串口 HEX 开销另算。录音上传仍为原来的 PCM，暂未压缩。

设备声明 `X-Voxi-Audio-Format: opus-24000-v1`，能力字段也仅列出 `opus-24000-v1`，通过 `ready.audioFormat` 确认。按用户要求已删除旧下行编解码与自动回退；云端缺失或收到其他格式时返回 `opus_required` 并关闭，新固件遇到不支持 Opus 的云端也明确提示升级，不播放错误格式。更新后的网关要求旧设备同步更新固件。

## 协议与播放

每个 WebSocket 二进制消息是一帧：4 字节 little-endian 顺序号（每个 audio_start 从 0 开始）加原始 Opus packet。每帧解码为 480 个 16-bit PCM 采样。错序、缺帧、损坏帧或解码失败显式报错并断开恢复，不跳过字词。编码器按 audio_start 重置；尾帧补零并额外排空一帧编码器延迟，避免最后一个音节被截断，附加不足 40ms 尾部时间。

所有板型在主音频任务中解码，再通过原有 I2S 播放。S3 使用 PSRAM PCM 环形缓冲、2 秒首次预缓冲、自适应最多 6 秒、1 秒中途恢复门槛。C6 使用 96KB 内部 PCM 环形缓冲，初始 1.4 秒、最多约 1.7 秒、0.6 秒中途恢复，水位不会增长超过缓冲容量。audio_start 显示 BUFFERING，真正开始输出音频后显示 PLAYING。

`replyWireReceivedBytes` 是压缩消息字节；Opus 模式下 `replyReceivedBytes` / `replyConsumedBytes` 及对应 CRC 比较的是本机解码后 PCM 的接收/播放完整性，不是与有损压缩前源 PCM 比较。`opusDecodedFrames`、`opusDecodeErrors`、`opusDecodeMaxUs` 用于性能和错误诊断。

## 依赖与验证

云端使用固定版本 `opusscript@0.1.1` 的 libopus WASM，不依赖 Alpine 原生编译工具。设备使用 Espressif `esp_audio_codec` 2.6.2，按芯片选择 ESP32-S3 或 ESP32-C6 库，仅链接 Opus decoder。来源、提交、校验和及许可证见 `firmware-c6/vendor/esp_audio_opus/NOTICE`；预编译库仅用于 Espressif 设备，不在服务器执行。

自动测试覆盖 16kbps 固定码率、帧序号、实际解码、尾帧排空、跨轮状态重置、拒绝缺失/旧格式、Pocket 网关端到端传输以及持续下行时仍定期发送 Ping、服务端接受 Ping/有效设备帧作为存活证据。各板型固件另有空闲时的 `opus_probe` USB 自检：传入从序号 0 开始的单帧十六进制消息，返回解码采样数、峰值、耗时和 CRC，不播放声音，也不提交 AI。

## 云端部署

只更新 Voxi 网关，无需改动 codex-pocket-cloud 后端：

```bash
cd ~/Voxi
git -c core.hooksPath=/dev/null pull --ff-only
sudo bash deploy/deploy.sh
sudo bash deploy/check-opus.sh
```

自检应显示 `ok:true`、`format:opus-24000-v1`、`opusOnly:true`、`audioBitrate:16000` 和 `wireBytesPerSecond:2200`。随后设备重连，USB 状态中的 `replyCodecConfirmed=true`、`replyAudioBitrate=16000` 和 `cloudReady=true` 表示已确认 16kbps Opus 并就绪。新版不允许旧格式回退。未插到本机的其他设备只能交付编译产物，不能假定已烧录。

## 本机验证状态

- 网关统一格式及心跳调整后 51 项测试通过，包括真实 Opus 编解码、固定码率、尾部排空、缺失/旧格式明确拒绝和设备 Ping/消息刷新存活；帧序号、播放门控、蜂窝心跳和按键本地测试通过。
- 全部五个维护中的构建目标通过：C6、S3G、AMOLED、MiniCam 标准版、MiniCam GPIO11 改装版。当前音量＋录音版 MiniCam 已烧录最终统一 Opus/双向心跳固件，写入 Hash 校验成功，保留 Wi-Fi/4G、令牌、CA 和唯一设备 ID。其他设备未连接，未声称已烧录或完成实机性能验收。
- 网关 16kbps 编码器生成的真实帧已通过 USB 送入实际 ESP32-S3：解码为 480 采样，峰值 9205、耗时约 3035µs；错序和非法帧拒绝测试通过。
- 用户已部署首个 Opus 版本，实际设备已确认 `opus-24000-v1` 并恢复 READY。去除回退后的统一版本还需更新云端和各板型固件；长故事改善程度、低信号和高重传效果仍待现场验证。压缩降低带宽需求，不保证消除断网或严重 TCP 重传。

首版 24kbps 实际播放记录：成功解码 2368 帧、解码错误 0，最大解码约 5357µs，但最终模组报告 `MIPURC disconnect: 2`；另一轮音频收包空档达到约 41.8 秒后断线。不能把此类 TCP 故障归为 Opus 解码失败，也不能宣称压缩已根治断线。最新版播放期间每 15 秒仍会主动发 Ping，服务器将收到的 Ping 和有效设备流量计为存活，仍保留真正失联后的关闭机制。
