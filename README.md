# Voxi · AI 对讲机

支持 **微雪 ESP32-C6-ePaper-1.54** 、**ESP32-S3-ePaper-1.54G 四彩屏** 与 **ESP32-S3-Touch-AMOLED-1.8 V2**：按住 BOOT 讲话，松开听 AI；EC11 旋钮切换四个 AI 频道。复用板载麦克风、ES8311、功放与墨水屏，云端语音网关部署在腾讯云 Linux 主机。

仓库：https://github.com/castoryan-looper/Voxi

## 先看这里

- [Voxi Agent 与管理员后台](docs/VOXI-AGENT.md)：沿用 Pocket Cloud 的后台任务、频道路由、批准、中断和密钥保管。
- [用户空间与账户](docs/USER-ACCOUNTS.md)：普通用户配置自己的资料、频道和助手，管理员开通账户并维护全局设置。

- [换电脑接续／最新开发交接](docs/handoffs/LATEST.md)
- [MiniCam 4G 缓存补充优化](docs/MINICAM-JITTER.md)：小智策略参考、有界播放额度、2/3/4 秒恢复及验证边界。
- [MiniCam Wi-Fi TLS 内存修复](docs/MINICAM-WIFI-MEMORY.md)：按联网方式延迟启动 4G DMA 与任务，保留内部内存供 Wi-Fi TLS 使用。
- [脱敏开发对话记录](docs/conversations/README.md)

- [复用已登录的 Pocket Cloud，无需 API Key](docs/POCKET-BACKEND.md)
- [网页配置与本机烧录](docs/WEB-SETUP.md)：USB 网页设置 Wi-Fi/令牌/根 CA，无需预填 config.h。
- [腾讯云部署命令](docs/TENCENT-CLOUD.md)：管理页面主机终端操作，不需要 SSH。默认 WSS `43.160.215.253:9443`，保留已有 8448 服务。
- [正辰 MiniCam 2.0 英寸适配进度](docs/zhengchen-minicam-2.0.md)：独立构建、ES8388 / ST7789，已实测显示、出声与 ML307R 4G 对话。
- [MiniCam 4G 配置与验证](docs/MINICAM-4G.md)：Wi-Fi / 4G 切换、APN、CA 校验和 DMA 串口。
- [统一 Opus 下行](docs/MINICAM-OPUS.md)：所有维护板型、Wi-Fi/4G 均为 16kbps Opus，不再回退旧下行格式；更新网关时需同步更新各设备固件。
- [MiniCam 分级待机](docs/MINICAM-STANDBY.md)：1 分钟关屏保连接、5 分钟释放云端会话、15 分钟休眠，USB 页面可调整。
- [MiniCam 暗色界面](docs/MINICAM-UI.md)：Wi-Fi / 4G / USB 状态图标、大号频道与对讲状态，屏幕不再显示调试日志。
- [S3 录音上行 Opus](docs/MINICAM-UPLINK-OPUS.md)：MiniCam / AMOLED / S3G 的 16kbps 压缩录音上传、合包发送和首次补传提速，需网关支持（当前已部署）。
- [Wi-Fi 心跳修正](docs/WIFI-HEARTBEAT.md)：避免只等 3 秒 Pong 而在音频仍到达时提前断开，保留有界失联检测。
- [AMOLED 1.8 V2 支持](docs/WAVESHARE-AMOLED18-V2.md)：实时状态、触摸对讲、CO5300/CST820。
- [S3G 四彩屏编译与接线](docs/WAVESHARE-S3G.md)：8MB PSRAM、独立构建目标和静态彩屏。
- [C6 接线与编译](docs/WAVESHARE-C6.md)：BOOT 对讲、GPIO16/17 旋钮、证书与 Wi-Fi 配置。
- [服务器空间与旧 Codex 处理](docs/SERVER-SPACE.md)
- [开发计划与验收](docs/PLAN.md)
- [音频设备协议](docs/PROTOCOL.md)

## 工程

| 目录 | 用途 |
|---|---|
| firmware-c6/ | 共用 C6 / S3G / AMOLED V2 / MiniCam 源码，四个 PlatformIO 构建目标 |
| firmware/ | 历史 S3 外接音频原型，不再兼容当前统一 Opus 网关，请使用 firmware-c6/ |
| gateway/ | Node.js 22+ 流式网关，mock / OpenAI Realtime |
| deploy/ | Docker Compose、TLS、首次部署、自动拉取与健康检查 |
| .github/workflows/ | 网关测试、镜像构建与 C6 编译 CI |

## 本地模拟

```powershell
cd gateway
Copy-Item .env.example .env
# 修改 DEVICE_TOKEN
npm ci
npm test
npm start
```

本地固件用 `GATEWAY_TLS=0`、电脑局域网 IP 和 8787 端口，仅用于可信局域网。mock 返回约 300ms 测试音，不调用识别或合成接口。云端默认使用 WSS 和设备信任的根 CA。

## 自动更新

首次执行 `deploy/bootstrap.sh` 后，服务器每分钟从 main 拉取。新提交会触发镜像构建、测试、候选健康检查，再重建服务。部署失败会保留旧版本或尝试网关镜像回退。手动 `git pull --ff-only` 通过 post-merge hook 触发相同步骤。重启期间设备重连，当前对话会中断。

更新影响网关与部署容器，**ESP32 固件仍需手动烧录**，本轮没有无线 OTA。

## 对话与声音

四个虚构角色：营地、巡逻、夜航、探索。当前共用 marin 音色，回复短、自然接话，网关加无线电带通与软限幅。关闭 VAD，以物理松键提交，24kHz PCM 流式传输。默认模型 `gpt-realtime-2.1` 需要账号具备权限，模型与声音可在服务器配置。

API Key、设备令牌和 TLS 私钥不能提交仓库。服务器配置在 `/etc/voxi`，设备连接配置保存在 NVS，USB 网页直接读写；可选 config.h 只保留硬件覆盖。

## 验证边界

网关具备 mock 自动化测试；CI 检查网关、镜像和 C6 编译。尚未连接实体 C6 或使用真实 Key 联调；GPIO、电源、音频槽、屏幕波形、听感和端到端延迟需要上板确认。热会话松键到首音目标 P50 0.6–1.2 秒，属于待实测指标。

依据：[微雪资料](https://docs.waveshare.com/ESP32-C6-ePaper-1.54)、[OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations)、[腾讯云 Docker](https://intl.cloud.tencent.com/document/product/213/37516?lang=en)。

公网设备管理：见 [部署和使用说明](docs/CLOUD-ADMIN.md)，支持在线连接查看与数量上限实时调整。

设备自动待机：MiniCam 使用可配置的 [1／5／15 分钟分级待机](docs/MINICAM-STANDBY.md)，前两级唤醒无需整机重启；其他板型空闲60秒关闭无线、音频和显示，通过按键/AMOLED触摸唤醒，详见 [待机设计与验收](docs/STANDBY.md)。
